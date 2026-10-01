import type { BlockId } from './internals/blocks'
import { error, warnOnceIf } from './internals/console'
import {
  DEFAULT_HEADING_PLACEHOLDER,
  DEFAULT_MENTION_CHARACTER,
  DEFAULT_PARAGRAPH_PLACEHOLDER,
  DEFAULT_SLASH_COMMAND_CHARACTER,
} from './internals/constants'
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
import {
  isBlockWithActiveCursor,
  isSelectionActive,
} from './internals/selection'
import { TransactionPipeline } from './internals/transaction'
import type { Transaction, TransactionSource } from './internals/transaction'
import type { Relax } from './internals/types'
import { noop } from './internals/utils'

/** Api to interact with one aspect of the editor. */
export interface DactyloAspectApi<A, C> {
  /** Tools to query one aspect of the editor.*/
  readonly tools: A

  /** Commands to mutate one aspect of the editor. */
  readonly commands: C
}

/** Static configuration for the editor. */
export interface DactyloStaticConfig {
  /** Configuration for mentions. */
  mentions: {
    /**
     * The character to trigger a mention.
     * Defaults to `@`
     */
    character: string
  }

  /** Configuration for slash command. */
  slashCommand: {
    /**
     * The character to trigger a slash command.
     * Defaults to `/`
     */
    character: string
  }

  /** Configuration for the headings */
  heading: {
    /** Placeholder text when a heading is created or empty. */
    placeholder: string
  }

  /** Configuration for the paragraphs */
  paragraph: {
    /** Placeholder text when an empty paragraph is created or empty. */
    placeholder: string
  }
}

/** Discriminated union of tools that can be executed by the user/ai-agent. */
export type DactyloTool =
  /** History tools */
  | 'history/can-undo'
  | 'history/can-redo'

  /** Marks tools */
  | 'marks/is-active'

  /** Selection tools */
  | 'selection/is-block-with-active-cursor'
  | 'selection/is-focused'

/** Discriminated union of commands that can be executed by the user/ai-agent. */
export type DactyloCommand =
  /** History commands */
  | 'history/undo'
  | 'history/redo'

  /** Marks commands */
  | 'marks/toggle'

  /** Composer commands */
  | 'composer/send-input'

  /** Selection commands */
  | 'selection/focus'
  | 'selection/blur'

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

/** Event emitted when a tool is executed by the user/ai-agent. */
export interface DactyloToolEvent {
  /** The tool that was executed. */
  readonly tool: DactyloTool

  /** The status of the tool. */
  readonly status: 'success' | 'error'

  /** The result of the tool on success. */
  readonly result?: unknown

  /** The error thrown from the command on failure. Also delivered to {@link DactyloErrorEvent}. */
  readonly error?: DactyloError

  /** The duration of the tool in milliseconds. */
  readonly durationMs: number

  /** The optional payload of the tool. */
  readonly payload?: Record<string, unknown>
}

/** Event emitted when an error is thrown from a command or a tool. */
export type DactyloErrorEvent = {
  /** The error thrown from the command or tool. */
  readonly error: DactyloError

  /** The duration of the command or tool in milliseconds. */
  readonly durationMs: number

  /** The optional payload of the command or tool. */
  readonly payload?: Record<string, unknown>
} & Relax<
  | {
      /** The command  that caused the error. */
      readonly command: DactyloCommand
    }
  | {
      /** The tool that caused the error. */
      readonly tool: DactyloTool
    }
>

/** Event emitted when the `editable` state changes in the editor. */
export interface DactyloEditableEvent {
  /** The editor state. */
  readonly editable: boolean
}

/** Api to interact with the events of the editor. */
export interface DactyloEventsApi {
  /** Subscribes to the `editable` changes */
  readonly editable: Observable<DactyloEditableEvent>

  /** Subscribes to the commands executed by the user/ai-agent. */
  readonly commands: Observable<DactyloCommandEvent>

  /** Subscribes to the tools executed by the user/ai-agent. */
  readonly tools: Observable<DactyloToolEvent>

  /** Subscribes to the errors thrown from commands or tools. */
  readonly errors: Observable<DactyloErrorEvent>

  /** Subscribes to the history stack changes. */
  readonly history: Observable<HistoryEvent>

  /**
   * Subscribes to applied transactions.
   * 👉🏻 Useful for low-level debugging and tracing.
   */
  readonly transactionDidApply: Observable<Transaction>

  /**
   * Subscribes to rejected transactions.
   * 👉🏻 Useful for low-level debugging and tracing.
   */
  readonly transactionDidReject: Observable<Transaction>
}

/** Event sources for {@link Dactylo} */
export interface DactyloEventSources {
  /** The event source for `editable` changes.  */
  readonly editable: EventSource<DactyloEditableEvent>

  /** The event source for the commands executed by the user/ai-agent. */
  readonly commands: EventSource<DactyloCommandEvent>

  /** The event source for the tools executed by the user/ai-agent. */
  readonly tools: EventSource<DactyloToolEvent>

  /** The event source for the errors thrown from commands. */
  readonly errors: EventSource<DactyloErrorEvent>
}

/** Tools to query the history of the editor. */
export interface DactyloHistoryTools {
  /** Whether at least one undo entry is available. */
  readonly canUndo: () => boolean

  /** Whether at least one redo entry is available. */
  readonly canRedo: () => boolean
}

/** Commands to mutate the history of the editor. */
export interface DactyloHistoryCommands {
  /** Applies the newest undo entry via the transaction pipeline. */
  readonly undo: () => void

  /** Re-applies the newest redo entry via the transaction pipeline. */
  readonly redo: () => void
}

/** Api to interact with the history of the editor. */
export type DactyloHistoryApi = DactyloAspectApi<
  DactyloHistoryTools,
  DactyloHistoryCommands
>

/** Tools to query the marks of the editor. */
export interface DactyloMarksTools {
  /**
   * Whether a mark is active or not depending on the current current selection.
   * 👉🏻 A toolbar button for a mark that should appear pressed or not.
   *
   * This is a pure function that does not mutate the editor context.
   */
  readonly isActive: (mark: MarkKey) => boolean
}

/** Commands to mutate the marks of the editor. */
export interface DactyloMarksCommands {
  /** Toggle a mark on or off via the transaction pipeline. */
  readonly toggle: (
    mark: MarkKey,
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void
}

/** Api to interact with the marks of the editor. */
export type DactyloMarksApi = DactyloAspectApi<
  DactyloMarksTools,
  DactyloMarksCommands
>

/** Tools to query the composer of the editor. */
// oxlint-disable-next-line typescript/no-empty-interface typescript/no-empty-object-type
export interface DactyloComposerTools {}

/** Commands to mutate the {@link DocumentState} of the editor. */
export interface DactyloComposerCommands {
  /**
   * Sends an input event to the editor and returns a boolean indicating whether the event was processed or not.
   * Input events are triggered by user actions such as typing, pasting, or selecting text.
   *
   * Use it to handle events like `onBeforeInput` or `onInput` to get real user intent and get:
   *  - inserted characters
   *  - delete intents
   *  - data transfer from copy/paste
   *
   * Using input events is meant to be used with the `onBeforeInput` event handler
   * for IME composition and be compliant with virtual mobile keyboards (iOS and Android)
   * by telling us "What's being inserted", not just "What's being pressed".
   */
  readonly sendInput: (event: InputEvent) => boolean
}

/** Api to interact with the composer of the editor. */
export type DactyloComposerApi = DactyloAspectApi<
  DactyloComposerTools,
  DactyloComposerCommands
>

/** Tools to query the selection of the editor. */
export interface DactyloSelectionTools {
  /**
   * Whether the block with the given ID is with an active cursor selection within.
   * This is a pure function that does not mutate the editor context.
   */
  readonly isBlockWithActiveCursor: (blockId: BlockId) => boolean

  /**
   * Whether the editor is focused or not.
   * This is a pure function that does not mutate the editor context.
   */
  readonly isFocused: () => boolean
}

/** Commands to mutate the selection of the editor. */
export interface DactyloSelectionCommands {
  /** Focus the editor by placing a collapsed cursor at the end of the document. */
  readonly focus: (
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /** Blur the editor by clearing the selection. */
  readonly blur: (
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void
}

/** Api to interact with the selection of the editor. */
export type DactyloSelectionApi = DactyloAspectApi<
  DactyloSelectionTools,
  DactyloSelectionCommands
>

/** Config options to use for the internal components and delegates of the editor. */
export interface DactyloConfigOptions {
  /** Configuration for the editor */
  editor?: {
    /** Configuration for mentions. */
    mentions?: {
      /**
       * The character to trigger a mention.
       * Defaults to `@`
       */
      character?: string
    }

    /** Configuration for slash command. */
    slashCommand?: {
      /**
       * The character to trigger a slash command.
       * Defaults to `/`
       */
      character?: string
    }

    /** Configuration for the paragraphs */
    paragraph?: {
      /**
       * Placeholder text when an empty paragraph is created or empty.
       * Defaults to placeholder option in {@link DactyloOptions} if set
       * or defaults to {@link DEFAULT_PARAGRAPH_PLACEHOLDER}.
       */
      placeholder?: string
    }

    /** Configuration for the headings */
    heading?: {
      /**
       * Placeholder text when a heading is created or empty.
       * Defaults to {@link DEFAULT_HEADING_PLACEHOLDER} with level.
       * @example
       * ```txt
       * Heading 1
       * ```
       */
      placeholder?: string
    }
  }

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
  /** Alias for {@link DactyloConfigOptions.editor.paragraph.placeholder}. */
  placeholder?: string

  /**
   * Whether the editor is editable.
   * Defaults to `true`
   */
  editable?: boolean

  /** Config options to use for the internal components and delegates of the editor. */
  config?: DactyloConfigOptions

  /**
   * Whether to enable debug mode.
   * Defaults to `false`
   */
  debug?: boolean
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
 * ┌─────────────┐   ┌──────────────┐   ┌───────────┐   ┌────────────┐   ┌──────────---------┐
 * │   Source    │ → │ Build Tx     │ → │ Validate  │ → │ Apply      │ → │ Commit Effects    │
 * │ (input/AI)  │   │ (ops batch)  │   │ (schema)  │   │ (pure)     │   │ (history/events)  │
 * └─────────────┘   └──────────────┘   └───────────┘   └────────────┘   └──────────---------┘
 *                                          ↓ fail
 *                              Reject (state unchanged) + error
 *
 * @example
 * ```ts
 * import { Dactylo } from '@sugardarius/dactylo'
 *
 * const editor = new Dactylo({
 *  placeholder: 'Write something…',
 * })
 * ```
 */
export class Dactylo {
  /** Whether the editor is editable or not. */
  #editable: boolean

  /** Whether to enable debug mode. */
  readonly #debug: boolean

  /** Static configuration for the editor. */
  readonly #config: DactyloStaticConfig

  /** Transaction pipeline to use for the editor */
  readonly #pipeline: TransactionPipeline

  /** Events emitted by Dactylo. */
  readonly #eventSources: DactyloEventSources

  constructor(options: DactyloOptions = {}) {
    this.#editable = options.editable ?? true
    this.#debug = options.debug ?? false
    this.#config = {
      heading: {
        placeholder:
          options.config?.editor?.heading?.placeholder ??
          DEFAULT_HEADING_PLACEHOLDER,
      },
      mentions: {
        character:
          options.config?.editor?.mentions?.character ??
          DEFAULT_MENTION_CHARACTER,
      },
      paragraph: {
        placeholder:
          options.placeholder ??
          options.config?.editor?.paragraph?.placeholder ??
          DEFAULT_PARAGRAPH_PLACEHOLDER,
      },
      slashCommand: {
        character:
          options.config?.editor?.slashCommand?.character ??
          DEFAULT_SLASH_COMMAND_CHARACTER,
      },
    }
    this.#pipeline = new TransactionPipeline({
      batchMaxSize: options.config?.pipeline?.batchMaxSize,
      historyMaxDepth: options.config?.pipeline?.historyMaxDepth,
      operations: {
        engine: {
          mentions: {
            character: this.#config.mentions.character,
          },
          slashCommand: {
            character: this.#config.slashCommand.character,
          },
        },
      },
    })
    this.#eventSources = {
      commands: new EventSource<DactyloCommandEvent>(),
      editable: new EventSource<DactyloEditableEvent>(),
      errors: new EventSource<DactyloErrorEvent>(),
      tools: new EventSource<DactyloToolEvent>(),
    }
  }

  /**
   * Safely executes a command based on the `editable` state of the editor
   * and handle gracefully errors.
   *
   * When the editor is not editable, the command is executed with a fallback executor,
   * allowing to return a default value without throwing an error and crashing UI libraries
   * using the editor.
   * In most cases, the fallback executor either returns `false` or `void` as a no-op.
   *
   * When it rejects, the error is wrapped into a {@link DactyloError} and re-thrown,
   * and the event `errors` is emitted with it.
   * Emits a `commands` event when it settles.
   */
  #safeExecuteCommand<T>(
    command: DactyloCommand,
    executor: () => T,
    fallback: () => T,
    opts?: {
      payload?: Record<string, unknown>
    },
  ): T {
    const startedAt = Date.now()

    let $executor = executor
    if (!this.#editable) {
      warnOnceIf(
        this.#debug,
        `Command \`${command}\` cannot perform any transactions or operations as editor is not editable. To make it editable please call the method \`.setEditable(true)\`. Fallback executor is used instead.`,
      )
      $executor = fallback
    }

    try {
      const result = $executor()
      const durationMs = Date.now() - startedAt

      this.#eventSources.commands.notify({
        command,
        durationMs,
        payload: opts?.payload,
        result,
        status: 'success',
      })

      return result
    } catch (err) {
      const wrapped = DactyloError.wrap(err)
      const durationMs = Date.now() - startedAt

      error(wrapped.message, wrapped.stack)

      this.#eventSources.errors.notify({
        command,
        durationMs,
        error: wrapped,
        payload: opts?.payload,
      })
      this.#eventSources.commands.notify({
        command,
        durationMs,
        error: wrapped,
        payload: opts?.payload,
        status: 'error',
      })

      throw wrapped
    }
  }

  /**
   * Safely executes a tool based on the `editable` state of the editor
   * and handle gracefully errors.
   *
   * When the editor is not editable, the tool is executed with a fallback executor,
   * allowing to return a default value without throwing an error and crashing UI libraries
   * using the editor.
   * In most cases, the fallback executor either returns `false` or `void` as a no-op.
   *
   * When it rejects, the error is wrapped into a {@link DactyloError} and re-thrown,
   * and the event `errors` is emitted with it.
   * Emits a `tools` event when it settles.
   */
  #safeExecuteTool<T>(
    tool: DactyloTool,
    executor: () => T,
    fallback: () => T,
    opts?: { payload?: Record<string, unknown> },
  ): T {
    const startedAt = Date.now()

    let $executor = executor
    if (!this.#editable) {
      warnOnceIf(
        this.#debug,
        `Tool \`${tool}\` cannot be executed as editor is not editable. To make it editable please call the method \`.setEditable(true)\`. Fallback executor is used instead.`,
      )
      $executor = fallback
    }

    try {
      const result = $executor()
      const durationMs = Date.now() - startedAt

      this.#eventSources.tools.notify({
        durationMs,
        payload: opts?.payload,
        result,
        status: 'success',
        tool,
      })

      return result
    } catch (err) {
      const wrapped = DactyloError.wrap(err)
      const durationMs = Date.now() - startedAt

      error(wrapped.message, wrapped.stack)

      this.#eventSources.errors.notify({
        durationMs,
        error: wrapped,
        payload: opts?.payload,
        tool,
      })
      this.#eventSources.tools.notify({
        durationMs,
        error: wrapped,
        payload: opts?.payload,
        status: 'error',
        tool,
      })

      throw wrapped
    }
  }
  /**
   * Returns the static configuration for the editor.
   *
   * @example
   * ```ts
   * const config = editor.config
   *
   * console.log(config.paragraph.placeholder)
   * console.log(config.heading.placeholder)
   * ```
   */
  get config(): DactyloStaticConfig {
    return this.#config
  }

  /** Returns the Api to interact with the events of the editor. */
  get events(): DactyloEventsApi {
    return {
      /**
       * Subscribes to the commands executed by the user/ai-agent.
       *
       * @example
       * ```ts
       * const unsub = editor.events.commands.subscribe((event) => {
       *  console.log(event.command, event.status)
       * })
       * ```
       */
      commands: this.#eventSources.commands.observable,

      /**
       * Subscribe to the `editable` changes.
       *
       * @example
       * ```ts
       * const unsub = editor.events.editable.subscribe((event) => {
       *  console.log(event.editable)
       * })
       * ```
       */
      editable: this.#eventSources.editable.observable,

      /**
       * Subscribes to the errors thrown from executed commands.
       *
       * @example
       * ```ts
       * const unsub = editor.events.errors.subscribe((event) => {
       *  console.log(event.command, event.error)
       * })
       * ```
       */
      errors: this.#eventSources.errors.observable,

      /**
       * Subscribes to the history stack changes.
       *
       * @example
       * ```ts
       * const unsub = editor.events.history.subscribe((event) => {
       *  console.log(event.canUndo, event.canRedo)
       * })
       * ```
       */
      history: this.#pipeline.events.history,

      /**
       * Subscribes to the tools executed by the user/ai-agent.
       *
       * @example
       * ```ts
       * const unsub = editor.events.tools.subscribe((event) => {
       *  console.log(event.tool, event.status)
       * })
       * ```
       */
      tools: this.#eventSources.tools.observable,

      /**
       * Subscribes to applied transactions.
       * 👉🏻 Useful for low-level debugging and tracing.
       *
       * @example
       * ```ts
       * const unsub = editor.events.transactionDidApply.subscribe((event) => {
       *  console.log(event.transaction)
       * })
       * ```
       */
      transactionDidApply: this.#pipeline.events.transactionDidApply,

      /**
       * Subscribes to rejected transactions.
       * 👉🏻 Useful for low-level debugging and tracing.
       *
       * @example
       * ```ts
       * const unsub = editor.events.transactionDidReject.subscribe((event) => {
       *  console.log(event.transaction)
       * })
       * ```
       */
      transactionDidReject: this.#pipeline.events.transactionDidReject,
    }
  }

  /** Returns the Api to interact with the history of the editor. */
  get history(): DactyloHistoryApi {
    return {
      commands: {
        /**
         * Re-applies the newest redo entry via the transaction pipeline.
         *
         * @example
         * ```ts
         * editor.history.commands.redo()
         * ```
         */
        redo: (): void =>
          this.#safeExecuteCommand(
            'history/redo',
            () => this.#pipeline.redo(),
            noop,
          ),

        /**
         * Applies the newest undo entry via the transaction pipeline.
         *
         * @example
         * ```ts
         * editor.history.commands.undo()
         * ```
         */
        undo: (): void =>
          this.#safeExecuteCommand(
            'history/undo',
            () => this.#pipeline.undo(),
            noop,
          ),
      },
      tools: {
        /**
         * Whether at least one redo entry is available.
         *
         * @example
         * ```ts
         * const canRedo = editor.history.tools.canRedo()
         * if (canRedo) {
         *  editor.history.commands.redo()
         * }
         * ```
         */
        canRedo: (): boolean =>
          this.#safeExecuteTool(
            'history/can-redo',
            () => this.#pipeline.canRedo(),
            () => false,
          ),

        /**
         * Whether at least one undo entry is available.
         *
         * @example
         * ```ts
         * const canUndo = editor.history.tools.canUndo()
         * if (canUndo) {
         *  editor.history.commands.undo()
         * }
         * ```
         */
        canUndo: (): boolean =>
          this.#safeExecuteTool(
            'history/can-undo',
            () => this.#pipeline.canUndo(),
            () => false,
          ),
      },
    }
  }

  /** Returns the Api to interact with the marks of the editor. */
  get marks(): DactyloMarksApi {
    return {
      commands: {
        /**
         * Toggle a mark on or off via the pipeline.
         *
         * @example
         * ```ts
         * editor.marks.commands.toggle('bold')
         * ```
         */
        toggle: (
          mark: MarkKey,
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ): void =>
          this.#safeExecuteCommand(
            'marks/toggle',
            () => this.#pipeline.toggleMark(mark, source),
            noop,
            { payload: { mark, source } },
          ),
      },
      tools: {
        /**
         * Whether a mark is active or not depending from the selection on the given editor context.
         * 👉🏻  A toolbar button for a mark that should appear pressed or not.
         *
         * This is a pure function that does not mutate the editor context.
         *
         * @example
         * ```ts
         * const isBoldActive = editor.marks.tools.isActive('bold')
         * ```
         */
        isActive: (mark: MarkKey): boolean =>
          this.#safeExecuteTool(
            'marks/is-active',
            () => isMarkActiveInContext(this.#pipeline.context, mark),
            () => false,
            { payload: { mark } },
          ),
      },
    }
  }

  /** Returns the Api to interact with the composer of the editor. */
  get composer(): DactyloComposerApi {
    return {
      commands: {
        /**
         * Sends an input event to the editor and returns a boolean indicating whether the event was processed or not.
         * @example
         * ```ts
         * const handleBeforeInput = (event: InputEvent) => {
         *  editor.composer.commands.sendInput(event)
         * }
         *
         * const editable = document.getElementById('editable')
         * editable?.addEventListener('beforeinput', handleBeforeInput)
         *
         * <div id='editable' contentEditable={true} />
         * ```
         */
        sendInput: (event: InputEvent): boolean =>
          this.#safeExecuteCommand(
            'composer/send-input',
            () => this.#pipeline.digestInputEvent(event),
            () => false,
            { payload: { event } },
          ),
      },
      // @todo: add tools for the composer
      tools: {},
    }
  }

  /** Returns the Api to interact with the selection of the editor. */
  get selection(): DactyloSelectionApi {
    return {
      // @todo: add select-all and deselect commands
      commands: {
        /**
         * Blurs the editor by clearing the selection.
         *
         * @example
         * ```ts
         * editor.selection.commands.blur()
         * ```
         */
        blur: (
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ): void =>
          this.#safeExecuteCommand(
            'selection/blur',
            () => this.#pipeline.clearSelection(source),
            noop,
          ),

        /**
         * Focus the editor by placing a collapsed cursor at the end of the document.
         *
         * @example
         * ```ts
         * editor.selection.commands.focus()
         * ```
         */
        focus: (
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ): void =>
          this.#safeExecuteCommand(
            'selection/focus',
            () => this.#pipeline.putCursorSelectionAtDocumentEnd(source),
            noop,
          ),
      },
      tools: {
        /**
         * Whether the block with the given ID is with an active cursor selection within.
         * This is a pure function that does not mutate the editor context.
         *
         * @example
         * ```ts
         * const withActiveCursor = editor.selection.tools.isBlockWithActiveCursor(blockId)
         * ```
         */
        isBlockWithActiveCursor: (blockId: BlockId): boolean =>
          this.#safeExecuteTool(
            'selection/is-block-with-active-cursor',
            () =>
              isBlockWithActiveCursor(
                this.#pipeline.context.selection,
                blockId,
              ),
            () => false,
          ),

        /**
         * Whether the selection is active or not.
         * This is a pure function that does not mutate the editor context.
         *
         * @example
         * ```ts
         * const isFocused = editor.selection.tools.isFocused()
         * ```
         */
        isFocused: (): boolean =>
          this.#safeExecuteTool(
            'selection/is-focused',
            () => isSelectionActive(this.#pipeline.context.selection),
            () => false,
          ),
      },
    }
  }

  /**
   * Returns whether the editor is editable.
   *
   * @example
   * ```ts
   * const canEdit = editor.canEdit()
   * console.log(canEdit))
   * ```
   */
  canEdit(): boolean {
    return this.#editable
  }

  /**
   * Sets the editable state of the editor.
   *
   * Clears the selection when the editor is set to not editable.
   * Emits an `editable` event when the editor `editable` change.
   *
   * @example
   * ```ts
   * editor.setEditable(true)
   * editor.setEditable(false, 'ai-agent')
   * ```
   */
  setEditable(
    next: boolean,
    source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
  ): void {
    const current = this.#editable
    /** no-op if the value is the same as the current `editable` state. */
    if (current === next) {
      warnOnceIf(
        this.#debug,
        `Editor is already ${current ? 'editable' : 'not editable'}.`,
      )
      return
    }

    this.#editable = next
    if (next === false) {
      this.#pipeline.clearSelection(source)
    }
    this.#eventSources.editable.notify({ editable: next })
  }

  /**
   * Returns the current editor context from the transaction pipeline.
   *
   * @example
   * ```ts
   * const context = editor.getContext()
   * console.log(context.state.blocks)
   * ```
   */
  getContext(): EditorContext {
    /** Passthrough for DX convenience. */
    return this.#pipeline.context
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
  subscribe(callback: SubscriberCallback<EditorContext>): UnsubscribeCallback {
    /** Passthrough for DX convenience. */
    return this.#pipeline.events.context.subscribe(callback)
  }
}
