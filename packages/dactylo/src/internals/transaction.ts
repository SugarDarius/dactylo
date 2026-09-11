import { findNodeInBlock } from './blocks'
import type { BlockId, BlockWithoutPosKey } from './blocks'
import { DEFAULT_BATCH_MAX_SIZE } from './constants'
import {
  collectTextSpansInRange,
  compareTextCursors,
  computeInsertBlockPosKey,
  getBlock,
  normalizeRange,
  resolveInsertAfterBlockId,
} from './document'
import { createInitialEditorContext } from './editor-context'
import type { EditorContext } from './editor-context'
import { DactyloError } from './errors'
import type { Observable } from './event-source'
import { EventSource } from './event-source'
import { HistoryStack } from './history'
import type { HistoryEvent } from './history'
import { detectPlatformKeyboardShortcut } from './keyboard'
import { isMarkEnabled, toggleMarkFlag } from './marks'
import type { MarkKey, Marks } from './marks'
import type { Operation, InsertBlockOpPosition } from './operations'
import { applyOps, invertOps, validateOps } from './operations-engine'
import { assertNever } from './utils'

/** The source of a transaction. */
export type TransactionSource =
  /**  The transaction is initiated by a human user action */
  | 'user'
  /** The transaction is initiated by an AI agent action */
  | 'ai-agent'
  /** The editor decided itself to initiate a transaction */
  | 'editor'
  /** The transaction is initiated by an import (ex. initial content) operation */
  | 'import'
  /** The transaction is an undo history operation */
  | 'undo'
  /** The transaction is a redo history operation */
  | 'redo'

/**
 * The policy layer as metadata about a {@link Transaction} not about individual operations.
 * It tells the commit phase how to treat an otherwise normal operation
 * without polluting the operations themselves or branching the apply engines.
 *
 * We don't put this on operations as they must stay:
 *  1. pure
 *  2. invertible
 *  3. serializable
 *
 * Adding `source: 'undo'` on every `insert_text` operations would:
 *  - Complicate the `invert()` -- meta fields would need stripping
 *  - Leak commit policy in the apply stage logic
 *  - Break the rule than operations describe document changes only
 *
 */
export interface TransactionPolicy {
  /**
   * Human-readable label of the transaction
   * for debugging, DevTools, Ai tracing, ...
   */
  label?: string

  /**
   * Whether to push this transaction to the history stack.
   * When set to `false`, commit phase skips history push.
   * Defaults to `true` -- history records the transaction.
   */
  pushToHistory?: boolean

  /**
   * Who/what initiated the transaction.
   * It drives history rules, hooks filtering, ...
   */
  source?: TransactionSource

  /** When true, merge history action for rapid typing coalescing. */
  coalesce?: boolean
}

/** Callback to invoke when the batch is flushed. */
export type BatchFlushCallback = (
  /** The operations that were flushed. */
  ops: readonly Operation[],
  /** The policy that was used for the flush. */
  policy?: TransactionPolicy,
) => void

/** Options for constructing a {@link Batch} instance. */
export interface BatchOptions {
  /**
   * Max operations held before auto-flush.
   * defaults to 512
   */
  maxSize?: number

  /** Callback to invoke when the batch is flushed. */
  onFlush: BatchFlushCallback
}

/**
 * A dedicated `Batch` class for efficiency and control.
 *
 * | Concern               | Inline arrays                    | `Batch` class                           |
 * |-----------------------|----------------------------------|-----------------------------------------|
 * | Memory on large paste | Unbounded queue until batch ends | `maxSize` auto-flush chunks the queue   |
 * | Mid-batch commit      | Not possible                     | `flush()` commits now, batch stays open |
 * | Error recovery        | Manual queue cleanup             | `discard()` drops pending ops safely    |
 * | Testing               | Requires full `Dactylo` instance | Test queue/flush in isolation           |
 * | Observability         | No metrics                       | `pendingCount`, `depth` exposed         |
 *
 * Semantics:
 *
 * enqueue(op) ──► queue[]
 *                │
 *                ├─ queue.length >= maxSize ? ──► flush() ──► onFlush(ops) ──► runTransaction
 *                │
 * batch.run(fn) ──► depth++
 *                 fn() calls enqueue…
 *                 depth--
 *                 depth === 0 && queue not empty ? ──► flush()
 *
 * Tradeoff: `maxSize` against single undo step
 *
 * A paste of 5 000 paragraphs may exceed `maxSize`. Auto-flush produces **multiple history entries** (multiple undo steps).
 * Options:
 *  1. Default `maxSize: 512` — safe memory; large pastes = multi-step undo
 *  2. `batchMaxSize: Infinity` in options — single undo for huge paste; higher memory peak
 *  3. `flush()` at end of paste handler — one explicit commit; `maxSize` only guards runaway loops
 *
 *  Max size override:
 *  Without {@link Batch#maxSizeOverride}, you would have to create a second `Batch` instance for paste,
 * or permanently raise the global limit and lose memory protection for normal edits.
 */
export class Batch {
  /** Max operations held before auto-flush. */
  readonly #maxSize: number

  /** Callback to invoke when the batch is flushed. */
  readonly #onFlush: BatchFlushCallback

  /** Queue of operations. */
  #queue: Operation[]

  /** Depth of the batch. */
  #depth: number

  /** Policy for the batch. */
  #policy?: TransactionPolicy

  /** Temporary override for the current `run()` scope only (e.g. paste). */
  #maxSizeOverride: number | undefined

  constructor(options: BatchOptions) {
    this.#maxSize = options.maxSize ?? DEFAULT_BATCH_MAX_SIZE
    this.#onFlush = options.onFlush

    this.#queue = []
    this.#depth = 0
  }

  /** True while inside `run()`. */
  get active() {
    return this.#depth > 0
  }

  /** Nesting level (0 = outside batch). */
  get depth(): number {
    return this.#depth
  }

  /** Ops waiting to be committed. */
  get pendingCount(): number {
    return this.#queue.length
  }

  /** True when queue has ops (inside or outside batch). */
  get hasPending(): boolean {
    return this.#queue.length > 0
  }

  /** Effective limit: override during `run(..., { maxSize })`, else instance default. */
  #effectiveMaxSize(): number {
    return this.#maxSizeOverride ?? this.#maxSize
  }

  /**
   * Commit queued ops now. Clears queue; does not exit batch scope.
   * No-op if queue is empty.
   */
  flush(policy?: TransactionPolicy): void {
    if (this.#queue.length === 0) {
      return
    }

    const queue = [...this.#queue]
    this.#queue = []

    const mergedPolicy = { ...this.#policy, ...policy }
    this.#policy = undefined

    this.#onFlush(queue, mergedPolicy)
  }

  /** Add ops to the queue. Auto-flushes when queue would exceed maxSize. */
  enqueue(ops: Operation[], policy?: TransactionPolicy): void {
    if (policy !== undefined) {
      this.#policy = { ...this.#policy, ...policy }
    }

    for (const op of ops) {
      if (this.#queue.length >= this.#effectiveMaxSize()) {
        this.flush()
      }

      this.#queue.push(op)
    }
  }

  /** Drop queued ops without committing. Does not exit batch scope. */
  discard(): void {
    this.#queue = []
    this.#policy = undefined
  }

  /**
   * Run fn inside a batch scope. Flushes remaining queue when outermost scope ends.
   * Pass `{ maxSize: Infinity }` for unbounded queue (large paste).
   */
  run<T>(
    fn: () => T,
    opts: { maxSize?: number; policy?: TransactionPolicy } = {},
  ): T {
    const prevMaxSizeOverride = this.#maxSizeOverride
    if (opts?.maxSize !== undefined) {
      this.#maxSizeOverride = opts.maxSize
    }
    this.#depth += 1

    if (opts.policy !== undefined) {
      this.#policy = { ...this.#policy, ...opts.policy }
    }

    try {
      return fn()
    } catch (err) {
      this.discard()
      throw err
    } finally {
      this.#depth -= 1
      this.#maxSizeOverride = prevMaxSizeOverride

      if (this.#depth === 0 && this.#queue.length > 0) {
        this.flush({ label: 'batch' })
      }
    }
  }
}

export function skipHistoryPush(policy?: TransactionPolicy): boolean {
  return (
    policy?.pushToHistory === false ||
    policy?.source === 'undo' ||
    policy?.source === 'redo'
  )
}

/**
 * A bundle of operations with policy metadata about
 * how to commit them through the pipeline
 */
export interface Transaction {
  /** The operations to apply in the transaction */
  readonly ops: readonly Operation[]

  /** The policy metadata about the transaction */
  readonly policy?: TransactionPolicy
}

/** Events emitted by the transaction pipeline */
export interface TransactionPipelineEvents {
  /**
   * Subscribes to the current editor context changes.
   * Fires anytime the context is updated.
   */
  readonly context: Observable<EditorContext>

  /**
   * Subscribes to the history stack changes.
   * Fires anytime the history stack is updated.
   */
  readonly history: Observable<HistoryEvent>
}

/** Event sources for the transaction pipeline. */
export interface TransactionPipelineEventSources {
  /** The event source for the current editor context */
  readonly context: EventSource<EditorContext>

  /** The event source for the history stack */
  readonly history: EventSource<HistoryEvent>
}

/** Options for constructing a {@link TransactionPipeline} instance. */
export interface TransactionPipelineOptions {
  /** Placeholder text for the editor when no content is written. */
  placeholder: string

  /** Max ops queued before auto-flush. Default 512. Use Infinity for large paste. */
  batchMaxSize?: number

  /** Max undo entries retained by {@link HistoryStack}. */
  historyMaxDepth?: number
}

/**
 * Transaction pipeline
 *
 * The pipeline enforces ordering:
 * Transaction { ops, policy } → validateOps → applyOps → commitEffects
 *                                 ↓ fail
 *                         reject (state unchanged)
 *
 * Commit effects (side effects, not pure):
 *  1. Push to history stack (unless we don't want too)
 *  2. Dispatch hooks and plugins
 *  3. Notify subscribers (UI)
 *
 * Keeping commit separate from apply stage means undo action
 * applies inverted operations through the same apply stage path
 * without re-firing history.
 *
 * Core:
 *
 * The pipeline is is built around three cooperating types:
 *  1. {@link Operation} describing what's change
 *  2. {@link Transaction} bundles operations with metadata: {@link TransactionPolicy}
 *  3. {@link EditorContext} as the before/after snapshot
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                           Transaction                                   │
 * │  ┌─────────────────────────────┐   ┌─────────────────────────────────┐  │
 * │  │ ops: Operation[]            │   │ policy?: TransactionPolicy      │  │
 * │  │ (the structural mutations)  │   │ (how commit should behave)      │  │
 * │  └─────────────────────────────┘   └─────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *          │ validate + apply on                    │ read at commit only
 *          ▼                                        ▼
 *    EditorContext ──────────────► EditorContext
 *       (prev)                         (next)
 *
 * | Type                | Mutable?      | Serialized to disk?   | Role                             |
 * |---------------------|---------------|-----------------------|----------------------------------|
 * | `Operation`         | No (readonly) | Yes (history, logs)   | Atomic mutation step             |
 * | `TransactionPolicy` | No            | Optional (debug logs) | Commit-time policy               |
 * | `Transaction`       | No            | Yes                   | Unit dispatched through pipeline |
 * | `EditorContext`     | No            | `doc` only via export | Full editing snapshot            |
 *
 * The transaction pipeline never asks "what changed in the doc?" alone. It asks "What is the next complete editing snapshot?".
 * That answer is always an {@link EditorContext}.
 */
export class TransactionPipeline {
  /** The batch to use for the transaction pipeline */
  readonly #batch: Batch

  /** Current editor context */
  #context: EditorContext

  /** The history stack to use for the transaction pipeline */
  readonly #history: HistoryStack

  /** Events emitted by the transaction pipeline */
  readonly #eventSources: TransactionPipelineEventSources

  constructor(options: TransactionPipelineOptions) {
    /**
     * Initialize the editor context
     * If no initial content is provided, it creates an empty document
     * with a placeholder.
     *
     * Otherwise initial document state is provider from either:
     *  - a JSON object (validated against the current schema version)
     *  - a markdown string
     *
     * TODO: handle initial content from props
     *  - from JSON
     *  - from markdown string
     */
    this.#context = createInitialEditorContext(options.placeholder)
    this.#batch = new Batch({
      maxSize: options.batchMaxSize,
      onFlush: (ops, policy) =>
        this.#dispatch({
          ops,
          policy: { source: 'editor', ...policy },
        }),
    })
    this.#history = new HistoryStack({
      maxDepth: options.historyMaxDepth,
    })
    this.#eventSources = {
      context: new EventSource<EditorContext>(),
      history: new EventSource<HistoryEvent>(),
    }
  }

  /** Returns the current editor context */
  get context(): EditorContext {
    return this.#context
  }

  // ─── Core pipeline ────────────────────────────────────────────────

  /** Runs the transaction pipeline and updates editor context. */
  /**
   * Dispatches a transaction by running the full pipeline:
   * 1. Validate or reject the operation
   * 2. └- Apply the operation and get the invert operation for history
   * 3. └- Push to history
   * 4. └- Updates the editor context
   * 4. └- Notify subscribers
   *
   * Does not mutate the inputs.
   */
  #dispatch(transaction: Transaction): void {
    const { ops } = transaction

    if (ops.length === 0) {
      return
    }

    try {
      validateOps(this.#context, ops)
    } catch (err) {
      throw DactyloError.wrap(err)
    }

    let next = { ...this.#context }

    next = applyOps(this.#context, ops)
    const inverseOps = invertOps(ops)

    if (!skipHistoryPush(transaction.policy)) {
      /** Only coalesce history entries for user and ai-agent transactions. */
      const coalesce =
        transaction.policy?.coalesce === true &&
        transaction.policy?.source === 'user'

      this.#history.push({ inverseOps, ops: [...ops] }, coalesce)
    }

    this.#context = next
    this.#eventSources.context.notify(next)
  }

  /**
   * Enqueues or immediately dispatches operations depending on batch state.
   * Mental model: #commit([op1, op2, …]) 👉🏻 this user action is one atomic transaction.
   */
  #commit(ops: Operation[], policy?: TransactionPolicy): void {
    if (this.#batch.active) {
      this.#batch.enqueue(ops, policy)
      return
    }

    this.#dispatch({
      ops,
      policy: { source: 'editor', ...policy },
    })
  }

  // ─── Events ───────────────────────────────────────────────────----

  /** Returns the events emitted by the transaction pipeline. */
  get events(): TransactionPipelineEvents {
    return {
      context: this.#eventSources.context.observable,
      history: this.#eventSources.history.observable,
    }
  }

  // --- Marks operations ─────────────────────────────────────────----

  /** Whether at least one undo entry is available. */
  canUndo(): boolean {
    return this.#history.canUndo()
  }

  /** Whether at least one redo entry is available. */
  canRedo(): boolean {
    return this.#history.canRedo()
  }

  /** Applies the newest undo entry's inverse operations. */
  undo(): void {
    if (this.#batch.active) {
      throw DactyloError.from({
        code: 'HISTORY_NOT_ALLOWED',
        hint: 'TransactionPipeline/#undo',
        message: 'undo() is not allowed to execute when the batch is active.',
      })
    }

    const entry = this.#history.popUndo()
    if (!entry) {
      return
    }

    this.#dispatch({
      ops: [...entry.inverseOps],
      policy: { label: 'undo', pushToHistory: false, source: 'undo' },
    })

    this.#eventSources.history.notify({
      canRedo: this.#history.canRedo(),
      canUndo: this.#history.canUndo(),
    })
  }

  /** Re-applies the newest redo entry's forward operations. */
  redo(): void {
    if (this.#batch.active) {
      throw DactyloError.from({
        code: 'HISTORY_NOT_ALLOWED',
        hint: 'TransactionPipeline/#redo',
        message: 'redo() is not allowed to execute when the batch is active.',
      })
    }

    const entry = this.#history.popRedo()
    if (!entry) {
      return
    }

    this.#dispatch({
      ops: [...entry.ops],
      policy: { label: 'redo', pushToHistory: false, source: 'redo' },
    })

    this.#eventSources.history.notify({
      canRedo: this.#history.canRedo(),
      canUndo: this.#history.canUndo(),
    })
  }

  // --- Marks operations ─────────────────────────────────────────----

  /** Toggle a mark on or off. */
  toggleMark(markKey: MarkKey, policy?: TransactionPolicy): void {
    const { selection } = this.#context

    if (selection !== null) {
      if (selection.__type === 'cursor') {
        const prevActiveMarks = this.#context.activeMarks
        const activeMarks = toggleMarkFlag(prevActiveMarks, markKey)

        this.#commit(
          [
            {
              __type: 'set_active_marks',
              activeMarks,
              prevActiveMarks,
            },
          ],
          {
            ...policy,
            label: `toggle_active_mark:${String(markKey)}`,
            pushToHistory: false,
          },
        )
      } else if (selection.__type === 'range') {
        const normalized = normalizeRange(this.#context.state, selection)
        const { anchor, focus } = normalized

        /**
         * Anchor must precede focus in document order.
         * We cannot accept this case as it's a contract-violation
         * because a {@link RangeSelection} is a non-empty text range.
         */
        if (compareTextCursors(this.#context.state, anchor, focus) >= 0) {
          throw DactyloError.from({
            code: 'RANGE_SELECTION_COLLAPSED',
            hint: 'Use selection.__type === "cursor" (or toggleMark with a collapsed caret) to change activeMarks in editor context.',
            message:
              'Range selection is collapsed; expected anchor to precede focus.',
          })
        }

        /**
         * Collecting text spans must yield at least one text slice.
         * An empty span list is also a contract-violation (collapsed range stored as `range`, stale cursors,
         * or range or non-text-only inline nodes) - not a cue to toggle {@link EditorContext} active marks.
         *
         * Use only `selection.__type === 'cursor'` to toggle active marks.
         */
        const spans = collectTextSpansInRange(this.#context.state, normalized)
        if (spans.length <= 0) {
          throw DactyloError.from({
            code: 'RANGE_SELECTION_NO_TEXT_SPANS',
            hint: 'Ensure the range covers at least one text node with non-zero length.',
            message: 'Range selection produced no text spans.',
          })
        }

        const enabling = spans.every((span) => {
          const block = getBlock(this.#context.state, span.blockId)
          const found = findNodeInBlock(block, span.nodeId)

          if (!found || found.node.__type !== 'text') {
            return false
          }

          return isMarkEnabled(found.node.marks, markKey)
        })

        const ops: Operation[] = []

        for (const span of spans) {
          const block = getBlock(this.#context.state, span.blockId)
          const found = findNodeInBlock(block, span.nodeId)

          if (!found || found.node.__type !== 'text') {
            continue
          }

          const { node } = found
          const nextMarks: Marks = { ...node.marks }

          if (enabling) {
            nextMarks[markKey] = true
          }

          ops.push({
            __type: 'set_marks',
            blockId: span.blockId,
            from: span.from,
            nextMarks,
            nodeId: span.nodeId,
            prevMarks: { ...node.marks },
            to: span.to,
          })
        }

        this.#commit(ops, {
          ...policy,
          label: `toggle_mark_on_selection:${String(markKey)}`,
          pushToHistory: true,
        })
      }
    }
  }

  // --- Keyboard operations ─────────────────────────────────────────

  /**
   * Digests a keyboard event and applies the corresponding operations.
   * This method is responsible for automatically handling:
   * - Detect and resolves platform keyboard shortcuts (undo/redo, copy/paste/cut/select-all, deselect)
   * - Handles structural editing keys (Enter, Backspace, typing, ...)
   * - Handles markdown shortcuts on type (bold, italic, ...)
   * - Handles markdown syntax on paste (e.g, **bold**, [link](https://example.com))
   * - Handles mention key and slash command key
   * - Handles typed keys and behavior keys (e.g. Enter, Shift+Enter, Backspace, etc.)
   *
   * It commits the corresponding operations to the transaction pipeline
   * given the current editor context and selection.
   *
   * And notify subscribers for the following events:
   * - `context`
   * - `history`
   * - `mention`
   * - `slash-command`
   *
   * Returns a boolean indicating whether the event was handled.
   */
  digestKeyboardEvent(
    event: KeyboardEvent,
    policy?: TransactionPolicy,
  ): boolean {
    const platformShortcut = detectPlatformKeyboardShortcut(event)
    if (platformShortcut !== null) {
      switch (platformShortcut) {
        case 'undo': {
          this.undo()
          return true
        }
        case 'redo': {
          this.redo()
          return true
        }
        //@todo: hto be handled
        case 'copy':
        case 'paste':
        case 'cut':
        case 'select-all':
        case 'deselect': {
          return false
        }
        default: {
          assertNever(platformShortcut)
        }
      }
    }

    const { selection } = this.#context
    if (selection !== null && selection.__type === 'cursor') {
      // @todo: add shortcut detection
      // @todo: add mention and /command character (pay attention to behaviors in UI)
      // @todo: detect history  (undo/redo) shortcuts
      // @todo: detect paste shortcuts.
      // @todo: handle markdown

      event.preventDefault()

      this.#commit([], {
        ...policy,
        coalesce: true,
        label: `typed_key:${String(event.key)}`,
        pushToHistory: true,
      })

      return true
    }

    return false
  }

  // ─── Block operations ───────────────────────────────────────------

  /**
   * Inserts a block at the given document position.
   * This method is intended to be used from server code and Ai agents.
   */
  // @todo: to be updated according to the new upcoming block API
  insertBlock(
    blockWithOutPosKey: BlockWithoutPosKey,
    pos: InsertBlockOpPosition,
    policy?: TransactionPolicy,
  ): void {
    this.#commit(
      [
        {
          __type: 'insert_block',
          afterBlockId: resolveInsertAfterBlockId(this.#context.state, pos),
          block: {
            ...blockWithOutPosKey,
            posKey: computeInsertBlockPosKey(this.#context.state, pos),
          },
        },
      ],
      policy,
    )
  }

  /**
   * Removes a block by ID.
   * This method is intended to be used from server code and Ai agents.
   */
  // @todo: to be updated according to the new upcoming block API
  deleteBlock(blockId: BlockId, policy?: TransactionPolicy): void {
    const block = getBlock(this.#context.state, blockId)
    const idx = this.#context.state.blockOrderById.indexOf(blockId)

    let afterBlockId: BlockId | null = null
    if (idx > 0) {
      afterBlockId = this.#context.state.blockOrderById[idx - 1] ?? null
    }

    this.#commit(
      [{ __type: 'delete_block', afterBlockId, blockId, snapshot: block }],
      policy,
    )
  }
}
