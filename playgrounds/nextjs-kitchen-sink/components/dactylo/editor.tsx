'use client'

import { Composer, useCommandsListener } from '@sugardarius/dactylo/react'

import { toast } from '~/components/ui/toast'
import { cn } from '~/lib/utils'

function CommandsListener() {
  useCommandsListener(({ command, status }) => {
    toast.add({
      description: `Command ${command} ${status}`,
      title: `Command ${command} ${status}`,
      type: status === 'success' ? 'success' : 'error',
    })
  })
  return null
}

export function Editor({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('relative w-full', className)} {...props}>
      <Composer.Root
        placeholder='Write something…'
        clientOnly={true}
        className='relative w-full'
      >
        <Composer.Editable autoFocus className='relative w-full' />
        <CommandsListener />
      </Composer.Root>
    </div>
  )
}
