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
  DEFAULT_MAX_TRANSACTION_BATCH_MAX_DEPTH,
  INLINE_DETECTOR_TRIGGER_CHARACTER,
} from './constants'
import type { DocumentStatus } from './document'
import { validateDocumentJsonInput } from './document-json-input'
import type { DocumentJsonInput } from './document-json-input'
import {
  createEditorContext,
  findInlineBufferPointerAtCursor,
  readInlineBufferQueryAtPointer,
  withSelection,
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
import type { MentionNode, NodeId } from './nodes'
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
import type { Awaitable } from './types'
import { isJsonObject, isPromise } from './utils'

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

/** Throws a {@link DactyloError} when {@link TransactionBatch} is already in use. */
export function transactionBatchError(message: string, hint: string): never {
  throw DactyloError.from({
    code: 'TRANSACTION_BATCH_NOT_ALLOWED',
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

/**
 * Pair of source ops and inverse ops for an applied {@link Transaction}
 * from the operations runtime validation stage.
 */
export interface AppliedTransactionOps {
  /** Forward ops that were just applied. */
  readonly sourceOps: readonly Operation[]

  /** Inverse ops, already in undo order for this command. */
  readonly inverseOps: readonly Operation[]
}

/**
 * Behavior for notifying {@link EditorContext} subscribers
 * about work inside a {@link TransactionBatch}.
 *
 * - `end` → Notify once, when the batch function settles. Right default for tool-calling agents
 *   and for a full document replace (no flicker of half-built state).
 * - `each` → Notify after every commands. Useful when tokens steam into the document
 *   and users should see them land.
 */
export type TransactionBatchNotifyBehavior = 'end' | 'each'

/** Policy for a {@link TransactionBatch}. */
export interface TransactionBatchPolicy {
  /** Human-readable label of the transaction for debugging, DevTools, Ai tracing, ... */
  readonly label?: string

  /** Who/what initiated the batch. */
  readonly source?: Extract<TransactionSource, 'user' | 'ai-agent'>
}

/**
 * Open outermost batch run state.
 *
 * There is only one batch run state at a time. Nested `run()` calls append there.
 * See this state as an accumulator.
 *
 * Other calls to `run()` do not create a new state. `editorContextSnapshot` is the
 * {@link EditorContext} from before the first command, so a throw can restore it for free.
 */
export interface TransactionBatchRunState {
  /** Either the {@link EditorContext} was updated during this batch run (`notify: 'each'`). */
  didNotify: boolean

  /** Behavior for notifying {@link EditorContext} subscribers about work inside this batch run. */
  readonly notifyBehavior: TransactionBatchNotifyBehavior

  /** Forward ops for the whole batch run, in command order */
  sourceOps: Operation[]

  /** Inverse ops accumulated for undo. */
  inverseOps: Operation[]

  /** Commit-time policy for the flushed history entry. */
  readonly policy?: TransactionBatchPolicy

  /** {@link EditorContext} before the first command in this batch run. */
  readonly editorContextSnapshot: EditorContext
}

/** Parameters for flushing a {@link TransactionBatchFlushCallback}. */
export interface TransactionBatchFlushCallbackParams {
  /** Pair of source ops and inverse ops for an applied {@link Transaction}. */
  readonly applied: AppliedTransactionOps

  /** Commit-time policy for the flushed history entry. */
  readonly policy?: TransactionBatchPolicy

  /** Behavior for notifying {@link EditorContext} subscribers about work inside this batch run. */
  readonly notifyBehavior: TransactionBatchNotifyBehavior
}
/**
 * Callback called when the outermost `run()` call succeeds and there is something to commit.
 * 👉🏻 This is where after a batch run history and {@link EditorContext} notify happen.
 */
export type TransactionBatchFlushCallback = (
  params: TransactionBatchFlushCallbackParams,
) => void

/** Parameters for rolling back a {@link TransactionBatch}. */
export interface TransactionBatchRollbackCallbackParams {
  /** {@link EditorContext} before the first command in this batch run. */
  readonly editorContextSnapshot: EditorContext

  /** Either the {@link EditorContext} was updated during this batch run (`notify: 'each'`). */
  readonly didNotify: boolean
}

/**
 * Callback called when the outermost `run()` call throws.
 * Restore `editorContextSnapshot`. Notify `context` only if we already painted during the batch run.
 */
export type TransactionBatchRollbackCallback = (
  params: TransactionBatchRollbackCallbackParams,
) => void

/** Options for constructing a {@link TransactionBatch}. */
export interface TransactionBatchOptions {
  /** Finish the batch run: history + subscribers. */
  readonly onFlush: TransactionBatchFlushCallback

  /** Undo in-memory work after a throw, without touching history. */
  readonly onRollback: TransactionBatchRollbackCallback

  /**
   * How many `run()` frames {@link TransactionBatch} can nest.
   * Default to {@link DEFAULT_MAX_TRANSACTION_BATCH_MAX_DEPTH} and capped at it.
   */
  readonly maxDepth?: number
}

/**
 * Groups already-validated operations into one undoable transaction.
 * Made for use cases like big Ai agents edits.
 *
 * Mental model:
 * ```md
 * run(fn)
 *   command → apply now (live context, real ids)
 *          → accumulate into the batch run
 *   fn settles
 *          → one history entry
 *          → context notify ('end'), or already notified ('each')
 * ```
 *
 * Nested `run()` calls from inside `fn` is the same undo step (helpers).
 * A second `run()` call while `fn` is awaiting (promises) throws.
 *
 * Depth is capped at {@link DEFAULT_MAX_TRANSACTION_BATCH_MAX_DEPTH}.
 *
 * To avoid splitting undo we throw instead of auto-flushing a nested run call.
 */
export class TransactionBatch {
  /** Callback called when the outermost `run()` call succeeds and there is something to commit. */
  readonly #onFlush: TransactionBatchFlushCallback

  /** Callback called when the outermost `run()` call throws. */
  readonly #onRollback: TransactionBatchRollbackCallback

  /** Maximum nesting depth for {@link TransactionBatch}. */
  readonly #maxDepth: number

  /** How many `run()` frames are open. */
  #depth = 0

  /** Whether a batch run is currently in progress. */
  #invoking = false

  /** The open batch run state, or `null` when idle. */
  #state: TransactionBatchRunState | null

  constructor(options: TransactionBatchOptions) {
    this.#onFlush = options.onFlush
    this.#onRollback = options.onRollback

    this.#maxDepth = options.maxDepth
      ? Math.min(options.maxDepth, DEFAULT_MAX_TRANSACTION_BATCH_MAX_DEPTH)
      : DEFAULT_MAX_TRANSACTION_BATCH_MAX_DEPTH

    this.#state = null
  }

  /**
   * Whether a batch run is currently in progress.
   * Including while a batch run is awaiting (promises).
   */
  get active(): boolean {
    return this.#state !== null
  }

  /** Nesting level. `0` means nothing is running. */
  get depth(): number {
    return this.#depth
  }

  /**
   * Paint policy for the open batch run.
   * `'end'` when idle, so `#commit` can stay branch-free.
   */
  get notifyBehavior(): TransactionBatchNotifyBehavior {
    return this.#state?.notifyBehavior ?? 'end'
  }

  /** Flush the current batch. */
  #flush(): void {
    const state = this.#state
    this.#state = null

    if (state === null || state.sourceOps.length <= 0) {
      return
    }

    this.#onFlush({
      applied: {
        sourceOps: state.sourceOps,
        inverseOps: state.inverseOps,
      },
      policy: state.policy,
      notifyBehavior: state.notifyBehavior,
    })
  }

  /** Rollback the current batch. */
  #rollback(): void {
    const snapshot = this.#state?.editorContextSnapshot
    const didNotify = this.#state?.didNotify ?? false

    this.#state = null

    if (snapshot !== undefined) {
      this.#onRollback({
        editorContextSnapshot: snapshot,
        didNotify,
      })
    }
  }

  /** Complete a batch run. */
  #completeRun(): void {
    this.#depth -= 1
    if (this.#depth > 0) {
      return
    }

    this.#flush()
  }

  /** Abort a batch run. */
  #abortRun(): void {
    this.#rollback()

    this.#state = null
    this.#depth = 0
  }

  /**
   * Remember that `context` subscribers already saw this batch run.
   * Rollback uses this to decide whether to paint the restored snapshot.
   */
  markAsNotified(): void {
    if (this.#state !== null) {
      this.#state.didNotify = true
    }
  }

  /**
   * Accumulate a validated {@link Transaction} into the batch run state.
   * Inverse ops go to the front, so undo walks the work backwards.
   */
  accumulate(validated: AppliedTransactionOps): void {
    if (this.#state === null) {
      transactionBatchError(
        '`accumulate()` needs an open batch run. Call it from inside `run()`.',
        'TransactionBatch/accumulate',
      )
    }

    this.#state.sourceOps.push(...validated.sourceOps)
    this.#state.inverseOps.unshift(...validated.inverseOps)
  }

  /**
   * Runs a function as (or inside) one batch run.
   *
   * `editorContextSnapshot` and `policy` / `notifyBehavior` are kept only on the outermost enter.
   * Nested `run()` calls ignore them and just shares the accumulator.
   *
   * Always returns a Promise so it can wrap async calls.
   * A sync `fn` still works — we resolve immediately.
   */
  run<T>(
    /** The batch function to run. */
    fn: () => Awaitable<T>,
    opts: {
      /** The editor context snapshot. */
      editorContextSnapshot: EditorContext
      /** The policy for the batch run. */
      policy?: TransactionBatchPolicy
      /** The behavior for notifying the editor context subscribers. Defaults to `'end'`. */
      notifyBehavior?: TransactionBatchNotifyBehavior
    },
  ): Promise<T> {
    const { editorContextSnapshot, policy, notifyBehavior = 'end' } = opts
    if (this.#depth > 0 && !this.#invoking) {
      transactionBatchError(
        'Another batch run is already running. Wait for it to finish before starting a new one.',
        'TransactionBatch/run',
      )
    }

    if (this.#depth >= this.#maxDepth) {
      transactionBatchError(
        `Batch run nested too deep (max ${this.#maxDepth}). You probably have a recursive helper calling run().`,
        'TransactionBatch/run',
      )
    }

    this.#depth += 1

    if (this.#depth === 1) {
      this.#state = {
        didNotify: false,
        notifyBehavior: notifyBehavior ?? 'end',
        policy,
        sourceOps: [],
        inverseOps: [],
        editorContextSnapshot,
      }
    }

    this.#invoking = true

    try {
      const result = fn()
      this.#invoking = false

      if (isPromise(result)) {
        return Promise.resolve(result)
          .then((value) => {
            this.#completeRun()
            return value as T
          })
          .catch((err: unknown) => {
            this.#abortRun()
            throw err
          })
      }

      this.#completeRun()

      return Promise.resolve(result)
    } catch (err: unknown) {
      this.#invoking = false
      this.#abortRun()

      return Promise.reject(err)
    }
  }
}

/** Event emitted when {@link DocumentStatus} is set to `ready`. */
export interface DocumentReadyEvent {
  /** The duration in milliseconds it took to set the {@link DocumentStatus} to `ready`. */
  readonly durationMs: number
}

/** Event emitted when {@link DocumentStatus} is set to `error`. */
export interface DocumentErrorEvent {
  /** The error that occurred thrown by {@link TransactionPipeline}. */
  readonly error: DactyloError

  /** The duration in milliseconds it took to set the {@link DocumentStatus} to `error`. */
  readonly durationMs: number
}

/** Alias for the emitted mention buffer event. */
export type MentionBufferEvent = InlineBufferEvent<'mention'>

/** Alias for the emitted command trigger buffer event. */
export type CommandTriggerBufferEvent = InlineBufferEvent<'command-trigger'>

/** Alias for the emitted emojis trigger buffer event. */
export type EmojisTriggerBufferEvent = InlineBufferEvent<'emojis-trigger'>

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

  /** Where from the mention was created. */
  readonly from:
    | 'confirm-buffered-inline-mention'
    | 'insert-block'
    | 'patch-block'
    | 'duplicate-block'

  /** Who/what created the mention. */
  readonly source: Extract<TransactionSource, 'user' | 'ai-agent'>
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
  readonly documentReady: Observable<DocumentReadyEvent>

  /**
   * Subscribes to when the {@link DocumentStatus} is set to `error`.
   * 👉🏻 Fires once the document is in error state.
   */
  readonly documentError: Observable<DocumentErrorEvent>

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
   * Subscribes to the emojis trigger buffer changes.
   * 👉🏻 Fires anytime the inline buffer is updated.
   */
  readonly emojisTriggerBuffer: Observable<EmojisTriggerBufferEvent>

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
  readonly documentReady: EventSource<DocumentReadyEvent>

  /** The event source for when the {@link DocumentStatus} is set to `error`. */
  readonly documentError: EventSource<DocumentErrorEvent>

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
  readonly initialContent?: DocumentJsonInput | string

  /**
   * Configuration for creating initial metadata in {@link DocumentState}
   * when it's not initialized from a JSON object or a markdown string.
   *
   * Defaults to `{}`
   */
  readonly initialMetadata?: OperationsBuilderInitialMetadata

  /** Configuration for {@link TransactionBatch}. */
  readonly batch?: {
    /** Max depth of how many run frames are open. Defaults to `16`. */
    readonly maxDepth?: number
  }

  /** Configuration for the history of the transaction pipeline */
  readonly history?: HistoryStackOptions

  /** Configuration for mentions. */
  readonly mentions: {
    /** Whether to enable mentions. */
    readonly enabled: boolean

    /** Character to trigger a mention. */
    readonly character: string

    /** Whether to abort the mention inline buffer if user types two (2) consecutive spaces. */
    readonly abortOnConsecutiveSpaces: boolean
  }

  /** Configuration for command trigger. */
  readonly commandTrigger: {
    /** Whether to enable command trigger. */
    readonly enabled: boolean

    /** Character to trigger a command. */
    readonly character: string

    /** Whether to abort the command trigger inline buffer if user types two (2) consecutive spaces. */
    readonly abortOnConsecutiveSpaces: boolean
  }

  /** Configuration for emojis trigger. */
  readonly emojisTrigger: {
    /** Whether to enable emojis trigger. */
    readonly enabled: boolean

    /** Character to trigger a emoji. */
    readonly character: string

    /** Whether to abort the emojis trigger inline buffer if user types two (2) consecutive spaces. */
    readonly abortOnConsecutiveSpaces: boolean
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

  /** Whether to abort the mention inline buffer if user types two (2) consecutive spaces. */
  readonly abortOnConsecutiveSpaces: boolean
}

/** Configuration for command trigger. */
export interface TransactionPipelineCommandTriggerConfig {
  /** Whether to enable command trigger. */
  readonly enabled: boolean

  /** Character to use for command trigger. */
  readonly character: string

  /** Whether to abort the command trigger inline buffer if user types two (2) consecutive spaces. */
  readonly abortOnConsecutiveSpaces: boolean
}

/** Configuration for emojis trigger. */
export interface TransactionPipelineEmojisTriggerConfig {
  /** Whether to enable emojis trigger. */
  readonly enabled: boolean

  /** Character to trigger a emoji. */
  readonly character: string

  /** Whether to abort the emojis trigger inline buffer if user types two (2) consecutive spaces. */
  readonly abortOnConsecutiveSpaces: boolean
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

  /** Current editor context */
  #context: EditorContext

  /** Document status. */
  #documentStatus: DocumentStatus

  /**
   * Whether the IME composition is currently active.
   * Covers gaps between events, where `isComposing` is missing or already `false`.
   */
  #isIMEComposing = false

  /** Groups already-validated commands into one undo step. */
  readonly #batch: TransactionBatch

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

  /** Emojis trigger configuration. */
  readonly #emojisTrigger: TransactionPipelineEmojisTriggerConfig

  /** Emojis trigger buffer instance. */
  readonly #emojisTriggerBuffer: InlineBuffer<'emojis-trigger'>

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

    this.#emojisTrigger = options.emojisTrigger
    this.#emojisTriggerBuffer = new InlineBuffer({
      debug: this.#debug,
      enabled: this.#emojisTrigger.enabled,
      eventKind: 'emojis-trigger',
      name: 'EmojisTriggerBuffer',
    })

    this.#batch = new TransactionBatch({
      onFlush: (params) => this.#flushBatch(params),
      onRollback: (params) => this.#rollbackBatch(params),
      maxDepth: options.batch?.maxDepth,
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
      documentError: new EventSource<DocumentErrorEvent>(),
      documentReady: new EventSource<DocumentReadyEvent>(),
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

  /** Returns the inline buffer for emojis trigger. */
  get emojisTriggerInlineBuffer(): InlineBuffer<'emojis-trigger'> {
    return this.#emojisTriggerBuffer
  }

  /** Waits until the document is ready to work with. */
  waitUntilDocumentReady(): Promise<void> {
    /** No to need to subscribe if at the time of the call the document is already ready. */
    if (this.#documentStatus === 'ready') {
      return Promise.resolve()
    }

    const { promise, resolve } = Promise.withResolvers<void>()
    const unsub = this.#eventSources.documentReady.observable.subscribeOnce(
      () => resolve(),
    )

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

  /** Whether a emojis trigger is being typed. */
  #isEmojisTriggerIntent(text: string): boolean {
    if (!this.#emojisTrigger.enabled) {
      logOnceIf(this.#debug, 'Emojis trigger is not enabled.')
      return false
    }

    return text === this.#emojisTrigger.character
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
    abortOnConsecutiveSpaces: boolean,
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

    /**
     * Abort the inline buffer if the query is `null`
     * or if the user types two (2) consecutive spaces.
     */
    if (query === null || (abortOnConsecutiveSpaces && query.endsWith('  '))) {
      buffer.abort()
      return
    }

    buffer.updateBufferedText(query)
  }

  /** Syncs mention and command-trigger buffers with the current document. */
  #syncInlineBuffers(): void {
    this.#syncInlineBuffer(
      this.#mentionBuffer,
      this.#mentions.character,
      this.#mentions.abortOnConsecutiveSpaces,
    )
    this.#syncInlineBuffer(
      this.#commandTriggerBuffer,
      this.#commandTrigger.character,
      this.#commandTrigger.abortOnConsecutiveSpaces,
    )
    this.#syncInlineBuffer(
      this.#emojisTriggerBuffer,
      this.#emojisTrigger.character,
      this.#emojisTrigger.abortOnConsecutiveSpaces,
    )
  }

  /**
   * Validates/rejects and applies operations in the {@link Transaction}.
   * Compute the inverse operations for history.
   */
  #apply(transaction: Transaction): AppliedTransactionOps | null {
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
      return null
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

    return {
      sourceOps: [...ops],
      inverseOps: [...inverseDocumentOps, ...inverseSelectionOps],
    }
  }

  /**
   * Runs the transaction pipeline and updates editor context.
   *
   * Dispatches a transaction by running the full pipeline:
   *   1. Validate or reject each operations
   *   2. └- Apply the operation and get the invert operation for history
   *   3. └- Side effects: push to history; notify events to subscribers
   *
   * Does not mutate the inputs.
   */
  #dispatch(transaction: Transaction): void {
    const applied = this.#apply(transaction)
    if (applied === null) {
      return
    }

    const { inverseOps, sourceOps } = applied

    if (!skipHistoryPush(transaction.policy)) {
      /** Only coalesce history entries for transactions initiated by a user. */
      const coalesce =
        transaction.policy?.coalesce === true &&
        transaction.policy?.source === 'user'

      this.#history.push(
        {
          inverseOps: [...inverseOps],
          ops: [...sourceOps],
        },
        coalesce,
      )
    }

    if (transaction.policy?.syncInlineBuffers !== false) {
      this.#syncInlineBuffers()
    }

    this.#eventSources.context.notify(this.#context)
    this.#eventSources.transactionDidApply.notify(transaction)

    this.#notifyHistory()
  }

  /**
   * Commits a transaction by dispatching the operations to the transaction pipeline.
   * If the batch is active, the operations are accumulated and notified to the subscribers.
   * Otherwise, the operations are dispatched immediately.
   */
  #commit(ops: Operation[], policy?: TransactionPolicy): void {
    const transaction: Transaction = {
      ops,
      policy: { source: 'editor', ...policy },
    }

    if (this.#batch.active) {
      const applied = this.#apply(transaction)
      if (applied === null) {
        return
      }

      this.#batch.accumulate(applied)

      if (this.#batch.notifyBehavior === 'each') {
        this.#eventSources.context.notify(this.#context)
        this.#batch.markAsNotified()
      }
    } else {
      this.#dispatch(transaction)
    }
  }

  /**
   * Builds the initial {@link EditorContext}.
   *
   * If no initial content is provided, then we created an initial {@link DocumentState}
   * with a single {@link ParagraphBlock} owning a single {@link TextNode}.
   *
   * Otherwise we build the initial {@link DocumentState} provided from either:
   *  - A {@link DocumentJsonInput} validated against the current schema version.
   *  - A markdown string validated against the current schema version.
   *
   * This initialization creates a list of ops to apply to the default {@link EditorContext}
   * from `import` source when initial content is provided, otherwise it's from `editor` source.
   *
   * {@link NumberedListItemBlock}s are re-indexed to maintain correct numbering.
   */
  #buildInitialEditorContext(input: DocumentJsonInput | string | null): void {
    const startedAt = Date.now()

    this.#documentStatus = 'initializing'
    this.#eventSources.documentStatus.notify(this.#documentStatus)

    try {
      let intent: BuilderOpsIntent | null = null
      let source: Extract<TransactionSource, 'editor' | 'import'> = 'editor'

      if (input !== null) {
        if (typeof input === 'string') {
          warnIf(
            this.#debug,
            `Initializing editor context from provided initial markdown string is not supported yet.`,
          )
        } else if (isJsonObject(input)) {
          validateDocumentJsonInput(input)

          intent = this.#operationsEngine.buildInitialDocumentOps(input)
          source = 'import'
        }
      }

      if (intent === null) {
        intent = this.#operationsEngine.buildInitialEmptyDocumentOps()
        source = 'editor'
      }

      const { ops, label } = intent
      this.#commit(ops, {
        label: transactionPolicyLabel('editor-context', label),
        pushToHistory: false,
        source,
      })

      const reindexOps = buildReindexNumberedListItemsOps(this.#context.state)
      if (reindexOps.length > 0) {
        this.#commit(reindexOps, {
          label: transactionPolicyLabel(
            'editor-context',
            'reindex-numbered-list-items',
          ),
          pushToHistory: false,
          source,
        })
      }

      const durationMs = Date.now() - startedAt
      this.#documentStatus = 'ready'

      this.#eventSources.documentStatus.notify(this.#documentStatus)
      this.#eventSources.documentReady.notify({
        durationMs,
      })
    } catch (err: unknown) {
      const durationMs = Date.now() - startedAt

      const wrapped = DactyloError.wrap(err)
      error(wrapped.message, wrapped.stack)

      this.#documentStatus = 'error'

      this.#eventSources.documentStatus.notify(this.#documentStatus)
      this.#eventSources.documentError.notify({
        durationMs,
        error: wrapped,
      })

      throw wrapped
    }
  }

  // ─── Events ───────────────────────────────────────────────────----

  /** Returns the events emitted by the transaction pipeline. */
  get events(): TransactionPipelineEvents {
    return {
      commandTriggerBuffer: this.#commandTriggerBuffer.observable,
      context: this.#eventSources.context.observable,
      documentError: this.#eventSources.documentError.observable,
      documentReady: this.#eventSources.documentReady.observable,
      documentStatus: this.#eventSources.documentStatus.observable,
      emojisTriggerBuffer: this.#emojisTriggerBuffer.observable,
      history: this.#eventSources.history.observable,
      mentionBuffer: this.#mentionBuffer.observable,
      mentionDidCreated: this.#eventSources.mentionDidCreated.observable,
      transactionDidApply: this.#eventSources.transactionDidApply.observable,
      transactionDidReject: this.#eventSources.transactionDidReject.observable,
    }
  }

  // ─── Batching ─────────────────────────────────────────────────----

  /**
   * Flushes the batch by pushing the applied operations
   * as one history entry to the history stack.
   *
   * Notifies {@link EditorContext} subscribers and history subscribers.
   */
  #flushBatch(params: TransactionBatchFlushCallbackParams): void {
    const { applied, policy, notifyBehavior } = params
    this.#history.push({
      ops: [...applied.sourceOps],
      inverseOps: [...applied.inverseOps],
    })

    this.#syncInlineBuffers()

    if (notifyBehavior === 'end') {
      this.#eventSources.context.notify(this.#context)
    }

    this.#eventSources.transactionDidApply.notify({
      ops: [...applied.sourceOps],
      policy: {
        ...policy,
        source: policy?.source ?? 'editor',
      },
    })

    this.#notifyHistory()
  }

  /**
   * Rolls back a batch by restoring the {@link EditorContext} to the snapshot
   * and notifying the subscribers if the {@link EditorContext} was updated during the batch run.
   */
  #rollbackBatch(params: TransactionBatchRollbackCallbackParams): void {
    const { editorContextSnapshot, didNotify } = params

    this.#context = editorContextSnapshot
    if (didNotify) {
      this.#eventSources.context.notify(this.#context)
    }
  }

  /** Runs a batch of grouped operations as one single transaction. */
  runBatch<T>(
    /** The batch function to run. */
    fn: () => Awaitable<T>,
    opts: {
      /** The policy for the batch run. */
      policy?: TransactionBatchPolicy
      /** The behavior for notifying the editor context subscribers. Defaults to `'end'`. */
      notifyBehavior?: TransactionBatchNotifyBehavior
    } = {},
  ): Promise<T> {
    return this.#batch.run(fn, {
      editorContextSnapshot: this.#context,
      ...opts,
    })
  }

  // --- History operations ─────────────────────────────────────────--

  /** Whether at least one undo entry is available. */
  canUndo(): boolean {
    return !this.#batch.active && this.#history.canUndo()
  }

  /** Whether at least one redo entry is available. */
  canRedo(): boolean {
    return !this.#batch.active && this.#history.canRedo()
  }

  /** Applies the newest undo entry's inverse operations. */
  undo(): void {
    if (this.#batch.active) {
      historyError(
        'Cannot undo while a batch run is open.',
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
        'Cannot redo while a batch run is open.',
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

  /** Notifies the mentions that were created. */
  #notifyMentions(
    blockId: BlockId,
    mentions: MentionNode[],
    from: MentionDidCreatedEvent['from'],
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): void {
    for (const mention of mentions) {
      this.#eventSources.mentionDidCreated.notify({
        blockId,
        createdAt: mention.createdAt,
        entity: mention.entity,
        metadata: mention.metadata,
        nodeId: mention.id,
        from,
        source,
      })
    }
  }

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

    this.#notifyMentions(
      pointer.blockId,
      [mention],
      'confirm-buffered-inline-mention',
      source,
    )

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
   * Confirms an emojis trigger buffer by removing the opener character and the query text
   * from the current {@link TextNode}.
   *
   * Enforces core constraints invariants:
   *  - A emojis trigger is currently being buffered.
   *  - The emojis trigger buffer is confirmed by a user action.
   *  - When the emojis trigger buffer is confirmed, the opened character and the query text are removed
   *    from the current {@link TextNode} and the buffer is released and we notify that the emojis trigger
   *    buffer is confirmed.
   *  - Otherwise, the buffer is aborted and we notify that the emojis trigger buffer is aborted,
   *  - The deletion is pushed to the {@link HistoryStack}.
   *
   * Returns a boolean indicating whether the emojis trigger buffer was confirmed or not.
   */
  confirmBufferedInlineEmojisTrigger(
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    if (!this.#emojisTriggerBuffer.isBuffering) {
      warn(
        `Cannot confirm emojis trigger as there is no emojis trigger buffer active.`,
      )
      return false
    }

    const [pointer, bufferedText] = this.#emojisTriggerBuffer.get()

    /**
     * Should not happen as we check if the buffer is being buffered before calling this method.
     * But we return `null` for UI libraries to let render what they need based on this state
     * and not break the UI with an error.
     */
    if (pointer === null || bufferedText === null) {
      /** When no pointer or buffered text, we need to abort the buffer to clear up the state and notify the UI. */
      this.#emojisTriggerBuffer.abort()
      return false
    }

    const intent =
      this.#operationsEngine.buildDeleteEmojisTriggerInlineBufferSpanOps(
        this.#context,
        {
          ...pointer,
          bufferedText,
          character: this.#emojisTrigger.character,
        },
      )

    if (intent === null) {
      /** When no intent we need to abort the buffer to clear up the state and notify the UI. */
      this.#emojisTriggerBuffer.abort()
      return false
    }

    /** When the emojis trigger is confirmed, we release the buffer to clear up the state and notify the UI. */
    this.#emojisTriggerBuffer.release()

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('emojis-trigger', 'confirm', label),
      pushToHistory: true,
      source,
      /** When the emojis trigger is confirmed, we don't need to sync the inline buffers as the buffer is released. */
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
   * Dismisses an emojis trigger buffer by aborting it and pinning the caret at the
   * end of the query. Leaves the opener and query as ordinary text.
   *
   * Returns a boolean indicating whether the emojis trigger buffer was dismissed.
   */
  dismissBufferedInlineEmojisTrigger(
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    return this.#dismissInlineBuffer(
      this.#emojisTriggerBuffer,
      this.#emojisTrigger.character,
      source,
      'emojis-trigger',
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
            this.#commandTriggerBuffer.isBuffering ||
            this.#emojisTriggerBuffer.isBuffering)
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

      /** Inserting text. */
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
            !this.#commandTriggerBuffer.isBuffering &&
            !this.#emojisTriggerBuffer.isBuffering

          const isMentionIntent =
            canStartInlineBuffer && this.#isMentionIntent(text)

          const isCommandTriggerIntent =
            canStartInlineBuffer &&
            !isMentionIntent &&
            this.#isCommandTriggerIntent(text)

          const isEmojisTriggerIntent =
            canStartInlineBuffer &&
            !isMentionIntent &&
            !isCommandTriggerIntent &&
            this.#isEmojisTriggerIntent(text)

          const mentionPointer = isMentionIntent
            ? findInlineBufferPointerAtCursor(this.#context)
            : null

          const commandTriggerPointer = isCommandTriggerIntent
            ? findInlineBufferPointerAtCursor(this.#context)
            : null

          const emojisTriggerPointer = isEmojisTriggerIntent
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
            !canStartInlineBuffer ||
            this.#mentionBuffer.isBuffering ||
            this.#commandTriggerBuffer.isBuffering ||
            this.#emojisTriggerBuffer.isBuffering
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
          } else if (isEmojisTriggerIntent) {
            /**
             * Invariant UX:
             * A emojis trigger buffer is only started when the cursor is at the start of
             * a {@link TextNode} or immediately after a whitespace character.
             */
            if (emojisTriggerPointer !== null) {
              this.#emojisTriggerBuffer.start(emojisTriggerPointer)
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

          if (this.#emojisTriggerBuffer.isBuffering) {
            return this.dismissBufferedInlineEmojisTrigger('user')
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

    const [intent, blockId, mentions] = tuple

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('blocks', label),
      pushToHistory: true,
      source,
    })

    if (mentions !== null && mentions.length > 0) {
      this.#notifyMentions(blockId, mentions, 'insert-block', source)
    }

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
    const tuple = this.#operationsEngine.buildPatchBlockOps(
      this.#context,
      opts.blockId,
      opts.spec,
    )

    if (tuple === null) {
      return false
    }

    const [intent, mentions] = tuple

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('blocks', label),
      pushToHistory: true,
      source,
    })

    if (mentions !== null && mentions.length > 0) {
      this.#notifyMentions(opts.blockId, mentions, 'patch-block', source)
    }

    return true
  }

  /** Duplicates a {@link Block} by ID. */
  duplicateBlock(
    blockId: BlockId,
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    const tuple = this.#operationsEngine.buildDuplicateBlockOps(
      this.#context,
      blockId,
    )

    if (tuple === null) {
      return false
    }

    const [intent, cloneBlockId, mentions] = tuple

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('blocks', label),
      pushToHistory: true,
      source,
    })

    if (mentions !== null && mentions.length > 0) {
      this.#notifyMentions(cloneBlockId, mentions, 'duplicate-block', source)
    }

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

  // ─── Inline nodes operations ────────────────────────────────------

  /** Inserts text at a given {@link InlineNodeWithEditableText} offset. */
  insertText(
    opts: {
      blockId: BlockId
      nodeId: NodeId
      offset: number
      text: string
    },
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    const intent = this.#operationsEngine.buildInsertTextAtOps(
      this.#context,
      opts,
    )

    if (intent === null) {
      return false
    }

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('nodes', label),
      pushToHistory: true,
      source,
    })

    return true
  }

  /**
   * Inserts text at the current selection, or at the given {@link Selection} when provided.
   * Uses the same typing rules as `insertText` input type when composing from keystrokes.
   */
  insertTextAt(
    opts: {
      text: string
      at?: Selection | null
    },
    source: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ): boolean {
    const { text, at } = opts

    if (text.length === 0) {
      return false
    }

    const context =
      at === undefined ? this.#context : withSelection(this.#context, at)
    const intent = this.#operationsEngine.buildInsertTextOps(context, text)

    if (intent === null) {
      return false
    }

    const { ops, label } = intent
    this.#commit(ops, {
      label: transactionPolicyLabel('nodes', label),
      pushToHistory: true,
      source,
    })

    return true
  }
}
