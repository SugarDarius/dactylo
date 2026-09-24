'use client'

import { forwardRef, useSyncExternalStore } from 'react'

import { Dactylo } from '../dactylo'
import type { DactyloOptions } from '../dactylo'
import type { EditorContext } from '../internals/editor-context'
import { createSafeContext } from './internals/context'
import {
  useIsomorphicLayoutEffect,
  useStableCallback,
  useStableValue,
} from './internals/hooks'

// --- Composer.Root ─────────────────────────────────────────-------

/** The name of the composer root component. */
export const COMPOSER_ROOT_NAME = 'Composer.Root'

const { Provider: DactyloProvider, useContext: useDactylo } =
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

/** Props for declaring the composer root component. */
export interface ComposerRootProps
  extends React.HTMLAttributes<HTMLDivElement>, DactyloOptions {}

/**
 * Adds the root of the composers.
 * @example
 * ```tsx
 * import { Composer } from '@liveblocks/dactylo/react'
 *
 * <Composer.Root placeholder='Write something…'>
 *   {children}
 * </Composer.Root>
 * ```
 */
export const ComposerRoot = forwardRef<HTMLDivElement, ComposerRootProps>(
  (
    { children, editable = true, placeholder, config, ...props },
    forwardedRef,
  ) => {
    const editor = useStableValue(
      new Dactylo({ config, editable, placeholder }),
    )

    return (
      <div {...props} ref={forwardedRef} dactylo-composer-root=''>
        <DactyloProvider value={editor}>{children}</DactyloProvider>
      </div>
    )
  },
)

ComposerRoot.displayName = COMPOSER_ROOT_NAME

// --- Composer.Editable ─────────────────────────────────────────---

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

export const COMPOSER_EDITABLE_NAME = 'Composer.Editable'

/** Props for declaring the composer editable component. */
export interface ComposerEditableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether to place the cursor in the editor at the document end  after initial mount. */
  autoFocus?: boolean
}

/**
 * Adds the editable area of the composer.
 * @example
 * ```tsx
 * import { Composer } from '@liveblocks/dactylo/react'
 *
 * <Composer.Root placeholder='Write something…'>
 *   <Composer.Editable autoFocus>
 *     {children}
 *   </Composer.Editable>
 * </Composer.Root>
 * ```
 */
export const ComposerEditable = forwardRef<
  HTMLDivElement,
  ComposerEditableProps
>(({ children, autoFocus, translate = 'no', ...props }, forwardedRef) => {
  const editor = useDactylo()

  const canEdit = useCanEdit()
  const isFocused = useIsFocused()

  /** Focus the editor after initial mount if `autoFocus` is true. */
  useIsomorphicLayoutEffect(() => {
    if (autoFocus && !isFocused && canEdit) {
      editor.selection.focus()
    }
  }, [canEdit, isFocused])

  return (
    <div
      {...props}
      ref={forwardedRef}
      dactylo-composer-editable=''
      role={canEdit ? 'textbox' : undefined}
      aria-multiline={canEdit ? 'true' : undefined}
      translate={translate}
    >
      {children}
    </div>
  )
})

ComposerEditable.displayName = COMPOSER_EDITABLE_NAME

export { ComposerRoot as Root, ComposerEditable as Editable, useDactylo }
