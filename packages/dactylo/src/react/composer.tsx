'use client'

import { forwardRef } from 'react'

/**  Props for declaring the composer root. */
export interface ComposerRootProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Alias for {@link DactyloConfigOptions.editor.paragraph.placeholder}. */
  placeholder?: string
}

export const ComposerRoot = forwardRef<HTMLDivElement, ComposerRootProps>(
  (props, ref) => <div ref={ref} {...props} />,
)

ComposerRoot.displayName = 'ComposerRoot'

export { ComposerRoot as Root }
