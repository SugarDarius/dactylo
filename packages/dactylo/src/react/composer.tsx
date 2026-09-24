import { useSyncExternalStore } from 'react'

import type { Dactylo } from '../dactylo'
import type { EditorContext } from '../internals/editor-context'
import { COMPOSER_ROOT_NAME } from './internals/constants'
import { createSafeContext } from './internals/context'
import { useStableCallback } from './internals/hooks'

/** @internal */
type OnStoreChange = () => void

export const { Provider: DactyloProvider, useContext: useDactylo } =
  createSafeContext<Dactylo>({
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
  const editor = useDactylo()

  const subscribe = useStableCallback((onStoreChange: OnStoreChange) =>
    editor.subscribe(onStoreChange),
  )
  const getSnapshot = useStableCallback(() => editor.getContextSnapshot())

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
  const editor = useDactylo()

  const subscribe = useStableCallback((onStoreChange: OnStoreChange) =>
    editor.subscribe(onStoreChange),
  )
  const getSnapshot = useStableCallback(() =>
    editor.selection.isFocused(editor.getContextSnapshot()),
  )

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
  const editor = useDactylo()

  const subscribe = useStableCallback(editor.events.editable.subscribe)
  const getSnapshot = useStableCallback(() => editor.canEdit())

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
