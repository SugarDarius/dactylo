import type {
  BBM,
  CBM,
  DBM,
  HBM,
  LBNM,
  LNM,
  MNED,
  MNM,
  NBM,
  PBM,
  QBM,
  TNM,
} from './augmentation'
import type { BlockId } from './blocks'
import { readTransferredData } from './clipboard'
import { error, logOnceIf, warn, warnIf, warnOnceIf } from './console'
import {
  DEFAULT_BATCH_MAX_SIZE,
  INLINE_DETECTOR_TRIGGER_CHARACTER,
} from './constants'
import type { DocumentStatus } from './document'
import { validateDocumentJsonSchema } from './document-json-schema'
import type { DocumentJsonSchema } from './document-json-schema'
import {
  createEditorContext,
  findInlineBufferPointerAtCursor,
  readInlineBufferQueryAtPointer,
} from './editor-context'
import type { EditorContext } from './editor-context'
import { DactyloError } from './errors'
import type { Observable } from './event-source'
import { EventSource } from './event-source'
import { HistoryStack } from './history'
import type { HistoryEvent, HistoryStackOptions } from './history'
import { InlineBuffer } from './inline-buffer'
import type { InlineBufferEvent } from './inline-buffer'
import { detectPlatformShortcut } from './keyboard'
import type { MarkKey } from './marks'
import type { NodeId } from './nodes'
import type { Operation } from './operations'
import { buildReindexNumberedListItemsOps } from './operations-builder'
import type {
  BuilderOpsIntent,
  InsertBlockSpec,
  InsertOrMoveBlockPosition,
  MutateBlockSpec,
  OperationsBuilderInitialMetadata,
  PatchBlockSpec,
} from './operations-builder'
import { OperationsEngine } from './operations-engine'
import type { OperationsEngineOptions } from './operations-engine'
import type { Selection } from './selection'
import { isJsonObject } from './utils'

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
  readonly label?: string

  /**
   * Whether to push this transaction to the history stack.
   * When set to `false`, commit phase skips history push.
   * Defaults to `true` -- history records the transaction.
   */
  readonly pushToHistory?: boolean

  /**
   * Who/what initiated the transaction.
   * It drives history rules, hooks filtering, ...
   */
  readonly source?: TransactionSource

  /** When true, merge history action for rapid typing coalescing. */
  readonly coalesce?: true

  /**
   * Whether to stop syncing inline buffers with the current document,
   * after this commit.
   */
  readonly syncInlineBuffers?: false
}

/** Joins the parts with a `:` for a human-readable label. */
export function transactionPolicyLabel(...parts: string[]): string {
  return parts.join(':')
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

/** Alias for the emitted mention buffer event. */
export type MentionBufferEvent = InlineBufferEvent<'mention'>

/** Alias for the emitted command trigger buffer event. */
export type CommandTriggerBufferEvent = InlineBufferEvent<'command-trigger'>

/** Event emitted when a mention that was created after a mention buffer was confirmed. */
export interface MentionDidCreatedEvent {
  /** {@link BlockId} where the mention was created. */
  readonly blockId: BlockId

  /** Created {@link MentionNode}'s node id. */
  readonly nodeId: NodeId

  /** Entity related to the mention that was created. */
  readonly entity: {
    /** Id referencing the mention's entity in the code. */
    readonly id: string

    /** Developer-provided additional JSON structured data stored with the mention's entity. */
    readonly data: MNED
  }

  /** When the mention was created. */
  readonly createdAt: Date

  /** Metadata associated with the mention that was created. */
  readonly metadata: MNM
}

/** Events emitted by the transaction pipeline */
export interface TransactionPipelineEvents {
  /**
   * Subscribes to the current {@link EditorContext} changes.
   * 👉🏻 Fires anytime the context is updated.
   */
  readonly context: Observable<EditorContext>

  /**
   * Subscribes to the {@link DocumentStatus} changes.
   * 👉🏻  Fires anytime this status changes.
   */
  readonly documentStatus: Observable<DocumentStatus>

  /**
   * Subscribes to when the {@link DocumentStatus} is set to `ready`.
   * 👉🏻 Fires once the document is ready to work with.
   */
  readonly documentReady: Observable<void>

  /**
   * Subscribes to the history stack changes.
   * 👉🏻  Fires anytime the history stack is updated.
   */
  readonly history: Observable<HistoryEvent>

  /**
   * Subscribes to the mention buffer changes.
   * 👉🏻 Fires anytime the inline buffer is updated.
   */
  readonly mentionBuffer: Observable<MentionBufferEvent>

  /**
   * Subscribes to mentions that were created.
   * 👉🏻  Fires anytime a mention is created.
   */
  readonly mentionDidCreated: Observable<MentionDidCreatedEvent>

  /**
   * Subscribes to the command trigger buffer changes.
   * 👉🏻 Fires anytime the inline buffer is updated.
   */
  readonly commandTriggerBuffer: Observable<CommandTriggerBufferEvent>

  /**
   * Subscribes to applied transactions.
   * 👉🏻 Fires anytime a transaction is applied.
   */
  readonly transactionDidApply: Observable<Transaction>

  /**
   * Subscribes to rejected transactions.
   * 👉🏻  Fires anytime a transaction is rejected.
   */
  readonly transactionDidReject: Observable<Transaction>
}

/** Event sources for the transaction pipeline. */
export interface TransactionPipelineEventSources {
  /** The event source for the current {@link EditorContext}. */
  readonly context: EventSource<EditorContext>

  /** The event source for the {@link DocumentStatus}. */
  readonly documentStatus: EventSource<DocumentStatus>

  /** The event source for when the {@link DocumentStatus} is set to `ready`. */
  readonly documentReady: EventSource<void>

  /** The event source for the {@link HistoryStack}. */
  readonly history: EventSource<HistoryEvent>

  /** The event source for a {@link Transaction} that was applied. */
  readonly transactionDidApply: EventSource<Transaction>

  /** The event source for a {@link Transaction} that was rejected. */
  readonly transactionDidReject: EventSource<Transaction>

  /** The event source for a {@link MentionNode} that was created. */
  readonly mentionDidCreated: EventSource<MentionDidCreatedEvent>
}

/** Options for constructing a {@link TransactionPipeline} instance. */
export interface TransactionPipelineOptions {
  /**
   * Whether to enable debug mode.
   * Defaults to `false`
   */
  readonly debug: boolean

  /** Initial developer-provided content to initialize the {@link EditorContext}. */
  readonly initialContent?: DocumentJsonSchema | string

  /**
   * Configuration for creating initial metadata in {@link DocumentState}
   * when it's not initialized from a JSON object or a markdown string.
   *
   * Defaults to `{}`
   */
  readonly initialMetadata?: OperationsBuilderInitialMetadata

  /** Configuration for the batch of the transaction pipeline */
  readonly batch?: {
    /** Max ops queued before auto-flush. Default 512. Use Infinity for large paste. */
    maxSize?: number
  }

  /** Configuration for the history of the transaction pipeline */
  readonly history?: HistoryStackOptions

  /** Configuration for mentions. */
  readonly mentions: {
    /** Whether to enable mentions. */
    readonly enabled: boolean

    /** Character to trigger a mention. */
    readonly character: string
  }

  /** Configuration for command trigger. */
  readonly commandTrigger: {
    /** Whether to enable command trigger. */
    readonly enabled: boolean

    /** Character to trigger a command. */
    readonly character: string
  }

  /** Configuration for autolink detection. */
  readonly autolink: {
    /** Whether to enable autolink detection. */
    readonly enabled: boolean
  }

  /** Configuration for markdown shortcuts. */
  readonly markdown: {
    /** Whether to enable markdown shortcuts. */
    readonly enabled: boolean
  }

  /** Configuration for the operations engine. */
  readonly engine: Omit<
    OperationsEngineOptions,
    'autolink' | 'debug' | 'initialMetadata'
  >
}

/** Configuration for mentions. */
export interface TransactionPipelineMentionsConfig {
  /** Whether to enable mentions. */
  readonly enabled: boolean

  /** Character to use for mentions. */
  readonly character: string
}

/** Configuration for command trigger. */
export interface TransactionPipelineCommandTriggerConfig {
  /** Whether to enable command trigger. */
  readonly enabled: boolean

  /** Character to use for command trigger. */
  readonly character: string
}

/** Configuration for autolink detection. */
export interface TransactionPipelineAutolinkConfig {
  /** Whether to enable autolink detection. */
  readonly enabled: boolean
}

/** Configuration for markdown shortcuts. */
export interface TransactionPipelineMarkdownConfig {
  /** Whether to enable markdown shortcuts. */
  readonly enabled: boolean
}

/**
 * Transaction pipeline
 *
 * The pipeline enforces ordering:
 * ```md
 * Transaction { ops, policy } → validateOps → applyOps → commitEffects
 *                                 ↓ fail
 *                         reject (state unchanged)
 * ```
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
 * ```md
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                           Transaction                                   │
 * │  ┌─────────────────────────────┐   ┌─────────────────────────────────┐  │
 * │  │ ops: Operation[]            │   │ policy?: TransactionPolicy      │  │
 * │  │ (the structural mutations)  │   │ (how commit should behave)      │  │
 * │  └─────────────────────────────┘   └─────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *          │ validate + apply on                    │ read at commit only
 *          ▼                                        ▼
 *    EditorContext ──────────────-----------------------► EditorContext
 *       (prev)                                               (next)
 * ```
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
  /** Whether to enable debug mode. */
  readonly #debug: boolean

  /** The batch to use for the transaction pipeline */
  readonly #batch: Batch

  /** Current editor context */
  #context: EditorContext

  /** Document status. */
  #documentStatus: DocumentStatus

  /**
   * Whether the IME composition is currently active.
   * Covers gaps between events, where `isComposing` is missing or already `false`.
   */
  #isIMEComposing = false

  /** Operations engine instance. */
  readonly #operationsEngine: OperationsEngine

  /** History stack instance. */
  readonly #history: HistoryStack

  /** Mentions configuration. */
  readonly #mentions: TransactionPipelineMentionsConfig

  /** Mention buffer instance. */
  readonly #mentionBuffer: InlineBuffer<'mention'>

  /** Command trigger configuration. */
  readonly #commandTrigger: TransactionPipelineCommandTriggerConfig

  /** Command trigger buffer instance. */
  readonly #commandTriggerBuffer: InlineBuffer<'command-trigger'>

  /** Autolink configuration. */
  readonly #autolink: TransactionPipelineAutolinkConfig

  /** Markdown shortcuts configuration. */
  readonly #markdown: TransactionPipelineMarkdownConfig

  /** Events emitted by the pipeline */
  readonly #eventSources: TransactionPipelineEventSources

  constructor(options: TransactionPipelineOptions) {
    this.#debug = options.debug ?? false

    const initialMetadata = options.initialMetadata ?? {
      bulletedList: {} as BBM,
      checkboxList: {} as CBM,
      divider: {} as DBM,
      heading: {} as HBM,
      lineBreak: {} as LBNM,
      link: {} as LNM,
      mentions: {} as MNM,
      numberedList: {} as NBM,
      paragraph: {} as PBM,
      quote: {} as QBM,
      text: {} as TNM,
    }

    this.#context = createEditorContext()
    this.#documentStatus = 'initializing'

    this.#batch = new Batch({
      maxSize: options.batch?.maxSize,
      onFlush: (ops, policy) =>
        this.#dispatch({
          ops,
          policy: { source: 'editor', ...policy },
        }),
    })

    this.#autolink = options.autolink
    this.#markdown = options.markdown

    this.#mentions = options.mentions
    this.#mentionBuffer = new InlineBuffer({
      debug: this.#debug,
      enabled: this.#mentions.enabled,
      eventKind: 'mention',
      name: 'MentionBuffer',
    })

    this.#commandTrigger = options.commandTrigger
    this.#commandTriggerBuffer = new InlineBuffer({
      debug: this.#debug,
      enabled: this.#commandTrigger.enabled,
      eventKind: 'command-trigger',
      name: 'CommandTriggerBuffer',
    })

    this.#operationsEngine = new OperationsEngine({
      ...options.engine,
      autolink: this.#autolink,
      debug: this.#debug,
      initialMetadata,
    })

    this.#history = new HistoryStack(options.history)

    this.#eventSources = {
      context: new EventSource<EditorContext>(),
      documentReady: new EventSource<void>(),
      documentStatus: new EventSource<DocumentStatus>(),
      history: new EventSource<HistoryEvent>(),
      mentionDidCreated: new EventSource<MentionDidCreatedEvent>(),
      transactionDidApply: new EventSource<Transaction>(),
      transactionDidReject: new EventSource<Transaction>(),
    }

    this.#buildInitialEditorContext(options.initialContent ?? null)
  }

  /** Returns the current editor context */
  get context(): EditorContext {
    return this.#context
  }

  /** Returns the current document status. */
  get documentStatus(): DocumentStatus {
    return this.#documentStatus
  }

  /** Whether the IME composition is currently active. */
  get isIMEComposing(): boolean {
    return this.#isIMEComposing
  }

  /** Sets the IME composing state. */
  setIMEComposing(isComposing: boolean): void {
    this.#isIMEComposing = isComposing
  }

  /** Returns the inline buffer for mentions. */
  get mentionInlineBuffer(): InlineBuffer<'mention'> {
    return this.#mentionBuffer
  }

  /** Returns the inline buffer for command trigger. */
  get commandTriggerInlineBuffer(): InlineBuffer<'command-trigger'> {
    return this.#commandTriggerBuffer
  }

  /** Waits until the document is ready to work with. */
  waitUntilDocumentReady(): Promise<void> {
    /** No to need to subscribe if at the time of the call the document is already ready. */
    if (this.#documentStatus === 'ready') {
      return Promise.resolve()
    }

    const { promise, resolve } = Promise.withResolvers<void>()
    const unsub =
      this.#eventSources.documentReady.observable.subscribeOnce(resolve)

    return promise.finally(unsub)
  }

  // ─── Core pipeline ────────────────────────────────────────────────

  /** Whether autolink detection is enabled. */
  #autolinkEnabled(): boolean {
    if (!this.#autolink.enabled) {
      logOnceIf(this.#debug, 'Autolink detection is not enabled.')
      return false
    }

    return true
  }

  /** Whether a mention is being typed. */
  #isMentionIntent(text: string): boolean {
    if (!this.#mentions.enabled) {
      logOnceIf(this.#debug, 'Mentions are not enabled.')
      return false
    }

    return text === this.#mentions.character
  }

  /** Whether a command trigger is being typed. */
  #isCommandTriggerIntent(text: string): boolean {
    if (!this.#commandTrigger.enabled) {
      logOnceIf(this.#debug, 'Command trigger is not enabled.')
      return false
    }

    return text === this.#commandTrigger.character
  }

  /** Notifies the document status changes. */
  #notifyDocumentStatus(): void {
    const status = this.#documentStatus
    this.#eventSources.documentStatus.notify(status)

    if (status === 'ready') {
      this.#eventSources.documentReady.notify()
    }

    // todo: add status error state.
  }

  /** Notifies the history stack changes. */
  #notifyHistory(): void {
    this.#eventSources.history.notify({
      canRedo: this.#history.canRedo(),
      canUndo: this.#history.canUndo(),
    })
  }

  /**
   * Syncs an active inline buffer from the document, or aborts it when the
   * opener is gone, the selection is a range, or the caret is no longer in the query.
   */
  #syncInlineBuffer<K extends string>(
    buffer: InlineBuffer<K>,
    character: string,
  ): void {
    if (!buffer.isBuffering || buffer.pointer === null) {
      return
    }

    const { pointer } = buffer
    const query = readInlineBufferQueryAtPointer(
      this.#context,
      pointer,
      character,
    )

    if (query === null) {
      buffer.abort()
      return
    }

    buffer.updateBufferedText(query)
  }

  /** Syncs mention and command-trigger buffers with the current document. */
  #syncInlineBuffers(): void {
    this.#syncInlineBuffer(this.#mentionBuffer, this.#mentions.character)
    this.#syncInlineBuffer(
      this.#commandTriggerBuffer,
      this.#commandTrigger.character,
    )
  }

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
        'TransactionPipeline/dispatch: no operations declared in transaction.',
        JSON.stringify(transaction, null, 2),
      )
      return
    }

    let next = { ...this.#context }

    const inverseDocumentOps: Operation[] = []
    const inverseSelectionOps: Operation[] = []

    for (const op of ops) {
      try {
        this.#operationsEngine.runtime.validateOp(next, op)
      } catch (err: unknown) {
        this.#eventSources.transactionDidReject.notify(transaction)
        throw DactyloError.wrap(err)
      }

      /**
       * Invert against the pre-apply tree. `remove_inline_node` needs the
       * previous sibling while the node still exists. `set_selection` invert
       * swaps prev/next — storing the forward op would restore the post-edit caret.
       *
       * ⚠️ Order matter: inverse always comes before apply. ⚠️
       */
      const inverse = this.#operationsEngine.runtime.invertOp(next, op)
      next = this.#operationsEngine.runtime.applyOp(next, op)

      if (op.__type === 'set_selection') {
        inverseSelectionOps.push(inverse)
      } else {
        inverseDocumentOps.unshift(inverse)
      }
    }

    this.#context = next

    if (!skipHistoryPush(transaction.policy)) {
      /** Only coalesce history entries for transactions initiated by a user. */
      const coalesce =
        transaction.policy?.coalesce === true &&
        transaction.policy?.source === 'user'

      this.#history.push(
        {
          inverseOps: [...inverseDocumentOps, ...inverseSelectionOps],
          ops: [...ops],
        },
        coalesce,
      )
    }

    if (transaction.policy?.syncInlineBuffers !== false) {
      this.#syncInlineBuffers()
    }

    this.#eventSources.context.notify(next)
    this.#eventSources.transactionDidApply.notify(transaction)

    this.#notifyHistory()
  }

  /**
   * Builds the initial {@link EditorContext}.
   *
   * If no initial content is provided, then we created an initial {@link DocumentState}
   * with a single {@link ParagraphBlock} owning a single {@link TextNode}.
   *
   * Otherwise we build the initial {@link DocumentState} provided from either:
   *  - A {@link DocumentJsonSchema} validated against the current schema version.
   *  - A markdown string validated against the current schema version.
   *
   * This initialization creates a list of ops to apply to the default {@link EditorContext}
   * from `import` source when initial content is provided, otherwise it's from `editor` source.
   *
   * {@link NumberedListItemBlock}s are re-indexed to maintain correct numbering.
   */
  #buildInitialEditorContext(
    initialContent: DocumentJsonSchema | string | null,
  ): void {
    this.#documentStatus = 'initializing'
    this.#notifyDocumentStatus()

    try {
      let intent: BuilderOpsIntent | null = null
      let source: Extract<TransactionSource, 'editor' | 'import'> = 'editor'

      if (initialContent !== null) {
        if (typeof initialContent === 'string') {
          warnIf(
            this.#debug,
            `Initializing editor context from provided initial markdown string is not supported yet.`,
          )
        } else if (isJsonObject(initialContent)) {
          validateDocumentJsonSchema(initialContent)

          intent =
            this.#operationsEngine.buildInitialDocumentOps(initialContent)
          source = 'import'
        }
      }

      if (intent === null) {
        intent = this.#operationsEngine.buildInitialEmptyDocumentOps()
        source = 'editor'
      }

      const { ops, label } = intent
      this.#dispatch({
        ops,
        policy: {
          label: transactionPolicyLabel('editor-context', label),
          pushToHistory: false,
          source,
        },
      })

      const reindexOps = buildReindexNumberedListItemsOps(this.#context.state)
      if (reindexOps.length > 0) {
        this.#dispatch({
          ops: reindexOps,
          policy: {
            label: transactionPolicyLabel(
              'editor-context',
              'reindex-numbered-list-items',
            ),
            pushToHistory: false,
            source,
          },
        })
      }

      this.#documentStatus = 'ready'
      this.#notifyDocumentStatus()
    } catch (err: unknown) {
      const wrapped = DactyloError.wrap(err)
      error(wrapped.message, wrapped.stack)

      // @todo: add document error event
      this.#documentStatus = 'error'
      this.#notifyDocumentStatus()

      throw wrapped
    }
  }

  /**
   * Enqueues or immediately dispatches operations depending on batch state.
   *
   * Mental model: #commit([op1, op2, …]).
   * 👉🏻 this user action is one atomic transaction.
   */
  #commit(ops: Operation[], policy?: TransactionPolicy): void {
    if (this.#batch.active) {
      this.#batch.enqueue(ops, { source: 'editor', ...policy })
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
      commandTriggerBuffer: this.#commandTriggerBuffer.observable,
      context: this.#eventSources.context.observable,
      documentReady: this.#eventSources.documentReady.observable,
      documentStatus: this.#eventSources.documentStatus.observable,
      history: this.#eventSources.history.observable,
      mentionBuffer: this.#mentionBuffer.observable,
      mentionDidCreated: this.#eventSources.mentionDidCreated.observable,
      transactionDidApply: this.#eventSources.transactionDidApply.observable,
      transactionDidReject: this.#eventSources.transactionDidReject.observable,
    }
  }

  // --- History operations ─────────────────────────────────────────--

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
        '`undo()` is not allowed to execute when the batch is active.',
        'TransactionPipeline/undo',
      )
    }

    const entry = this.#history.popUndo()
    if (!entry) {
      return
    }

    this.#commit([...entry.inverseOps], {
      label: transactionPolicyLabel('history', 'undo'),
      pushToHistory: false,
      source: 'undo',
    })

    this.#notifyHistory()
  }

  /** Re-applies the newest redo entry's forward operations. */
  redo(): void {
    if (this.#batch.active) {
      historyError(
        '`redo()` is not allowed to execute when the batch is active.',
        'TransactionPipeline/redo',
      )
    }

    const entry = this.#history.popRedo()
    if (!entry) {
      return
    }

    this.#commit([...entry.ops], {
      label: transactionPolicyLabel('history', 'redo'),
      pushToHistory: false,
      source: 'redo',
    })

    this.#notifyHistory()
  }

  /** Clears the undo and redo stacks. */
  clearHistory(): void {
    this.#history.clear()
    this.#notifyHistory()
  }

  // --- Marks operations ─────────────────────────────────────────----

  /** Toggle a mark on or off. */
  toggleMark(
    markKey: MarkKey,
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): void {
    const intent = this.#operationsEngine.buildSetMarksOps(
      this.#context,
      markKey,
    )

    if (intent === null) {
      return
    }

    const { ops, label, coalesce, skipHistory } = intent
    this.#commit(ops, {
      coalesce,
      label: transactionPolicyLabel('marks', 'toggle', label),
      pushToHistory: !skipHistory,
      source,
    })
  }

  // --- Composing operations ─────────────────────────────────────────

  /**
   * Confirms a mention buffer by inserting a mention node into the document.
   *
   * Enforces core constraints invariants:
   *  - A mention is currently being buffered.
   *  - The mention buffer is confirmed by a user action.
   *  - When the mention buffer is confirmed, the mention is inserted into the document and the buffer is released
   *    and we notify that the mention buffer is confirmed.
   *  - Otherwise, the buffer is aborted and we notify that the mention buffer is aborted,
   *  - The created mention is pushed to the {@link HistoryStack}.
   *
   *  Returns a boolean indicating whether the mention buffer was confirmed or not.
   */
  confirmBufferedInlineMention(
    opts: {
      entity: {
        id: string
        data: MNED
      }
      metadata?: MNM
    },
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    if (!this.#mentionBuffer.isBuffering) {
      warn(`Cannot confirm mention as there is no mention buffer active.`)
      return false
    }

    const [pointer, bufferedText] = this.#mentionBuffer.get()
    /**
     * Should not happen as we check if the buffer is being buffered before calling this method.
     * But we return `null` for UI libraries to let render what they need based on this state
     * and not break the UI with an error.
     */
    if (pointer === null || bufferedText === null) {
      /** When no pointer or buffered text, we need to abort the buffer to clear up the state and notify the UI. */
      this.#mentionBuffer.abort()
      return false
    }

    const tuple =
      this.#operationsEngine.buildInsertMentionAfterBufferConfirmOps(
        this.#context,
        {
          entity: opts.entity,
          metadata: opts.metadata,
          ...pointer,
          bufferedText,
          character: this.#mentions.character,
        },
      )

    if (tuple === null) {
      /** When no tuple with intent we need to abort the buffer to clear up the state and notify the UI. */
      this.#mentionBuffer.abort()
      return false
    }

    /** When the mention is confirmed, we release the buffer to clear up the state and notify the UI. */
    this.#mentionBuffer.release()

    const [intent, mention] = tuple

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('mentions', 'confirm', label),
      pushToHistory: true,
      source,
      /** When the mention is confirmed, we don't need to sync the inline buffers as the buffer is released. */
      syncInlineBuffers: false,
    })

    this.#eventSources.mentionDidCreated.notify({
      blockId: pointer.blockId,
      createdAt: mention.createdAt,
      entity: mention.entity,
      metadata: mention.metadata,
      nodeId: mention.id,
    })

    return true
  }

  /**
   * Confirms a command trigger buffer by removing the opener character and the quey text
   * from the current {@link TextNode}.
   *
   * Enforces core constraints invariants:
   *  - A command trigger is currently being buffered.
   *  - The command trigger buffer is confirmed by a user action.
   *  - When the command trigger buffer is confirmed, the opened character and the query text are removed
   *    from the current {@link TextNode} and the buffer is released and we notify that the command trigger
   *    buffer is confirmed.
   *  - Otherwise, the buffer is aborted and we notify that the command trigger buffer is aborted,
   *  - The deletion is pushed to the {@link HistoryStack}.
   *
   * Returns a boolean indicating whether the command trigger buffer was confirmed or not.
   */
  confirmBufferedInlineCommandTrigger(
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    if (!this.#commandTriggerBuffer.isBuffering) {
      warn(
        `Cannot confirm command trigger as there is no command trigger buffer active.`,
      )
      return false
    }

    const [pointer, bufferedText] = this.#commandTriggerBuffer.get()
    /**
     * Should not happen as we check if the buffer is being buffered before calling this method.
     * But we return `null` for UI libraries to let render what they need based on this state
     * and not break the UI with an error.
     */
    if (pointer === null || bufferedText === null) {
      /** When no pointer or buffered text, we need to abort the buffer to clear up the state and notify the UI. */
      this.#commandTriggerBuffer.abort()
      return false
    }

    const intent =
      this.#operationsEngine.buildDeleteCommandTriggerInlineBufferSpanOps(
        this.#context,
        {
          ...pointer,
          bufferedText,
          character: this.#commandTrigger.character,
        },
      )

    if (intent === null) {
      /** When no intent we need to abort the buffer to clear up the state and notify the UI. */
      this.#commandTriggerBuffer.abort()
      return false
    }

    /** When the command trigger is confirmed, we release the buffer to clear up the state and notify the UI. */
    this.#commandTriggerBuffer.release()

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('command-trigger', 'confirm', label),
      pushToHistory: true,
      source,
      /** When the command trigger is confirmed, we don't need to sync the inline buffers as the buffer is released. */
      syncInlineBuffers: false,
    })

    return true
  }

  /**
   * Dismisses an inline buffer by aborting it and pinning the caret at the
   * end of the opener + query span. Does not mutate the document.
   */
  #dismissInlineBuffer<K extends string>(
    buffer: InlineBuffer<K>,
    character: string,
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
    kind: K,
  ): boolean {
    if (!buffer.isBuffering) {
      warn(`Cannot dismiss ${kind} inline buffer as there is no buffer active.`)
      return false
    }

    const [pointer, bufferedText] = buffer.get()
    if (pointer === null || bufferedText === null) {
      buffer.abort()
      return false
    }

    const intent = this.#operationsEngine.buildPutCursorAfterInlineBufferOps(
      this.#context,
      {
        ...pointer,
        bufferedText,
        character,
      },
    )

    if (intent === null) {
      buffer.abort()
      return false
    }

    buffer.abort()

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('inline-buffer', 'dismiss', kind, label),
      pushToHistory: false,
      source,
      syncInlineBuffers: false,
    })

    return true
  }

  /**
   * Dismisses a mention buffer by aborting it and pinning the caret at the
   * end of the query. Leaves the opener and query as ordinary text.
   *
   * Returns a boolean indicating whether the mention buffer was dismissed.
   */
  dismissBufferedInlineMention(
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    return this.#dismissInlineBuffer(
      this.#mentionBuffer,
      this.#mentions.character,
      source,
      'mention',
    )
  }

  /**
   * Dismisses a command trigger buffer by aborting it and pinning the caret at the
   * end of the query. Leaves the opener and query as ordinary text.
   *
   * Returns a boolean indicating whether the command trigger buffer was dismissed.
   */
  dismissBufferedInlineCommandTrigger(
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    return this.#dismissInlineBuffer(
      this.#commandTriggerBuffer,
      this.#commandTrigger.character,
      source,
      'command-trigger',
    )
  }

  /**
   * Digests and translates an input event into operations.
   * Enforces core constraints invariants:
   * - `Enter` → new block
   * - `shift+Enter` → soft line break node
   * - ...
   * Parses markdown inline syntax on typing and on paste:
   * - `##` → heading 2
   * - `**` → bold
   * - `[link](https://example.com)` → link node
   * - ...
   * Buffers mentions and slash commands on typing
   * Notifies subscribers for the following events:
   * - `context`
   * - `history`
   *
   * Platform chords are detected before structural keys (`Enter`, `Backspace`, typing)
   * where detection is pure and dispatch splits into buckets:
   *  1. Clipboard commands (paste, cut, …)
   *  2. Typing commands (text, line break, paragraph, heading, etc.)
   *  3. Not handled input types (historyUndo, historyRedo, …)
   *
   * ```md
   * Input → context → operations
   * InputEvent
   *      |
   *      ▼
   * Dactylo.composer.sendInput(event)
   *      |
   *      ▼
   * TransactionPipeline.digestInputEvent(event)
   *      |
   *      ├ ─ detects shortcuts  (e.g. Clipboard, …)
   *      ├ ─ builds typing operations → #commit (`Enter`, `Backspace`, character, …)
   *      |
   *      ▼
   * EventSources.context.notify(context)
   * ```
   *
   * By design, recognized intents are prevented by default.
   *
   * As we prevent by default input events like `insertText`, no native
   * browser history entry is pushed. This part is handled by the `digestKeydownEvent` method.
   *
   * Returns a boolean indicating whether the event was handled or not.
   */
  digestInputEvent(event: InputEvent): boolean {
    /**
     * When the event is already prevented, do not process it
     * as it's a no-op at transaction level.
     */
    if (event.defaultPrevented) {
      return false
    }

    const { inputType } = event

    const prevent = () => {
      event.preventDefault()
      event.stopPropagation()
    }

    // @todo: handle composition input types
    switch (inputType) {
      /**
       * Not handled input types bucket as we're consuming explicitly
       * input types like `insertText`, `insertReplacementText`, `insertFromPaste`, `deleteByCut`, `deleteContentBackward`, `deleteContentForward`
       * and we prevent the default browser behavior as we want full control over DOM tree with UI libraries.
       */
      case 'historyUndo':
      case 'historyRedo': {
        warnOnceIf(
          this.#debug,
          `\`${inputType}\` input type is not handled by Dactylo. Please use \`Dactylo.composer.commands.sendKeydownEvent(event)\` instead.`,
        )

        return false
      }

      /** Using `mod+v` or paste command to paste content from clipboard. */
      case 'insertReplacementText':
      case 'insertFromPaste': {
        /** In any case we prevent native browser behavior as we want full control over paste. */
        prevent()

        /**
         * Invariant UX (debatable):
         * When pasting content from clipboard, we don't allow it
         * when a mention or command trigger buffer is active.
         */
        if (
          inputType === 'insertFromPaste' &&
          (this.#mentionBuffer.isBuffering ||
            this.#commandTriggerBuffer.isBuffering)
        ) {
          return false
        }

        const transferredData = readTransferredData(event.dataTransfer)
        if (transferredData !== null) {
          // @todo: handle other clipboard data types
          const type = transferredData.__type
          switch (type) {
            case 'text/plain': {
              const intent = this.#operationsEngine.buildPlainTextPasteOps(
                this.#context,
                transferredData,
              )

              if (intent === null) {
                return false
              }

              const { ops, label, coalesce, skipHistory } = intent
              this.#commit(ops, {
                coalesce,
                label: transactionPolicyLabel('input', 'digest-event', label),
                pushToHistory: !skipHistory,
                source: 'user',
              })

              return true
            }
            case 'text/html':
            case 'dactylo': {
              warn(`Clipboard data type \`${type}\` is not implemented yet.`)
              return false
            }
            default: {
              return false
            }
          }
        }

        return false
      }

      /** `shift+Enter` is considered as a soft break. */
      case 'insertLineBreak': {
        /** In any case we prevent native browser behavior as we want full control over line breaks. */
        prevent()

        const intent = this.#operationsEngine.buildSoftBreakOps(this.#context)
        if (intent === null) {
          return false
        }

        const { ops, label } = intent
        this.#commit(ops, {
          label: transactionPolicyLabel('input', 'digest-event', label),
          pushToHistory: true,
          source: 'user',
        })

        return true
      }

      /** `Enter` is considered as a hard break. */
      case 'insertParagraph': {
        /** In any case we prevent native browser behavior as we want full control over paragraph breaks. */
        prevent()

        const intent = this.#operationsEngine.buildHardBreakOps(this.#context)
        if (intent === null) {
          return false
        }

        const { ops, label } = intent

        this.#commit(ops, {
          label: transactionPolicyLabel('input', 'digest-event', label),
          pushToHistory: true,
          source: 'user',
        })

        return true
      }

      /**
       *  Using `mod+x` or cut command to cut content from clipboard.
       * - Using `Backspace` to delete content backward.
       */
      case 'deleteByCut':
      case 'deleteContentBackward': {
        /** In any case we prevent native browser behavior as we want full control over backspace. */
        prevent()

        const intent = this.#operationsEngine.buildDeleteContentOps(
          this.#context,
        )

        if (intent === null) {
          return false
        }

        const { ops, label, coalesce } = intent
        this.#commit(ops, {
          coalesce,
          label: transactionPolicyLabel('input', 'digest-event', label),
          pushToHistory: true,
          source: 'user',
        })

        return true
      }

      /** Using `Delete` to delete content forward. */
      case 'deleteContentForward': {
        /** In any case we prevent native browser behavior as we want full control over delete. */
        prevent()

        const intent = this.#operationsEngine.buildDeleteContentForwardOps(
          this.#context,
        )

        if (intent === null) {
          return false
        }

        const { ops, label, coalesce } = intent
        this.#commit(ops, {
          coalesce,
          label: transactionPolicyLabel('input', 'digest-event', label),
          pushToHistory: true,
          source: 'user',
        })

        return true
      }

      /** Typing any character. */
      case 'insertText': {
        /** In any case we prevent native browser behavior as we want full control over text input. */
        prevent()

        const { data } = event
        /**
         * We only process text input if we have a non-empty data.
         * Allowing surrogate pairs and ZWJ sequences (aka. emoji pickers).
         */
        if (data && data.length > 0) {
          const text = data
          const intent = this.#operationsEngine.buildInsertTextOps(
            this.#context,
            text,
          )

          if (intent === null) {
            return false
          }

          /**
           * Capture the opener caret before inserting the trigger character.
           * `findInlineBufferPointerAtCursor` requires the caret at the start of a
           * {@link TextNode} or immediately after whitespace — after commit the
           * caret sits on the trigger itself.
           */
          const canStartInlineBuffer =
            !this.#mentionBuffer.isBuffering &&
            !this.#commandTriggerBuffer.isBuffering

          const isMentionIntent =
            canStartInlineBuffer && this.#isMentionIntent(text)

          const isCommandTriggerIntent =
            canStartInlineBuffer &&
            !isMentionIntent &&
            this.#isCommandTriggerIntent(text)

          const mentionPointer = isMentionIntent
            ? findInlineBufferPointerAtCursor(this.#context)
            : null

          const commandTriggerPointer = isCommandTriggerIntent
            ? findInlineBufferPointerAtCursor(this.#context)
            : null

          const { ops, label, coalesce, skipHistory } = intent
          this.#commit(ops, {
            coalesce,
            label: transactionPolicyLabel('input', 'digest-event', label),
            pushToHistory: !skipHistory,
            source: 'user',
          })

          if (
            this.#mentionBuffer.isBuffering ||
            this.#commandTriggerBuffer.isBuffering
          ) {
            return true
          }

          if (isMentionIntent) {
            /**
             * Invariant UX:
             * A mention buffer is only started when the cursor is at the start of
             * a {@link TextNode} or immediately after a whitespace character.
             */
            if (mentionPointer !== null) {
              this.#mentionBuffer.start(mentionPointer)
              return true
            }
          } else if (isCommandTriggerIntent) {
            /**
             * Invariant UX:
             * A command trigger buffer is only started when the cursor is at the start of
             * a {@link TextNode} or immediately after a whitespace character.
             */
            if (commandTriggerPointer !== null) {
              this.#commandTriggerBuffer.start(commandTriggerPointer)
              return true
            }
          } else {
            /**
             * Applies built ops when a markdown shortcut is detected.
             *  → User typed `space` at the end of `##`, `-`, `>`, …
             *  → User typed `*`, ```, `_`, …
             */
            if (this.#markdown.enabled) {
              const mdIntent = this.#operationsEngine.buildMarkdownShortcutOps(
                this.#context,
                text,
              )

              if (mdIntent !== null) {
                const { ops: mdOps, label: mdLabel } = mdIntent
                this.#commit(mdOps, {
                  label: transactionPolicyLabel(
                    'input',
                    'digest-event',
                    mdLabel,
                  ),
                  pushToHistory: true,
                  source: 'user',
                })

                return true
              }
            }

            /**
             * Applies ops built when {@link INLINE_DETECTOR_TRIGGER_CHARACTER} is typed for autolink detection.
             *  → User typed `space` at the end of a recognized link.
             */
            if (
              this.#autolinkEnabled() &&
              text === INLINE_DETECTOR_TRIGGER_CHARACTER
            ) {
              const autolinkIntent = this.#operationsEngine.buildAutolinkOps(
                this.#context,
                text,
              )

              if (autolinkIntent !== null) {
                const { ops: autolinkOps, label: autolinkLabel } =
                  autolinkIntent
                this.#commit(autolinkOps, {
                  label: transactionPolicyLabel(
                    'input',
                    'digest-event',
                    autolinkLabel,
                  ),
                  pushToHistory: true,
                  source: 'user',
                })

                return true
              }
            }
          }

          return true
        }

        return false
      }
      default: {
        return false
      }
    }
  }

  /**
   *
   * Regarding to `digestInputEvent` method, as we prevent `input` events
   * by design like `insertText`, no native browser history entry is pushed.
   *
   * It means that UI libraries has to handle keydown the make work the following buckets:
   *  1. History (undo/redo)
   *  2. Arrow navigation in editable content.
   *
   * Platform chords are detected internally by design like `Mod+Z` for undo/redo,
   * to then dispatch the appropriate operations.
   *
   * Notifies subscribers for the following events:
   * - `context`
   * - `history`
   *
   * ```md
   * Keydown → context → operations
   * KeyboardEvent
   *      |
   *      ▼
   * Dactylo.composer.sendKeydown(event)
   *      |
   *      ▼
   * TransactionPipeline.digestKeydownEvent(event)
   *      |
   *      ├ ─ detects shortcuts  (e.g. Mod+Z, …)
   *      ├ ─ builds history operations → #commit (`undo`, `redo`, …)
   *      ├ ─ builds arrow navigation operations → #commit (`ArrowUp`, `ArrowDown`, …)
   *      ├ ─ …
   *      |
   *      ▼
   * EventSources.context.notify(context)
   *      |
   *      ▼
   * EventSources.history.notify(history)
   * ```
   *
   * By design, recognized intents are prevented by default.
   *
   * Returns a boolean indicating whether the event was handled or not.
   */
  digestKeydownEvent(event: KeyboardEvent): boolean {
    /**
     * When the event is already prevented, do not process it
     * as it's a no-op at transaction level.
     */
    if (event.defaultPrevented) {
      return false
    }

    const prevent = () => {
      event.preventDefault()
      event.stopPropagation()
    }

    const shortcut = detectPlatformShortcut(event)
    if (shortcut !== null) {
      switch (shortcut) {
        case 'undo': {
          prevent()
          if (this.canUndo()) {
            this.undo()
          }

          return true
        }
        case 'redo': {
          prevent()
          if (this.canRedo()) {
            this.redo()
          }

          return true
        }
        case 'select-all': {
          prevent()

          const intent = this.#operationsEngine.buildSelectAllOps(this.#context)
          if (intent === null) {
            return false
          }

          const { ops, label } = intent
          this.#commit(ops, {
            label: transactionPolicyLabel('keydown', 'digest-event', label),
            pushToHistory: false,
            source: 'user',
          })

          return true
        }
        case 'escape': {
          prevent()

          if (this.#mentionBuffer.isBuffering) {
            return this.dismissBufferedInlineMention('user')
          }

          if (this.#commandTriggerBuffer.isBuffering) {
            return this.dismissBufferedInlineCommandTrigger('user')
          }

          const intent = this.#operationsEngine.buildClearSelectionOps(
            this.#context,
          )

          if (intent === null) {
            return false
          }

          const { ops, label } = intent
          this.#commit(ops, {
            label: transactionPolicyLabel('keydown', 'digest-event', label),
            pushToHistory: false,
            source: 'user',
          })

          return true
        }
        // @todo: handle copy with native clipboard event (→ digestClipboardEvent)
        case 'copy': {
          prevent()
          warn('`copy` shortcut is not implemented yet.')
          return false
        }
        case 'exit-right': {
          if (this.#isIMEComposing) {
            return false
          }

          const intent = this.#operationsEngine.buildExitCodeMarkOps(
            this.#context,
          )
          if (intent === null) {
            return false
          }

          /** Only prevent when we have an intent to apply. */
          prevent()

          const { ops, label } = intent
          /** We don't push to history as it's a caret-only session change. */
          this.#commit(ops, {
            label: transactionPolicyLabel('keydown', 'digest-event', label),
            source: 'user',
          })

          return true
        }
        default: {
          return false
        }
      }
    }

    return false
  }

  // --- Selection operations ─────────────────────────────────────────

  /**
   * Sets the selection to the end of the last block in document order without mutating content.
   * Does not push to history (caret-only session change)
   */
  putCursorSelectionAtDocumentEnd(
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): void {
    const intent =
      this.#operationsEngine.buildPutCursorSelectionAtDocumentEndOps(
        this.#context,
      )
    if (intent === null) {
      return
    }

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('selection', label),
      pushToHistory: false,
      source,
    })
  }

  /**
   * Updates the selection to the given value.
   * Does not push to the history.
   */
  updateSelection(
    next: Selection | null,
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): void {
    const intent = this.#operationsEngine.buildUpdateSelectionOps(
      this.#context,
      next,
    )

    if (intent === null) {
      return
    }

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('selection', label),
      pushToHistory: false,
      source,
    })
  }

  /**
   * Clears the the current selection.
   * Does not push to the history.
   */
  clearSelection(
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
    policy?: Pick<TransactionPolicy, 'syncInlineBuffers'>,
  ): void {
    const intent = this.#operationsEngine.buildClearSelectionOps(this.#context)
    if (intent === null) {
      return
    }

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('selection', label),
      pushToHistory: false,
      source,
      ...policy,
    })
  }

  // ─── Block operations ───────────────────────────────────────------

  /** Inserts a {@link Block} into the the document based on the given spec and position. */
  insertBlock(
    opts: {
      /** Where to insert the paragraph block. */
      pos?: InsertOrMoveBlockPosition
      /** Spec for inserting the paragraph block. */
      spec: InsertBlockSpec
    },
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): BlockId | null {
    const tuple = this.#operationsEngine.buildInsertBlockOps(
      this.#context,
      opts.spec,
      opts.pos,
    )

    if (tuple === null) {
      return null
    }

    const [intent, blockId] = tuple

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('blocks', label),
      pushToHistory: true,
      source,
    })

    return blockId
  }

  /** Patches an existing {@link Block} in place based on the given spec. */
  patchBlock(
    opts: {
      /** Spec for patching the block. */
      spec: PatchBlockSpec
      /** ID of the block to patch. */
      blockId: BlockId
    },
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    const intent = this.#operationsEngine.buildPatchBlockOps(
      this.#context,
      opts.blockId,
      opts.spec,
    )

    if (intent === null) {
      return false
    }

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('blocks', label),
      pushToHistory: true,
      source,
    })

    return true
  }

  /** Duplicates a {@link Block} by ID. */
  duplicateBlock(
    blockId: BlockId,
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    const intent = this.#operationsEngine.buildDuplicateBlockOps(
      this.#context,
      blockId,
    )

    if (intent === null) {
      return false
    }

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('blocks', label),
      pushToHistory: true,
      source,
    })

    return true
  }

  /** Moves a {@link Block} by ID to a new document position. */
  moveBlock(
    blockId: BlockId,
    pos: InsertOrMoveBlockPosition,
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    const moveIntent = this.#operationsEngine.buildMoveBlockOps(
      this.#context,
      blockId,
      pos,
    )

    if (moveIntent === null) {
      return false
    }

    this.#commit(moveIntent.ops, {
      label: transactionPolicyLabel('blocks', moveIntent.label),
      pushToHistory: true,
      source,
    })

    const reindexIntent =
      this.#operationsEngine.buildReindexNumberedListAfterMoveOps(
        this.#context,
        blockId,
      )

    if (reindexIntent === null) {
      return true
    }

    this.#commit(reindexIntent.ops, {
      label: transactionPolicyLabel('blocks', reindexIntent.label),
      pushToHistory: true,
      source,
    })

    return true
  }

  /** Mutates a {@link Block} type into another one by ID. */
  mutateBlock(
    blockId: BlockId,
    /** Spec for mutating the block type. */
    spec: MutateBlockSpec,
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    const intent = this.#operationsEngine.buildMutateBlockTypeOps(
      this.#context,
      blockId,
      spec,
    )

    if (intent === null) {
      return false
    }

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('blocks', label),
      pushToHistory: true,
      source,
    })

    return true
  }

  /** Removes a {@link Block} by ID. */
  deleteBlock(
    blockId: BlockId,
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    const intent = this.#operationsEngine.buildDeleteBlockOps(
      this.#context,
      blockId,
    )

    if (intent === null) {
      return false
    }

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('blocks', label),
      pushToHistory: true,
      source,
    })

    return true
  }
}
