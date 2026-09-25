import { useSyncExternalStore } from 'react'

import type { Dactylo } from '../dactylo'
import type { BlockId } from '../internals/blocks'
import type { EditorContext } from '../internals/editor-context'
import { isCursorSelection } from '../internals/selection'
import { COMPOSER_ROOT_NAME } from './internals/constants'
import { createSafeContext } from './internals/context'
import { useStableCallback } from './internals/hooks'

/** @private */
export type OnStoreChange = () => void

/** Dactylo context. */
export interface DactyloContext {
  /** The editor instance. */
  editor: Dactylo
}

export const { Provider: DactyloProvider, useContext: useDactylo } =
  createSafeContext<DactyloContext>({
    errorMsg: `\`<${COMPOSER_ROOT_NAME} />\` is missing. Did you forget to wrap your component with it?`,
  })

/**
 * Returns the editor context {@link EditorContext}.
 *
 * @example
 * ```tsx
 * const context = useEditorContext()
 * console.log(context)
 * ```
 */
export function useEditorContext(): EditorContext {
  const { editor } = useDactylo()

  const subscribe = useStableCallback((cb: OnStoreChange) =>
    editor.subscribe(() => {
      cb()
    }),
  )
  const getSnapshot = useStableCallback(() => editor.getContext())

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Returns whether the block with the given ID has an active cursor.
 *
 * @example
 * ```tsx
 * const withActiveCursor = useIsBlockWithActiveCursor(blockId)
 * console.log(isActive)
 * ```
 */
export function useIsBlockWithActiveCursor(blockId: BlockId): boolean {
  const { editor } = useDactylo()

  const subscribe = useStableCallback((cb: OnStoreChange) =>
    editor.subscribe(() => {
      cb()
    }),
  )
  const getSnapshot = useStableCallback(() => {
    const { selection } = editor.getContext()

    return isCursorSelection(selection) && selection.anchor.blockId === blockId
  })
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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
  const getSnapshot = useStableCallback(() => editor.selection.isFocused())

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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

/**
 * Returns the selection commands.
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

  const focus = useStableCallback(() => editor.selection.focus())
  const blur = useStableCallback(() => editor.selection.blur())

  return { blur, focus } as const
}
