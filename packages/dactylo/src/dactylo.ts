import { DEFAULT_PLACEHOLDER } from './internals/constants'
import { isMarkActiveInContext } from './internals/editor-context'
import type { EditorContext } from './internals/editor-context'
import { DactyloError } from './internals/errors'
import type {
  Observable,
  SubscriberCallback,
  UnsubscribeCallback,
} from './internals/event-source'
import { EventSource } from './internals/event-source'
import type { HistoryEvent } from './internals/history'
import type { MarkKey } from './internals/marks'
import { TransactionPipeline } from './internals/transaction'
import type { TransactionSource } from './internals/transaction'
import type { Awaitable } from './internals/types'

/** Discriminated union of commands that can be executed by the user/ai-agent. */
export type DactyloCommand =
  | 'editor-context/get-snapshot'
  | 'editor-context/subscribe'
  | 'history/undo'
  | 'history/redo'
  | 'history/can-undo'
  | 'history/can-redo'
  | 'marks/toggle'
  | 'marks/is-active'
  | 'keyboard/on-key-down'

/** Event emitted when a command is executed */
export interface DactyloCommandEvent {
  /** The command that was executed. */
  readonly command: DactyloCommand

  /** The status of the command. */
  readonly status: 'success' | 'error'

  /** The result of the command on success. */
  readonly result?: unknown

  /** The error thrown from the command on failure. Also delivered to {@link DactyloErrorEvent}. */
  readonly error?: DactyloError

  /** The duration of the command in milliseconds. */
  readonly durationMs: number

  /** The optional payload of the command. */
  readonly payload?: Record<string, unknown>
}

/** Event emitted when an error is thrown from a command. */
export interface DactyloErrorEvent {
  /** The command that caused the error. */
  readonly command: DactyloCommand

  /** The error thrown from the command. */
  readonly error: DactyloError

  /** The duration of the command in milliseconds. */
  readonly durationMs: number

  /** The optional payload of the command. */
  readonly payload?: Record<string, unknown>
}

/** Api to interact with the events of the editor. */
export interface DactyloEventsApi {
  /** Subscribes to the commands executed by the user/ai-agent. */
  readonly commands: Observable<DactyloCommandEvent>

  /** Subscribes to the errors thrown from commands. */
  readonly errors: Observable<DactyloErrorEvent>

  /** Subscribes to the history stack changes. */
  readonly history: Observable<HistoryEvent>
}

/** Event sources for {@link Dactylo} */
export interface DactyloEventSources {
  /** The event source for the commands executed by the user/ai-agent. */
  readonly commands: EventSource<DactyloCommandEvent>

  /** The event source for the errors thrown from commands. */
  readonly errors: EventSource<DactyloErrorEvent>
}

/** Commands to interact with the history of the editor. */
export interface DactyloHistoryCommands {
  /** Whether at least one undo entry is available. */
  readonly canUndo: () => Awaitable<boolean>

  /** Whether at least one redo entry is available. */
  readonly canRedo: () => Awaitable<boolean>

  /** Applies the newest undo entry via the transaction pipeline. */
  readonly undo: () => Awaitable<void>

  /** Re-applies the newest redo entry via the transaction pipeline. */
  readonly redo: () => Awaitable<void>
}

/** Commands to interact with the marks of the editor. */
export interface DactyloMarksCommands {
  /** Toggle a mark on or off via the transaction pipeline. */
  readonly toggle: (
    markKey: MarkKey,
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => Awaitable<void>

  /**
   * Whether a mark is active or not depending on the current current selection.
   * 👉🏻  A toolbar button for a mark that should appear pressed or not.
   */
  readonly isActive: (
    markKey: MarkKey,
    context: EditorContext,
  ) => Awaitable<boolean>
}

/** Commands to interact with the keyboard in the editor. */
export interface DactyloKeyboardCommands {
  /** Handles an `onKeyDown` event and returns a boolean indicating whether the event was handled or not. */
  readonly onKeyDown: (event: KeyboardEvent) => Awaitable<boolean>
}

/** Config options to use for the internal components and delegates of the editor. */
export interface DactyloConfigOptions {
  /** Configuration for the transaction pipeline */
  pipeline?: {
    /** Max ops queued before auto-flush. Default 512. Use Infinity for large paste. */
    batchMaxSize?: number

    /** Max undo entries retained. */
    historyMaxDepth?: number
  }
}

/** Options for constructing a {@link Dactylo} instance. */
export interface DactyloOptions {
  /** Placeholder text for the editor when no content is written. */
  placeholder?: string

  /** Config options to use for the internal components and delegates of the editor. */
  config?: DactyloConfigOptions
}

/**
 * Dactylo is a block-based rich-text markdown editor whose runtime model is a structured document (blocks + inline nodes),
 * not a plain text buffer with regex parsing on every keystroke.
 *
 * Users edit through familiar markdown behaviors (`# ` for headings, `**bold**`, etc.)
 * while the engine maintains a typed AST-like structure optimized for mutation, history, and future collaboration.
 *
 * The core spine of Dactylo is a transactional pipeline as it provides:
 *  1. Atomic batches
 *  2. Predictable and reversible mutations and optimistic local updates
 *  3. Side effects: history, events, ...
 *  4. Uniform input paths: keyboard, Ai edits, imports, all produce transactions
 *
 * Pipeline stages:
 * ┌─────────────┐   ┌──────────────┐   ┌───────────┐   ┌────────────┐   ┌──────────-┐
 * │   Source    │ → │ Build Tx     │ → │ Validate  │ → │ Apply      │ → │ Commit    │
 * │ (input/AI)  │   │ (ops batch)  │   │ (schema)  │   │ (pure)     │   │ (effects) │
 * └─────────────┘   └──────────────┘   └───────────┘   └────────────┘   └──────────-┘
 *                                          ↓ fail
 *                              Reject (state unchanged) + error
 *
 * @example
 * ```ts
 * import { Dactylo } from '@sugardarius/dactylo'
 *
 * const editor = new Dactylo({
 *  placeholder: 'Write something...',
 * })
 * ```
 */
export class Dactylo {
  /** Placeholder text for the editor when no content is written. */
  readonly #placeholder: string

  /** Transaction pipeline to use for the editor */
  readonly #pipeline: TransactionPipeline

  /** Events emitted by Dactylo. */
  readonly #eventSources: DactyloEventSources

  constructor(options: DactyloOptions) {
    this.#placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER
    this.#pipeline = new TransactionPipeline({
      batchMaxSize: options.config?.pipeline?.batchMaxSize,
      historyMaxDepth: options.config?.pipeline?.historyMaxDepth,
      placeholder: this.#placeholder,
    })
    this.#eventSources = {
      commands: new EventSource<DactyloCommandEvent>(),
      errors: new EventSource<DactyloErrorEvent>(),
    }
  }

  /**
   * Safely executes a command and handle gracefully errors.
   * When it rejects, the error is wrapped into a {@link DactyloError} and re-thrown,
   * and the event `errors` is emitted with it.
   * Emits an `commands` event when it settles.
   */
  #safeExecuteCommand<T>(
    command: DactyloCommand,
    executor: () => Awaitable<T>,
    payload?: Record<string, unknown>,
  ): Awaitable<T> {
    const startedAt = Date.now()
    try {
      const result = executor()
      const durationMs = Date.now() - startedAt

      this.#eventSources.commands.notify({
        command,
        durationMs,
        payload,
        result,
        status: 'success',
      })

      return result
    } catch (err) {
      const wrapped = DactyloError.wrap(err)
      const durationMs = Date.now() - startedAt

      // @todo: add specific logger.
      console.error(wrapped)

      this.#eventSources.errors.notify({
        command,
        durationMs,
        error: wrapped,
        payload,
      })
      this.#eventSources.commands.notify({
        command,
        durationMs,
        error: wrapped,
        payload,
        status: 'error',
      })

      throw err
    }
  }

  /**
   * Returns the Api to interact with the events of the editor.
   *
   * @example
   * ```ts
   * const unsub = editor.events.history.subscribe((event) => {
   *  console.log(event.canUndo, event.canRedo)
   * })
   * ```
   */
  get events(): DactyloEventsApi {
    return {
      /** Subscribes to the commands executed by the user/ai-agent. */
      commands: this.#eventSources.commands.observable,
      /** Subscribes to the errors thrown from executed commands. */
      errors: this.#eventSources.errors.observable,
      /** Subscribes to the history stack changes. */
      history: this.#pipeline.events.history,
    }
  }

  /**
   * Returns the commands to interact with the history of the editor.
   *
   * @example
   * ```ts
   * const canUndo = editor.history.canUndo()
   * if (canUndo) {
   *  editor.history.undo()
   * }
   * ```
   */
  get history(): DactyloHistoryCommands {
    return {
      /** Whether at least one redo entry is available. */
      canRedo: () =>
        this.#safeExecuteCommand('history/can-redo', () =>
          this.#pipeline.canRedo(),
        ),

      /** Whether at least one undo entry is available. */
      canUndo: () =>
        this.#safeExecuteCommand('history/can-undo', () =>
          this.#pipeline.canUndo(),
        ),

      /** Re-applies the newest redo entry via the transaction pipeline. */
      redo: () =>
        this.#safeExecuteCommand('history/redo', () => this.#pipeline.redo()),

      /** Applies the newest undo entry via the transaction pipeline. */
      undo: () =>
        this.#safeExecuteCommand('history/undo', () => this.#pipeline.undo()),
    }
  }

  /**
   * Returns the commands to interact with the marks of the editor.
   *
   * @example
   * ```ts
   * editor.marks.toggle('bold')
   * editor.marks.toggle('italic', 'ai-agent')
   *
   * const isBoldActive = editor.marks.isActive('bold', editor.getContextSnapshot())
   * ```
   */
  get marks(): DactyloMarksCommands {
    return {
      /**
       * Whether a mark is active or not depending from the selection on the given editor context.
       * 👉🏻  A toolbar button for a mark that should appear pressed or not.
       *
       * This is a pure function that does not mutate the editor context.
       * To check if a mark is active or not you need to call this function with
       * the current editor context after each updates.
       */
      isActive: (markKey: MarkKey, context: EditorContext) =>
        this.#safeExecuteCommand(
          'marks/is-active',
          () => isMarkActiveInContext(context, markKey),
          { mark: markKey },
        ),

      /** Toggle a mark on or off via the pipeline. */
      toggle: (
        markKey: MarkKey,
        source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
      ) =>
        this.#safeExecuteCommand(
          'marks/toggle',
          () => this.#pipeline.toggleMark(markKey, source),
          { mark: markKey, source },
        ),
    }
  }

  /**
   * Returns the commands to interact with the keyboard in the editor.
   *
   * @example
   * ```ts
   * <div onKeyDown={editor.keyboard.onKeyDown} contentEditable={true} />
   * ```
   */
  get keyboard(): DactyloKeyboardCommands {
    return {
      /** Handles an `onKeyDown` event and returns a boolean indicating whether the event was handled or not. */
      onKeyDown: (event: KeyboardEvent) =>
        this.#safeExecuteCommand(
          'keyboard/on-key-down',
          () => this.#pipeline.digestKeyboardEvent(event),
          { payload: { event } },
        ),
    }
  }

  /**
   * Returns the current editor context snapshot from the transaction pipeline.
   *
   * @example
   * ```ts
   * const context = editor.getContextSnapshot()
   * console.log(context.state.blocks)
   * ```
   */
  getContextSnapshot(): Awaitable<EditorContext> {
    return this.#safeExecuteCommand('editor-context/get-snapshot', () => ({
      ...this.#pipeline.context,
    }))
  }

  /**
   * Subscribes to the editor context and invokes the callback after each context update.
   * Returns a function to unsubscribe from the event.
   *
   * @example
   * ```ts
   * const unsub = editor.subscribe((context) => {
   *  render(context.state.blocks)
   * })
   * ```
   */
  subscribe(
    callback: SubscriberCallback<EditorContext>,
  ): Awaitable<UnsubscribeCallback> {
    return this.#safeExecuteCommand('editor-context/subscribe', () =>
      this.#pipeline.events.context.subscribe(callback),
    )
  }
}
