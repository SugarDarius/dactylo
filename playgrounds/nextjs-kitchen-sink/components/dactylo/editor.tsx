'use client'

import { Composer } from '@sugardarius/dactylo/react'

import { cn } from '~/lib/utils'

export function Editor({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('relative w-full', className)} {...props}>
      <Composer.Root placeholder='Write something…' clientOnly={true}>
        <Composer.Editable autoFocus className='relative w-full' />
      </Composer.Root>
    </div>
  )
}
