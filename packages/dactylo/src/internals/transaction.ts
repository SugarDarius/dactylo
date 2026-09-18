import type { BlockId, BlockWithoutPosKey } from './blocks'
import { warn } from './console'
import { DEFAULT_BATCH_MAX_SIZE } from './constants'
import { createInitialEditorContext } from './editor-context'
import type { EditorContext } from './editor-context'
import { DactyloError } from './errors'
import type { Observable } from './event-source'
import { EventSource } from './event-source'
import { HistoryStack } from './history'
import type { HistoryEvent } from './history'
import { detectPlatformKeyboardShortcut } from './keyboard'
import type { MarkKey } from './marks'
import type { Operation, InsertBlockOpPosition } from './operations'
import {
  applyOps,
  buildDeleteBlockOps,
  buildInsertBlockOps,
  buildKeyboardOps,
  buildPutCursorSelectionAtDocumentEndOps,
  buildSetMarksOps,
  invertOps,
  validateOps,
} from './operations-engine'
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

/** Whether to skip pushing the transaction to the history stack. */
export function skipHistoryPush(policy?: TransactionPolicy): boolean {
  return (
    policy?.pushToHistory === false ||
    policy?.source === 'undo' ||
    policy?.source === 'redo'
  )
}

/** Throws a {@link DactyloError} when history is not allowed. */
export function historyError(message: string, hint: string): never {
  throw DactyloError.from({
    code: 'HISTORY_NOT_ALLOWED',
    hint,
    message,
  })
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

  /**
   * Subscribes to applied transactions.
   * Fires anytime a transaction is applied.
   */
  readonly transactionDidApply: Observable<Transaction>

  /**
   * Subscribes to rejected transactions.
   * Fires anytime a transaction is rejected.
   */
  readonly transactionDidReject: Observable<Transaction>
}

/** Event sources for the transaction pipeline. */
export interface TransactionPipelineEventSources {
  /** The event source for the current editor context */
  readonly context: EventSource<EditorContext>

  /** The event source for the history stack */
  readonly history: EventSource<HistoryEvent>

  /** The event source for the transaction that was applied. */
  readonly transactionDidApply: EventSource<Transaction>

  /** The event source for the transaction that was rejected. */
  readonly transactionDidReject: EventSource<Transaction>
}

/** Options for constructing a {@link TransactionPipeline} instance. */
export interface TransactionPipelineOptions {
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
 *  2. Notify subscribers (UI)
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
    this.#context = createInitialEditorContext()
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
      transactionDidApply: new EventSource<Transaction>(),
      transactionDidReject: new EventSource<Transaction>(),
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
   * 3. └- Commit effects: push to history; notify events to subscribers
   *
   * Does not mutate the inputs.
   */
  #dispatch(transaction: Transaction): void {
    const { ops } = transaction

    /**
     * Do nothing if the transaction has no operations.
     * By design a transaction should always have at least one operations
     * but it should not be treated as an error and break the editor.
     */
    if (ops.length === 0) {
      warn(
        'TransactionPipeline/#dispatch: empty operations in transaction',
        JSON.stringify(transaction, null, 2),
      )
      return
    }

    try {
      validateOps(this.#context, ops)
    } catch (err) {
      this.#eventSources.transactionDidReject.notify(transaction)
      throw DactyloError.wrap(err)
    }

    let next = { ...this.#context }

    next = applyOps(this.#context, ops)
    const inverseOps = invertOps(ops)

    this.#context = next

    if (!skipHistoryPush(transaction.policy)) {
      /** Only coalesce history entries for transactions initiated by a user. */
      const coalesce =
        transaction.policy?.coalesce === true &&
        transaction.policy?.source === 'user'

      this.#history.push({ inverseOps, ops: [...ops] }, coalesce)
    }

    this.#eventSources.context.notify(next)
    this.#eventSources.transactionDidApply.notify(transaction)
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
      transactionDidApply: this.#eventSources.transactionDidApply.observable,
      transactionDidReject: this.#eventSources.transactionDidReject.observable,
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
      historyError(
        'undo() is not allowed to execute when the batch is active.',
        'TransactionPipeline/#undo',
      )
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
      historyError(
        'redo() is not allowed to execute when the batch is active.',
        'TransactionPipeline/#redo',
      )
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
  toggleMark(
    markKey: MarkKey,
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): void {
    const intent = buildSetMarksOps(this.#context, markKey)

    /** No-op if we don't detect any active selection. */
    if (intent === null) {
      return
    }

    const { ops, kind } = intent
    switch (kind) {
      case 'set_active_marks': {
        this.#commit(ops, {
          label: `toggle_active_mark:${String(markKey)}`,
          pushToHistory: false,
          source,
        })
        break
      }
      case 'set_marks': {
        this.#commit(ops, {
          label: `toggle_mark_on_selection:${String(markKey)}`,
          pushToHistory: true,
          source,
        })
        break
      }
      default: {
        assertNever(kind, { hint: 'TransactionPipeline/#toggleMark' })
      }
    }
  }

  // --- Keyboard operations ─────────────────────────────────────────

  /**
   * Digests and translates keyboard and clipboard into operations.
   * Enforces core constraints:
   * - `Enter` → new block
   * - `shift+Enter` → soft line break node
   * - ...
   * Parses markdown inline syntax on typing and on paste:
   * - `##` → heading 2
   * - `**` → bold
   * - `[link](https://example.com)` → link node
   * - ...
   * Buffers mentions on typing and on paste and slash commands on typing.
   * Notifies subscribers for the following events:
   * - `context`
   * - `history`
   * - `mention`
   * - `slash-command`
   *
   * Platform chords are detected before structural keys (`Enter`, `Backspace`, typing)
   * where detection is pure and dispatch splits intro three buckets:
   * 1. History commands (undo/redo)
   * 2. Clipboard command (copy, paste, and cut)
   * 3. Document commands (select all, deselect)
   *
   * ```
   * Input → context → operations
   * KeyboardEvent
   *      |
   *      ▼
   * Dactylo.keyboard.onKeyDown(event)
   *      |
   *      ▼
   * TransactionPipeline.digestKeyboardEvent(event)
   *      |
   *      ├ ─ detects platform shortcuts  (e.g. undo / redo, copy / paste, cut, select-all, deselect)
   *      ├ ─ builds keyboard operations → #commit (`Enter`, `Backspace`, typing....)
   *      |
   *      ▼
   * EventSources.context.notify(context)
   *
   * By design, recognized keystrokes and shortcuts are prevented by default.
   * They can be not prevented by passing `{ prevent: false }` in the options.
   *
   * Returns a boolean indicating whether the event was handled or not.
   */
  digestKeyboardEvent(
    event: KeyboardEvent,
    opts: { prevent?: false } = {},
  ): boolean {
    const prevent = () => {
      const prevented = opts.prevent !== false
      if (prevented) {
        event.preventDefault()
      }
    }

    const shortcut = detectPlatformKeyboardShortcut(event)
    if (shortcut !== null) {
      switch (shortcut) {
        case 'undo': {
          prevent()
          this.undo()

          return true
        }
        case 'redo': {
          prevent()
          this.redo()

          return true
        }
        // @todo: to be handled
        // @note: decides if we either handle here or directly through DOM events
        case 'copy':
        case 'paste':
        case 'cut':
        case 'select-all':
        case 'deselect': {
          return false
        }
        default: {
          /** Unrecognized shortcuts are not handled. */
          return false
        }
      }
    }

    const intent = buildKeyboardOps(this.#context, event)
    /**
     * When we don't have any active selection or if the event is a modifier key,
     * or if twe don't have any handled intent,
     * we don't want to handle the event and we don't prevent it by default.
     */
    if (intent === null) {
      return false
    }

    /** Otherwise we handle the event and commit the operations. */
    const { ops, label, coalesce } = intent

    prevent()
    this.#commit(ops, {
      coalesce,
      label,
      pushToHistory: true,
      source: 'user',
    })

    return true
  }

  // --- Selection operations ─────────────────────────────────────────

  /**
   * Sets the selection to the end of the last block in document order without mutating content.
   * Does not push to history (caret-only session change)
   */
  putCursorSelectionAtDocumentEnd(
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): void {
    const ops = buildPutCursorSelectionAtDocumentEndOps(this.#context)
    if (ops === null) {
      return
    }

    this.#commit(ops, {
      label: `put_cursor_selection_at_document_end`,
      pushToHistory: false,
      source,
    })
  }

  // ─── Block operations ───────────────────────────────────────------

  /** Inserts a block at the given document position. */
  // @todo: to be updated according to the new upcoming blocks API
  insertBlock(
    pos: InsertBlockOpPosition,
    block: BlockWithoutPosKey,
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): void {
    const ops = buildInsertBlockOps(this.#context, pos, block)
    this.#commit(ops, { label: `insert_block`, pushToHistory: true, source })
  }

  /** Removes a block by ID.  This method is intended to be used from server code and Ai agents. */
  // @todo: to be updated according to the new upcoming blocks API
  deleteBlock(
    blockId: BlockId,
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): void {
    const ops = buildDeleteBlockOps(this.#context, blockId)
    this.#commit(ops, { label: `delete_block`, pushToHistory: true, source })
  }
}
