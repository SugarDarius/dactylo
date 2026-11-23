'use client'

import type { BlockId, MarkKey } from '@sugardarius/dactylo'
import type {
  ComposerBulletListItemBlockMarkerDotProps,
  ComposerBulletListItemBlockProps,
  ComposerCheckboxListItemBlockProps,
  ComposerCheckboxListItemCheckboxProps,
  ComposerDividerBlockProps,
  ComposerDividerBlockSeparatorProps,
  ComposerHeadingBlockProps,
  ComposerLinkNodeProps,
  ComposerMentionNodeProps,
  ComposerNumberedListItemBlockMarkerNumberingProps,
  ComposerNumberedListItemBlockProps,
  ComposerParagraphBlockProps,
  ComposerQuoteBlockMarkerBorderProps,
  ComposerQuoteBlockProps,
  ComposerTextNodeProps,
} from '@sugardarius/dactylo/react'
import {
  Composer,
  useBlocks,
  useBulletLists,
  useCanEdit,
  useCheckboxLists,
  useCommandTrigger,
  useCursorSelection,
  useDividers,
  useEditableListener,
  useEditorConfig,
  useHeadings,
  useHistory,
  useMark,
  useMarks,
  useMention,
  useMentionDidCreatedListener,
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
  UserRoundPlus,
} from 'lucide-react'
import { Fragment, useCallback, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { Avatar, AvatarBadge, AvatarFallback } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '~/components/ui/hover-card'
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
    fullName: 'Chris',
    id: 'chris@liveblocks.io',
    role: 'Developer Relations',
  },
  {
    fullName: 'Olivier',
    id: 'olivier@liveblocks.io',
    role: 'Product Engineer',
  },
  {
    fullName: 'Adrien',
    id: 'adrien@liveblocks.io',
    role: 'Head of Product',
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
  {
    fullName: 'Nico',
    id: 'nico@sfeir.com',
    role: 'Developer Advocate',
  },
] as const

function getInitials(fullName: string): string {
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

export function EditableListener() {
  useEditableListener(({ editable }) => {
    toast.add({
      title: `Editor is now ${editable ? 'editable' : 'read-only'}.`,
      type: 'info',
    })
  })

  return null
}

export function MentionDidCreatedListener() {
  useMentionDidCreatedListener(({ entity }) => {
    toast.add({
      title: `Mention created: ${entity.data.fullName}.`,
      type: 'info',
    })
  })

  return null
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

const COMMAND_GROUPS = ['Basic Blocks', 'Lists', 'Advanced'] as const

export type CommandItem = {
  disabled?: boolean
  extra?: string
  group: (typeof COMMAND_GROUPS)[number]
  icon: typeof Pilcrow
  id: string
  label: string
  run?: () => void
  search: string
}

function useInsertCommands(): CommandItem[] {
  const selection = useCursorSelection()

  const { mutate } = useBlocks()
  const { insert: insertParagraph, isEmpty: isParagraphEmpty } = useParagraphs()
  const { insert: insertHeading, isEmpty: isHeadingEmpty } = useHeadings()
  const { insert: insertDivider } = useDividers()
  const { insert: insertBulletListItem, isEmpty: isBulletListItemEmpty } =
    useBulletLists()
  const { insert: insertNumberedListItem, isEmpty: isNumberedListItemEmpty } =
    useNumberedLists()
  const { insert: insertCheckboxListItem, isEmpty: isCheckboxListItemEmpty } =
    useCheckboxLists()
  const { insert: insertQuote, isEmpty: isQuoteEmpty } = useQuotes()

  const insertOrMutate = useCallback(
    (
      isEmpty: (blockId: BlockId) => boolean,
      insertFn: () => void,
      mutateFn: (blockId: BlockId) => void,
    ): void => {
      if (selection !== null && isEmpty(selection.anchor.blockId)) {
        mutateFn(selection.anchor.blockId)
        return
      }

      insertFn()
    },
    [selection],
  )

  return [
    {
      group: 'Basic Blocks',
      icon: Pilcrow,
      id: 'paragraph',
      label: 'Paragraph',
      run: () =>
        insertOrMutate(
          isParagraphEmpty,
          () => insertParagraph(),
          (blockId) => mutate(blockId, { kind: 'to_paragraph' }),
        ),
      search: 'paragraph',
    },
    {
      group: 'Basic Blocks',
      icon: Quote,
      id: 'quote',
      label: 'Quote',
      run: () =>
        insertOrMutate(
          isQuoteEmpty,
          () => insertQuote(),
          (blockId) => mutate(blockId, { kind: 'to_quote' }),
        ),
      search: 'quote',
    },
    {
      group: 'Basic Blocks',
      icon: Heading1,
      id: 'heading-1',
      label: 'Heading 1',
      run: () =>
        insertOrMutate(
          isHeadingEmpty,
          () => insertHeading(1),
          (blockId) => mutate(blockId, { kind: 'to_heading', level: 1 }),
        ),
      search: 'heading 1',
    },
    {
      group: 'Basic Blocks',
      icon: Heading2,
      id: 'heading-2',
      label: 'Heading 2',
      run: () =>
        insertOrMutate(
          isHeadingEmpty,
          () => insertHeading(2),
          (blockId) => mutate(blockId, { kind: 'to_heading', level: 2 }),
        ),
      search: 'heading 2',
    },
    {
      group: 'Basic Blocks',
      icon: Heading3,
      id: 'heading-3',
      label: 'Heading 3',
      run: () =>
        insertOrMutate(
          isHeadingEmpty,
          () => insertHeading(3),
          (blockId) => mutate(blockId, { kind: 'to_heading', level: 3 }),
        ),
      search: 'heading 3',
    },
    {
      group: 'Basic Blocks',
      icon: Heading4,
      id: 'heading-4',
      label: 'Heading 4',
      run: () =>
        insertOrMutate(
          isHeadingEmpty,
          () => insertHeading(4),
          (blockId) => mutate(blockId, { kind: 'to_heading', level: 4 }),
        ),
      search: 'heading 4',
    },
    {
      group: 'Basic Blocks',
      icon: Heading5,
      id: 'heading-5',
      label: 'Heading 5',
      run: () =>
        insertOrMutate(
          isHeadingEmpty,
          () => insertHeading(5),
          (blockId) => mutate(blockId, { kind: 'to_heading', level: 5 }),
        ),
      search: 'heading 5',
    },
    {
      group: 'Basic Blocks',
      icon: Heading6,
      id: 'heading-6',
      label: 'Heading 6',
      run: () =>
        insertOrMutate(
          isHeadingEmpty,
          () => insertHeading(6),
          (blockId) => mutate(blockId, { kind: 'to_heading', level: 6 }),
        ),
      search: 'heading 6',
    },
    {
      group: 'Basic Blocks',
      icon: Minus,
      id: 'divider',
      label: 'Divider',
      run: () => insertDivider(),
      search: 'divider',
    },
    {
      group: 'Lists',
      icon: List,
      id: 'bullet-list',
      label: 'Bulleted List',
      run: () =>
        insertOrMutate(
          isBulletListItemEmpty,
          () => insertBulletListItem(),
          (blockId) => mutate(blockId, { kind: 'to_bullet_list_item' }),
        ),
      search: 'bulleted list',
    },
    {
      group: 'Lists',
      icon: ListOrdered,
      id: 'numbered-list',
      label: 'Numbered List',
      run: () =>
        insertOrMutate(
          isNumberedListItemEmpty,
          () => insertNumberedListItem(),
          (blockId) => mutate(blockId, { kind: 'to_numbered_list_item' }),
        ),
      search: 'numbered list',
    },
    {
      extra: '(alpha)',
      group: 'Lists',
      icon: ListOrdered,
      id: 'numbered-list-alpha',
      label: 'Numbered List',
      run: () =>
        insertOrMutate(
          isNumberedListItemEmpty,
          () => insertNumberedListItem({ variant: 'alpha' }),
          (blockId) =>
            mutate(blockId, {
              kind: 'to_numbered_list_item',
              variant: 'alpha',
            }),
        ),
      search: 'numbered list alpha',
    },
    {
      extra: '(roman)',
      group: 'Lists',
      icon: ListOrdered,
      id: 'numbered-list-roman',
      label: 'Numbered List',
      run: () =>
        insertOrMutate(
          isNumberedListItemEmpty,
          () => insertNumberedListItem({ variant: 'roman' }),
          (blockId) =>
            mutate(blockId, {
              kind: 'to_numbered_list_item',
              variant: 'roman',
            }),
        ),
      search: 'numbered list roman',
    },
    {
      group: 'Lists',
      icon: SquareCheck,
      id: 'checkbox-list',
      label: 'Checkbox List',
      run: () =>
        insertOrMutate(
          isCheckboxListItemEmpty,
          () => insertCheckboxListItem(),
          (blockId) =>
            mutate(blockId, {
              kind: 'to_checkbox_list_item',
            }),
        ),
      search: 'checkbox list',
    },
    {
      disabled: true,
      group: 'Advanced',
      icon: Code,
      id: 'code',
      label: 'Code',
      search: 'code',
    },
  ]
}

export function CommandMenuItems({
  commands,
  onSelect,
  selectedId,
}: {
  commands: CommandItem[]
  onSelect: (command: CommandItem) => void
  selectedId?: string
}) {
  return COMMAND_GROUPS.map((group, groupIndex) => {
    const items = commands.filter((command) => command.group === group)
    if (items.length === 0) {
      return null
    }

    const hasPreviousGroup = COMMAND_GROUPS.slice(0, groupIndex).some(
      (previousGroup) =>
        commands.some((command) => command.group === previousGroup),
    )

    return (
      <Fragment key={group}>
        {hasPreviousGroup ? <DropdownMenuSeparator /> : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{group}</DropdownMenuLabel>
          {items.map((command) => {
            const Icon = command.icon
            const selected = command.id === selectedId

            return (
              <DropdownMenuItem
                className={cn(selected && 'bg-muted')}
                disabled={command.disabled}
                key={command.id}
                onClick={() => onSelect(command)}
                onMouseDown={(event) => {
                  event.preventDefault()
                }}
              >
                <Icon className='size-3.5' />
                {command.label}
                {command.extra ? (
                  <>
                    {' '}
                    <span className='text-muted-foreground text-xs'>
                      {command.extra}
                    </span>
                  </>
                ) : null}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </Fragment>
    )
  })
}

export function Toolbar() {
  const canEdit = useCanEdit()
  const setEditable = useSetEditable()

  const { canUndo, canRedo, undo, redo } = useHistory()
  const commands = useInsertCommands()

  const { toggle } = useMarks()

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
              <CommandMenuItems
                commands={commands}
                onSelect={(command) => command.run?.()}
              />
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
  const { block } = props

  return (
    <Composer.ParagraphBlock
      {...props}
      className={cn('flex flex-col px-1.5', editableBlockContentClassName, {
        'text-base': block.metadata.fontSize === '16px',
      })}
    />
  )
}

export function QuoteBlockMarkerBorder(
  props: ComposerQuoteBlockMarkerBorderProps,
) {
  return <Separator {...props} orientation='vertical' className='w-0.5!' />
}

export function QuoteBlock(props: ComposerQuoteBlockProps) {
  return (
    <Composer.QuoteBlock
      {...props}
      components={{
        MarkerBorder: QuoteBlockMarkerBorder,
      }}
      className={cn(
        'flex flex-row items-stretch gap-2 px-1.5',
        '**:[[dactylo-quote-block-marker]]:flex',
        '**:[[dactylo-quote-block-marker]]:shrink-0',
        '**:[[dactylo-quote-block-marker]]:items-stretch',
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

export function BulletListItemBlockMarkerDot(
  props: ComposerBulletListItemBlockMarkerDotProps,
) {
  return (
    <div {...props} className='size-1.5 shrink-0 rounded-full bg-current' />
  )
}

export function BulletListItemBlock(props: ComposerBulletListItemBlockProps) {
  return (
    <Composer.BulletListItemBlock
      {...props}
      components={{
        MarkerDot: BulletListItemBlockMarkerDot,
      }}
      className={cn(
        'flex flex-row items-center gap-2 px-1.5',
        '**:[[dactylo-bullet-list-item-marker]]:flex',
        '**:[[dactylo-bullet-list-item-marker]]:flex-col',
        '**:[[dactylo-bullet-list-item-marker]]:justify-center',
        '**:[[dactylo-bullet-list-item-marker]]:items-center',
        '**:[[dactylo-bullet-list-item-marker]]:p-1.5',
        '**:[[dactylo-block-content]]:min-w-0',
        '**:[[dactylo-block-content]]:flex-1',
        editableBlockContentClassName,
      )}
    />
  )
}

export function NumberedListItemBlockMarkerNumbering({
  numbering,
  ...props
}: ComposerNumberedListItemBlockMarkerNumberingProps) {
  return (
    <div {...props} className='shrink-0 select-none'>
      {numbering}
    </div>
  )
}

export function NumberedListItemBlock(
  props: ComposerNumberedListItemBlockProps,
) {
  return (
    <Composer.NumberedListItemBlock
      {...props}
      components={{
        MarkerNumbering: NumberedListItemBlockMarkerNumbering,
      }}
      className={cn(
        'flex flex-row items-center gap-2 px-1.5',
        '**:[[dactylo-numbered-list-item-marker]]:flex',
        '**:[[dactylo-numbered-list-item-marker]]:flex-col',
        '**:[[dactylo-numbered-list-item-marker]]:justify-center',
        '**:[[dactylo-numbered-list-item-marker]]:items-center',
        '**:[[dactylo-numbered-list-item-marker]]:p-1',
        '**:[[dactylo-block-content]]:min-w-0',
        '**:[[dactylo-block-content]]:flex-1',
        editableBlockContentClassName,
      )}
    />
  )
}

export function CheckboxListItemCheckbox({
  disabled,
  checked,
  onCheckedChange,
  ...props
}: ComposerCheckboxListItemCheckboxProps) {
  return (
    <Checkbox
      {...props}
      className='size-4.5 cursor-pointer rounded-md'
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
    />
  )
}

export function CheckboxListItemBlock(
  props: ComposerCheckboxListItemBlockProps,
) {
  return (
    <Composer.CheckboxListItemBlock
      {...props}
      components={{
        Checkbox: CheckboxListItemCheckbox,
      }}
      className={cn(
        'flex flex-row items-center gap-2 px-1.5',
        '**:[[dactylo-checkbox-list-item-marker]]:flex',
        '**:[[dactylo-checkbox-list-item-marker]]:flex-col',
        '**:[[dactylo-checkbox-list-item-marker]]:justify-center',
        '**:[[dactylo-checkbox-list-item-marker]]:items-center',
        '**:[[dactylo-checkbox-list-item-marker]]:p-1.5',
        'data-[dactylo-checkbox-list-item-checked=true]:**:[[dactylo-block-content]]:text-muted-foreground',
        'data-[dactylo-checkbox-list-item-checked=true]:**:[[dactylo-block-content]]:line-through',
        'data-[dactylo-checkbox-list-item-checked=true]:**:[[dactylo-mention-node]]:line-through',
        '**:[[dactylo-block-content]]:min-w-0',
        '**:[[dactylo-block-content]]:flex-1',
        editableBlockContentClassName,
      )}
    />
  )
}

export function DividerBlockSeparator(
  props: ComposerDividerBlockSeparatorProps,
) {
  return <Separator {...props} className='shrink-0' />
}

export function DividerBlock(props: ComposerDividerBlockProps) {
  return (
    <Composer.DividerBlock
      {...props}
      components={{
        Separator: DividerBlockSeparator,
      }}
      className={cn(
        'flex w-full flex-col',
        '**:[[dactylo-block-content]]:flex **:[[dactylo-block-content]]:flex-col',
        '**:[[dactylo-block-content]]:items-center **:[[dactylo-block-content]]:justify-center',
        '**:[[dactylo-block-content]]:py-2',
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
  const { mentions } = useEditorConfig()
  const { entity } = props.node

  return (
    <HoverCard>
      <Composer.MentionNode
        {...props}
        className={cn(
          'bg-muted text-foreground font-sm relative inline-flex cursor-pointer items-center gap-1 rounded-sm border p-0.5 text-xs',
          'data-[selected=true]:selection:bg-transparent',
          'data-[selected=true]:selection:text-accent-foreground',
          'data-[selected=true]:after:[content:""]',
          'data-[selected=true]:after:absolute',
          'data-[selected=true]:after:-top-1.5',
          'data-[selected=true]:after:-left-1',
          'data-[selected=true]:after:-right-1',
          'data-[selected=true]:after:-bottom-1',
          'data-[selected=true]:after:bg-cyan-500/70',
        )}
      >
        <HoverCardTrigger>
          <span className='text-foreground'>
            {mentions.character}_{entity.data.fullName}
          </span>
        </HoverCardTrigger>
      </Composer.MentionNode>
      <HoverCardContent>
        <div className='font-semibold'>{entity.id}</div>
        <div className='text-muted-foreground mt-1 text-xs'>
          {entity.data.role}
        </div>
      </HoverCardContent>
    </HoverCard>
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
          role: user.role,
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
    <DropdownMenu
      modal={false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isBuffering) {
          dismiss()
        }
      }}
      open={open}
    >
      <DropdownMenuContent
        align='start'
        anchor={anchor}
        className='w-72'
        finalFocus={false}
        initialFocus={false}
        side='bottom'
        sideOffset={6}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Coworkers</DropdownMenuLabel>
          <DropdownMenuItem disabled>
            <UserRoundPlus className='size-4' />
            <span className='text-muted-foreground text-sm font-medium'>
              {bufferedText}&hellip;
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {suggestions.length === 0 ? (
            <DropdownMenuItem disabled>No coworkers found</DropdownMenuItem>
          ) : (
            suggestions.map((person, index) => {
              const selected = index === activeIndex

              return (
                <DropdownMenuItem
                  className={cn('gap-2', selected && 'bg-muted')}
                  key={person.id}
                  onClick={() => confirmPerson(person)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
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
                </DropdownMenuItem>
              )
            })
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CommandTriggerSuggestions() {
  const { commandTrigger } = useEditorConfig()
  const { anchor, bufferedText, confirm, dismiss, isBuffering } =
    useCommandTrigger()
  const commands = useInsertCommands()

  const query = (bufferedText ?? '').trim().toLowerCase()
  const suggestions =
    query === ''
      ? commands
      : commands.filter((command) => command.search.includes(query))
  const enabledSuggestions = suggestions.filter((command) => !command.disabled)

  const [activeIndex, setActiveIndex] = useState(0)
  const [highlightedQuery, setHighlightedQuery] = useState(query)

  if (highlightedQuery !== query) {
    setHighlightedQuery(query)
    setActiveIndex(0)
  }

  const open = isBuffering && anchor !== null
  const activeCommand = enabledSuggestions[activeIndex]

  const applyCommand = (command: CommandItem) => {
    if (command.disabled || !command.run) {
      return
    }
    if (!confirm()) {
      return
    }
    command.run()
  }

  useHotkeys(
    'enter',
    (event) => {
      event.preventDefault()
      if (!activeCommand) {
        return
      }
      applyCommand(activeCommand)
    },
    {
      enableOnContentEditable: true,
      enabled: isBuffering,
      preventDefault: true,
    },
    [activeCommand, confirm],
  )

  useHotkeys(
    'down',
    (event) => {
      event.preventDefault()
      if (enabledSuggestions.length === 0) {
        return
      }
      setActiveIndex((index) => (index + 1) % enabledSuggestions.length)
    },
    {
      enableOnContentEditable: true,
      enabled: isBuffering,
      preventDefault: true,
    },
    [enabledSuggestions],
  )

  useHotkeys(
    'up',
    (event) => {
      event.preventDefault()
      if (enabledSuggestions.length === 0) {
        return
      }
      setActiveIndex(
        (index) =>
          (index - 1 + enabledSuggestions.length) % enabledSuggestions.length,
      )
    },
    {
      enableOnContentEditable: true,
      enabled: isBuffering,
      preventDefault: true,
    },
    [enabledSuggestions],
  )

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isBuffering) {
          dismiss()
        }
      }}
      open={open}
    >
      <DropdownMenuContent
        align='start'
        anchor={anchor}
        className='w-48'
        finalFocus={false}
        initialFocus={false}
        side='bottom'
        sideOffset={6}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem disabled>
            <span className='text-muted-foreground text-sm font-medium'>
              {commandTrigger.character}
              {bufferedText}&hellip;
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {suggestions.length === 0 ? (
          <DropdownMenuItem disabled>No commands found</DropdownMenuItem>
        ) : (
          <CommandMenuItems
            commands={suggestions}
            onSelect={applyCommand}
            selectedId={activeCommand?.id}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
        commandTrigger={{ enabled: true }}
        initialContent={{
          blocks: [
            {
              content: [
                {
                  text: 'Welcome to Dactylo 🚀',
                  type: 'text',
                },
              ],
              level: 1,
              type: 'heading',
            },
            {
              type: 'divider',
            },
            {
              content: [
                {
                  text: 'Type ',
                  type: 'text',
                },
                {
                  marks: { code: true },
                  text: '/',
                  type: 'text',
                },
                {
                  text: ' to open the command menu and discover blocks, formatting, and hidden features.',
                  type: 'text',
                },
              ],
              type: 'paragraph',
            },
            {
              content: [{ text: 'Make it yours', type: 'text' }],
              level: 3,
              type: 'heading',
            },
            {
              content: [
                {
                  text: '',
                  type: 'text',
                },
              ],
              type: 'paragraph',
            },
          ],
        }}
      >
        <Toolbar />
        <EditableListener />
        <MentionDidCreatedListener />
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
          <CommandTriggerSuggestions />
        </Composer.Editable>
      </Composer.Root>
    </div>
  )
}
