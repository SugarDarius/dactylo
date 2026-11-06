import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from 'react'

import type {
  Dactylo,
  DactyloCommandEvent,
  DactyloEditableEvent,
  DactyloStaticConfig,
  DactyloToolEvent,
} from '../dactylo'
import type { Block, BlockId, HeadingBlock } from '../internals/blocks'
import {
  EDITABLE_NODE_BOLD_MARK_DATA_NAME,
  EDITABLE_NODE_ITALIC_MARK_DATA_NAME,
  EDITABLE_NODE_STRIKETHROUGH_MARK_DATA_NAME,
  EDITABLE_NODE_UNDERLINE_MARK_DATA_NAME,
  EDITABLE_NODE_CODE_MARK_DATA_NAME,
  EDITABLE_NODE_EMPTY_DATA_NAME,
} from '../internals/constants'
import type { DocumentState } from '../internals/document'
import { paintTextForDOM } from '../internals/dom'
import type { EditorContext } from '../internals/editor-context'
import { isMarkEnabled } from '../internals/marks'
import type { MarkKey } from '../internals/marks'
import type { InlineNodeWithEditableText } from '../internals/nodes'
import type { InsertOrMoveBlockPosition } from '../internals/operations-builder'
import { isCursorSelection, isRangeSelection } from '../internals/selection'
import type {
  CursorSelection,
  RangeSelection,
  Selection,
} from '../internals/selection'
import type { TransactionSource } from '../internals/transaction'
import type { Metadata } from '../internals/types'
import { noop, shallow } from '../internals/utils'
import { COMPOSER_ROOT_NAME } from './internals/constants'
import { createSafeContext } from './internals/context'
import { findLinkAnchorFromEventTarget, openLink } from './internals/dom'
import {
  useIsomorphicLayoutEffect,
  useStableCallback,
  useStableValue,
  useSyncExternalStoreWithSelector,
} from './internals/hooks'

// --- Composer Context ─────────────────────────────────────────----

/** Main Dactylo context. */
export interface ComposerContext {
  /** The {@link Dactylo} editor instance. */
  editor: Dactylo
}

export const { Provider: ComposerProvider, useContext: useComposer } =
  createSafeContext<ComposerContext>({
    errorMsg: `\`<${COMPOSER_ROOT_NAME} />\` is missing. Did you forget to wrap your component within it?`,
  })

// --- Editor Store ───────────────────────────────────--------------

/**
 * Subscribe to {@link EditorContext} and re-render only when
 * the selector changes (referentially or per `isEqual`).
 *
 * @example
 * ```tsx
 * const { state } = useEditorContextStore(({ state }) => state)
 * console.log(state)
 * ```
 *
 * @private
 */
export function useEditorContextStore<S>(
  selector: (context: EditorContext) => S,
  isEqual?: (a: S, b: S) => boolean,
): S {
  const selectorRef = useRef(selector)
  const { editor } = useComposer()

  useIsomorphicLayoutEffect(() => {
    selectorRef.current = selector
  })

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() => editor.getContext())

  const stableSelector = useStableCallback((context: EditorContext) =>
    selectorRef.current(context),
  )

  return useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getSnapshot,
    stableSelector,
    isEqual,
  )
}

// --- Editor ─────────────────────────────────────────--------------

/**
 * Returns the editor {@link DactyloStaticConfig}.
 *
 * @example
 * ```tsx
 * const config = useEditorConfig()
 * console.log(config)
 * ```
 */
export function useEditorConfig(): DactyloStaticConfig {
  const { editor } = useComposer()
  const config = useStableValue(editor.config)

  return config
}

/**
 * Returns whether the editor is editable.
 *
 * @example
 * ```tsx
 * const canEdit = useCanEdit()
 * ```
 */
export function useCanEdit(): boolean {
  const { editor } = useComposer()

  const subscribe = useStableCallback(
    editor.events.editable.subscribe.bind(editor),
  )
  const getSnapshot = useStableCallback(() => editor.canEdit())

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Returns a function to set the editor to editable or not.
 *
 * @example
 * ```tsx
 * const setEditable = useSetEditable()
 * setEditable(true)
 * setEditable(false, 'ai-agent')
 * ```
 */
export function useSetEditable() {
  const { editor } = useComposer()
  return useStableCallback(
    (
      next: boolean,
      source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
    ): void => {
      editor.setEditable(next, source)
    },
  )
}

/**
 * Get informed when the editor is editable or not.
 * When not editable, the editor is in read-only mode.
 *
 * @example
 * ```tsx
 * useEditableListener(({ editable }) => {
 *   console.log(editable)
 * })
 * ```
 */
export function useEditableListener(
  listener: (event: DactyloEditableEvent) => void,
): void {
  const { editor } = useComposer()

  const stableListener = useStableCallback((event: DactyloEditableEvent) => {
    listener(event)
  })

  useEffect(
    () => editor.events.editable.subscribe(stableListener),
    [editor, stableListener],
  )
}

// --- Document State ─────────────────────────────────────────------

/**
 * Returns the {@link DocumentState} from the {@link EditorContext}.
 *
 * @example
 * ```tsx
 * const state = useDocumentState()
 * console.log(state)
 * ```
 */
export function useDocumentState(): DocumentState {
  return useEditorContextStore(({ state }) => state)
}

/**
 * Returns the block order by id from the {@link EditorContext}.
 *
 * @example
 * ```tsx
 * const blockOrderById = useBlockOrderById()
 * console.log(blockOrderById)
 * ```
 */
export function useBlockOrderById(): readonly BlockId[] {
  return useEditorContextStore(({ state }) => state.blockOrderById, shallow)
}

/**
 * Returns the block from the {@link EditorContext}.
 *
 * @example
 * ```tsx
 * const block = useBlock(blockId)
 * console.log(block)
 * ```
 */
export function useBlock(blockId: BlockId): Block | null {
  return useEditorContextStore(
    ({ state }) => state.blocks.get(blockId) ?? null,
    shallow,
  )
}

// --- Selection ─────────────────────────────────────────-----------

/**
 * Returns the {@link Selection} or `null`from the {@link EditorContext}.
 *
 * @example
 * ```tsx
 * const selection = useSelection()
 * console.log(selection)
 * ```
 */
export function useSelection(): Selection | null {
  return useEditorContextStore(({ selection }) => selection, shallow)
}

/**
 * Returns the {@link CursorSelection} or `null` from the {@link EditorContext}.
 *
 * @example
 * ```tsx
 * const cursorSelection = useCursorSelection()
 * console.log(cursorSelection)
 * ```
 */
export function useCursorSelection(): CursorSelection | null {
  return useEditorContextStore(({ selection }) => {
    if (!isCursorSelection(selection)) {
      return null
    }

    return selection
  }, shallow)
}

/**
 * REturns the {@link RangeSelection} or `null` from the {@link EditorContext}.
 *
 * @example
 * ```tsx
 * const rangeSelection = useRangeSelection()
 * console.log(rangeSelection)
 * ```
 */
export function useRangeSelection(): RangeSelection | null {
  return useEditorContextStore(({ selection }) => {
    if (!isRangeSelection(selection)) {
      return null
    }

    return selection
  }, shallow)
}

/**
 * Returns selection queries and focus commands.
 *
 * @example
 * ```tsx
 * const { withCursorIn, withRangeIn, isSelectedBlock, focus, blur } = useFocus()
 *
 * console.log(withCursorIn(blockId), withRangeIn(blockId), isSelectedBlock(blockId))
 *
 * focus()
 * blur()
 * ```
 */
export function useFocus() {
  const { editor } = useComposer()

  const withCursorIn = useStableCallback((blockId: BlockId) =>
    editor.selection.tools.isBlockWithActiveCursor(blockId),
  )

  const withRangeIn = useStableCallback((blockId: BlockId) =>
    editor.selection.tools.isBlockWithActiveRange(blockId),
  )

  const isSelectedBlock = useStableCallback((blockId: BlockId) =>
    editor.selection.tools.isBlockWithActiveSelection(blockId),
  )

  const focus = useStableCallback(
    (source?: Extract<TransactionSource, 'user' | 'ai-agent'>) =>
      editor.selection.commands.focus(source),
  )

  const blur = useStableCallback(
    (source?: Extract<TransactionSource, 'user' | 'ai-agent'>) =>
      editor.selection.commands.blur(source),
  )

  return {
    blur,
    focus,
    isSelectedBlock,
    withCursorIn,
    withRangeIn,
  } as const
}

/**
 * Returns whether the editor is focused.
 *
 * @example
 * ```tsx
 * const isFocused = useIsFocused()
 * console.log(isFocused)
 * ```
 */
export function useIsFocused(): boolean {
  const { editor } = useComposer()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() =>
    editor.selection.tools.isFocused(),
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Returns whether the block has an active selection.
 *
 * @example
 * ```tsx
 * const selected = useIsSelectedBlock(blockId)
 * console.log(selected)
 * ```
 */
export function useIsSelectedBlock(blockId: BlockId): boolean {
  const { editor } = useComposer()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() =>
    editor.selection.tools.isBlockWithActiveSelection(blockId),
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// --- Marks ─────────────────────────────────────────---------------

/**
 * Returns mark queries and commands.
 *
 * @example
 * ```tsx
 * const { isActive, toggle } = useMarks()
 * console.log(isActive('bold'))
 * toggle('bold')
 * toggle('bold', 'ai-agent')
 * ```
 */
export function useMarks() {
  const { editor } = useComposer()

  const isActive = useStableCallback((mark: MarkKey) =>
    editor.marks.tools.isActive(mark),
  )

  const toggle = useStableCallback(
    (mark: MarkKey, source?: Extract<TransactionSource, 'user' | 'ai-agent'>) =>
      editor.marks.commands.toggle(mark, source),
  )

  return { isActive, toggle } as const
}

/**
 * Returns whether the mark is active.
 *
 * @example
 * ```tsx
 * const isActive = useIsMarkActive('bold')
 * console.log(isActive)
 * ```
 */
export function useIsMarkActive(mark: MarkKey): boolean {
  const { editor } = useComposer()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() => editor.marks.tools.isActive(mark))

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// --- Composer ------─────────────────────────────────────────------

/**
 * Returns composer input commands.
 *
 * @example
 * ```tsx
 * const { sendInput, sendKeydown } = useComposerInput()
 * sendInput(event)
 * sendKeydown(event)
 * ```
 */
export function useComposerInput() {
  const { editor } = useComposer()

  const sendInput = useStableCallback((event: InputEvent) =>
    editor.composer.commands.sendInput(event),
  )

  const sendKeydown = useStableCallback((event: KeyboardEvent) =>
    editor.composer.commands.sendKeydown(event),
  )

  return { sendInput, sendKeydown } as const
}

// --- Blocks ------─────────────────────────────────────────--------

/**
 * Returns block queries and commands.
 *
 * @example
 * ```tsx
 * const {
 *   isEmpty,
 *   move,
 *   delete,
 *   duplicate,
 *   insertParagraph,
 *   insertHeading,
 *   insertBulletListItem,
 *   insertCheckboxListItem,
 *   insertDivider,
 * } = useBlocks()
 *
 * console.log(isEmpty(blockId))
 *
 * delete(blockId)
 * delete(blockId, 'ai-agent')
 *
 * insertParagraph({ pos: { type: 'end'}, metadata: { fontColor: 'purple' } })
 *
 * insertHeading(1)
 * insertHeading(2, { pos: { type: 'end' } })
 * insertHeading(3, {}, 'ai-agent')
 *
 * insertBulletListItem()
 * insertBulletListItem({ pos: { type: 'end' } })
 * insertBulletListItem({}, 'ai-agent')
 *
 * insertCheckboxListItem()
 * insertCheckboxListItem({ checked: true, pos: { type: 'end' } })
 * insertCheckboxListItem({}, 'ai-agent')
 *
 * insertDivider()
 * insertDivider({ pos: { type: 'end' } })
 * insertDivider({}, 'ai-agent')
 *
 * duplicate(blockId)
 * duplicate(blockId, 'ai-agent')
 *
 * move(blockId, { type: 'after', blockId: targetId })
 * move(blockId, { type: 'start' }, 'ai-agent')
 * ```
 */
export function useBlocks() {
  const { editor } = useComposer()

  const isEmpty = useStableCallback((blockId: BlockId) =>
    editor.blocks.tools.isWithEmptyInlineContent(blockId),
  )

  const insertParagraph = useStableCallback(
    (
      opts?: { pos?: InsertOrMoveBlockPosition; metadata?: Metadata },
      source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
    ) => editor.blocks.commands.insertParagraph(opts, source),
  )

  const insertHeading = useStableCallback(
    (
      level: HeadingBlock['level'],
      opts?: { pos?: InsertOrMoveBlockPosition; metadata?: Metadata },
      source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
    ) => editor.blocks.commands.insertHeading(level, opts, source),
  )

  const insertCheckboxListItem = useStableCallback(
    (
      opts?: {
        checked?: boolean
        pos?: InsertOrMoveBlockPosition
        metadata?: Metadata
      },
      source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
    ) => editor.blocks.commands.insertCheckboxListItem(opts, source),
  )

  const insertBulletListItem = useStableCallback(
    (
      opts?: { pos?: InsertOrMoveBlockPosition; metadata?: Metadata },
      source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
    ) => editor.blocks.commands.insertBulletListItem(opts, source),
  )

  const insertDivider = useStableCallback(
    (
      opts?: { pos?: InsertOrMoveBlockPosition; metadata?: Metadata },
      source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
    ) => editor.blocks.commands.insertDivider(opts, source),
  )

  const duplicate = useStableCallback(
    (
      blockId: BlockId,
      source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
    ) => editor.blocks.commands.duplicate(blockId, source),
  )

  const $delete = useStableCallback(
    (
      blockId: BlockId,
      source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
    ) => editor.blocks.commands.delete(blockId, source),
  )

  const move = useStableCallback(
    (
      blockId: BlockId,
      pos: InsertOrMoveBlockPosition,
      source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
    ) => editor.blocks.commands.move(blockId, pos, source),
  )

  return {
    delete: $delete,
    duplicate,
    insertBulletListItem,
    insertCheckboxListItem,
    insertDivider,
    insertHeading,
    insertParagraph,
    isEmpty,
    move,
  } as const
}

/**
 * Returns whether the block is empty.
 *
 * @example
 * ```tsx
 * const isEmpty = useIsBlockEmpty(blockId)
 * console.log(isEmpty)
 * ```
 */
export function useIsBlockEmpty(blockId: BlockId): boolean {
  const { editor } = useComposer()
  const block = useBlock(blockId)

  /**
   * Block-scoped UI may still re-render once after
   * undo/delete before React unmounts the block.
   * To avoid state rendering treat missing blocks as empty instead of throwing
   */
  return block !== null && editor.blocks.tools.isWithEmptyInlineContent(blockId)
}

// --- History ------─────────────────────────────────────────-------

/**
 * Returns history queries and commands.
 *
 * @example
 * ```tsx
 * const { canUndo, canRedo, undo, redo, clear } = useHistory()
 * ```
 */
export function useHistory() {
  const { editor } = useComposer()

  const undo = useStableCallback(() => editor.history.commands.undo())
  const redo = useStableCallback(() => editor.history.commands.redo())
  const clear = useStableCallback(() => editor.history.commands.clear())

  const subscribe = useStableCallback(
    editor.events.history.subscribe.bind(editor),
  )

  const getSnapshotCanUndo = useStableCallback(() =>
    editor.history.tools.canUndo(),
  )
  const getSnapshotCanRedo = useStableCallback(() =>
    editor.history.tools.canRedo(),
  )

  const canUndo = useSyncExternalStore(
    subscribe,
    getSnapshotCanUndo,
    getSnapshotCanUndo,
  )
  const canRedo = useSyncExternalStore(
    subscribe,
    getSnapshotCanRedo,
    getSnapshotCanRedo,
  )

  return { canRedo, canUndo, clear, redo, undo } as const
}

// --- Editable ------─────────────────────────────────────────------

/**
 * Binds `<Composer.Editable />` to {@link Dactylo} selection and events.
 *  - DOM → model: `pointerup` on the editable element + `selectionchange` events.
 *  - Model → DOM: paint caret/range from layout effect (microtask, cancelable).
 * Mount once on `<Composer.Editable />`, do not mount per block.
 *
 * @private
 */
export function useEditable() {
  const editableRef = useRef<HTMLDivElement>(null)

  const { editor } = useComposer()

  const canEdit = useCanEdit()
  const focused = useIsFocused()

  const cursorSelection = useCursorSelection()
  const rangeSelection = useRangeSelection()

  const { focus } = useFocus()
  const { sendInput, sendKeydown } = useComposerInput()

  /**
   * `beforeinput` event handler used to capture the following input types:
   *  - `insertLineBreak` (`shift+Enter` → soft break)
   *  - `insertParagraph` (`Enter` → hard break)
   *  - `deleteContentBackward` (`Backspace` → delete char for cursor selection or  range of chars for range selection)
   *  - `insertText` (`Typing` → insert text)
   *
   * `input` event fires too late for how {@link Dactylo} works.
   * The `sendInput` command treats the `InputEvent` as a user-intent and then calls
   * `event.preventDefault()` for the cases it owns.
   *
   * That only works because `beforeinput` event runs before the browser mutates the `contentEditable` DOM.
   * The model {@link DocumentState} stays the source of truth, and the caret is written back afterwards.
   *
   * `input` event runs after the DOM mutation. So we cannot cancel it properly. The browser would have already
   * inserted the character, or a line break, and we would be reconciling DIRTY DOM instead of applying the intent
   * to the document.
   *
   * `beforeinput` event is also used for IME and mobile keyboard edits reporting to "what is being inserted?"
   * before the DOM changes.
   */
  const onBeforeInput = useStableCallback((event: InputEvent) => {
    sendInput(event)
  })

  const onKeydown = useStableCallback((event: KeyboardEvent) => {
    sendKeydown(event)
  })

  const onFocus = useStableCallback(() => {
    focus()
  })

  const onPointerUp = useStableCallback((event: PointerEvent) => {
    if (event.defaultPrevented) {
      return
    }

    editor.dom.commands.syncSelection()
  })

  const onSelectionChange = useStableCallback(() => {
    editor.dom.commands.syncSelection(true)
  })

  const onCompositionStart = useStableCallback(() => {
    editor.composer.commands.setIMEComposing(true)
  })

  const onCompositionEnd = useStableCallback(() => {
    editor.composer.commands.setIMEComposing(false)
    editor.dom.commands.syncSelection()
  })

  const onLinkClick = useStableCallback((event: MouseEvent) => {
    if (event.defaultPrevented) {
      return
    }

    const anchor = findLinkAnchorFromEventTarget(event.target)
    if (!anchor) {
      return
    }

    event.preventDefault()
    openLink(anchor)
  })

  /**
   * Attach the orchestrator to the editable element when it is mounted.
   * And adds the event listeners to the editable element.
   */
  useEffect(() => {
    const editable = editableRef.current
    if (!editable || !canEdit) {
      return
    }

    editor.dom.commands.attach(editable)

    /** Listen to global pointerup and selectionchange events. */
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('selectionchange', onSelectionChange)

    /**
     * Attach a native DOM event handler for `beforeinput` as React build-in `onBeforeInput`
     * is returning a `TextEvent` as native event instead of an `InputEvent`.
     * We want real Level 2 DOM events.
     */
    editable.addEventListener('beforeinput', onBeforeInput)

    /** Listen to global keydown events. */
    editable.addEventListener('keydown', onKeydown)

    /** Listen to `focus` event on the editable element. */
    editable.addEventListener('focus', onFocus)

    /** Listen to `compositionstart` and `compositionend` events on the editable element. */
    editable.addEventListener('compositionstart', onCompositionStart)
    editable.addEventListener('compositionend', onCompositionEnd)

    /** Listen to link clicks on the editable element. */
    editable.addEventListener('click', onLinkClick)

    return () => {
      editor.dom.commands.detach()

      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('selectionchange', onSelectionChange)

      editable.removeEventListener('beforeinput', onBeforeInput)

      editable.removeEventListener('keydown', onKeydown)

      editable.removeEventListener('focus', onFocus)

      editable.removeEventListener('compositionstart', onCompositionStart)
      editable.removeEventListener('compositionend', onCompositionEnd)

      editable.removeEventListener('click', onLinkClick)
    }
  }, [
    canEdit,
    editor,
    onBeforeInput,
    onKeydown,
    onFocus,
    onPointerUp,
    onSelectionChange,
    onCompositionStart,
    onCompositionEnd,
    onLinkClick,
  ])

  /**
   * Paints the native selection from editor context:
   * collapsed caret or range (e.g. shift + arrow keys).
   * The write is queued on a microtask (after this layout effect, before the
   * browser paints).
   * Cleanup cancels it so a stale caret/range is not painted
   * after the selection changes or the editable unmounts.
   */
  useIsomorphicLayoutEffect(() => {
    if (!canEdit) {
      return
    }

    if (!cursorSelection && !rangeSelection) {
      return editor.dom.commands.clearSelection()
    }

    if (cursorSelection !== null) {
      return editor.dom.commands.paintCaret()
    }

    if (rangeSelection !== null) {
      return editor.dom.commands.paintRange()
    }

    return noop
  }, [canEdit, cursorSelection, rangeSelection, editor])

  return { canEdit, editableRef, focused } as const
}

/**
 * Wires a block's `contentEditable` surface to {@link Dactylo}.
 * Works only for blocks with inline content.
 *
 * @private
 */
export function useEditableBlock(blockId: BlockId) {
  const editableId = useId()

  const canEdit = useCanEdit()

  const withActiveSelection = useIsSelectedBlock(blockId)
  const isEmpty = useIsBlockEmpty(blockId)

  return {
    canEdit,
    editableId,
    isEmpty,
    withActiveSelection,
  } as const
}

/**
 * Wires an inline node's with editable text surface to {@link Dactylo}.
 * Works only for inline nodes  {@link TextNode}, and {@link LinkNode}.
 *
 * @private
 */
export function useEditableNode(node: InlineNodeWithEditableText) {
  const renderedText = useMemo(() => paintTextForDOM(node.text), [node.text])
  const nodeAttributes = useMemo(
    () => ({
      [EDITABLE_NODE_BOLD_MARK_DATA_NAME]: isMarkEnabled(node.marks, 'bold'),
      [EDITABLE_NODE_CODE_MARK_DATA_NAME]: isMarkEnabled(node.marks, 'code'),
      [EDITABLE_NODE_EMPTY_DATA_NAME]: node.text.length <= 0,
      [EDITABLE_NODE_ITALIC_MARK_DATA_NAME]: isMarkEnabled(
        node.marks,
        'italic',
      ),
      [EDITABLE_NODE_STRIKETHROUGH_MARK_DATA_NAME]: isMarkEnabled(
        node.marks,
        'strikethrough',
      ),
      [EDITABLE_NODE_UNDERLINE_MARK_DATA_NAME]: isMarkEnabled(
        node.marks,
        'underline',
      ),
    }),
    [node.marks, node.text.length],
  )

  return {
    nodeAttributes,
    renderedText,
  } as const
}

// --- Listeners ------─────────────────────────────────────────-----

/**
 * Get informed when a tool is executed successfully or not.
 *
 * @example
 * ```tsx
 * useToolsListener(({ tool, status }) => {
 *   console.log(tool, status)
 * })
 * ```
 */
export function useToolsListener(
  listener: (event: DactyloToolEvent) => void,
): void {
  const { editor } = useComposer()
  const stableListener = useStableCallback(listener)

  useEffect(
    () => editor.events.tools.subscribe(stableListener),
    [editor, stableListener],
  )
}

/**
 * Get informed when a command is executed successfully or not.
 *
 * @example
 * ```tsx
 * useCommandsListener(({ command, status }) => {
 *   console.log(command, status)
 * })
 * ```
 */
export function useCommandsListener(
  listener: (event: DactyloCommandEvent) => void,
): void {
  const { editor } = useComposer()
  const stableListener = useStableCallback(listener)

  useEffect(
    () => editor.events.commands.subscribe(stableListener),
    [editor, stableListener],
  )
}
