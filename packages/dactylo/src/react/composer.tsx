import { useEffect, useId, useRef, useSyncExternalStore } from 'react'

import type {
  Dactylo,
  DactyloCommandEvent,
  DactyloStaticConfig,
  DactyloToolEvent,
} from '../dactylo'
import { putCursorCaretAtPositionInDOM } from '../dom/cursor'
import type { BlockId } from '../internals/blocks'
import type { DocumentState } from '../internals/document'
import type { CursorSelection, Selection } from '../internals/selection'
import type { TransactionSource } from '../internals/transaction'
import { COMPOSER_ROOT_NAME } from './internals/constants'
import { createSafeContext } from './internals/context'
import {
  useIsomorphicLayoutEffect,
  useStableCallback,
  useStableValue,
} from './internals/hooks'

// --- Main Context ─────────────────────────────────────────--------

/** Main Dactylo context. */
export interface DactyloContext {
  /** The {@link Dactylo} editor instance. */
  editor: Dactylo
}

export const { Provider: DactyloProvider, useContext: useDactylo } =
  createSafeContext<DactyloContext>({
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
  const { editor } = useDactylo()
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
  const { editor } = useDactylo()

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
  const { editor } = useDactylo()
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
  const { editor } = useDactylo()

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
  const { editor } = useDactylo()

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
  const { editor } = useDactylo()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() => {
    const { selection } = editor.getContext()
    if (selection?.__type !== 'cursor') {
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
  const { editor } = useDactylo()

  const isBlockWithActiveCursor = useStableCallback((blockId: BlockId) =>
    editor.selection.tools.isBlockWithActiveCursor(blockId),
  )

  return { isBlockWithActiveCursor } as const
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
  const { editor } = useDactylo()

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
  const { editor } = useDactylo()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() =>
    editor.selection.tools.isFocused(),
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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
  const { editor } = useDactylo()

  const undo = useStableCallback(() => editor.history.commands.undo())
  const redo = useStableCallback(() => editor.history.commands.redo())

  return { redo, undo } as const
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
  const { editor } = useDactylo()

  const canUndo = useStableCallback(() => editor.history.tools.canUndo())
  const canRedo = useStableCallback(() => editor.history.tools.canRedo())

  return { canRedo, canUndo } as const
}

// --- Editable ------─────────────────────────────────────────------

/**
 * Wires a block's `contentEditable` surface to {@link Dactylo}.
 * @private
 */
export function useEditableBlock(blockId: BlockId) {
  const { editor } = useDactylo()

  const editableId = useId()
  const editableRef = useRef<HTMLDivElement>(null)

  const canEdit = useCanEdit()
  const { isBlockWithActiveCursor } = useSelectionTools()
  const cursorSelection = useCursorSelection()
  const withActiveCursor = cursorSelection
    ? isBlockWithActiveCursor(blockId)
    : false

  // @todo: add show placeholder

  /**
   * `beforeinput` event handled used to capture the following input types:
   *  - `insertLineBreak` (`shift+Enter` → soft break)
   *  - `insertParagraph` (`Enter` → hard break)
   *  - `deleteContentBackward` (`Backspace` → delete char for cursor selection or  range of chars for range selection)
   *  - `insertText` (`Typing` → insert text)
   */
  const onBeforeInput = useStableCallback((event: InputEvent) =>
    editor.composer.commands.sendInput(event),
  )

  useEffect(() => {
    const editable = editableRef.current
    if (!editable) {
      return
    }

    /**
     * Attach a native DOM event handler for `beforeinput` as React build-in `onBeforeInput`
     * is returning a `TextEvent` as native event instead of an `InputEvent`.
     */
    editable.addEventListener('beforeinput', onBeforeInput)
    return () => editable.removeEventListener('beforeinput', onBeforeInput)
  }, [onBeforeInput])

  /** Put the cursor caret in the DOM at the position of the cursor selection. */
  useIsomorphicLayoutEffect(() => {
    if (
      !editableRef.current ||
      !canEdit ||
      !cursorSelection ||
      !withActiveCursor
    ) {
      return
    }

    const editable = editableRef.current
    const id = requestAnimationFrame(() => {
      putCursorCaretAtPositionInDOM(editable, cursorSelection.anchor)
    })

    return () => cancelAnimationFrame(id)
  }, [canEdit, withActiveCursor, cursorSelection])

  return {
    canEdit,
    editableId,
    editableRef,
    withActiveCursor,
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
  const { editor } = useDactylo()
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
  const { editor } = useDactylo()
  const stableListener = useStableCallback(listener)

  useEffect(
    () => editor.events.commands.subscribe(stableListener),
    [editor, stableListener],
  )
}
