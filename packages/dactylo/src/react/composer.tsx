'use client'

import { forwardRef } from 'react'

import type { DactyloOptions } from '../dactylo'

/** Props for declaring the composer root. */
export interface ComposerRootProps
  extends React.HTMLAttributes<HTMLDivElement>, DactyloOptions {
  /**
   * Whether the composer is disabled.
   * Defaults to `false`.
   */
  disabled?: boolean
}

/**
 * Adds the root of the composers.
 * @example
 * ```tsx
 * import { Composer } from '@liveblocks/dactylo/react'
 *
 * <Composer.Root>
 *   {children}
 * </Composer.Root>
 * ```
 */
export const ComposerRoot = forwardRef<HTMLDivElement, ComposerRootProps>(
  ({ children, disabled = false, ...props }, forwardedRef) => (
    <div
      {...props}
      ref={forwardedRef}
      dactylo-root=''
      style={{ position: 'relative' }}
    >
      {children}
    </div>
  ),
)

ComposerRoot.displayName = 'ComposerRoot'

export { ComposerRoot as Root }
