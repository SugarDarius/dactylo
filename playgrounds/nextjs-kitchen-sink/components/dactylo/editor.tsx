'use client'

import {
  Composer,
  useHistoryCommands,
  useHistoryTools,
} from '@sugardarius/dactylo/react'
import {
  Redo2,
  Undo2,
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Link,
  TextAlignStart,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  CodeXml,
} from 'lucide-react'

import { Button } from '~/components/ui/button'
import { Separator } from '~/components/ui/separator'
import { cn } from '~/lib/utils'

export function Toolbar() {
  const { canUndo, canRedo } = useHistoryTools()
  const { undo, redo } = useHistoryCommands()

  return (
    <div className='border-border flex w-full items-center gap-1.5 border-b px-1.5 py-2'>
      <div className='flex items-center'>
        <Button variant='ghost' size='icon' disabled={!canUndo} onClick={undo}>
          <Undo2 className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon' disabled={!canRedo} onClick={redo}>
          <Redo2 className='size-3.5' />
        </Button>
      </div>
      <Separator orientation='vertical' />
      <div className='flex items-center'>
        <Button variant='ghost' size='icon'>
          <Bold className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon'>
          <Italic className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon'>
          <Strikethrough className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon'>
          <Underline className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon'>
          <CodeXml className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon'>
          <Link className='size-3.5' />
        </Button>
      </div>
      <Separator orientation='vertical' />
      <div className='flex items-center'>
        <Button variant='ghost' size='icon'>
          <TextAlignStart className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon'>
          <TextAlignCenter className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon'>
          <TextAlignEnd className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon'>
          <TextAlignJustify className='size-3.5' />
        </Button>
      </div>
      <Separator orientation='vertical' />
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
        placeholder='Welcome to Dactylo! Start writing something…'
        clientOnly={true}
        debug={true}
        className='relative flex w-full flex-col gap-2 rounded-md shadow-sm'
      >
        <Toolbar />
        <Composer.Editable
          autoFocus
          className={cn(
            'relative flex w-full flex-col px-6 py-2',
            // @note: for DX convenience add custom components
            '**:[[dactylo-block-content]]:outline-0',
            '**:[[dactylo-blocks]]:flex **:[[dactylo-blocks]]:flex-col **:[[dactylo-blocks]]:gap-2',
            `[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:[content:attr(dactylo-block-placeholder)/'']`,
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:pointer-events-none',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:max-w-full',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:max-w-full',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:min-h-[1em]',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:p-0',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:text-muted-foreground',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:whitespace-break-spaces',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:wrap-break-word',
          )}
        />
      </Composer.Root>
    </div>
  )
}
