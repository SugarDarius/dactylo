'use client'

import {
  Composer,
  useCommandsListener,
  useToolsListener,
} from '@sugardarius/dactylo/react'

import { toast } from '~/components/ui/toast'
import { cn } from '~/lib/utils'

function CommandsListener() {
  useCommandsListener(({ command, status }) => {
    const id = toast.add({
      description: `Command ${command} ${status}`,
      onClose: () => {
        toast.close(id)
      },
      title: `Command ${command} ${status}`,
      type: status === 'success' ? 'success' : 'error',
    })
  })
  return null
}

function ToolsListener() {
  useToolsListener(({ tool, status }) => {
    const id = toast.add({
      description: `Tool ${tool} ${status}`,
      onClose: () => {
        toast.close(id)
      },
    })
  })
  return null
}

export function Editor({ className, ...props }: React.ComponentProps<'div'>) {
  const debug = process.env.NODE_ENV === 'development'
  return (
    <div className={cn('relative w-full', className)} {...props}>
      <Composer.Root
        placeholder='Write something…'
        clientOnly={true}
        debug={debug}
        className='relative w-full'
      >
        <Composer.Editable autoFocus className='relative w-full' />
        <ToolsListener />
        <CommandsListener />
      </Composer.Root>
    </div>
  )
}
