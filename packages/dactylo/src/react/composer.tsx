import { useSyncExternalStore } from 'react'

import type { Dactylo } from '../dactylo'
import type { EditorContext } from '../internals/editor-context'
import { COMPOSER_ROOT_NAME } from './internals/constants'
import { createSafeContext } from './internals/context'
import { useStableCallback } from './internals/hooks'

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

  const { subscribe } = editor
  const getSnapshot = editor.getContextSnapshot

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

  const { subscribe } = editor
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

  const { subscribe } = editor.events.editable
  const { canEdit } = editor

  return useSyncExternalStore(subscribe, canEdit, canEdit)
}
