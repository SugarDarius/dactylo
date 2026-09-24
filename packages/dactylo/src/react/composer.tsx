'use client'

import { forwardRef, useCallback } from 'react'

import { Dactylo } from '../dactylo'
import type { DactyloOptions } from '../dactylo'
import { createSafeContext } from './internals/context'
import {
  useIsomorphicLayoutEffect,
  useStableReference,
} from './internals/hooks'

/** The name of the composer root component. */
export const COMPOSER_ROOT_NAME = 'Composer.Root'

const { Provider: DactyloProvider, useContext: useDactylo } =
  createSafeContext<Dactylo>({
    errorMsg: `\`<${COMPOSER_ROOT_NAME} />\` is missing. Did you forget to wrap your component with it?`,
  })

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
  ({ children, placeholder, config, ...props }, forwardedRef) => {
    const dactylo = useStableReference(new Dactylo({ config, placeholder }))

    return (
      <div {...props} ref={forwardedRef} dactylo-composer-root=''>
        <DactyloProvider value={dactylo}>{children}</DactyloProvider>
      </div>
    )
  },
)

ComposerRoot.displayName = COMPOSER_ROOT_NAME

export const COMPOSER_EDITABLE_NAME = 'Composer.Editable'

/** Props for declaring the composer editable component. */
export interface ComposerEditableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether to place the cursor in the editor after initial mount. */
  autoFocus?: boolean
}

export const ComposerEditable = forwardRef<
  HTMLDivElement,
  ComposerEditableProps
>(({ children, autoFocus, ...props }, forwardedRef) => {
  const dactylo = useDactylo()

  /** Send input events to the editor's composer. */
  const onBeforeInput = useCallback(
    (event: React.InputEvent<HTMLDivElement>) => {
      dactylo.composer.sendInput(event.nativeEvent)
    },
    [dactylo],
  )

  /** Focus the editor after initial mount if `autoFocus` is true. */
  useIsomorphicLayoutEffect(() => {
    const isFocused = dactylo.selection.isFocused(dactylo.getContextSnapshot())
    if (autoFocus && !isFocused) {
      dactylo.selection.focus()
    }
  }, [])

  return (
    <div
      {...props}
      ref={forwardedRef}
      dactylo-composer-editable=''
      suppressContentEditableWarning={true}
      onBeforeInput={onBeforeInput}
    >
      {children}
    </div>
  )
})

ComposerEditable.displayName = COMPOSER_EDITABLE_NAME

export { ComposerRoot as Root, ComposerEditable as Editable, useDactylo }
