'use client'

import type { MarkKey } from '@sugardarius/dactylo'
import type {
  ComposerBulletListItemBlockProps,
  ComposerCheckboxListItemBlockProps,
  ComposerDividerBlockProps,
  ComposerHeadingBlockProps,
  ComposerLinkNodeProps,
  ComposerMentionNodeProps,
  ComposerNumberedListItemBlockProps,
  ComposerParagraphBlockProps,
  ComposerQuoteBlockProps,
  ComposerTextNodeProps,
} from '@sugardarius/dactylo/react'
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
  useMention,
  useNumberedLists,
  useParagraphs,
  useQuotes,
  useSetEditable,
} from '@sugardarius/dactylo/react'
import {
  BadgeCheck,
  Bold,
  ChevronDown,
  Code,
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
import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { Avatar, AvatarBadge, AvatarFallback } from '~/components/ui/avatar'
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
import { Popover, PopoverContent, PopoverTitle } from '~/components/ui/popover'
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

const USERS = [
  {
    fullName: 'Aurélien',
    id: 'aurelien@liveblocks.io',
    role: 'Product Engineer',
  },
  {
    fullName: 'Nimesh',
    id: 'nimesh@liveblocks.io',
    role: 'Product Engineer',
  },
  {
    fullName: 'Pierre',
    id: 'pierre@liveblocks.io',
    role: 'Design Engineer',
  },
  {
    fullName: 'Vincent',
    id: 'vincent@liveblocks.io',
    role: 'Product Engineer',
  },
  {
    fullName: 'Marc',
    id: 'marc@liveblocks.io',
    role: 'Design Engineer',
  },
  {
    fullName: 'Olivier',
    id: 'olivier@liveblocks.io',
    role: 'Product Engineer',
  },
  {
    fullName: 'Florent',
    id: 'florent@liveblocks.io',
    role: 'Product Engineer',
  },
  {
    fullName: 'Alicia',
    id: 'alicia@liveblocks.io',
    role: 'Head of People',
  },
  {
    fullName: 'Stacy',
    id: 'stacy@liveblocks.io',
    role: 'Head of Sales',
  },
  {
    fullName: 'Steven',
    id: 'steven@liveblocks.io',
    role: 'CEO',
  },
] as const

export function getInitials(fullName: string): string {
  const [first, ...rest] = fullName.split(' ').filter(Boolean)
  if (!first) {
    return '?'
  }
  const last = rest.at(-1)
  if (!last) {
    return first.slice(0, 2).toUpperCase()
  }
  return `${first[0]}${last[0]}`.toUpperCase()
}

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
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Advanced</DropdownMenuLabel>
                <DropdownMenuItem disabled>
                  <Code className='size-3.5' />
                  Code
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

const editableBlockContentClassName = cn(
  '[&_[dactylo-block-content][data-dactylo-block-content-editable=true]]:caret-cyan-500',
  `[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:[content:attr(dactylo-block-placeholder)/'']`,
  '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:pointer-events-none',
  '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:max-w-full',
  '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:min-h-[1em]',
  '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:p-0',
  '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:text-muted-foreground',
  '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:whitespace-break-spaces',
  '[&_[dactylo-block-content][data-dactylo-block-content-editable=true][data-empty=true][data-active=true]]:after:wrap-break-word',
)

const markClassName = cn(
  'data-[dactylo-italic-mark=true]:italic',
  'data-[dactylo-bold-mark=true]:font-extrabold',
  '[&[data-dactylo-code-mark=true]:not([data-dactylo-editable-node-empty=true])]:p-0.5',
  'data-[dactylo-code-mark=true]:bg-muted',
  'data-[dactylo-code-mark=true]:rounded-sm',
  'data-[dactylo-code-mark=true]:font-mono',
  'data-[dactylo-code-mark=true]:text-sm',
  'data-[dactylo-code-mark=true]:text-red-600',
  'data-[dactylo-strikethrough-mark=true]:line-through',
  'data-[dactylo-underline-mark=true]:underline',
)

export function ParagraphBlock(props: ComposerParagraphBlockProps) {
  return (
    <Composer.ParagraphBlock
      {...props}
      className={cn('flex flex-col px-1.5', editableBlockContentClassName)}
    />
  )
}

export function QuoteBlock(props: ComposerQuoteBlockProps) {
  return (
    <Composer.QuoteBlock
      {...props}
      className={cn(
        'flex flex-row items-stretch gap-2 px-1.5',
        '**:[[dactylo-quote-block-marker]]:flex',
        '**:[[dactylo-quote-block-marker]]:shrink-0',
        '**:[[dactylo-quote-block-marker]]:items-stretch',
        '**:[[dactylo-quote-block-marker-border]]:w-0.5',
        '**:[[dactylo-quote-block-marker-border]]:self-stretch',
        '**:[[dactylo-quote-block-marker-border]]:rounded-full',
        '**:[[dactylo-quote-block-marker-border]]:bg-border',
        '**:[[dactylo-block-content]]:min-w-0',
        '**:[[dactylo-block-content]]:flex-1',
        '**:[[dactylo-block-content]]:text-muted-foreground',
        editableBlockContentClassName,
      )}
    />
  )
}

export function HeadingBlock(props: ComposerHeadingBlockProps) {
  return (
    <Composer.HeadingBlock
      {...props}
      className={cn(
        'flex flex-col px-1.5',
        'data-[dactylo-heading-block-level=1]:pt-7.5 data-[dactylo-heading-block-level=1]:pb-1.5',
        'data-[dactylo-heading-block-level=1]:text-5xl',
        'data-[dactylo-heading-block-level=1]:font-semibold',
        'data-[dactylo-heading-block-level=1]:tracking-tight',
        'data-[dactylo-heading-block-level=2]:pt-6.5 data-[dactylo-heading-block-level=2]:pb-1.5',
        'data-[dactylo-heading-block-level=2]:text-3xl',
        'data-[dactylo-heading-block-level=2]:font-semibold',
        'data-[dactylo-heading-block-level=2]:tracking-tight',
        'data-[dactylo-heading-block-level=3]:pt-5.5 data-[dactylo-heading-block-level=3]:pb-1.5',
        'data-[dactylo-heading-block-level=3]:text-2xl',
        'data-[dactylo-heading-block-level=3]:font-semibold',
        'data-[dactylo-heading-block-level=3]:tracking-tight',
        'data-[dactylo-heading-block-level=4]:pt-4.5 data-[dactylo-heading-block-level=4]:pb-1.5',
        'data-[dactylo-heading-block-level=4]:text-xl',
        'data-[dactylo-heading-block-level=4]:font-semibold',
        'data-[dactylo-heading-block-level=4]:tracking-tight',
        'data-[dactylo-heading-block-level=5]:pt-4 data-[dactylo-heading-block-level=5]:pb-1.5',
        'data-[dactylo-heading-block-level=5]:text-lg',
        'data-[dactylo-heading-block-level=5]:font-semibold',
        'data-[dactylo-heading-block-level=5]:tracking-tight',
        'data-[dactylo-heading-block-level=6]:pt-4 data-[dactylo-heading-block-level=6]:pb-1.5',
        'data-[dactylo-heading-block-level=6]:text-base',
        'data-[dactylo-heading-block-level=6]:font-semibold',
        'data-[dactylo-heading-block-level=6]:tracking-tight',
        editableBlockContentClassName,
      )}
    />
  )
}

export function BulletListItemBlock(props: ComposerBulletListItemBlockProps) {
  return (
    <Composer.BulletListItemBlock
      {...props}
      className={cn(
        'flex flex-row items-center gap-2 px-1.5',
        '**:[[dactylo-bullet-list-item-marker]]:flex',
        '**:[[dactylo-bullet-list-item-marker]]:flex-col',
        '**:[[dactylo-bullet-list-item-marker]]:justify-center',
        '**:[[dactylo-bullet-list-item-marker]]:items-center',
        '**:[[dactylo-bullet-list-item-marker]]:p-1.5',
        '**:[[dactylo-bullet-list-item-marker-dot]]:size-1.5',
        '**:[[dactylo-bullet-list-item-marker-dot]]:shrink-0',
        '**:[[dactylo-bullet-list-item-marker-dot]]:rounded-full',
        '**:[[dactylo-bullet-list-item-marker-dot]]:bg-current',
        '**:[[dactylo-block-content]]:min-w-0',
        '**:[[dactylo-block-content]]:flex-1',
        editableBlockContentClassName,
      )}
    />
  )
}

export function NumberedListItemBlock(
  props: ComposerNumberedListItemBlockProps,
) {
  return (
    <Composer.NumberedListItemBlock
      {...props}
      className={cn(
        'flex flex-row items-center gap-2 px-1.5',
        '**:[[dactylo-numbered-list-item-marker]]:flex',
        '**:[[dactylo-numbered-list-item-marker]]:flex-col',
        '**:[[dactylo-numbered-list-item-marker]]:justify-center',
        '**:[[dactylo-numbered-list-item-marker]]:items-center',
        '**:[[dactylo-numbered-list-item-marker]]:p-1',
        '**:[[dactylo-numbered-list-item-marker-index]]:shrink-0',
        '**:[[dactylo-numbered-list-item-marker-index]]:select-none',
        '**:[[dactylo-block-content]]:min-w-0',
        '**:[[dactylo-block-content]]:flex-1',
        editableBlockContentClassName,
      )}
    />
  )
}

export function CheckboxListItemBlock(
  props: ComposerCheckboxListItemBlockProps,
) {
  return (
    <Composer.CheckboxListItemBlock
      {...props}
      className={cn(
        'flex flex-row items-start gap-2 px-1.5',
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
        'data-[dactylo-checkbox-list-item-checked=true]:**:[[dactylo-checkbox-list-item-marker-input]]:bg-current',
        'data-[dactylo-checkbox-list-item-checked=true]:**:[[dactylo-block-content]]:text-muted-foreground',
        'data-[dactylo-checkbox-list-item-checked=true]:**:[[dactylo-block-content]]:line-through',
        '**:[[dactylo-block-content]]:min-w-0',
        '**:[[dactylo-block-content]]:flex-1',
        editableBlockContentClassName,
      )}
    />
  )
}

export function DividerBlock(props: ComposerDividerBlockProps) {
  return (
    <Composer.DividerBlock
      {...props}
      className={cn(
        'flex w-full flex-col',
        '**:[[dactylo-block-content]]:flex **:[[dactylo-block-content]]:flex-col',
        '**:[[dactylo-block-content]]:items-center **:[[dactylo-block-content]]:justify-center',
        '**:[[dactylo-block-content]]:py-2',
        '**:[[dactylo-divider-separator]]:bg-border',
        '**:[[dactylo-divider-separator]]:h-px',
        '**:[[dactylo-divider-separator]]:w-full',
        '**:[[dactylo-divider-separator]]:shrink-0',
      )}
    />
  )
}

export function TextNode(props: ComposerTextNodeProps) {
  return (
    <Composer.TextNode
      {...props}
      className={cn(
        markClassName,
        '**:[[dactylo-inline-query-node]]:bg-muted/90',
        '**:[[dactylo-inline-query-node]]:rounded-sm',
        '**:[[dactylo-inline-query-node]]:p-1',
      )}
    />
  )
}

export function LinkNode(props: ComposerLinkNodeProps) {
  return (
    <Composer.LinkNode
      {...props}
      className={cn(
        'text-cyan-500 underline decoration-cyan-500 underline-offset-2',
        'hover:text-cyan-400 hover:decoration-cyan-400',
        'data-[dactylo-link-clickable=true]:cursor-pointer',
        'data-[dactylo-link-clickable=false]:cursor-default',
        markClassName,
      )}
    />
  )
}

export function MentionNode(props: ComposerMentionNodeProps) {
  const { entity } = props.node
  return (
    <Composer.MentionNode
      {...props}
      className='bg-muted text-foreground inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-1.5 pl-1 text-xs font-medium'
    >
      <Avatar size='sm'>
        <AvatarFallback className='bg-violet-100 text-violet-800'>
          {getInitials(entity.data.fullName)}
        </AvatarFallback>
        <AvatarBadge className='bg-green-600 dark:bg-green-800' />
      </Avatar>
      <span className='text-foreground'>{entity.data.fullName}</span>
    </Composer.MentionNode>
  )
}

export function MentionSuggestions() {
  const { anchor, bufferedText, confirm, dismiss, isBuffering } = useMention()
  const query = (bufferedText ?? '').trim().toLowerCase()
  const suggestions =
    query === ''
      ? USERS
      : USERS.filter(
          (user) =>
            user.fullName.toLowerCase().includes(query) ||
            user.id.toLowerCase().includes(query),
        )

  const [activeIndex, setActiveIndex] = useState(0)
  const [highlightedQuery, setHighlightedQuery] = useState(query)

  if (highlightedQuery !== query) {
    setHighlightedQuery(query)
    setActiveIndex(0)
  }

  const open = isBuffering && anchor !== null

  const confirmPerson = (user: (typeof USERS)[number]) => {
    confirm({
      entity: {
        data: {
          email: user.id,
          fullName: user.fullName,
        },
        id: user.id,
      },
    })
  }

  useHotkeys(
    'enter',
    (event) => {
      event.preventDefault()
      const person = suggestions[activeIndex]
      if (!person) {
        return
      }
      confirmPerson(person)
    },
    {
      enableOnContentEditable: true,
      enabled: isBuffering,
      preventDefault: true,
    },
    [activeIndex, confirm, suggestions],
  )

  useHotkeys(
    'down',
    (event) => {
      event.preventDefault()
      if (suggestions.length === 0) {
        return
      }
      setActiveIndex((index) => (index + 1) % suggestions.length)
    },
    {
      enableOnContentEditable: true,
      enabled: isBuffering,
      preventDefault: true,
    },
    [suggestions],
  )

  useHotkeys(
    'up',
    (event) => {
      event.preventDefault()
      if (suggestions.length === 0) {
        return
      }
      setActiveIndex(
        (index) => (index - 1 + suggestions.length) % suggestions.length,
      )
    },
    {
      enableOnContentEditable: true,
      enabled: isBuffering,
      preventDefault: true,
    },
    [suggestions],
  )

  return (
    <Popover
      modal={false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isBuffering) {
          dismiss()
        }
      }}
      open={open}
    >
      <PopoverContent
        align='start'
        anchor={anchor}
        className='w-72 gap-0 p-1'
        finalFocus={false}
        initialFocus={false}
        side='bottom'
        sideOffset={6}
      >
        <PopoverTitle className='sr-only'>Mention suggestions</PopoverTitle>
        <p className='text-muted-foreground px-2 py-1 text-xs font-medium'>
          Coworkers
        </p>
        {suggestions.length === 0 ? (
          <p className='text-muted-foreground px-2 py-1.5 text-sm'>
            No coworkers found
          </p>
        ) : (
          <div className='flex flex-col' role='listbox'>
            {suggestions.map((person, index) => {
              const selected = index === activeIndex

              return (
                <button
                  aria-selected={selected}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-hidden',
                    'hover:bg-muted data-[selected=true]:bg-muted',
                  )}
                  data-selected={selected}
                  key={person.id}
                  onClick={() => confirmPerson(person)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  role='option'
                  type='button'
                >
                  <Avatar size='sm'>
                    <AvatarFallback className='bg-violet-100 text-violet-800'>
                      {getInitials(person.fullName)}
                    </AvatarFallback>
                    <AvatarBadge className='bg-green-600 dark:bg-green-800' />
                  </Avatar>
                  <span className='min-w-0 truncate'>{person.fullName}</span>
                  <span className='text-muted-foreground text-xs'>
                    {person.role}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
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
        paragraph={{ initialMetadata: { fontSize: '16px' } }}
        mentions={{ enabled: true }}
      >
        <Toolbar />
        <Composer.Editable
          autoFocus
          components={{
            BulletListItemBlock,
            CheckboxListItemBlock,
            DividerBlock,
            HeadingBlock,
            LinkNode,
            MentionNode,
            NumberedListItemBlock,
            ParagraphBlock,
            QuoteBlock,
            TextNode,
          }}
          className={cn(
            'selection:text-accent-foreground relative flex w-full flex-col px-6 py-2 whitespace-break-spaces selection:bg-cyan-500',
            '**:[[dactylo-blocks]]:flex **:[[dactylo-blocks]]:flex-col **:[[dactylo-blocks]]:gap-2',
          )}
        >
          <MentionSuggestions />
        </Composer.Editable>
      </Composer.Root>
    </div>
  )
}
