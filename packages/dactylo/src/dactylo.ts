import type {
  BBM,
  CBM,
  DBM,
  HBM,
  LBNM,
  LNM,
  MNM,
  NBM,
  PBM,
  QBM,
  TNM,
} from './internals/augmentation'
import type {
  BlockId,
  HeadingBlock,
  NumberedListItemBlock,
} from './internals/blocks'
import { error, warnOnceIf } from './internals/console'
import {
  DEFAULT_AUTOLINK_ENABLED,
  DEFAULT_BULLET_LIST_ITEM_PLACEHOLDER,
  DEFAULT_CHECKBOX_LIST_ITEM_PLACEHOLDER,
  DEFAULT_HEADING_PLACEHOLDER,
  DEFAULT_INLINE_COMMAND_TRIGGER_CHARACTER,
  DEFAULT_INLINE_COMMAND_TRIGGER_ENABLED,
  DEFAULT_LINK_OPEN_ON_CLICK_ENABLED,
  DEFAULT_LOCALES,
  DEFAULT_MARKDOWN_SHORTCUTS_ENABLED,
  DEFAULT_MENTION_CHARACTER,
  DEFAULT_MENTIONS_ENABLED,
  DEFAULT_NUMBERED_LIST_ITEM_PLACEHOLDER,
  DEFAULT_PARAGRAPH_PLACEHOLDER,
  DEFAULT_QUOTE_PLACEHOLDER,
} from './internals/constants'
import { isBlockWithInlineContentEmpty } from './internals/document'
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
import type { MarkKey } from './internals/marks'
import type { InlineNode } from './internals/nodes'
import type { InsertOrMoveBlockPosition } from './internals/operations-builder'
import {
  isBlockWithActiveCursor,
  isBlockWithActiveRange,
  isBlockWithActiveSelection,
  isSelectionActive,
} from './internals/selection'
import type { Selection } from './internals/selection'
import { TransactionPipeline } from './internals/transaction'
import type { Transaction, TransactionSource } from './internals/transaction'
import type {
  CancelCallback,
  OptionalTupleUnless,
  Relax,
  WithUnless,
} from './internals/types'
import { canUseDOM, negate, noop } from './internals/utils'

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

  /** Configuration for inline command trigger. */
  readonly inlineCommandTrigger: {
    /**
     * Whether to enable inline command trigger.
     * Defaults to `true`
     */
    readonly enabled: boolean

    /**
     * The character to trigger an inline command.
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
  | 'selection/is-block-with-active-cursor'
  | 'selection/is-block-with-active-range'
  | 'selection/is-block-with-active-selection'
  | 'selection/is-focused'

  /** DOM tools. */
  | 'dom/get-active-range'

  /** Blocks tools. */
  | 'blocks/is-with-empty-inline-content'

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
  | 'blocks/insert-paragraph'
  | 'blocks/insert-quote'
  | 'blocks/insert-heading'
  | 'blocks/insert-bullet-list-item'
  | 'blocks/insert-numbered-list-item'
  | 'blocks/insert-checkbox-list-item'
  | 'blocks/insert-divider'
  | 'blocks/duplicate'
  | 'blocks/delete'
  | 'blocks/move'
  | 'blocks/patch-paragraph'
  | 'blocks/patch-quote'
  | 'blocks/patch-heading'
  | 'blocks/patch-bullet-list-item'
  | 'blocks/patch-numbered-list-item'
  | 'blocks/patch-checkbox-list-item'
  | 'blocks/patch-divider'

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
   * Whether the block with the given ID is with empty inline content.
   * This is a pure function that does not mutate the editor context.
   *
   * @example
   * ```ts
   * const isEmpty = editor.blocks.tools.isWithEmptyInlineContent(blockId)
   * ```
   */
  readonly isWithEmptyInlineContent: (blockId: BlockId) => boolean
}

/** Commands to mutate the {@link DocumentState} blocks of the editor. */
export interface DactyloBlocksCommands {
  /**
   * Inserts a {@link ParagraphBlock} at the given position with metadata.
   * By defaults it inserts after the current selection.
   *
   * @example
   * ```ts
   * editor.blocks.commands.insertParagraph()
   * editor.blocks.commands.insertParagraph({ pos: 'end' })
   * editor.blocks.commands.insertParagraph({}, 'ai-agent')
   * ```
   */
  readonly insertParagraph: (
    opts?: {
      /** Where to insert the {@link ParagraphBlock}. */
      pos?: InsertOrMoveBlockPosition

      /** Metadata to associate with the {@link ParagraphBlock}. */
      metadata?: PBM
    },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Inserts a {@link QuoteBlock} at the given position with metadata.
   * By defaults it inserts after the current selection.
   *
   * @example
   * ```ts
   * editor.blocks.commands.insertQuote()
   * editor.blocks.commands.insertQuote({ pos: 'end' })
   * editor.blocks.commands.insertQuote({}, 'ai-agent')
   * ```
   */
  readonly insertQuote: (
    opts?: {
      /** Where to insert the {@link QuoteBlock}. */
      pos?: InsertOrMoveBlockPosition

      /** Metadata to associate with the {@link QuoteBlock}. */
      metadata?: QBM
    },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Inserts a {@link HeadingBlock} at the given position with metadata.
   * By defaults it inserts after the current selection.
   *
   * @example
   * ```ts
   * editor.blocks.commands.insertHeading(1)
   * editor.blocks.commands.insertHeading(2, { pos: 'end' })
   * editor.blocks.commands.insertHeading(3, {}, 'ai-agent')
   * ```
   */
  readonly insertHeading: (
    /** Level of the heading. */
    level: HeadingBlock['level'],

    opts?: {
      /** Where to insert the {@link HeadingBlock}. */
      pos?: InsertOrMoveBlockPosition

      /** Metadata to associate with the {@link HeadingBlock}. */
      metadata?: HBM
    },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Inserts a {@link BulletListItemBlock} at the given position with metadata.
   * By defaults it inserts after the current selection.
   *
   * @example
   * ```ts
   * editor.blocks.commands.insertBulletListItem()
   * editor.blocks.commands.insertBulletListItem({ pos: 'end' })
   * editor.blocks.commands.insertBulletListItem({}, 'ai-agent')
   * ```
   */
  readonly insertBulletListItem: (
    opts?: {
      /** Where to insert the {@link BulletListItemBlock}. */
      pos?: InsertOrMoveBlockPosition

      /** Metadata to associate with the {@link BulletListItemBlock}. */
      metadata?: BBM
    },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Inserts a {@link NumberedListItemBlock} at the given position with metadata.
   * By defaults it inserts after the current selection.
   *
   * @example
   * ```ts
   * editor.blocks.commands.insertNumberedListItem()
   * editor.blocks.commands.insertNumberedListItem({ pos: 'end' })
   * editor.blocks.commands.insertNumberedListItem({}, 'ai-agent')
   * ```
   */
  readonly insertNumberedListItem: (
    opts?: {
      /** Where to insert the {@link NumberedListItemBlock}. */
      pos?: InsertOrMoveBlockPosition
      /** Variant to use in order to display item marker. */
      variant?: NumberedListItemBlock['variant']
      /** Metadata to associate with the numbered list item block. */
      metadata?: NBM
    },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Inserts a {@link CheckboxListItemBlock} at the given position with metadata.
   * By defaults it inserts after the current selection.
   *
   * @example
   * ```ts
   * editor.blocks.commands.insertCheckboxListItem()
   * editor.blocks.commands.insertCheckboxListItem({ checked: true, pos: 'end' })
   * editor.blocks.commands.insertCheckboxListItem({ checked: true, pos: 'end' }, 'ai-agent')
   * ```
   */
  readonly insertCheckboxListItem: (
    opts?: {
      /** Whether the item is checked. */
      checked?: boolean

      /** Where to insert the {@link CheckboxListItemBlock}. */
      pos?: InsertOrMoveBlockPosition

      /** Metadata to associate with the {@link CheckboxListItemBlock}. */
      metadata?: CBM
    },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Inserts a {@link DividerBlock} at the given position with metadata.
   * By defaults it inserts after the current selection.
   *
   * @example
   * ```ts
   * editor.blocks.commands.insertDivider()
   * editor.blocks.commands.insertDivider({ pos: 'end' })
   * editor.blocks.commands.insertDivider({}, 'ai-agent')
   * ```
   */
  readonly insertDivider: (
    opts?: {
      /** Where to insert the {@link DividerBlock}. */
      pos?: InsertOrMoveBlockPosition

      /** Metadata to associate with the {@link DividerBlock}. */
      metadata?: DBM
    },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Deletes a {@link Block} from the document state by ID.
   *
   * @example
   * ```ts
   * editor.blocks.commands.delete(blockId)
   * editor.blocks.commands.delete(blockId, 'ai-agent')
   * ```
   */
  readonly delete: (
    blockId: BlockId,
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Duplicates a {@link Block} by ID.
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
  ) => void

  /**
   * Moves a {@link Block} by ID to a new document position.
   *
   * @example
   * ```ts
   * editor.blocks.commands.move(blockId, { type: 'after', blockId: targetId })
   * editor.blocks.commands.move(blockId, { type: 'start' }, 'ai-agent')
   * ```
   */
  readonly move: (
    blockId: BlockId,
    pos: InsertOrMoveBlockPosition,
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Patches a {@link ParagraphBlock} in place with the given options.
   *
   * @example
   * ```ts
   * editor.blocks.commands.patchParagraph(blockId, { metadata: { fontColor: 'purple' } })
   * editor.blocks.commands.patchParagraph(blockId, { content }, 'ai-agent')
   * ```
   */
  readonly patchParagraph: (
    blockId: BlockId,
    opts: { content?: InlineNode[]; metadata?: PBM },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Patches a {@link QuoteBlock} in place with the given options.
   *
   * @example
   * ```ts
   * editor.blocks.commands.patchQuote(blockId, { content }, 'ai-agent')
   * ```
   */
  readonly patchQuote: (
    blockId: BlockId,
    opts: { content?: InlineNode[]; metadata?: QBM },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Patches a {@link HeadingBlock} in place with the given options.
   *
   * @example
   * ```ts
   * editor.blocks.commands.patchHeading(blockId, { level: 3 })
   * editor.blocks.commands.patchHeading(blockId, { level: 2 }, 'ai-agent')
   * ```
   */
  readonly patchHeading: (
    blockId: BlockId,
    opts: {
      level?: HeadingBlock['level']
      content?: InlineNode[]
      metadata?: HBM
    },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Patches a {@link BulletListItemBlock} in place with the given options.
   *
   * @example
   * ```ts
   * editor.blocks.commands.patchBulletListItem(blockId, { metadata: { source: 'import' } })
   * ```
   */
  readonly patchBulletListItem: (
    blockId: BlockId,
    opts: { content?: InlineNode[]; metadata?: BBM },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Patches a {@link NumberedListItemBlock} in place with the given options.
   *
   * @example
   * ```ts
   * editor.blocks.commands.patchNumberedListItem(blockId, { variant: 'alpha' })
   * editor.blocks.commands.patchNumberedListItem(blockId, { variant: 'alpha' }, 'ai-agent')
   * ```
   */
  readonly patchNumberedListItem: (
    blockId: BlockId,
    opts: {
      variant?: NumberedListItemBlock['variant']
      content?: InlineNode[]
      metadata?: NBM
    },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Patches a {@link CheckboxListItemBlock} in place with the given options.
   *
   * @example
   * ```ts
   * editor.blocks.commands.patchCheckboxListItem(blockId, { checked: true })
   * editor.blocks.commands.patchCheckboxListItem(blockId, { checked: true }, 'ai-agent')
   * ```
   */
  readonly patchCheckboxListItem: (
    blockId: BlockId,
    opts: {
      checked?: boolean
      content?: InlineNode[]
      metadata?: CBM
    },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void

  /**
   * Patches a {@link DividerBlock} in place with the given options.
   *
   * @example
   * ```ts
   * editor.blocks.commands.patchDivider(blockId, { metadata: { source: 'import' } })
   * ```
   */
  readonly patchDivider: (
    blockId: BlockId,
    opts: { metadata?: DBM },
    source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
  ) => void
}

/** Api to interact with the {@link DocumentState} blocks of the editor. */
export type DactyloBlocksApi = DactyloAspectApi<
  DactyloBlocksTools,
  DactyloBlocksCommands
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

  /** Configuration for inline command trigger. */
  readonly inlineCommandTrigger?: {
    /**
     * Whether to enable inline command trigger.
     * Defaults to `true`
     */
    readonly enabled?: boolean

    /**
     * The character to trigger an inline command.
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
  // oxlint-disable-next-line typescript/ban-types typescript/no-empty-object-type
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
      divider: {
        initialMetadata: options.divider?.initialMetadata ?? ({} as DBM),
      },
      heading: {
        initialMetadata: options.heading?.initialMetadata ?? ({} as HBM),
        placeholder:
          options.heading?.placeholder ?? DEFAULT_HEADING_PLACEHOLDER,
      },
      inlineCommandTrigger: {
        character:
          options.inlineCommandTrigger?.character ??
          DEFAULT_INLINE_COMMAND_TRIGGER_CHARACTER,
        enabled:
          options.inlineCommandTrigger?.enabled ??
          DEFAULT_INLINE_COMMAND_TRIGGER_ENABLED,
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
      inlineCommandTrigger: {
        character: this.#config.inlineCommandTrigger.character,
        enabled: this.#config.inlineCommandTrigger.enabled,
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
      payload?: Record<string, unknown>
      clientOnly?: true
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
    opts?: { payload?: Record<string, unknown>; clientOnly?: true },
  ): T {
    const startedAt = Date.now()

    let $executor = executor
    if (!this.#editable) {
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
        /** Deletes a {@link Block} from the document state by ID. */
        delete: (
          blockId: BlockId,
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/delete',
            () => this.#pipeline.deleteBlock(blockId, source),
            noop,
            { payload: { blockId, source } },
          ),

        /** Duplicates a {@link Block} by ID. */
        duplicate: (
          blockId: BlockId,
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/duplicate',
            () => this.#pipeline.duplicateBlock(blockId, source),
            noop,
            { payload: { blockId, source } },
          ),

        /**
         * Inserts a {@link BulletListItemBlock} at the given position with metadata.
         * By defaults it inserts after the current selection.
         */
        insertBulletListItem: (
          opts: {
            pos?: InsertOrMoveBlockPosition
            metadata?: BBM
          } = {},
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/insert-bullet-list-item',
            () =>
              this.#pipeline.insertBulletListItemBlock(
                {
                  ...opts,
                  metadata:
                    opts.metadata ?? this.#config.bulletedList.initialMetadata,
                },
                source,
              ),
            noop,
            { payload: { source } },
          ),

        /**
         * Inserts a {@link CheckboxListItemBlock} at the given position with metadata.
         * By defaults it inserts after the current selection.
         */
        insertCheckboxListItem: (
          opts: {
            /** Whether the item is checked. */
            checked?: boolean
            pos?: InsertOrMoveBlockPosition
            metadata?: CBM
          } = {},
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/insert-checkbox-list-item',
            () =>
              this.#pipeline.insertCheckboxListItemBlock(
                {
                  ...opts,
                  metadata:
                    opts.metadata ?? this.#config.checkboxList.initialMetadata,
                },
                source,
              ),
            noop,
            { payload: { source } },
          ),

        /**
         * Inserts a {@link DividerBlock} at the given position with metadata.
         * By defaults it inserts after the current selection.
         */
        insertDivider: (
          opts: {
            pos?: InsertOrMoveBlockPosition
            metadata?: DBM
          } = {},
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/insert-divider',
            () =>
              this.#pipeline.insertDividerBlock(
                {
                  ...opts,
                  metadata:
                    opts.metadata ?? this.#config.divider.initialMetadata,
                },
                source,
              ),
            noop,
            { payload: { source } },
          ),

        /**
         * Inserts a {@link HeadingBlock} at the given position with metadata.
         * By defaults it inserts after the current selection.
         */
        insertHeading: (
          /** Level of the heading. */
          level: HeadingBlock['level'],

          opts: {
            pos?: InsertOrMoveBlockPosition
            metadata?: HBM
          } = {},
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/insert-heading',
            () =>
              this.#pipeline.insertHeadingBlock(
                level,
                {
                  ...opts,
                  metadata:
                    opts.metadata ?? this.#config.heading.initialMetadata,
                },
                source,
              ),
            noop,
            { payload: { source } },
          ),

        /**
         * Inserts a {@link NumberedListItemBlock} at the given position with metadata.
         * By defaults it inserts after the current selection.
         */
        insertNumberedListItem: (
          opts: {
            pos?: InsertOrMoveBlockPosition
            variant?: NumberedListItemBlock['variant']
            metadata?: NBM
          } = {},
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/insert-numbered-list-item',
            () =>
              this.#pipeline.insertNumberedListItemBlock(
                {
                  ...opts,
                  metadata:
                    opts.metadata ?? this.#config.numberedList.initialMetadata,
                },
                source,
              ),
            noop,
            { payload: { source } },
          ),

        /**
         * Inserts a {@link ParagraphBlock} at the given position with metadata.
         * By defaults it inserts after the current selection.
         */
        insertParagraph: (
          opts: {
            pos?: InsertOrMoveBlockPosition
            metadata?: PBM
          } = {},
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/insert-paragraph',
            () =>
              this.#pipeline.insertParagraphBlock(
                {
                  ...opts,
                  metadata:
                    opts.metadata ?? this.#config.paragraph.initialMetadata,
                },
                source,
              ),
            noop,
            { payload: { source } },
          ),

        /**
         * Inserts a {@link QuoteBlock} at the given position with metadata.
         * By defaults it inserts after the current selection.
         */
        insertQuote: (
          opts: {
            pos?: InsertOrMoveBlockPosition
            metadata?: QBM
          } = {},
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/insert-quote',
            () =>
              this.#pipeline.insertQuoteBlock(
                {
                  ...opts,
                  metadata: opts.metadata ?? this.#config.quote.initialMetadata,
                },
                source,
              ),
            noop,
            { payload: { source } },
          ),

        /** Moves a {@link Block} by ID to a new document position.  */
        move: (
          blockId: BlockId,
          pos: InsertOrMoveBlockPosition,
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/move',
            () => this.#pipeline.moveBlock(blockId, pos, source),
            noop,
            { payload: { blockId, pos, source } },
          ),

        /** Patches a {@link BulletListItemBlock} in place with the given options. */
        patchBulletListItem: (
          blockId: BlockId,
          opts: {
            content?: InlineNode[]
            metadata?: BBM
          },
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/patch-bullet-list-item',
            () =>
              this.#pipeline.patchBulletListItemBlock(blockId, opts, source),
            noop,
            { payload: { blockId, source } },
          ),

        /** Patches a {@link CheckboxListItemBlock} in place with the given options. */
        patchCheckboxListItem: (
          blockId: BlockId,
          opts: {
            checked?: boolean
            content?: InlineNode[]
            metadata?: CBM
          },
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/patch-checkbox-list-item',
            () =>
              this.#pipeline.patchCheckboxListItemBlock(blockId, opts, source),
            noop,
            { payload: { blockId, source } },
          ),

        /** Patches a {@link DividerBlock} in place with the given options. */
        patchDivider: (
          blockId: BlockId,
          opts: { metadata?: DBM },
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/patch-divider',
            () => this.#pipeline.patchDividerBlock(blockId, opts, source),
            noop,
            { payload: { blockId, source } },
          ),

        /** Patches a {@link HeadingBlock} in place with the given options. */
        patchHeading: (
          blockId: BlockId,
          opts: {
            level?: HeadingBlock['level']
            content?: InlineNode[]
            metadata?: HBM
          },
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/patch-heading',
            () => this.#pipeline.patchHeadingBlock(blockId, opts, source),
            noop,
            { payload: { blockId, source } },
          ),

        /** Patches a {@link NumberedListItemBlock} in place with the given options. */
        patchNumberedListItem: (
          blockId: BlockId,
          opts: {
            variant?: NumberedListItemBlock['variant']
            content?: InlineNode[]
            metadata?: NBM
          },
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/patch-numbered-list-item',
            () =>
              this.#pipeline.patchNumberedListItemBlock(blockId, opts, source),
            noop,
            { payload: { blockId, source } },
          ),

        /** Patches a {@link ParagraphBlock} in place with the given options. */
        patchParagraph: (
          blockId: BlockId,
          opts: {
            content?: InlineNode[]
            metadata?: PBM
          },
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/patch-paragraph',
            () => this.#pipeline.patchParagraphBlock(blockId, opts, source),
            noop,
            { payload: { blockId, source } },
          ),

        /** Patches a {@link QuoteBlock} in place with the given options. */
        patchQuote: (
          blockId: BlockId,
          opts: {
            content?: InlineNode[]
            metadata?: QBM
          },
          source: Extract<TransactionSource, 'user' | 'ai-agent'> = 'user',
        ) =>
          this.#safeExecuteCommand(
            'blocks/patch-quote',
            () => this.#pipeline.patchQuoteBlock(blockId, opts, source),
            noop,
            { payload: { blockId, source } },
          ),
      },
      tools: {
        /**
         * Whether the block with the given ID is with empty inline content.
         * This is a pure function that does not mutate the editor context.
         */
        isWithEmptyInlineContent: (blockId: BlockId): boolean =>
          this.#safeExecuteTool(
            'blocks/is-with-empty-inline-content',
            () =>
              isBlockWithInlineContentEmpty(
                this.#pipeline.context.state,
                blockId,
              ),
            negate,
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
       */
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
