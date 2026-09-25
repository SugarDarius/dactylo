'use client'

import { Composer } from '@sugardarius/dactylo/react'
import { useEffect, useState } from 'react'

import { cn } from '~/lib/utils'

export function Editor({ className, ...props }: React.ComponentProps<'div'>) {
  // @todo: remove this once we have a proper way to mount the editor
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <div className={cn('relative w-full', className)} {...props}>
      <Composer.Root placeholder='Write something…'>
        <Composer.Editable autoFocus className='relative w-full' />
      </Composer.Root>
    </div>
  )
}
