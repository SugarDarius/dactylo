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
} from './internals/augmentation'
import type {
  Block,
  BlockId,
  BlockWithInlineContentEmptiness,
} from './internals/blocks'
import { error, warnOnceIf } from './internals/console'
import {
  DEFAULT_AUTOLINK_ENABLED,
  DEFAULT_BULLET_LIST_ITEM_PLACEHOLDER,
  DEFAULT_CHECKBOX_LIST_ITEM_PLACEHOLDER,
  DEFAULT_COMMAND_TRIGGER_CHARACTER,
  DEFAULT_COMMAND_TRIGGER_ENABLED,
  DEFAULT_HEADING_PLACEHOLDER,
  DEFAULT_LINK_OPEN_ON_CLICK_ENABLED,
  DEFAULT_LOCALES,
  DEFAULT_MARKDOWN_SHORTCUTS_ENABLED,
  DEFAULT_MENTION_CHARACTER,
  DEFAULT_MENTIONS_ENABLED,
  DEFAULT_NUMBERED_LIST_ITEM_PLACEHOLDER,
  DEFAULT_PARAGRAPH_PLACEHOLDER,
  DEFAULT_QUOTE_PLACEHOLDER,
} from './internals/constants'
import {
  getBlock,
  getBlockSelectionCoverageTopology,
  getInlineNodeSelectionCoverageTopology,
  isBlockWithInlineContentEmpty,
} from './internals/document'
import { DOMManager } from './internals/dom-manager'
import { isMarkActiveInContext } from './internals/editor-context'
import type { EditorContext } from './internals/editor-context'
import { DactyloError } from './internals/errors'
import type {
  Observable,
  SubscriberCallback,
  UnsubscribeCallback,
} from './internals/event-source'
import { EventSource } from './internals/event-source'
import type { HistoryEvent, HistoryStackOptions } from './internals/history'
import type { InlineBufferPointer } from './internals/inline-buffer'
import type { MarkKey } from './internals/marks'
import { extractMention } from './internals/mention'
import type {
  ExtractMentionQuery,
  MentionWithContext,
} from './internals/mention'
import type { NodeId } from './internals/nodes'
import type {
  InsertBlockSpec,
  InsertOrMoveBlockPosition,
  MutateBlockSpec,
  PatchBlockSpec,
} from './internals/operations-builder'
import {
  isBlockWithActiveCursor,
  isBlockWithActiveRange,
  isBlockWithActiveSelection,
  isSelectionActive,
} from './internals/selection'
import type {
  Selection,
  SelectionCoverageTopology,
} from './internals/selection'
import { TransactionPipeline } from './internals/transaction'
import type {
  CommandTriggerBufferEvent,
  MentionBufferEvent,
  MentionDidCreatedEvent,
  Transaction,
  TransactionSource,
} from './internals/transaction'
import type {
  CancelCallback,
  OptionalTupleUnless,
  Relax,
  WithUnless,
} from './internals/types'
import { canUseDOM, negate, noop, nullish } from './internals/utils'

/** Api to interact with one aspect of the editor. */
export interface DactyloAspectApi<T extends object, C extends object> {
  /** Tools to query one aspect of the editor.*/
  readonly tools: T

  /** Commands to mutate one aspect of the editor. */
  readonly commands: C
}

/** Static configuration for the editor. */
export interface DactyloStaticConfig {
  /** Configuration for markdown shortcuts. */
  readonly markdown: {
    /**
     * Whether to enable markdown shortcuts.
     * Defaults to `true`
     */
    readonly enabled: boolean
  }

  /** Configuration for autolink detection. */
  readonly autolink: {
    /**
     * Whether to enable autolink detection.
     * Defaults to `true`
     */
    readonly enabled: boolean
  }

  /** The locales used for writing and reading text. */
  readonly locales: Intl.LocalesArgument

  /** Configuration for command trigger. */
  readonly commandTrigger: {
    /**
     * Whether to enable command trigger.
     * Defaults to `true`
     */
    readonly enabled: boolean

    /**
     * The character to trigger a command.
     * Defaults to `/`
     */
    readonly character: string
  }

  /** Configuration for headings. */
  readonly heading: {
    /** Placeholder text when a heading is created or empty. */
    readonly placeholder: string

    /**
     * Initial metadata applied.
     * Defaults to `{}`
     */
    readonly initialMetadata: HBM
  }

  /** Configuration for paragraphs. */
  readonly paragraph: {
    /** Placeholder text when an empty paragraph is created or empty. */
    readonly placeholder: string

    /**
     * Initial metadata applied.
     * Defaults to `{}`
     */
    readonly initialMetadata: PBM
  }

  /** Configuration for quotes. */
  readonly quote: {
    /** Placeholder text when an empty quote is created or empty. */
    readonly placeholder: string

    /**
     * Initial metadata applied.
     * Defaults to `{}`
     */
    readonly initialMetadata: QBM
  }

  /** Configuration for bulleted lists. */
  readonly bulletedList: {
    /** Placeholder text when a bullet list item is created or empty. */
    readonly placeholder: string

    /**
     * Initial metadata applied.
     * Defaults to `{}`
     */
    readonly initialMetadata: BBM
  }

  /** Configuration for numbered lists. */
  readonly numberedList: {
    /** Placeholder text when a numbered list item is created or empty. */
    readonly placeholder: string

    /**
     * Initial metadata applied.
     * Defaults to `{}`
     */
    readonly initialMetadata: NBM
  }

  /** Configuration for checkbox lists. */
  readonly checkboxList: {
    /** Placeholder text when a checkbox list item is created or empty. */
    readonly placeholder: string

    /**
     * Initial metadata applied.
     * Defaults to `{}`
     */
    readonly initialMetadata: CBM
  }

  /** Configuration for dividers. */
  readonly divider: {
    /**
     * Initial metadata applied.
     * Defaults to `{}`
     */
    readonly initialMetadata: DBM
  }

  /** Configuration for texts. */
  readonly text: {
    /**
     * Initial metadata applied.
     * Defaults to `{}`
     */
    readonly initialMetadata: TNM
  }

  /** Configuration for links. */
  readonly link: {
    /**
     * Whether to open links on click when the editor is editable.
     * Defaults to `true`
     */
    readonly openOnClick: boolean

    /**
     * Initial metadata applied.
     * Defaults to `{}`
     */
    readonly initialMetadata: LNM
  }

  /** Configuration for line breaks. */
  readonly lineBreak: {
    /**
     * Initial metadata applied.
     * Defaults to `{}`
     */
    readonly initialMetadata: LBNM
  }

  /** Configuration for mentions. */
  readonly mentions: {
    /**
     * Whether to enable mentions.
     * Defaults to `true`
     */
    readonly enabled: boolean

    /**
     * The character to trigger a mention.
     * Defaults to `@`
     */
    readonly character: string

    /**
     * Initial metadata applied.
     * Defaults to `{}`
     */
    readonly initialMetadata: MNM
  }
}

/** Discriminated union of tools that can be executed by the user/ai-agent. */
export type DactyloTool =
  /** History tools. */
  | 'history/can-undo'
  | 'history/can-redo'

  /** Marks tools. */
  | 'marks/is-active'

  /** Selection tools */
  | 'selection/get-block-selection-coverage'
  | 'selection/get-node-selection-coverage'
  | 'selection/is-block-with-active-cursor'
  | 'selection/is-block-with-active-range'
  | 'selection/is-block-with-active-selection'
  | 'selection/is-focused'

  /** DOM tools. */
  | 'dom/get-active-range'

  /** Blocks tools. */
  | 'blocks/get'
  | 'blocks/is-with-empty-inline-content'

  /** Mentions tools. */
  | 'mentions/is-buffering'
  | 'mentions/get-buffered-text'
  | 'mentions/get-pointer'
  | 'mentions/extract'

  /** Command trigger tools. */
  | 'command-trigger/is-buffering'
  | 'command-trigger/get-buffered-text'
  | 'command-trigger/get-pointer'

/** Discriminated union of commands that can be executed by the user/ai-agent. */
export type DactyloCommand =
  /** History commands. */
  | 'history/undo'
  | 'history/redo'
  | 'history/clear'

  /** Marks commands. */
  | 'marks/toggle'

  /** Composer commands. */
  | 'composer/send-input'
  | 'composer/send-keydown'
  | 'composer/set-ime-composing'

  /** Selection commands. */
  | 'selection/focus'
  | 'selection/blur'

  /** DOM commands. */
  | 'dom/attach'
  | 'dom/detach'
  | 'dom/paint-caret-at'
  | 'dom/paint-range-at'
  | 'dom/sync-selection'
  | 'dom/clear-selection'
  | 'dom/get-active-range'

  /** Blocks commands. */
  | 'blocks/insert'
  | 'blocks/duplicate'
  | 'blocks/delete'
  | 'blocks/move'
  | 'blocks/mutate'
  | 'blocks/patch'

  /** Mentions commands. */
  | 'mentions/confirm-buffer'
  | 'mentions/dismiss-buffer'

  /** Command trigger commands. */
  | 'command-trigger/confirm'
  | 'command-trigger/dismiss'

/** Event emitted when a command is executed. */
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
  /**
   * Subscribes to the `editable` changes
   *
   * @example
   * ```ts
   * const unsub = editor.events.editable.subscribe((event) => {
   *  console.log(event.editable)
   * })
   */
  readonly editable: Observable<DactyloEditableEvent>

  /**
   * Subscribes to the commands executed by the user/ai-agent.
   *
   * @example
   * ```ts
   * const unsub = editor.events.commands.subscribe((event) => {
   *  console.log(event.command)
   * })
   */
  readonly commands: Observable<DactyloCommandEvent>

  /**
   * Subscribes to the tools executed by the user/ai-agent.
   *
   * @example
   * ```ts
   * const unsub = editor.events.tools.subscribe((event) => {
   *  console.log(event.tool)
   * })
   */
  readonly tools: Observable<DactyloToolEvent>

  /**
   * Subscribes to the errors thrown from commands or tools.
   *
   * @example
   * ```ts
   * const unsub = editor.events.errors.subscribe((event) => {
   *  console.log(event.error)
   * })
   */
  readonly errors: Observable<DactyloErrorEvent>

  /**
   * Subscribes to the history stack changes.
   *
   * @example
   * ```ts
   * const unsub = editor.events.history.subscribe((event) => {
   *  console.log(event.history)
   * })
   */
  readonly history: Observable<HistoryEvent>

  /**
   * Subscribes to the mention buffer changes.
   * 👉🏻 Fires anytime the inline buffer is updated.
   *
   * @example
   * ```ts
   * const unsub = editor.events.mentionBuffer.subscribe((event) => {
   *  console.log(event.bufferedText)
   * })
   * ```
   */
  readonly mentionBuffer: Observable<MentionBufferEvent>

  /**
   * Subscribes to mentions that were created.
   *
   * @example
   * ```ts
   * const unsub = editor.events.mentionDidCreated.subscribe((event) => {
   *  console.log(event.blockId, event.nodeId, event.entity, event.metadata)
   * })
   * ```
   */
  readonly mentionDidCreated: Observable<MentionDidCreatedEvent>

  /**
   * Subscribes to the command trigger buffer changes.
   * 👉🏻 Fires anytime the inline buffer is updated.
   *
   * @example
   * ```ts
   * const unsub = editor.events.commandTriggerBuffer.subscribe((event) => {
   *  console.log(event.bufferedText)
   * })
   * ```
   */
  readonly commandTriggerBuffer: Observable<CommandTriggerBufferEvent>

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
  readonly transactionDidApply: Observable<Transaction>

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

  /** Clears the undo and redo stacks via transaction pipeline. */
  readonly clear: () => void
}

/** Api to interact with the history of the editor. */
export type DactyloHistoryApi = DactyloAspectApi<
  DactyloHistoryTools,
  DactyloHistoryCommands
>

/** Tools to query the marks of the editor. */
export interface DactyloMarksTools {
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
  readonly isActive: (mark: MarkKey) => boolean
}

/** Commands to mutate the marks of the editor. */
export interface DactyloMarksCommands {
  /**
   * Toggle a mark on or off via the pipeline.
   *
   * @example
   * ```ts
   * editor.marks.commands.toggle('bold')
   * ```
   */
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

/** Commands to mutate the {@link DocumentState} of the editor from UI events. */
export interface DactyloComposerCommands {
  /**
   * Sends an input event to the editor and returns a boolean indicating whether the event was processed or not.
   * Input events are triggered by user actions such as typing, pasting, or selecting text.
   *
   * Use it to handle `beforeinput` event to get real user intent and get:
   *  - inserted characters from typing
   *  - delete intents from cut/delete
   *  - data transfer from paste
   *
   * Using `beforeinput` event handler is meant to be used to get intent before mutating DOM and
   * for IME composition and be compliant with virtual mobile keyboards (iOS and Android)
   * by telling us "What's being inserted", not just "What's being pressed".
   *
   * Client only.
   *
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
  readonly sendInput: (event: InputEvent) => boolean

  /**
   * Send a keydown event to the editor and returns a boolean indicating whether the event was processed or not.
   * Keydown events are triggered by user actions such as undo/redo, copy, select-all, …
   *
   * Use it to handle events like `onKeyDown` to get real user intent and get:
   *  - undo/redo from history
   *  - copy intents from clipboard
   *  - select-all/deselect from keyboard
   *  - arrow navigation from keyboard
   *
   * Client only.
   *
   * @example
   * ```ts
   * const handleKeyDown = (event: KeyboardEvent) => {
   *  editor.composer.commands.sendKeydown(event)
   * }
   *
   * const editable = document.getElementById('editable')
   * editable?.addEventListener('keydown', handleKeyDown)
   * ```
   */
  readonly sendKeydown: (event: KeyboardEvent) => boolean

  /**
   * Sets the IME composing state.
   *
   * @example
   * ```ts
   * editor.composer.commands.setIMEComposing(true)
   * ```
   */
  readonly setIMEComposing: (isComposing: boolean) => void
}

/** Api to interact with the composer of the editor. */
export interface DactyloComposerApi {
  /** Commands to mutate the {@link DocumentState} of the editor from UI events. */
  readonly commands: DactyloComposerCommands
}

/** Tools to query the selection of the editor. */
export interface DactyloSelectionTools {
  /**
   * Whether the block with the given ID is with an active cursor selection within.
   * This is a pure function that does not mutate the editor context.
   *
   * @example
   * ```ts
   * const withActiveCursor = editor.selection.tools.isBlockWithActiveCursor(blockId)
   * ```
   */
  readonly isBlockWithActiveCursor: (blockId: BlockId) => boolean

  /**
   * Whether the block with the given ID is with an active range selection within.
   * This is a pure function that does not mutate the editor context.
   *
   * @example
   * ```ts
   * const withActiveRange = editor.selection.tools.isBlockWithActiveRange(blockId)
   * ```
   */
  readonly isBlockWithActiveRange: (blockId: BlockId) => boolean

  /**
   * Whether the block with the given ID is with an active selection within.
   * This is a pure function that does not mutate the editor context.
   *
   * @example
   * ```ts
   * const withActiveSelection = editor.selection.tools.isBlockWithActiveSelection(blockId)
   * ```
   */
  readonly isBlockWithActiveSelection: (blockId: BlockId) => boolean

  /**
   * Whether the selection is active or not.
   * This is a pure function that does not mutate the editor context.
   *
   * @example
   * ```ts
   * const isFocused = editor.selection.tools.isFocused()
   * ```
   */
  readonly isFocused: () => boolean

  /**
   * Whether the block with the given ID is fully (`total`) or partially
   * (`partial`) covered by an active range selection, or `null` when it is
   * not selected.
   * A collapsed cursor is not a selection.
   * This is a pure function that does not mutate the editor context.
   *
   * @example
   * ```ts
   * const coverage = editor.selection.tools.getBlockSelectionCoverageTopology(blockId)
   * ```
   */
  readonly getBlockSelectionCoverageTopology: (
    blockId: BlockId,
  ) => SelectionCoverageTopology | null

  /**
   * Whether the inline node with the given ID is fully (`total`) or partially
   * (`partial`) covered by an active range selection, or `null` when it is
   * not selected.
   * A collapsed cursor is not a selection.
   * This is a pure function that does not mutate the editor context.
   *
   * @example
   * ```ts
   * const coverage = editor.selection.tools.getInlineNodeSelectionCoverageTopology(nodeId)
   * ```
   */
  readonly getInlineNodeSelectionCoverageTopology: (
    nodeId: NodeId,
  ) => SelectionCoverageTopology | null
}

/** Commands to mutate the selection of the editor. */
// @todo: add select-all and deselect commands
export interface DactyloSelectionCommands {
  /**
   * Focus the editor by placing a collapsed cursor at the end of the document.
   *
   * @example
   * ```ts
   * editor.selection.commands.focus()
   * ```
   */
  readonly focus: (
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Blurs the editor by clearing the selection.
   *
   * @example
   * ```ts
   * editor.selection.commands.blur()
   * ```
   */
  readonly blur: (
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void
}

/** Api to interact with the selection of the editor. */
export type DactyloSelectionApi = DactyloAspectApi<
  DactyloSelectionTools,
  DactyloSelectionCommands
>

/** Tools to query the DOM of the editor. */
export interface DactyloDomTools {
  /**
   * Returns a cloned DOM `Range` for the current non-collapsed window selection
   * inside the attached editable, or `null`.
   *
   * The clone is a snapshot: later selection changes do not mutate it.
   *
   * A major use-case to call this method is for rendering floating UI elements
   * like contextual menus, floating tooltips with libraries like `@floating-ui/react`
   * in the editable element when we can use `range.getBoundingClientRect()` as a virtual element.
   *
   * Client only.
   *
   * @example
   * ```ts
   * const range = editor.dom.commands.getActiveRange()
   * range?.getBoundingClientRect()
   * ```
   */
  readonly getActiveRange: () => Range | null
}

/** Commands to sync the DOM with the editor state. */
export interface DactyloDomCommands {
  /**
   * Attaches the DOM to the editor.
   *
   * @example
   * ```ts
   * editor.dom.commands.attach(editable)
   * ```
   */
  readonly attach: (editable: HTMLDivElement) => void

  /**
   * Detaches the editable `<div />` element from the editor.
   * Client only.
   *
   * @example
   * ```ts
   * editor.dom.commands.detach()
   * ```
   */
  readonly detach: () => void

  /**
   * Paints a collapsed caret at the position of the text cursor in the DOM.
   * Client only.
   *
   * @example
   * ```ts
   * editor.dom.commands.paintCaret()
   * ```
   */
  readonly paintCaret: () => CancelCallback

  /**
   * Paints a range at anchor/focus in the DOM.
   * Client only.
   *
   * @example
   * ```ts
   * editor.dom.commands.paintRange()
   * ```
   */
  readonly paintRange: () => CancelCallback

  /**
   * Synchronizes the DOM selection with the editor state.
   * Client only.
   *
   * @example
   * ```ts
   * editor.dom.commands.syncSelection()
   * ```
   */
  readonly syncSelection: (fromSelectionChange?: boolean) => void

  /**
   * Clears the selection in the DOM.
   * Client only.
   *
   * @example
   * ```ts
   * editor.dom.commands.clearSelection()
   * ```
   */
  readonly clearSelection: () => CancelCallback
}

/** Api to interact with the editor's DOM. */
export type DactyloDomApi = DactyloAspectApi<
  DactyloDomTools,
  DactyloDomCommands
>

/** Tools to query the {@link DocumentState} blocks of the editor. */
export interface DactyloBlocksTools {
  /**
   * Gets a {@link Block} by ID.
   * This is a pure function that does not mutate the editor context. 

   * Always executes even in read-only mode.
   *
   * Returns the {@link Block} if found, or `null` if not found in document state.
   *
   * @example
   * ```ts
   * const block = editor.blocks.tools.get(blockId)
   * ```
   */
  readonly get: (blockId: BlockId) => Block | null

  /**
   * Whether the block with the given ID has no inline content.
   * This is a pure function that does not mutate the editor context.
   *
   * Always executes even in read-only mode.
   *
   * Returns a {@link BlockWithInlineContentEmptiness} indicating whether the block has no inline content,
   * or `'never'` if the block does not exist or is not allowed to have inline content.
   *
   * @example
   * ```ts
   * const isEmpty = editor.blocks.tools.isWithEmptyInlineContent(blockId)
   * ```
   */
  readonly isWithEmptyInlineContent: (
    blockId: BlockId,
  ) => BlockWithInlineContentEmptiness
}

/** Commands to mutate the {@link DocumentState} blocks of the editor. */
export interface DactyloBlocksCommands {
  /**
   * Inserts a {@link Block} into the document based on the given spec and position.
   * By defaults it inserts after the current selection.
   *
   * Returns the {@link BlockId} of the inserted block on success,
   * or `null` if no ops were applied.
   *
   * @example
   * ```ts
   * const blockId = editor.blocks.commands.insert({ spec: { type: 'paragraph' } })
   * const blockId = editor.blocks.commands.insert({ spec: { type: 'paragraph' }, pos: { type: 'after', blockId: targetId } })
   * const blockId = editor.blocks.commands.insert({ spec: { type: 'paragraph' }, pos: { type: 'start' } }, 'ai-agent')
   * ```
   */
  readonly insert: (
    opts: { spec: InsertBlockSpec; pos?: InsertOrMoveBlockPosition },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => BlockId | null

  /**
   * Deletes a {@link Block} from the document state by ID.
   * Returns a boolean indicating whether the delete command was successful.
   *
   * @example
   * ```ts
   * const deleted = editor.blocks.commands.delete(blockId)
   * const deleted = editor.blocks.commands.delete(blockId, 'ai-agent')
   * ```
   */
  readonly delete: (
    blockId: BlockId,
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => boolean

  /**
   * Duplicates a {@link Block} by ID.
   * Returns a boolean indicating whether the duplicate command was successful.
   *
   * @example
   * ```ts
   * editor.blocks.commands.duplicate(blockId)
   * editor.blocks.commands.duplicate(blockId, 'ai-agent')
   * ```
   */
  readonly duplicate: (
    blockId: BlockId,
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => boolean

  /**
   * Moves a {@link Block} by ID to a new document position.
   * Returns a boolean indicating whether the move command was successful.
   *
   * @example
   * ```ts
   * const moved = editor.blocks.commands.move(blockId, { type: 'after', blockId: targetId })
   * const moved = editor.blocks.commands.move(blockId, { type: 'start' }, 'ai-agent')
   * ```
   */
  readonly move: (
    blockId: BlockId,
    pos: InsertOrMoveBlockPosition,
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => boolean

  /**
   * Mutates a {@link Block} type into another one by ID.
   * Applies only to blocks with inline content.
   * By defaults metadata is reset to the initial metadata of the new block type.
   *
   * Returns a boolean indicating whether the mutate command was successful.
   *
   * @example
   * ```ts
   * const mutated = editor.blocks.commands.mutate(blockId, { kind: 'to_heading', level: 2 })
   * const mutated = editor.blocks.commands.mutate(blockId, { kind: 'to_quote' })
   * const mutated = editor.blocks.commands.mutate(blockId, { kind: 'to_paragraph' }, 'ai-agent')
   * ```
   */
  readonly mutate: (
    blockId: BlockId,
    spec: MutateBlockSpec,
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => boolean

  /**
   * Patches a {@link Block} in place based on the given spec.
   * Returns a boolean indicating whether the patch command was successful.
   *
   * @example
   * ```ts
   * const patched = editor.blocks.commands.patch({ spec: { type: 'paragraph', metadata: { fontColor: 'purple' } }, blockId })
   * const patched = editor.blocks.commands.patch({ spec: { type: 'heading', level: 3 }, blockId })
   * const patched = editor.blocks.commands.patch({ spec: { type: 'paragraph', content }, blockId }, 'ai-agent')
   * ```
   */
  readonly patch: (
    opts: { spec: PatchBlockSpec; blockId: BlockId },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => boolean
}

/** Api to interact with the {@link DocumentState} blocks of the editor. */
export type DactyloBlocksApi = DactyloAspectApi<
  DactyloBlocksTools,
  DactyloBlocksCommands
>

/** Tools to query mentions in the editor. */
export interface DactyloMentionsTools {
  /**
   * Whether a mention is currently being buffered.
   * Client only.
   *
   * @example
   * ```ts
   * const isBuffering = editor.mentions.tools.isBuffering()
   * ```
   */
  readonly isBuffering: () => boolean

  /**
   * Returns the text that's being typed into the current mention buffer.
   * Client only.
   *
   * @example
   * ```ts
   * const bufferedText = editor.mentions.tools.getBufferedText()
   * ```
   */
  readonly getBufferedText: () => string | null

  /**
   * Returns the current pointer related to the mention buffer.
   * Client only.
   *
   * @example
   * ```ts
   * const pointer = editor.mentions.tools.getPointer()
   * ```
   */
  readonly getPointer: () => InlineBufferPointer | null

  /**
   * Extracts a mention by it's node id from the {@link DocumentState}.
   *
   * Returns a {@link MentionWithContext} if found with the context around it.
   * Otherwise returns `null` if the mention is not found.
   *
   * 👉🏻 Use this tool if you want to get the mention's content and the context
   * around it to display in an email notification.
   *
   * Always executable: you can extract a mention no matter if the editor is editable or not.
   *
   * @example
   * ```ts
   * const mention = editor.mentions.tools.extract(nodeId)
   * const mention = editor.mentions.tools.extract(nodeId, { neighbors: 1 })
   * const mention = editor.mentions.tools.extract(nodeId, { neighbors: { prev: 1, next: 2 } })
   * ```
   */
  readonly extract: (
    nodeId: NodeId,
    query?: ExtractMentionQuery,
  ) => MentionWithContext | null
}

/** Commands to mutate {@link DocumentState} mentions of the editor. */
export interface DactyloMentionsCommands {
  /**
   * Confirms the current mention buffer by inserting a mention node into the document.
   * Returns a boolean indicating whether the confirm command was successful.
   *
   * Client only.
   *
   * @example
   * ```ts
   * editor.mentions.commands.confirm({ entityId: 'user-123', data: { name: 'John Doe' }, metadata: { bgColor: 'blue' } })
   * editor.mentions.commands.confirm({ entityId: 'file-123', data: { name: 'John Doe' }, metadata: { bgColor: 'magenta' } }, 'ai-agent')
   * ```
   */
  readonly confirm: (
    opts: {
      entity: {
        id: string
        /** Developer-provided additional JSON structured data. */
        data: MNED
      }
      metadata?: MNM
    },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => boolean

  /**
   * Dismisses the current mention buffer by cancelling the inline buffer
   * Returns a boolean indicating whether the dismiss command was successful.
   *
   * Client only.
   *
   * @example
   * ```ts
   * editor.mentions.commands.dismiss()
   * editor.mentions.commands.dismiss('ai-agent')
   * ```
   */
  readonly dismiss: (
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => boolean
}

/** Api to interact with the {@link DocumentState} mentions of the editor. */
export type DactyloMentionsApi = DactyloAspectApi<
  DactyloMentionsTools,
  DactyloMentionsCommands
>

/** Tools to query command trigger in the editor. */
export interface DactyloCommandTriggerTools {
  /**
   * Whether a command trigger is currently being buffered.
   * Client only.
   *
   * @example
   * ```ts
   * const isBuffering = editor.commandTrigger.tools.isBuffering()
   * ```
   */
  readonly isBuffering: () => boolean

  /**
   * Returns the text that's being typed into the current command trigger buffer.
   * Client only.
   *
   * @example
   * ```ts
   * const bufferedText = editor.commandTrigger.tools.getBufferedText()
   * ```
   */
  readonly getBufferedText: () => string | null

  /**
   * Returns the current pointer related to the command trigger buffer.
   * Client only.
   *
   * @example
   * ```ts
   * const pointer = editor.commandTrigger.tools.getPointer()
   * ```
   */
  readonly getPointer: () => InlineBufferPointer | null
}

/** Commands to mutate command trigger in the editor. */
export interface DactyloCommandTriggerCommands {
  /**
   * Confirms the current command trigger buffer. Does not mutate the document.
   * Returns a boolean indicating whether the confirm command was successful.
   *
   * Client only.
   *
   * @example
   * ```ts
   * editor.commandTrigger.commands.confirm()
   * editor.commandTrigger.commands.confirm('ai-agent')
   * ```
   */
  readonly confirm: (
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => boolean

  /**
   * Dismisses the current command trigger buffer by cancelling the inline buffer
   * Returns a boolean indicating whether the dismiss command was successful.
   *
   * Client only.
   *
   * @example
   * ```ts
   * editor.commandTrigger.commands.dismiss()
   * editor.commandTrigger.commands.dismiss('ai-agent')
   * ```
   */
  readonly dismiss: (
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => boolean
}

/** Api to interact with the command trigger {@link InlineBuffer} of the editor. */
export type DactyloCommandTriggerApi = DactyloAspectApi<
  DactyloCommandTriggerTools,
  DactyloCommandTriggerCommands
>

/** Base options for constructing a {@link Dactylo} instance. */
export interface DactyloBaseOptions {
  /**
   * Whether to enable debug mode.
   * Defaults to `false`
   */
  readonly debug?: boolean

  /**
   * Whether the editor is editable.
   * Defaults to `true`
   */
  readonly editable?: boolean

  /** Alias for `paragraph.placeholder` option. */
  readonly placeholder?: string

  /**
   * The locales to use for writing text.
   * Defaults to `en-US`
   */
  readonly locales?: Intl.LocalesArgument

  /** Configuration for autolink detection. */
  readonly autolink?: {
    /**
     * Whether to enable autolink detection.
     * Defaults to `true`
     */
    readonly enabled?: boolean
  }

  /** Configuration for markdown shortcuts. */
  readonly markdown?: {
    /**
     * Whether to enable markdown shortcuts.
     * Defaults to `true`
     */
    readonly enabled?: boolean
  }

  /** Configuration for command trigger. */
  readonly commandTrigger?: {
    /**
     * Whether to enable command trigger.
     * Defaults to `true`
     */
    readonly enabled?: boolean

    /**
     * The character to trigger a command.
     * Defaults to `/`
     */
    readonly character?: string
  }

  /** Configuration for the transaction pipeline */
  readonly pipeline?: {
    /** Configuration for the batch of the transaction pipeline */
    readonly batch?: {
      /** Max ops queued before auto-flush. Default 512. Use Infinity for large paste. */
      readonly maxSize?: number
    }

    /** Configuration for the history of the transaction pipeline */
    readonly history?: HistoryStackOptions
  }
}

/** Options for constructing a {@link Dactylo} instance. */
export type DactyloOptions = DactyloBaseOptions &
  /** Configuration for paragraphs. */
  WithUnless<
    'paragraph',
    {
      /**
       * Placeholder text when an empty paragraph is created or empty.
       * Defaults to placeholder option in {@link DactyloOptions} if set
       * or defaults to {@link DEFAULT_PARAGRAPH_PLACEHOLDER}.
       */
      readonly placeholder?: string
    },
    'initialMetadata',
    PBM
  > &
  /** Configuration for quotes. */
  WithUnless<
    'quote',
    {
      /**
       * Placeholder text when an empty quote is created or empty.
       * Defaults to placeholder option in {@link DactyloOptions} if set
       * or defaults to {@link DEFAULT_QUOTE_PLACEHOLDER}.
       */
      readonly placeholder?: string
    },
    'initialMetadata',
    QBM
  > &
  /** Configuration for headings. */
  WithUnless<
    'heading',
    {
      /**
       * Placeholder text when a heading is created or empty.
       * Defaults to {@link DEFAULT_HEADING_PLACEHOLDER} with level.
       */
      readonly placeholder?: string
    },
    'initialMetadata',
    HBM
  > &
  /** Configuration for bulleted lists. */
  WithUnless<
    'bulletedList',
    {
      /**
       * Placeholder text when a bulleted list item is created or empty.
       * Defaults to {@link DEFAULT_BULLET_LIST_ITEM_PLACEHOLDER}.
       */
      readonly placeholder?: string
    },
    'initialMetadata',
    BBM
  > &
  /** Configuration for numbered lists. */
  WithUnless<
    'numberedList',
    {
      /**
       * Placeholder text when a numbered list item is created or empty.
       * Defaults to {@link DEFAULT_NUMBERED_LIST_ITEM_PLACEHOLDER}.
       */
      readonly placeholder?: string
    },
    'initialMetadata',
    NBM
  > &
  /** Configuration for checkbox lists. */
  WithUnless<
    'checkboxList',
    {
      /**
       * Placeholder text when a checkbox list is created or empty.
       * Defaults to {@link DEFAULT_CHECKBOX_LIST_ITEM_PLACEHOLDER}.
       */
      readonly placeholder?: string
    },
    'initialMetadata',
    CBM
  > &
  /** Configuration for dividers. */
  // oxlint-disable-next-line typescript/ban-types typescript/no-empty-object-type
  WithUnless<'divider', {}, 'initialMetadata', DBM> &
  /** Configuration for texts. */
  // oxlint-disable-next-line typescript/ban-types typescript/no-empty-object-type
  WithUnless<'text', {}, 'initialMetadata', TNM> &
  /** Configuration for links. */
  // oxlint-disable-next-line typescript/ban-types typescript/no-empty-object-type
  WithUnless<
    'link',
    {
      /**
       * Whether to open links on click when the editor is editable.
       * Defaults to `true`
       */
      readonly openOnClick?: boolean
    },
    'initialMetadata',
    LNM
  > &
  /** Configuration for line breaks. */
  // oxlint-disable-next-line typescript/ban-types typescript/no-empty-object-type
  WithUnless<'lineBreak', {}, 'initialMetadata', LBNM> &
  /** Configuration for mentions. */
  WithUnless<
    'mentions',
    {
      /**
       * Whether to enable mentions.
       * Defaults to `true`
       */
      readonly enabled?: boolean

      /**
       * The character to trigger a mention.
       * Defaults to `@`
       */
      readonly character?: string
    },
    'initialMetadata',
    MNM
  >

/** Validates a configuration option. */
export function validateConfigOption(
  condition: boolean | (() => boolean),
  message: string,
): never | void {
  if (typeof condition === 'function' ? !condition() : !condition) {
    throw DactyloError.from({
      code: 'BAD_CONFIG_OPTION',
      hint: 'Dactylo/constructor',
      message,
    })
  }
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
 * ```md
 * ┌─────────────┐   ┌──────────────┐   ┌───────────┐   ┌────────────┐   ┌──────────-----------┐
 * │   Source    │ → │ Build Tx     │ → │ Validate  │ → │ Apply      │ → │ Commit Side Effects │
 * │ (input/AI)  │   │ (ops batch)  │   │ (schema)  │   │ (pure)     │   │ (history/events)    │
 * └─────────────┘   └──────────────┘   └───────────┘   └────────────┘   └──────────-----------┘
 *                                          ↓ fail
 *                              Reject (state unchanged) + error
 *```
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

  /** Dactylo static configuration. */
  readonly #config: DactyloStaticConfig

  /** Transaction pipeline used to apply operations to the editor context. */
  readonly #pipeline: TransactionPipeline

  /** DOM manager used to paint the editor selection to the DOM. */
  readonly #domManager: DOMManager

  /** Events emitted by Dactylo. */
  readonly #eventSources: DactyloEventSources

  constructor(
    ...args: OptionalTupleUnless<
      [options: DactyloOptions],
      PBM & QBM & HBM & BBM & NBM & CBM & DBM & TNM & LNM & LBNM & MNM
    >
  ) {
    const options = args[0] ?? {}

    validateConfigOption(() => {
      if (options.mentions?.character !== undefined) {
        return options.mentions.character.length === 1
      }

      return true
    }, 'Mention character must be a single non-empty character')

    validateConfigOption(() => {
      if (options.commandTrigger?.character !== undefined) {
        return options.commandTrigger.character.length === 1
      }

      return true
    }, 'Command trigger character must be a single non-empty character')

    validateConfigOption(() => {
      if (options.mentions?.character && options.commandTrigger?.character) {
        return options.mentions.character !== options.commandTrigger.character
      }

      return true
    }, 'Mention and command trigger characters must be different')

    this.#editable = options.editable ?? true
    this.#debug = options.debug ?? false

    const locales = options.locales ?? DEFAULT_LOCALES

    this.#config = {
      autolink: {
        enabled: options.autolink?.enabled ?? DEFAULT_AUTOLINK_ENABLED,
      },
      bulletedList: {
        initialMetadata: options.bulletedList?.initialMetadata ?? ({} as BBM),
        placeholder:
          options.bulletedList?.placeholder ??
          DEFAULT_BULLET_LIST_ITEM_PLACEHOLDER,
      },
      checkboxList: {
        initialMetadata: options.checkboxList?.initialMetadata ?? ({} as CBM),
        placeholder:
          options.checkboxList?.placeholder ??
          DEFAULT_CHECKBOX_LIST_ITEM_PLACEHOLDER,
      },
      commandTrigger: {
        character:
          options.commandTrigger?.character ??
          DEFAULT_COMMAND_TRIGGER_CHARACTER,
        enabled:
          options.commandTrigger?.enabled ?? DEFAULT_COMMAND_TRIGGER_ENABLED,
      },
      divider: {
        initialMetadata: options.divider?.initialMetadata ?? ({} as DBM),
      },
      heading: {
        initialMetadata: options.heading?.initialMetadata ?? ({} as HBM),
        placeholder:
          options.heading?.placeholder ?? DEFAULT_HEADING_PLACEHOLDER,
      },
      lineBreak: {
        initialMetadata: options.lineBreak?.initialMetadata ?? ({} as LBNM),
      },
      link: {
        initialMetadata: options.link?.initialMetadata ?? ({} as LNM),
        openOnClick:
          options.link?.openOnClick ?? DEFAULT_LINK_OPEN_ON_CLICK_ENABLED,
      },
      locales,
      markdown: {
        enabled:
          options.markdown?.enabled ?? DEFAULT_MARKDOWN_SHORTCUTS_ENABLED,
      },
      mentions: {
        character: options.mentions?.character ?? DEFAULT_MENTION_CHARACTER,
        enabled: options.mentions?.enabled ?? DEFAULT_MENTIONS_ENABLED,
        initialMetadata: options.mentions?.initialMetadata ?? ({} as MNM),
      },
      numberedList: {
        initialMetadata: options.numberedList?.initialMetadata ?? ({} as NBM),
        placeholder:
          options.numberedList?.placeholder ??
          DEFAULT_NUMBERED_LIST_ITEM_PLACEHOLDER,
      },
      paragraph: {
        initialMetadata: options.paragraph?.initialMetadata ?? ({} as PBM),
        placeholder:
          options.placeholder ??
          options.paragraph?.placeholder ??
          DEFAULT_PARAGRAPH_PLACEHOLDER,
      },
      quote: {
        initialMetadata: options.quote?.initialMetadata ?? ({} as QBM),
        placeholder: options.quote?.placeholder ?? DEFAULT_QUOTE_PLACEHOLDER,
      },
      text: {
        initialMetadata: options.text?.initialMetadata ?? ({} as TNM),
      },
    }

    this.#pipeline = new TransactionPipeline({
      autolink: {
        enabled: this.#config.autolink.enabled,
      },
      batch: options.pipeline?.batch,
      commandTrigger: {
        character: this.#config.commandTrigger.character,
        enabled: this.#config.commandTrigger.enabled,
      },
      debug: this.#debug,
      engine: {
        locales,
      },
      history: options.pipeline?.history,
      initialMetadata: {
        bulletedList: this.#config.bulletedList.initialMetadata,
        checkboxList: this.#config.checkboxList.initialMetadata,
        divider: this.#config.divider.initialMetadata,
        heading: this.#config.heading.initialMetadata,
        lineBreak: this.#config.lineBreak.initialMetadata,
        link: this.#config.link.initialMetadata,
        mentions: this.#config.mentions.initialMetadata,
        numberedList: this.#config.numberedList.initialMetadata,
        paragraph: this.#config.paragraph.initialMetadata,
        quote: this.#config.quote.initialMetadata,
        text: this.#config.text.initialMetadata,
      },
      markdown: {
        enabled: this.#config.markdown.enabled,
      },
      mentions: {
        character: this.#config.mentions.character,
        enabled: this.#config.mentions.enabled,
      },
    })

    this.#domManager = new DOMManager({
      commitSelection: (next: Selection | null) =>
        this.#pipeline.updateSelection(next, 'user'),
      debug: this.#debug,
      getIMEComposingState: () => this.#pipeline.isIMEComposing,
      getSelection: () => this.#pipeline.context.selection,
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
      /** Whether the command should be executed only on the client side. */
      clientOnly?: true

      /** Payload used to execute the command.  */
      payload?: Record<string, unknown>
    },
  ): T {
    const startedAt = Date.now()

    let $executor = executor
    if (!this.#editable) {
      warnOnceIf(
        this.#debug,
        `Command \`${command}\` cannot perform any transactions or operations as editor is not editable. To make it editable please call the method \`Dactylo.setEditable(true)\`. Fallback executor is used instead.`,
      )
      $executor = fallback
    } else if (opts?.clientOnly && !canUseDOM()) {
      warnOnceIf(
        this.#debug,
        `Command \`${command}\` cannot be executed in a non-DOM environment. Fallback executor is used instead.`,
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
    } catch (err: unknown) {
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
    opts?: {
      /** Whether the tool should be executed even if the editor is not editable. */
      alwaysExecute?: true

      /** Whether the tool should be executed only on the client side. */
      clientOnly?: true

      /** Payload used to execute the tool. */
      payload?: Record<string, unknown>
    },
  ): T {
    const startedAt = Date.now()

    let $executor = executor
    if (!this.#editable && !opts?.alwaysExecute) {
      warnOnceIf(
        this.#debug,
        `Tool \`${tool}\` cannot be executed as editor is not editable. To make it editable please call the method \`.setEditable(true)\`. Fallback executor is used instead.`,
      )
      $executor = fallback
    } else if (opts?.clientOnly && !canUseDOM()) {
      warnOnceIf(
        this.#debug,
        `Tool \`${tool}\` cannot be executed in a non-DOM environment. Fallback executor is used instead.`,
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
    } catch (err: unknown) {
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
   * console.log(config.bulletListItem.placeholder)
   * ```
   */
  get config(): DactyloStaticConfig {
    return this.#config
  }

  /** Returns the Api to interact with the events of the editor. */
  get events(): DactyloEventsApi {
    return {
      /**
       * Subscribes to the command trigger buffer changes.
       * 👉🏻 Fires anytime the inline buffer is updated.
       */
      commandTriggerBuffer: this.#pipeline.events.commandTriggerBuffer,

      /** Subscribes to the commands executed by the user/ai-agent. */
      commands: this.#eventSources.commands.observable,

      /** Subscribe to the `editable` changes. */
      editable: this.#eventSources.editable.observable,

      /** Subscribes to the errors thrown from executed commands. */
      errors: this.#eventSources.errors.observable,

      /** Subscribes to the history stack changes. */
      history: this.#pipeline.events.history,

      /**
       * Subscribes to the mention buffer changes.
       * 👉🏻 Fires anytime the inline buffer is updated.
       */
      mentionBuffer: this.#pipeline.events.mentionBuffer,

      /** Subscribes to mentions that were created. */
      mentionDidCreated: this.#pipeline.events.mentionDidCreated,

      /** Subscribes to the tools executed by the user/ai-agent.*/
      tools: this.#eventSources.tools.observable,

      /**
       * Subscribes to applied transactions.
       * 👉🏻 Useful for low-level debugging and tracing.
       */
      transactionDidApply: this.#pipeline.events.transactionDidApply,

      /**
       * Subscribes to rejected transactions.
       * 👉🏻 Useful for low-level debugging and tracing.
       */
      transactionDidReject: this.#pipeline.events.transactionDidReject,
    }
  }

  /** Returns the Api to interact with the history of the editor. */
  get history(): DactyloHistoryApi {
    return {
      commands: {
        /**
         * Clears the undo and redo stacks via transaction pipeline.
         *
         * @example
         * ```ts
         * editor.history.commands.clear()
         * ```
         */
        clear: (): void =>
          this.#safeExecuteCommand(
            'history/clear',
            () => this.#pipeline.clearHistory(),
            noop,
          ),

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
            negate,
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
            negate,
          ),
      },
    }
  }

  /** Returns the Api to interact with the marks of the editor. */
  get marks(): DactyloMarksApi {
    return {
      commands: {
        /** Toggle a mark on or off via the transaction pipeline. */
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
         * Whether a mark is active or not depending on the current current selection.
         * 👉🏻 A toolbar button for a mark that should appear pressed or not.
         *
         * This is a pure function that does not mutate the editor context.
         */
        isActive: (mark: MarkKey): boolean =>
          this.#safeExecuteTool(
            'marks/is-active',
            () => isMarkActiveInContext(this.#pipeline.context, mark),
            negate,
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
         * Input events are triggered by user actions such as typing, pasting, or selecting text.
         *
         * Use it to handle `beforeinput` event to get real user intent and get:
         *  - inserted characters from typing
         *  - delete intents from cut/delete
         *  - data transfer from paste
         *
         * Using `beforeinput` event handler is meant to be used to get intent before mutating DOM and
         * for IME composition and be compliant with virtual mobile keyboards (iOS and Android)
         * by telling us "What's being inserted", not just "What's being pressed".
         *
         * Client only.
         */
        sendInput: (event: InputEvent): boolean =>
          this.#safeExecuteCommand(
            'composer/send-input',
            () => this.#pipeline.digestInputEvent(event),
            negate,
            { clientOnly: true, payload: { event } },
          ),
        /**
         * Send a keydown event to the editor and returns a boolean indicating whether the event was processed or not.
         * Keydown events are triggered by user actions such as undo/redo, copy, select-all, …
         *
         * Use it to handle events like `onKeyDown` to get real user intent and get:
         *  - undo/redo from history
         *  - copy intents from clipboard
         *  - select-all/deselect from keyboard
         *  - arrow navigation from keyboard
         *
         * Client only.
         */
        sendKeydown: (event: KeyboardEvent): boolean =>
          this.#safeExecuteCommand(
            'composer/send-keydown',
            () => this.#pipeline.digestKeydownEvent(event),
            negate,
            { clientOnly: true, payload: { event } },
          ),

        /** Sets the IME composing state. */
        setIMEComposing: (isComposing: boolean): void =>
          this.#safeExecuteCommand(
            'composer/set-ime-composing',
            () => this.#pipeline.setIMEComposing(isComposing),
            noop,
            { payload: { isComposing } },
          ),
      },
    }
  }

  /** Returns the Api to interact with the selection of the editor. */
  get selection(): DactyloSelectionApi {
    return {
      // @todo: add select-all and deselect commands
      commands: {
        /** Blur the editor by clearing the selection. */
        blur: (
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ): void =>
          this.#safeExecuteCommand(
            'selection/blur',
            () => this.#pipeline.clearSelection(source),
            noop,
          ),

        /** Focus the editor by placing a collapsed cursor at the end of the document. */
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
         * Whether the block with the given ID is fully (`total`) or partially
         * (`partial`) covered by an active range selection, or `null` when it
         * is not selected.
         *
         * This is a pure function that does not mutate the editor context.
         */
        getBlockSelectionCoverageTopology: (
          blockId: BlockId,
        ): SelectionCoverageTopology | null =>
          this.#safeExecuteTool(
            'selection/get-block-selection-coverage',
            () =>
              getBlockSelectionCoverageTopology(
                this.#pipeline.context.selection,
                this.#pipeline.context.state,
                blockId,
              ),
            nullish,
          ),

        /**
         * Whether the inline node with the given ID is fully (`total`) or
         * partially (`partial`) covered by an active range selection, or
         * `null` when it is not selected.
         *
         * This is a pure function that does not mutate the editor context.
         */
        getInlineNodeSelectionCoverageTopology: (
          nodeId: NodeId,
        ): SelectionCoverageTopology | null =>
          this.#safeExecuteTool(
            'selection/get-node-selection-coverage',
            () =>
              getInlineNodeSelectionCoverageTopology(
                this.#pipeline.context.selection,
                this.#pipeline.context.state,
                nodeId,
              ),
            nullish,
          ),

        /**
         * Whether the block with the given ID is with an active cursor selection within.
         * This is a pure function that does not mutate the editor context.
         */
        isBlockWithActiveCursor: (blockId: BlockId): boolean =>
          this.#safeExecuteTool(
            'selection/is-block-with-active-cursor',
            () =>
              isBlockWithActiveCursor(
                this.#pipeline.context.selection,
                blockId,
              ),
            negate,
          ),

        /**
         * Whether the block with the given ID is with an active range selection within.
         * This is a pure function that does not mutate the editor context.
         */
        isBlockWithActiveRange: (blockId: BlockId): boolean =>
          this.#safeExecuteTool(
            'selection/is-block-with-active-range',
            () =>
              isBlockWithActiveRange(this.#pipeline.context.selection, blockId),
            negate,
          ),

        /**
         * Whether the block with the given ID is with an active selection within.
         * This is a pure function that does not mutate the editor context.
         */
        isBlockWithActiveSelection: (blockId: BlockId): boolean =>
          this.#safeExecuteTool(
            'selection/is-block-with-active-selection',
            () =>
              isBlockWithActiveSelection(
                this.#pipeline.context.selection,
                blockId,
              ),
            negate,
          ),

        /**
         * Whether the editor is focused or not.
         * This is a pure function that does not mutate the editor context.
         */
        isFocused: (): boolean =>
          this.#safeExecuteTool(
            'selection/is-focused',
            () => isSelectionActive(this.#pipeline.context.selection),
            negate,
          ),
      },
    }
  }

  /** Returns the Api to interact with the editor's DOM. */
  get dom(): DactyloDomApi {
    return {
      commands: {
        /**
         * Attaches the editable `<div />` element to the editor.
         * Client only.
         */
        attach: (editable: HTMLDivElement) =>
          this.#safeExecuteCommand(
            'dom/attach',
            () => this.#domManager.attach(editable),
            noop,
            { clientOnly: true, payload: { editable } },
          ),

        /**
         * Clears the selection in the DOM.
         * Client only.
         */
        clearSelection: () =>
          this.#safeExecuteCommand(
            'dom/clear-selection',
            () => this.#domManager.clearSelection(),
            () => noop,
            { clientOnly: true },
          ),

        /**
         * Detaches the editable `<div />` element from the editor.
         * Client only.
         */
        detach: () =>
          this.#safeExecuteCommand(
            'dom/detach',
            () => this.#domManager.detach(),
            noop,
            { clientOnly: true },
          ),

        /**
         * Paints a collapsed caret at the position of the text cursor in the DOM.
         * Client only.
         */
        paintCaret: () =>
          this.#safeExecuteCommand(
            'dom/paint-caret-at',
            () => this.#domManager.paintCaretAt(),
            () => noop,
            { clientOnly: true },
          ),

        /**
         * Paints a range at anchor/focus in the DOM.
         * Client only.
         */
        paintRange: () =>
          this.#safeExecuteCommand(
            'dom/paint-range-at',
            () => this.#domManager.paintRangeAt(),
            () => noop,
            { clientOnly: true },
          ),

        /**
         * Synchronizes the DOM selection with the editor state.
         * Client only.
         */
        syncSelection: (fromSelectionChange?: boolean) =>
          this.#safeExecuteCommand(
            'dom/sync-selection',
            () => this.#domManager.scheduleSync(fromSelectionChange),
            noop,
            { clientOnly: true },
          ),
      },
      tools: {
        /**
         * Returns a cloned DOM `Range` for the current non-collapsed window selection
         * inside the attached editable, or `null`.
         *
         * The clone is a snapshot: later selection changes do not mutate it.
         *
         * A major use-case to call this method is for rendering floating UI elements
         * like contextual menus, floating tooltips with libraries like `@floating-ui/react`
         * in the editable element when we can use `range.getBoundingClientRect()` as a virtual element.
         *
         * Client only.
         */
        getActiveRange: () =>
          this.#safeExecuteTool(
            'dom/get-active-range',
            () => this.#domManager.getActiveRange(),
            () => null,
            { clientOnly: true },
          ),
      },
    }
  }

  /** Returns the Api to interact with the {@link DocumentState} blocks of the editor. */
  get blocks(): DactyloBlocksApi {
    return {
      commands: {
        /**
         * Deletes a {@link Block} from the document state by ID.
         * Returns a boolean indicating whether the patch command was successful.
         */
        delete: (
          blockId: BlockId,
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/delete',
            () => this.#pipeline.deleteBlock(blockId, source),
            negate,
            { payload: { blockId, source } },
          ),

        /**
         * Duplicates a {@link Block} by ID.
         * Returns a boolean indicating whether the patch command was successful.
         */
        duplicate: (
          blockId: BlockId,
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/duplicate',
            () => this.#pipeline.duplicateBlock(blockId, source),
            negate,
            { payload: { blockId, source } },
          ),

        /**
         * Inserts a {@link Block} into the document based on the given spec and position.
         * By defaults it inserts after the current selection.
         *
         * Returns the {@link BlockId} of the inserted block on success,
         * or `null` if no ops were applied.
         */
        insert: (
          opts: { spec: InsertBlockSpec; pos?: InsertOrMoveBlockPosition },
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/insert',
            () => this.#pipeline.insertBlock(opts, source),
            nullish,
            { payload: { opts, source } },
          ),

        /**
         * Moves a {@link Block} by ID to a new document position.
         * Returns a boolean indicating whether the patch command was successful.
         */
        move: (
          blockId: BlockId,
          pos: InsertOrMoveBlockPosition,
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/move',
            () => this.#pipeline.moveBlock(blockId, pos, source),
            negate,
            { payload: { blockId, pos, source } },
          ),

        /**
         * Mutates a {@link Block} type into another one by ID.
         * Applies only to blocks with inline content.
         * By defaults metadata is reset to the initial metadata of the new block type.
         *
         * Returns a boolean indicating whether the mutate command was successful.
         */
        mutate: (
          blockId: BlockId,
          spec: MutateBlockSpec,
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/mutate',
            () => this.#pipeline.mutateBlock(blockId, spec, source),
            negate,
            { payload: { blockId, source } },
          ),

        /**
         * Patches a {@link Block} in place based on the given spec.
         * Returns a boolean indicating whether the patch command was successful.
         */
        patch: (
          opts: { spec: PatchBlockSpec; blockId: BlockId },
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/patch',
            () => this.#pipeline.patchBlock(opts, source),
            negate,
            { payload: { opts, source } },
          ),
      },
      tools: {
        /**
         * Gets a {@link Block} by ID.
         * This is a pure function that does not mutate the editor context.
         * Always executes even in read-only mode.
         *
         * Returns the {@link Block} if found, or `null` if not found in document state.
         */
        get: (blockId: BlockId) =>
          this.#safeExecuteTool(
            'blocks/get',
            () => {
              try {
                const block = getBlock(this.#pipeline.context.state, blockId)
                return block
              } catch {
                return null
              }
            },
            nullish,
            { alwaysExecute: true },
          ),

        /**
         * Whether the block with the given ID is with empty inline content.
         * This is a pure function that does not mutate the editor context.
         *
         * Always executes even in read-only mode.
         *
         * Returns a {@link BlockWithInlineContentEmptiness} indicating whether the block is with empty inline content,
         * or `'never'` if the block does not exist or is not allowed to have inline content.
         */
        isWithEmptyInlineContent: (
          blockId: BlockId,
        ): BlockWithInlineContentEmptiness =>
          this.#safeExecuteTool(
            'blocks/is-with-empty-inline-content',
            () => {
              try {
                const empty = isBlockWithInlineContentEmpty(
                  this.#pipeline.context.state,
                  blockId,
                )

                return empty ? 'empty' : 'not-empty'
              } catch {
                return 'never'
              }
            },
            () => 'never',
            { alwaysExecute: true },
          ),
      },
    }
  }

  /** Returns the Api to interact with the {@link DocumentState} mentions of the editor. */
  get mentions(): DactyloMentionsApi {
    return {
      commands: {
        /**
         * Confirms the current mention buffer by inserting a mention node into the document.
         * Returns a boolean indicating whether the confirm command was successful.
         *
         * Client only.
         */
        confirm: (
          opts: {
            entity: {
              id: string
              data: MNED
            }
            metadata?: MNM
          },
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'mentions/confirm-buffer',
            () =>
              this.#pipeline.confirmBufferedInlineMention(
                {
                  entity: {
                    data: opts.entity.data,
                    id: opts.entity.id,
                  },
                  metadata: opts.metadata,
                },
                source,
              ),
            negate,
            {
              clientOnly: true,
              payload: {
                entity: {
                  data: JSON.stringify(opts.entity.data),
                  id: opts.entity.id,
                },
                metadata: opts.metadata,
                source,
              },
            },
          ),
        /**
         * Dismisses the current mention buffer by cancelling the inline buffer
         * Returns a boolean indicating whether the dismiss command was successful.
         *
         * Client only.
         * ```
         */
        dismiss: (
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'mentions/dismiss-buffer',
            () => this.#pipeline.dismissBufferedInlineMention(source),
            negate,
            { clientOnly: true, payload: { source } },
          ),
      },
      tools: {
        /**
         * Extracts a mention by it's node id from the {@link DocumentState}.
         *
         * Returns a {@link MentionWithContext} if found with the context around it.
         * Otherwise returns `null` if the mention is not found.
         *
         * Always executable: you can extract a mention no matter if the editor is editable or not.
         *
         * 👉🏻 Use this tool if you want to get the mention's content and the context
         * around it to display in an email notification.
         */
        extract: (nodeId: NodeId, query: ExtractMentionQuery = {}) =>
          this.#safeExecuteTool(
            'mentions/extract',
            () => extractMention(this.#pipeline.context.state, nodeId, query),
            nullish,
            { alwaysExecute: true },
          ),

        /**
         * Returns the text that's being typed into the current mention buffer.
         * Client only.
         */
        getBufferedText: () =>
          this.#safeExecuteTool(
            'mentions/get-buffered-text',
            () => this.#pipeline.mentionInlineBuffer.bufferedText,
            nullish,
            { clientOnly: true },
          ),

        /**
         * Returns the current pointer related to the mention buffer.
         * Client only.
         */
        getPointer: () =>
          this.#safeExecuteTool(
            'mentions/get-pointer',
            () => this.#pipeline.mentionInlineBuffer.pointer,
            nullish,
            { clientOnly: true },
          ),

        /**
         * Whether a mention is currently being buffered.
         * Client only.
         */
        isBuffering: () =>
          this.#safeExecuteTool(
            'mentions/is-buffering',
            () => this.#pipeline.mentionInlineBuffer.isBuffering,
            negate,
            { clientOnly: true },
          ),
      },
    }
  }

  /** Returns the api to interact with the command trigger {@link InlineBuffer} of the editor. */
  get commandTrigger(): DactyloCommandTriggerApi {
    return {
      commands: {
        /**
         * Confirms the current command trigger buffer. Does not mutate the document.
         * Returns a boolean indicating whether the confirm command was successful.
         *
         * Client only.
         */
        confirm: (
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'command-trigger/confirm',
            () => this.#pipeline.confirmBufferedInlineCommandTrigger(source),
            negate,
            { clientOnly: true, payload: { source } },
          ),

        /**
         * Dismisses the current command trigger buffer by cancelling the inline buffer
         * Returns a boolean indicating whether the dismiss command was successful.
         *
         * Client only.
         *
         * @example
         * ```ts
         * editor.commandTrigger.commands.dismiss()
         * editor.commandTrigger.commands.dismiss('ai-agent')
         * ```
         */
        dismiss: (
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'command-trigger/dismiss',
            () => this.#pipeline.dismissBufferedInlineCommandTrigger(source),
            negate,
            { clientOnly: true, payload: { source } },
          ),
      },
      tools: {
        /**
         * Returns the text that's being typed into the current command trigger buffer.
         * Client only.
         */
        getBufferedText: () =>
          this.#safeExecuteTool(
            'command-trigger/get-buffered-text',
            () => this.#pipeline.commandTriggerInlineBuffer.bufferedText,
            nullish,
            { clientOnly: true },
          ),

        /**
         * Returns the current pointer related to the command trigger buffer.
         * Client only.
         */
        getPointer: () =>
          this.#safeExecuteTool(
            'command-trigger/get-pointer',
            () => this.#pipeline.commandTriggerInlineBuffer.pointer,
            nullish,
            { clientOnly: true },
          ),

        /**
         * Whether a command trigger is currently being buffered.
         * Client only.
         */
        isBuffering: () =>
          this.#safeExecuteTool(
            'command-trigger/is-buffering',
            () => this.#pipeline.commandTriggerInlineBuffer.isBuffering,
            negate,
            { clientOnly: true },
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
      /**
       * We don't call `safeExecuteCommand` because
       * we want to clear the selection in any case whether the editor
       * is editable or not.
       *
       * And we don't sync inline buffers as the buffers need to survive
       * when the editor switch to `read-only` mode.
       */
      this.#pipeline.clearSelection(source, { syncInlineBuffers: false })
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
