'use client'

import {
  Composer,
  useHistoryCommands,
  useHistoryTools,
} from '@sugardarius/dactylo/react'
import { Redo2, Undo2 } from 'lucide-react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'

export function Toolbar() {
  const { canUndo, canRedo } = useHistoryTools()
  const { undo, redo } = useHistoryCommands()

  return (
    <div className='border-border flex w-full items-center border-b px-1.5 py-2'>
      <Button variant='ghost' size='icon' disabled={!canUndo} onClick={undo}>
        <Undo2 className='size-3.5' />
      </Button>
      <Button variant='ghost' size='icon' disabled={!canRedo} onClick={redo}>
        <Redo2 className='size-3.5' />
      </Button>
    </div>
  )
}

export function Editor({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('relative flex w-full max-w-6xl flex-col', className)}
      {...props}
    >
      <Composer.Root
        placeholder='Write something…'
        clientOnly={true}
        debug={true}
        className='relative flex w-full flex-col gap-2 rounded-md shadow-sm'
      >
        <Toolbar />
        <Composer.Editable
          autoFocus
          className='relative flex w-full flex-col px-1.5 py-2'
        />
      </Composer.Root>
    </div>
  )
}
