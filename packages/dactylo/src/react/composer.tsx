'use client'

import { forwardRef } from 'react'

import { Dactylo } from '../dactylo'
import type { DactyloOptions } from '../dactylo'
import { createSafeContext } from './internals/context'
import { useStableReference } from './internals/hooks'

/** The name of the composer root component. */
export const COMPOSER_ROOT_NAME = 'Composer.Root'

const { Provider: DactyloProvider, useContext: useDactylo } =
  createSafeContext<Dactylo>({
    errorMsg: `\`<${COMPOSER_ROOT_NAME} />\` is missing. Did you forget to wrap your component with it?`,
  })

/** Props for declaring the composer root. */
export interface ComposerRootProps
  extends React.HTMLAttributes<HTMLDivElement>, DactyloOptions {
  // @note: placeholder prop for now
  onChange: () => void
}

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

export { ComposerRoot as Root, useDactylo }
