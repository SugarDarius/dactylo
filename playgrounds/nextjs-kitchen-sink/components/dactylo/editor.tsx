'use client'

import type { MarkKey } from '@sugardarius/dactylo'
import {
  Composer,
  useCanEdit,
  useEditableListener,
  useHistoryCommands,
  useHistoryTools,
  useIsMarkActive,
  useMarksCommands,
  useSetEditable,
} from '@sugardarius/dactylo/react'
import {
  BadgeCheck,
  PencilOff,
  Redo2,
  Undo2,
  Bold,
  Italic,
  Heading1,
  Strikethrough,
  Underline,
  TextAlignStart,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  CodeXml,
  Lock,
  LockOpen,
  Plus,
  Pilcrow,
} from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Kbd } from '~/components/ui/kbd'
import { Separator } from '~/components/ui/separator'
import { toast } from '~/components/ui/toast'
import { Toggle } from '~/components/ui/toggle'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '~/components/ui/tooltip'
import { cn } from '~/lib/utils'

export function MarkToggleButton({
  mark,
  tooltipContent,
  children,
}: React.PropsWithChildren<{
  mark: MarkKey
  tooltipContent: React.ReactNode
}>) {
  const { toggle } = useMarksCommands()
  const canEdit = useCanEdit()

  const active = useIsMarkActive(mark)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            pressed={active}
            variant='outline'
            size='sm'
            onPressedChange={() => toggle(mark)}
            disabled={!canEdit}
            className='border-0'
          >
            {children}
          </Toggle>
        }
      />
      <TooltipContent>{tooltipContent}</TooltipContent>
    </Tooltip>
  )
}

export function ActionButton({
  disabled,
  onClick,
  tooltipContent,
  children,
}: React.PropsWithChildren<{
  disabled: boolean
  tooltipContent: React.ReactNode
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{tooltipContent}</TooltipContent>
    </Tooltip>
  )
}

export function Toolbar() {
  const canEdit = useCanEdit()
  const setEditable = useSetEditable()

  const { canUndo, canRedo } = useHistoryTools()
  const { undo, redo } = useHistoryCommands()

  const { toggle } = useMarksCommands()

  useEditableListener(({ editable }) => {
    toast.add({
      title: `Editor is now ${editable ? 'editable' : 'read-only'}.`,
      type: 'info',
    })
  })

  useHotkeys(
    'mod+b',
    (event) => {
      event.preventDefault()
      toggle('bold')
    },
    { enableOnContentEditable: true, enabled: canEdit },
  )

  useHotkeys(
    'mod+i',
    (event) => {
      event.preventDefault()
      toggle('italic')
    },
    { enableOnContentEditable: true, enabled: canEdit },
  )

  useHotkeys(
    'mod+s',
    (event) => {
      event.preventDefault()
      toggle('strikethrough')
    },
    { enableOnContentEditable: true, enabled: canEdit },
  )

  useHotkeys(
    'mod+u',
    (event) => {
      event.preventDefault()
      toggle('underline')
    },
    { enableOnContentEditable: true, enabled: canEdit },
  )

  useHotkeys(
    'mod+e',
    (event) => {
      event.preventDefault()
      toggle('code')
    },
    { enableOnContentEditable: true, enabled: canEdit },
  )

  return (
    <div className='border-border flex w-full items-center gap-1.5 border-b px-1.5 py-2'>
      <div className='flex items-center'>
        <ActionButton
          disabled={!canUndo}
          onClick={undo}
          tooltipContent={
            <span>
              Undo <Kbd>⌘Z</Kbd>
            </span>
          }
        >
          <Undo2 className='size-3.5' />
        </ActionButton>
        <ActionButton
          disabled={!canRedo}
          onClick={redo}
          tooltipContent={
            <span>
              Redo <Kbd>⌘Y</Kbd>
            </span>
          }
        >
          <Redo2 className='size-3.5' />
        </ActionButton>
      </div>
      <Separator orientation='vertical' />
      <div className='flex items-center'>
        <MarkToggleButton
          mark='bold'
          tooltipContent={
            <span>
              Bold <Kbd>⌘B</Kbd>
            </span>
          }
        >
          <Bold className='size-3.5' />
        </MarkToggleButton>
        <MarkToggleButton
          mark='italic'
          tooltipContent={
            <span>
              Italic <Kbd>⌘I</Kbd>
            </span>
          }
        >
          <Italic className='size-3.5' />
        </MarkToggleButton>
        <MarkToggleButton
          mark='strikethrough'
          tooltipContent={
            <span>
              Strikethrough <Kbd>⌘S</Kbd>
            </span>
          }
        >
          <Strikethrough className='size-3.5' />
        </MarkToggleButton>
        <MarkToggleButton
          mark='underline'
          tooltipContent={
            <span>
              Underline <Kbd>⌘U</Kbd>
            </span>
          }
        >
          <Underline className='size-3.5' />
        </MarkToggleButton>
        <MarkToggleButton
          mark='code'
          tooltipContent={
            <span>
              Code <Kbd>⌘E</Kbd>
            </span>
          }
        >
          <CodeXml className='size-3.5' />
        </MarkToggleButton>
      </div>
      <Separator orientation='vertical' />
      <div className='flex items-center'>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant='ghost' size='icon'>
                <Plus className='size-3.5' />
              </Button>
            }
          />
          <DropdownMenuContent className='w-40' align='start'>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Basic Blocks</DropdownMenuLabel>
              <DropdownMenuItem>
                <Pilcrow className='size-3.5' />
                Paragraph
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Heading1 className='size-3.5' />
                Heading 1
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Separator orientation='vertical' />
      <div className='flex items-center'>
        <Button variant='ghost' size='icon' disabled>
          <TextAlignStart className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon' disabled>
          <TextAlignCenter className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon' disabled>
          <TextAlignEnd className='size-3.5' />
        </Button>
        <Button variant='ghost' size='icon' disabled>
          <TextAlignJustify className='size-3.5' />
        </Button>
      </div>
      <Separator orientation='vertical' />
      <div className='flex items-center'>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                pressed={!canEdit}
                variant='outline'
                size='sm'
                onPressedChange={() => setEditable(!canEdit)}
                className='border-0'
              >
                {canEdit ? (
                  <LockOpen className='size-3.5' />
                ) : (
                  <Lock className='size-3.5' />
                )}
              </Toggle>
            }
          />
          <TooltipContent>
            {canEdit ? 'Disable editing' : 'Enable editing'}
          </TooltipContent>
        </Tooltip>
        <Badge variant={canEdit ? 'default' : 'secondary'}>
          {canEdit ? (
            <span className='inline-flex items-center gap-1'>
              <BadgeCheck className='size-3.5' />
              Editable
            </span>
          ) : (
            <span className='inline-flex items-center gap-1'>
              <PencilOff className='size-3.5' />
              Read-only mode
            </span>
          )}
        </Badge>
      </div>
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
            'selection:text-accent-foreground relative flex w-full flex-col px-6 py-2 selection:bg-cyan-500',
            // @note: for DX convenience add custom components
            '**:[[dactylo-blocks]]:flex **:[[dactylo-blocks]]:flex-col **:[[dactylo-blocks]]:gap-2',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true]]:caret-cyan-500',
            `[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:[content:attr(dactylo-block-placeholder)/'']`,
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:pointer-events-none',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:max-w-full',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:max-w-full',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:min-h-[1em]',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:p-0',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:text-muted-foreground',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:whitespace-break-spaces',
            '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:wrap-break-word',
            '[&_[dactylo-node][dactylo-link-node]]:cursor-pointer',
            '[&_[dactylo-node][dactylo-link-node]]:text-cyan-500',
            '[&_[dactylo-node][dactylo-link-node]]:underline',
            '[&_[dactylo-node][dactylo-link-node]]:decoration-cyan-500',
            '[&_[dactylo-node][dactylo-link-node]]:underline-offset-2',
            '[&_[dactylo-node][dactylo-link-node]]:hover:text-cyan-400',
            '[&_[dactylo-node][dactylo-link-node]]:hover:decoration-cyan-400',
            '**:data-[dactylo-italic-mark=true]:italic',
            '**:data-[dactylo-bold-mark=true]:font-bold',
            '**:[&[data-dactylo-code-mark=true]:not([data-dactylo-editable-node-empty=true])]:p-0.5',
            '**:data-[dactylo-code-mark=true]:bg-muted',
            '**:data-[dactylo-code-mark=true]:rounded-sm',
            '**:data-[dactylo-code-mark=true]:font-mono',
            '**:data-[dactylo-code-mark=true]:text-xs',
            '**:data-[dactylo-code-mark=true]:text-red-600',
            '**:data-[dactylo-strikethrough-mark=true]:line-through',
            '**:data-[dactylo-underline-mark=true]:underline',
          )}
        />
      </Composer.Root>
    </div>
  )
}
