'use client'

import type { MarkKey } from '@sugardarius/dactylo'
import {
  Composer,
  useBulletLists,
  useCanEdit,
  useCheckboxLists,
  useDividers,
  useEditableListener,
  useHeadings,
  useHistory,
  useMark,
  useMarks,
  useNumberedLists,
  useParagraphs,
  useQuotes,
  useSetEditable,
} from '@sugardarius/dactylo/react'
import {
  BadgeCheck,
  Bold,
  ChevronDown,
  CodeXml,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Italic,
  List,
  ListOrdered,
  Lock,
  LockOpen,
  Minus,
  PencilOff,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  SquareCheck,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
  Undo2,
} from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Kbd } from '~/components/ui/kbd'
import { Separator } from '~/components/ui/separator'
import { ThemeSwitcher } from '~/components/ui/theme-switcher'
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
  const canEdit = useCanEdit()
  const { active, toggle } = useMark(mark)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            pressed={active}
            variant='outline'
            size='sm'
            onPressedChange={() => toggle()}
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

  const { canUndo, canRedo, undo, redo } = useHistory()

  const { insert: insertParagraph } = useParagraphs()
  const { insert: insertHeading } = useHeadings()
  const { insert: insertDivider } = useDividers()
  const { insert: insertBulletListItem } = useBulletLists()
  const { insert: insertNumberedListItem } = useNumberedLists()
  const { insert: insertCheckboxListItem } = useCheckboxLists()
  const { insert: insertQuote } = useQuotes()

  const { toggle } = useMarks()

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
    <div className='border-border flex w-full items-center justify-between gap-2 border-b px-1.5 py-2'>
      <div className='flex w-full items-center gap-1.5'>
        <div className='flex items-center'>
          <ActionButton
            disabled={!canUndo}
            onClick={undo}
            tooltipContent={
              <span>
                Undo <Kbd>⌘+Z</Kbd>
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
                Redo <Kbd>⌘+Y</Kbd>
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
                Bold <Kbd>⌘+B</Kbd>
              </span>
            }
          >
            <Bold className='size-3.5' />
          </MarkToggleButton>
          <MarkToggleButton
            mark='italic'
            tooltipContent={
              <span>
                Italic <Kbd>⌘+I</Kbd>
              </span>
            }
          >
            <Italic className='size-3.5' />
          </MarkToggleButton>
          <MarkToggleButton
            mark='strikethrough'
            tooltipContent={
              <span>
                Strikethrough <Kbd>⌘+S</Kbd>
              </span>
            }
          >
            <Strikethrough className='size-3.5' />
          </MarkToggleButton>
          <MarkToggleButton
            mark='underline'
            tooltipContent={
              <span>
                Underline <Kbd>⌘+U</Kbd>
              </span>
            }
          >
            <Underline className='size-3.5' />
          </MarkToggleButton>
          <MarkToggleButton
            mark='code'
            tooltipContent={
              <span>
                Code <Kbd>⌘+E</Kbd>
              </span>
            }
          >
            <CodeXml className='size-3.5' />
          </MarkToggleButton>
        </div>
        <Separator orientation='vertical' />
        <div className='flex items-center'>
          <DropdownMenu>
            <Tooltip>
              <DropdownMenuTrigger
                render={
                  <TooltipTrigger
                    render={
                      <Button variant='ghost'>
                        <Plus className='size-3.5' />
                        <ChevronDown className='size-3.5' />
                      </Button>
                    }
                  />
                }
              />
              <TooltipContent>Insert</TooltipContent>
            </Tooltip>
            <DropdownMenuContent className='w-48' align='start'>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Basic Blocks</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => insertParagraph()}>
                  <Pilcrow className='size-3.5' />
                  Paragraph
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => insertQuote()}>
                  <Quote className='size-3.5' />
                  Quote
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => insertHeading(1)}>
                  <Heading1 className='size-3.5' />
                  Heading 1
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => insertHeading(2)}>
                  <Heading2 className='size-3.5' />
                  Heading 2
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => insertHeading(3)}>
                  <Heading3 className='size-3.5' />
                  Heading 3
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => insertHeading(4)}>
                  <Heading4 className='size-3.5' />
                  Heading 4
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => insertHeading(5)}>
                  <Heading5 className='size-3.5' />
                  Heading 5
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => insertHeading(6)}>
                  <Heading6 className='size-3.5' />
                  Heading 6
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => insertDivider()}>
                  <Minus className='size-3.5' />
                  Divider
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Lists</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => insertBulletListItem()}>
                  <List className='size-3.5' />
                  Bulleted List
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => insertNumberedListItem()}>
                  <ListOrdered className='size-3.5' />
                  Numbered List
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => insertNumberedListItem({ variant: 'alpha' })}
                >
                  <ListOrdered className='size-3.5' />
                  Numbered List{' '}
                  <span className='text-muted-foreground text-xs'>(alpha)</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => insertNumberedListItem({ variant: 'roman' })}
                >
                  <ListOrdered className='size-3.5' />
                  Numbered List{' '}
                  <span className='text-muted-foreground text-xs'>(roman)</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => insertCheckboxListItem()}>
                  <SquareCheck className='size-3.5' />
                  Checkbox List
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
      <ThemeSwitcher />
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
        placeholder='Start writing something…'
        clientOnly={true}
        debug={true}
        className='dark:shadow-accent relative flex w-full flex-col gap-2 rounded-md shadow-xs'
      >
        <Toolbar />
        <Composer.Editable
          autoFocus
          // @idea:💡 for DX convenience add custom components
          className={cn(
            // base
            'selection:text-accent-foreground relative flex w-full flex-col px-6 py-2 whitespace-break-spaces selection:bg-cyan-500',

            // blocks
            '**:[[dactylo-blocks]]:flex **:[[dactylo-blocks]]:flex-col **:[[dactylo-blocks]]:gap-2',

            // blocks with editable content
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

            // paragraph block
            '**:[[dactylo-paragraph-block]]:flex **:[[dactylo-paragraph-block]]:flex-col',
            '**:[[dactylo-paragraph-block]]:px-1.5',

            // quote block
            '**:[[dactylo-quote-block]]:flex **:[[dactylo-quote-block]]:flex-row',
            '**:[[dactylo-quote-block]]:items-stretch',
            '**:[[dactylo-quote-block]]:gap-2',
            '**:[[dactylo-quote-block]]:px-1.5',

            '**:[[dactylo-quote-block-marker]]:flex',
            '**:[[dactylo-quote-block-marker]]:shrink-0',
            '**:[[dactylo-quote-block-marker]]:items-stretch',

            '**:[[dactylo-quote-block-marker-border]]:w-0.5',
            '**:[[dactylo-quote-block-marker-border]]:self-stretch',
            '**:[[dactylo-quote-block-marker-border]]:rounded-full',
            '**:[[dactylo-quote-block-marker-border]]:bg-border',

            '[&_[dactylo-quote-block]_[dactylo-block-content]]:min-w-0',
            '[&_[dactylo-quote-block]_[dactylo-block-content]]:flex-1',
            '[&_[dactylo-quote-block]_[dactylo-block-content]]:text-muted-foreground',

            // bullet list item block
            '**:[[dactylo-bullet-list-item-block]]:flex **:[[dactylo-bullet-list-item-block]]:flex-row',
            '**:[[dactylo-bullet-list-item-block]]:items-center',
            '**:[[dactylo-bullet-list-item-block]]:gap-2',
            '**:[[dactylo-bullet-list-item-block]]:px-1.5',

            '**:[[dactylo-bullet-list-item-marker]]:flex',
            '**:[[dactylo-bullet-list-item-marker]]:flex-col',
            '**:[[dactylo-bullet-list-item-marker]]:justify-center',
            '**:[[dactylo-bullet-list-item-marker]]:items-center',
            '**:[[dactylo-bullet-list-item-marker]]:p-1.5',

            '**:[[dactylo-bullet-list-item-marker-dot]]:size-1.5',
            '**:[[dactylo-bullet-list-item-marker-dot]]:shrink-0',
            '**:[[dactylo-bullet-list-item-marker-dot]]:rounded-full',
            '**:[[dactylo-bullet-list-item-marker-dot]]:bg-current',

            '[&_[dactylo-bullet-list-item-block]_[dactylo-block-content]]:min-w-0',
            '[&_[dactylo-bullet-list-item-block]_[dactylo-block-content]]:flex-1',

            // numbered list item block
            '**:[[dactylo-numbered-list-item-block]]:flex **:[[dactylo-numbered-list-item-block]]:flex-row',
            '**:[[dactylo-numbered-list-item-block]]:items-center',
            '**:[[dactylo-numbered-list-item-block]]:gap-2',
            '**:[[dactylo-numbered-list-item-block]]:px-1.5',

            '**:[[dactylo-numbered-list-item-marker]]:flex',
            '**:[[dactylo-numbered-list-item-marker]]:flex-col',
            '**:[[dactylo-numbered-list-item-marker]]:justify-center',
            '**:[[dactylo-numbered-list-item-marker]]:items-center',
            '**:[[dactylo-numbered-list-item-marker]]:p-1',

            '**:[[dactylo-numbered-list-item-marker-index]]:shrink-0',
            '**:[[dactylo-numbered-list-item-marker-index]]:select-none',

            '[&_[dactylo-numbered-list-item-block]_[dactylo-block-content]]:min-w-0',
            '[&_[dactylo-numbered-list-item-block]_[dactylo-block-content]]:flex-1',

            // checkbox list item block
            '**:[[dactylo-checkbox-list-item-block]]:flex **:[[dactylo-checkbox-list-item-block]]:flex-row',
            '**:[[dactylo-checkbox-list-item-block]]:items-start',
            '**:[[dactylo-checkbox-list-item-block]]:gap-2',
            '**:[[dactylo-checkbox-list-item-block]]:px-1.5',

            '**:[[dactylo-checkbox-list-item-marker]]:flex',
            '**:[[dactylo-checkbox-list-item-marker]]:flex-col',
            '**:[[dactylo-checkbox-list-item-marker]]:justify-center',
            '**:[[dactylo-checkbox-list-item-marker]]:items-center',
            '**:[[dactylo-checkbox-list-item-marker]]:p-1.5',

            '**:[[dactylo-checkbox-list-item-marker-input]]:size-3.5',
            '**:[[dactylo-checkbox-list-item-marker-input]]:shrink-0',
            '**:[[dactylo-checkbox-list-item-marker-input]]:rounded-sm',
            '**:[[dactylo-checkbox-list-item-marker-input]]:border',
            '**:[[dactylo-checkbox-list-item-marker-input]]:border-current',
            '**:[[dactylo-checkbox-list-item-marker-input]]:cursor-pointer',
            '[&_[dactylo-checkbox-list-item-block][data-dactylo-checkbox-list-item-checked=true]_[dactylo-checkbox-list-item-marker-input]]:bg-current',

            '[&_[dactylo-checkbox-list-item-block][data-dactylo-checkbox-list-item-checked=true]_[dactylo-block-content]]:text-muted-foreground',
            '[&_[dactylo-checkbox-list-item-block][data-dactylo-checkbox-list-item-checked=true]_[dactylo-block-content]]:line-through',
            '[&_[dactylo-checkbox-list-item-block]_[dactylo-block-content]]:min-w-0',
            '[&_[dactylo-checkbox-list-item-block]_[dactylo-block-content]]:flex-1',

            // heading block
            '**:[[dactylo-heading-block]]:flex **:[[dactylo-heading-block]]:flex-col',
            '**:[[dactylo-heading-block]]:px-1.5',

            // heading block level 1
            '**:data-[dactylo-heading-block-level=1]:pt-7.5 **:data-[dactylo-heading-block-level=1]:pb-1.5',
            '**:data-[dactylo-heading-block-level=1]:text-5xl',
            '**:data-[dactylo-heading-block-level=1]:font-semibold',
            '**:data-[dactylo-heading-block-level=1]:tracking-tight',

            // heading block level 2
            '**:data-[dactylo-heading-block-level=2]:pt-6.5 **:data-[dactylo-heading-block-level=2]:pb-1.5',
            '**:data-[dactylo-heading-block-level=2]:text-3xl',
            '**:data-[dactylo-heading-block-level=2]:font-semibold',
            '**:data-[dactylo-heading-block-level=2]:tracking-tight',

            // heading block level 3
            '**:data-[dactylo-heading-block-level=3]:pt-5.5 **:data-[dactylo-heading-block-level=3]:pb-1.5',
            '**:data-[dactylo-heading-block-level=3]:text-2xl',
            '**:data-[dactylo-heading-block-level=3]:font-semibold',
            '**:data-[dactylo-heading-block-level=3]:tracking-tight',

            // heading block level 4
            '**:data-[dactylo-heading-block-level=4]:pt-4.5 **:data-[dactylo-heading-block-level=4]:pb-1.5',
            '**:data-[dactylo-heading-block-level=4]:text-xl',
            '**:data-[dactylo-heading-block-level=4]:font-semibold',
            '**:data-[dactylo-heading-block-level=4]:tracking-tight',

            // heading block level 5
            '**:data-[dactylo-heading-block-level=5]:pt-4 **:data-[dactylo-heading-block-level=5]:pb-1.5',
            '**:data-[dactylo-heading-block-level=5]:text-lg',
            '**:data-[dactylo-heading-block-level=5]:font-semibold',
            '**:data-[dactylo-heading-block-level=5]:tracking-tight',

            // heading block level 6
            '**:data-[dactylo-heading-block-level=6]:pt-4 **:data-[dactylo-heading-block-level=6]:pb-1.5',
            '**:data-[dactylo-heading-block-level=6]:text-base',
            '**:data-[dactylo-heading-block-level=6]:font-semibold',
            '**:data-[dactylo-heading-block-level=6]:tracking-tight',

            // divider block
            '**:[[dactylo-divider-block]]:flex **:[[dactylo-divider-block]]:w-full **:[[dactylo-divider-block]]:flex-col',
            '[&_[dactylo-divider-block]_[dactylo-block-content]]:flex [&_[dactylo-divider-block]_[dactylo-block-content]]:flex-col',
            '[&_[dactylo-divider-block]_[dactylo-block-content]]:items-center [&_[dactylo-divider-block]_[dactylo-block-content]]:justify-center',
            '[&_[dactylo-divider-block]_[dactylo-block-content]]:py-2',
            '**:[[dactylo-divider-separator]]:bg-border',
            '**:[[dactylo-divider-separator]]:shrink-0',
            '**:[[dactylo-divider-separator]]:h-px',
            '**:[[dactylo-divider-separator]]:w-full',

            // link node
            '[&_[dactylo-node][dactylo-link-node][data-dactylo-link-clickable=true]]:cursor-pointer',
            '[&_[dactylo-node][dactylo-link-node][data-dactylo-link-clickable=false]]:cursor-default',
            '[&_[dactylo-node][dactylo-link-node]]:text-cyan-500',
            '[&_[dactylo-node][dactylo-link-node]]:underline',
            '[&_[dactylo-node][dactylo-link-node]]:decoration-cyan-500',
            '[&_[dactylo-node][dactylo-link-node]]:underline-offset-2',
            '[&_[dactylo-node][dactylo-link-node]]:hover:text-cyan-400',
            '[&_[dactylo-node][dactylo-link-node]]:hover:decoration-cyan-400',

            // marks
            '**:data-[dactylo-italic-mark=true]:italic',
            '**:data-[dactylo-bold-mark=true]:font-extrabold',
            '**:[&[data-dactylo-code-mark=true]:not([data-dactylo-editable-node-empty=true])]:p-0.5',
            '**:data-[dactylo-code-mark=true]:bg-muted',
            '**:data-[dactylo-code-mark=true]:rounded-sm',
            '**:data-[dactylo-code-mark=true]:font-mono',
            '**:data-[dactylo-code-mark=true]:text-sm',
            '**:data-[dactylo-code-mark=true]:text-red-600',
            '**:data-[dactylo-strikethrough-mark=true]:line-through',
            '**:data-[dactylo-underline-mark=true]:underline',
          )}
        />
      </Composer.Root>
    </div>
  )
}
