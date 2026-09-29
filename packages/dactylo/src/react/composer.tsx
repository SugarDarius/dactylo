import { useEffect, useMemo, useSyncExternalStore } from 'react'

import type {
  Dactylo,
  DactyloCommandEvent,
  DactyloStaticConfig,
  DactyloToolEvent,
} from '../dactylo'
import type { BlockId } from '../internals/blocks'
import type { DocumentState } from '../internals/document'
import type { Selection } from '../internals/selection'
import { COMPOSER_ROOT_NAME } from './internals/constants'
import { createSafeContext } from './internals/context'
import { useStableCallback, useStableValue } from './internals/hooks'

/** @private */
export type OnStoreChange = () => void

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

  const subscribe = useStableCallback((cb: OnStoreChange) =>
    editor.events.editable.subscribe(() => {
      cb()
    }),
  )
  const getSnapshot = useStableCallback(() => editor.canEdit())

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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

  const subscribe = useStableCallback((cb: OnStoreChange) =>
    editor.subscribe(() => {
      cb()
    }),
  )
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

  const subscribe = useStableCallback((cb: OnStoreChange) =>
    editor.subscribe(() => {
      cb()
    }),
  )
  const getSnapshot = useStableCallback(() => {
    const { selection } = editor.getContext()

    return selection
  })

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Returns whether the block with the given ID is with
 * an active text cursor in it.
 *
 * @example
 * ```tsx
 * const withActiveCursor = useIsWithActiveCursor(blockId)
 * console.log(withActiveCursor)
 * ```
 */
export function useIsWithActiveCursor(blockId: BlockId): boolean {
  const { editor } = useDactylo()
  const withActiveCursor = useMemo(
    () => editor.selection.tools.isBlockWithActiveCursor(blockId),
    [editor, blockId],
  )

  return withActiveCursor
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

  const subscribe = useStableCallback((cb: OnStoreChange) =>
    editor.subscribe(() => {
      cb()
    }),
  )
  const getSnapshot = useStableCallback(() =>
    editor.selection.tools.isFocused(),
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// --- Commands ------─────────────────────────────────────────------

/**
 * Returns the selection focus command.
 *
 * @example
 * ```tsx
 * const focus = useSelectionFocus()
 *
 * useLayoutEffect(() => {
 *  focus()
 * }, [])
 * ```
 */
export function useSelectionFocus() {
  const { editor } = useDactylo()
  return useStableCallback(() => editor.selection.commands.focus())
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
