import { useEffect, useId, useRef, useSyncExternalStore } from 'react'

import type {
  Dactylo,
  DactyloCommandEvent,
  DactyloStaticConfig,
  DactyloToolEvent,
} from '../dactylo'
import type { BlockId } from '../internals/blocks'
import type { DocumentState } from '../internals/document'
import { isCursorSelection, isRangeSelection } from '../internals/selection'
import type {
  CursorSelection,
  RangeSelection,
  Selection,
} from '../internals/selection'
import type { TransactionSource } from '../internals/transaction'
import { noop } from '../internals/utils'
import { COMPOSER_ROOT_NAME } from './internals/constants'
import { createSafeContext } from './internals/context'
import {
  useIsomorphicLayoutEffect,
  useStableCallback,
  useStableValue,
} from './internals/hooks'

// --- Composer Context ─────────────────────────────────────────--------

/** Main Dactylo context. */
export interface ComposerContext {
  /** The {@link Dactylo} editor instance. */
  editor: Dactylo
}

export const { Provider: ComposerProvider, useContext: useComposer } =
  createSafeContext<ComposerContext>({
    errorMsg: `\`<${COMPOSER_ROOT_NAME} />\` is missing. Did you forget to wrap your component within it?`,
  })

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
  const { editor } = useComposer()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() => {
    const { state } = editor.getContext()

    return state
  })

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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
  const { editor } = useComposer()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() => {
    const { selection } = editor.getContext()
    return selection
  })

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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
  const { editor } = useComposer()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() => {
    const { selection } = editor.getContext()
    if (!isCursorSelection(selection)) {
      return null
    }

    return selection
  })

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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
  const { editor } = useComposer()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() => {
    const { selection } = editor.getContext()
    if (!isRangeSelection(selection)) {
      return null
    }

    return selection
  })

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Returns the selection tools.
 *
 * @example
 * ```tsx
 * const { isBlockWithActiveCursor } = useSelectionTools()
 * console.log(isBlockWithActiveCursor(blockId))
 * ```
 */
export function useSelectionTools() {
  const { editor } = useComposer()

  const isBlockWithActiveCursor = useStableCallback((blockId: BlockId) =>
    editor.selection.tools.isBlockWithActiveCursor(blockId),
  )

  const isBlockWithActiveRange = useStableCallback((blockId: BlockId) =>
    editor.selection.tools.isBlockWithActiveRange(blockId),
  )

  const isBlockWithActiveSelection = useStableCallback((blockId: BlockId) =>
    editor.selection.tools.isBlockWithActiveSelection(blockId),
  )

  return {
    isBlockWithActiveCursor,
    isBlockWithActiveRange,
    isBlockWithActiveSelection,
  } as const
}

/**
 * Returns the selection focus command.
 *
 * @example
 * ```tsx
 * const { focus } = useSelectionCommands()
 *
 * useLayoutEffect(() => {
 *  focus()
 * }, [])
 * ```
 */
export function useSelectionCommands() {
  const { editor } = useComposer()

  const focus = useStableCallback(
    (source?: Extract<TransactionSource, 'user' | 'ai-agent'>) =>
      editor.selection.commands.focus(source),
  )

  const blur = useStableCallback(
    (source?: Extract<TransactionSource, 'user' | 'ai-agent'>) =>
      editor.selection.commands.blur(source),
  )

  return { blur, focus } as const
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

// --- Composer ------─────────────────────────────────────────------

/**
 * Returns the composer commands.
 *
 * @example
 * ```tsx
 * const { sendInput } = useComposerCommands()
 * console.log(sendInput)
 * ```
 */
export function useComposerCommands() {
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
 * Returns the blocks tools.
 *
 * @example
 * ```tsx
 * const { isWithEmptyInlineContent } = useBlocksTools()
 * console.log(isWithEmptyInlineContent(blockId))
 * ```
 */
export function useBlocksTools() {
  const { editor } = useComposer()

  const isWithEmptyInlineContent = useStableCallback((blockId: BlockId) =>
    editor.blocks.tools.isWithEmptyInlineContent(blockId),
  )

  return { isWithEmptyInlineContent } as const
}

/**
 * Returns the blocks commands.
 *
 * @example
 * ```tsx
 * const { delete } = useBlocksCommands()
 * delete(blockId)
 * ```
 */
export function useBlocksCommands() {
  const { editor } = useComposer()

  const $delete = useStableCallback((blockId: BlockId) =>
    editor.blocks.commands.delete(blockId),
  )

  return { delete: $delete } as const
}

// --- History ------─────────────────────────────────────────-------

/**
 * Returns the history commands.
 *
 * @example
 * ```tsx
 * const { undo, redo } = useHistoryCommands()
 * console.log(undo, redo)
 * ```
 */
export function useHistoryCommands() {
  const { editor } = useComposer()

  const undo = useStableCallback(() => editor.history.commands.undo())
  const redo = useStableCallback(() => editor.history.commands.redo())
  const clear = useStableCallback(() => editor.history.commands.clear())

  return { clear, redo, undo } as const
}

/**
 * Returns the history tools.
 *
 * @example
 * ```tsx
 * const { canUndo, canRedo } = useHistoryTools()
 * console.log(canUndo, canRedo)
 * ```
 */
export function useHistoryTools() {
  const { editor } = useComposer()

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

  return { canRedo, canUndo } as const
}

// --- Editable ------─────────────────────────────────────────------

/**
 * Binds `<Composer.Editable />` to {@link Dactylo} selection and events.
 *  - DOM → model: `pointerup on the editable element + `selectionchange` events.
 *  - Model → DOM: paths a collapsed cursor caret in the current editable block.
 * Mount once on `<Composer.Editable />`, do not mount per block.
 *
 * @private
 */
export function useEditable() {
  const editableRef = useRef<HTMLDivElement>(null)

  const { editor } = useComposer()

  const canEdit = useCanEdit()
  const cursorSelection = useCursorSelection()
  const rangeSelection = useRangeSelection()

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

    /** Listen to compositionstart and compositionend events on the editable element. */
    editable.addEventListener('compositionstart', onCompositionStart)
    editable.addEventListener('compositionend', onCompositionEnd)
    return () => {
      editor.dom.commands.detach()

      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('selectionchange', onSelectionChange)

      editable.removeEventListener('compositionstart', onCompositionStart)
      editable.removeEventListener('compositionend', onCompositionEnd)
    }
  }, [
    canEdit,
    editor,
    onPointerUp,
    onSelectionChange,
    onCompositionStart,
    onCompositionEnd,
  ])

  /**
   * PPaints the native selection from editor context:
   * collapsed caret or range (e.g. shift + arrow keys).
   *
   * Runs only when the editor is editable and when there is a selection.
   */
  useIsomorphicLayoutEffect(() => {
    if (!canEdit || (!cursorSelection && !rangeSelection)) {
      return
    }

    if (cursorSelection !== null) {
      return editor.dom.commands.paintCaret()
    }

    if (rangeSelection !== null) {
      return editor.dom.commands.paintRange()
    }

    return noop
  }, [canEdit, cursorSelection, rangeSelection, editor])

  return { canEdit, editableRef } as const
}

/**
 * Wires a block's `contentEditable` surface to {@link Dactylo}.
 * Works only for blocks with inline content.
 *
 * @private
 */
export function useEditableBlock(blockId: BlockId) {
  const editableId = useId()
  const editableRef = useRef<HTMLDivElement>(null)

  const canEdit = useCanEdit()

  const { isBlockWithActiveSelection } = useSelectionTools()
  const { sendInput } = useComposerCommands()
  const { isWithEmptyInlineContent } = useBlocksTools()

  const isEmpty = isWithEmptyInlineContent(blockId)
  const withActiveSelection = isBlockWithActiveSelection(blockId)

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

  useEffect(() => {
    const editable = editableRef.current
    if (!editable || !withActiveSelection) {
      return
    }

    /**
     * Attach a native DOM event handler for `beforeinput` as React build-in `onBeforeInput`
     * is returning a `TextEvent` as native event instead of an `InputEvent`.
     * We want real Level 2 DOM events.
     */
    editable.addEventListener('beforeinput', onBeforeInput)
    return () => editable.removeEventListener('beforeinput', onBeforeInput)
  }, [onBeforeInput, withActiveSelection])

  return {
    canEdit,
    editableId,
    editableRef,
    isEmpty,
    withActiveSelection,
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
