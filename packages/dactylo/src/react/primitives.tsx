'use client'

import { forwardRef } from 'react'

import { Dactylo } from '../dactylo'
import {
  DactyloProvider,
  useCanEdit,
  useDactylo,
  useIsFocused,
} from './composer'
import {
  COMPOSER_EDITABLE_NAME,
  COMPOSER_ROOT_NAME,
} from './internals/constants'
import { useIsomorphicLayoutEffect, useStableValue } from './internals/hooks'
import type { ComposerRootProps, ComposerEditableProps } from './types'

// --- Composer.Root ─────────────────────────────────────────-------

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
    const ctx = useStableValue({
      editor: new Dactylo({ config, editable, placeholder }),
    })

    return (
      <div {...props} ref={forwardedRef} dactylo-composer-root=''>
        <DactyloProvider value={ctx}>{children}</DactyloProvider>
      </div>
    )
  },
)

ComposerRoot.displayName = COMPOSER_ROOT_NAME

// --- Composer.Editable ─────────────────────────────────────────---

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
  const { editor } = useDactylo()

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

export { ComposerRoot as Root, ComposerEditable as Editable }
