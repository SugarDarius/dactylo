import { forwardRef, memo, useDebugValue, useEffect, useRef } from 'react'

import { Dactylo } from '../dactylo'
import type { HeadingBlock } from '../internals/blocks'
import { warnOnce } from '../internals/console'
import {
  BLOCK_ATTR_NAME,
  BLOCK_CONTENT_ATTR_NAME,
  BLOCK_CONTENT_EDITABLE_DATA_NAME,
  BLOCK_ID_DATA_NAME,
  BLOCK_INDEX_DATA_NAME,
  BLOCK_PLACEHOLDER_ATTR_NAME,
  BLOCKS_ATTR_NAME,
  BULLET_LIST_ITEM_BLOCK_ATTR_NAME,
  BULLET_LIST_ITEM_MARKER_ATTR_NAME,
  BULLET_LIST_ITEM_MARKER_DOT_ATTR_NAME,
  CHECKBOX_LIST_ITEM_BLOCK_ATTR_NAME,
  CHECKBOX_LIST_ITEM_CHECKED_DATA_NAME,
  CHECKBOX_LIST_ITEM_MARKER_ATTR_NAME,
  CHECKBOX_LIST_ITEM_MARKER_INPUT_ATTR_NAME,
  DIVIDER_BLOCK_ATTR_NAME,
  DIVIDER_SEPARATOR_ATTR_NAME,
  EDITABLE_ATTR_NAME,
  HEADING_BLOCK_ATTR_NAME,
  HEADING_BLOCK_LEVEL_DATA_NAME,
  HEADING_LEVEL_REPLACER,
  INLINE_QUERY_NODE_ATTR_NAME,
  LINE_BREAK_NODE_ATTR_NAME,
  LINK_NODE_ATTR_NAME,
  LINK_NODE_CLICKABLE_ATTR_NAME,
  MENTION_NODE_ATTR_NAME,
  MENTION_NODE_ENTITY_ID_DATA_NAME,
  MENTION_QUERY_DATA_NAME,
  NODE_ATTR_NAME,
  NODE_ID_DATA_NAME,
  NUMBERED_LIST_ITEM_BLOCK_ATTR_NAME,
  NUMBERED_LIST_ITEM_MARKER_ATTR_NAME,
  NUMBERED_LIST_ITEM_MARKER_INDEX_ATTR_NAME,
  NUMBERED_LIST_ITEM_VARIANT_DATA_NAME,
  PARAGRAPH_BLOCK_ATTR_NAME,
  QUOTE_BLOCK_ATTR_NAME,
  QUOTE_BLOCK_MARKER_ATTR_NAME,
  QUOTE_BLOCK_MARKER_BORDER_ATTR_NAME,
  ROOT_ATTR_NAME,
  TEXT_NODE_ATTR_NAME,
} from '../internals/constants'
import { paintTextForDOM } from '../internals/dom'
import {
  ComposerEditableProvider,
  ComposerProvider,
  createAnchorElementStore,
  useBlock,
  useBlockOrderById,
  useCheckboxLists,
  useComposer,
  useComposerEditable,
  useEditable,
  useEditableBlock,
  useEditableNode,
  useEditorConfig,
  useFocus,
  useMentionBufferedText,
  useMentionPointer,
} from './composer'
import {
  COMPOSER_BLOCKS_NAME,
  COMPOSER_BULLET_LIST_ITEM_BLOCK_NAME,
  COMPOSER_CHECKBOX_LIST_ITEM_BLOCK_NAME,
  COMPOSER_DIVIDER_BLOCK_NAME,
  COMPOSER_EDITABLE_NAME,
  COMPOSER_HEADING_BLOCK_NAME,
  COMPOSER_HEADING_LEVELS,
  COMPOSER_HEADING_NAME,
  COMPOSER_HEADING_TAGS,
  COMPOSER_INLINE_QUERY_NODE_NAME,
  COMPOSER_LINE_BREAK_NODE_NAME,
  COMPOSER_LINK_NODE_NAME,
  COMPOSER_MENTION_NODE_NAME,
  COMPOSER_NUMBERED_LIST_ITEM_BLOCK_NAME,
  COMPOSER_PARAGRAPH_BLOCK_NAME,
  COMPOSER_QUOTE_BLOCK_NAME,
  COMPOSER_ROOT_NAME,
  COMPOSER_SLOT_BLOCK_NAME,
  COMPOSER_SLOT_INLINE_CONTENT_NAME,
  COMPOSER_TEXT_NODE_NAME,
} from './internals/constants'
import {
  useIsMounted,
  useIsomorphicLayoutEffect,
  useStableCallback,
  useStableValue,
} from './internals/hooks'
import { mergeRefs } from './internals/utils'
import type {
  ComposerBulletListItemBlockProps,
  ComposerCheckboxListItemBlockProps,
  ComposerContext,
  ComposerDividerBlockProps,
  ComposerEditableContext,
  ComposerEditableProps,
  ComposerHeadingBlockProps,
  ComposerInlineQueryNodeProps,
  ComposerLineBreakNodeProps,
  ComposerLinkNodeProps,
  ComposerMentionNodeProps,
  ComposerNumberedListItemBlockProps,
  ComposerParagraphBlockProps,
  ComposerQuoteBlockProps,
  ComposerRootProps,
  ComposerSlotBlockProps,
  ComposerSlotInlineContentProps,
  ComposerTextNodeProps,
} from './types'

/** Base style for the editable area of the composer. */
const EDITABLE_OUTLINE_STYLE: React.CSSProperties = {
  outlineStyle: 'none',
  outlineWidth: 0,
}

// --- Composer.Root ─────────────────────────────────────────-------

/**
 * Adds the root of the composers.
 * @example
 * ```tsx
 * import { Composer } from '@liveblocks/dactylo/react'
 *
 * <Composer.Root placeholder='Write something…'>
 *   {children}
 * </Composer.Root>
 * ```
 */
const ComposerRoot = forwardRef<HTMLDivElement, ComposerRootProps>(
  (
    {
      children,
      clientOnly = false,
      debug = false,
      editable = true,
      placeholder,
      locales,
      autolink,
      mentions,
      commandTrigger,
      paragraph,
      quote,
      heading,
      bulletedList,
      numberedList,
      checkboxList,
      link,
      pipeline,
      ...props
    },
    forwardedRef,
  ) => {
    const isMounted = useIsMounted()
    const ctx = useStableValue<ComposerContext>({
      /** Dactylo editor instance. */
      editor: new Dactylo({
        autolink,
        bulletedList,
        checkboxList,
        commandTrigger,
        debug,
        editable,
        heading,
        link,
        locales,
        mentions,
        numberedList,
        paragraph,
        pipeline,
        placeholder,
        quote,
      }),
      /** Inline mention query anchor element store. */
      ictqaes: createAnchorElementStore<HTMLSpanElement>(),
      /** Inline command trigger query anchor element store. */
      imqaes: createAnchorElementStore<HTMLSpanElement>(),
    })

    useDebugValue(ctx)

    if (!isMounted && clientOnly) {
      return null
    }

    return (
      <div
        {...props}
        ref={forwardedRef}
        {...{ [ROOT_ATTR_NAME]: '' }}
        aria-roledescription='root'
        style={{ position: 'relative' }}
      >
        <ComposerProvider value={ctx}>{children}</ComposerProvider>
      </div>
    )
  },
)
ComposerRoot.displayName = COMPOSER_ROOT_NAME

// --- Composer.Editable ─────────────────────────────────────────---

/**
 * Adds an inline query node to the composer.
 *
 * Renders the buffered text for a mention or command trigger query.
 * This component cannot be overridden with a custom component and is not exported as primitive
 * because it is an integral and internal part of `<Composer.TextNode />`.
 *
 * It can be customized though through attributes names:
 *  - `[dactylo-inline-query-node=""]`
 *  - `[data-dactylo-command-trigger-query="…"]`
 *  - `[data-dactylo-mention-query="…"]`
 */
const ComposerInlineQueryNode = memo<
  React.PropsWithChildren<ComposerInlineQueryNodeProps>
>(({ nodeId, text, children }) => {
  const { mentions } = useEditorConfig()
  const { imqaes } = useComposer()

  const mentionPointer = useMentionPointer()
  const mentionBufferedText = useMentionBufferedText()

  const isMentionBufferActive =
    mentionPointer !== null && mentionBufferedText !== null

  if (isMentionBufferActive && nodeId === mentionPointer.nodeId) {
    const from = mentionPointer.triggerOffset
    const to = from + mentions.character.length + mentionBufferedText.length

    return (
      <>
        {from > 0 ? paintTextForDOM(text.slice(0, from)) : null}
        <span
          ref={imqaes.setElement}
          {...{
            [INLINE_QUERY_NODE_ATTR_NAME]: '',
            [MENTION_QUERY_DATA_NAME]: mentionBufferedText,
          }}
          aria-roledescription='inline-query-node'
        >
          {paintTextForDOM(text.slice(from, to))}
        </span>
        {to < text.length ? paintTextForDOM(text.slice(to)) : null}
      </>
    )
  }

  // @todo: handle command trigger buffer

  return children
})
ComposerInlineQueryNode.displayName = COMPOSER_INLINE_QUERY_NODE_NAME

/** Adds a {@link TextNode} to the composer. */
const ComposerTextNode = memo(
  forwardRef<HTMLSpanElement, ComposerTextNodeProps>(
    ({ node, ...props }, forwardedRef) => {
      const { renderedText, nodeAttributes } = useEditableNode(node)

      return (
        <span
          {...props}
          ref={forwardedRef}
          {...{
            [NODE_ATTR_NAME]: '',
            [NODE_ID_DATA_NAME]: node.id,
            [TEXT_NODE_ATTR_NAME]: '',
            ...nodeAttributes,
          }}
          aria-roledescription='text-node'
        >
          <ComposerInlineQueryNode nodeId={node.id} text={node.text}>
            {renderedText}
          </ComposerInlineQueryNode>
        </span>
      )
    },
  ),
)
ComposerTextNode.displayName = COMPOSER_TEXT_NODE_NAME

/** Adds a {@link LinkNode} to the composer. */
const ComposerLinkNode = memo(
  forwardRef<HTMLAnchorElement, ComposerLinkNodeProps>(
    ({ node, ...props }, forwardedRef) => {
      const { link } = useEditorConfig()
      const { renderedText, nodeAttributes } = useEditableNode(node)

      return (
        <a
          target='_blank'
          rel='noopener noreferrer'
          {...props}
          ref={forwardedRef}
          {...{
            [LINK_NODE_ATTR_NAME]: '',
            [LINK_NODE_CLICKABLE_ATTR_NAME]: link.openOnClick
              ? 'true'
              : 'false',
            [NODE_ATTR_NAME]: '',
            [NODE_ID_DATA_NAME]: node.id,
            ...nodeAttributes,
          }}
          aria-roledescription='link-node'
          href={node.url.href}
          title={node.url.title}
        >
          {renderedText}
        </a>
      )
    },
  ),
)
ComposerLinkNode.displayName = COMPOSER_LINK_NODE_NAME

/** Adds a {@link LineBreakNode} to the composer. */
export const ComposerLineBreakNode = memo(
  forwardRef<HTMLBRElement, ComposerLineBreakNodeProps>(
    ({ node, ...props }, forwardedRef) => (
      <br
        {...props}
        ref={forwardedRef}
        {...{
          [LINE_BREAK_NODE_ATTR_NAME]: '',
          [NODE_ATTR_NAME]: '',
          [NODE_ID_DATA_NAME]: node.id,
        }}
        aria-roledescription='line-break-node'
      />
    ),
  ),
)
ComposerLineBreakNode.displayName = COMPOSER_LINE_BREAK_NODE_NAME

/** Adds a {@link MentionNode} to the composer. */
export const ComposerMentionNode = memo(
  forwardRef<HTMLSpanElement, ComposerMentionNodeProps>(
    ({ node, children, ...props }, forwardedRef) => {
      const { mentions } = useEditorConfig()

      return (
        <span
          {...props}
          ref={forwardedRef}
          contentEditable={false}
          {...{
            [MENTION_NODE_ATTR_NAME]: '',
            [MENTION_NODE_ENTITY_ID_DATA_NAME]: node.entity.id,
            [NODE_ATTR_NAME]: '',
            [NODE_ID_DATA_NAME]: node.id,
          }}
          aria-roledescription='mention-node'
        >
          {children ?? (
            <>
              {mentions.character}
              {node.entity.id}
            </>
          )}
        </span>
      )
    },
  ),
)
ComposerMentionNode.displayName = COMPOSER_MENTION_NODE_NAME

/** Adds a slot inline content component for a block with inline content to the composer. */
const ComposerSlotInlineContent = memo<ComposerSlotInlineContentProps>(
  ({ content }) => {
    const { components } = useComposerEditable()

    const TextNodeComp = components.TextNode ?? ComposerTextNode
    const LinkNodeComp = components.LinkNode ?? ComposerLinkNode
    const LineBreakNodeComp = components.LineBreakNode ?? ComposerLineBreakNode
    const MentionNodeComp = components.MentionNode ?? ComposerMentionNode

    const children = []

    for (const node of content) {
      const type = node.__type
      switch (type) {
        case 'text': {
          children.push(<TextNodeComp key={node.id} node={node} />)
          break
        }
        case 'link': {
          children.push(<LinkNodeComp key={node.id} node={node} />)
          break
        }
        case 'line_break': {
          children.push(<LineBreakNodeComp key={node.id} node={node} />)
          break
        }
        case 'mention': {
          children.push(<MentionNodeComp key={node.id} node={node} />)
          break
        }
        default: {
          warnOnce(`Skipping rendering for unsupported node type: ${type}.`)
        }
      }
    }

    return children
  },
)
ComposerSlotInlineContent.displayName = COMPOSER_SLOT_INLINE_CONTENT_NAME

/** Adds a {@link ParagraphBlock} to the composer. */
const ComposerParagraphBlock = forwardRef<
  HTMLDivElement,
  ComposerParagraphBlockProps
>(({ block, blockIndex, overrides, ...props }, forwardedRef) => {
  const { paragraph } = useEditorConfig()
  const { canEdit, editableId, isActive, isEmpty } = useEditableBlock(block)

  const placeholder = overrides?.placeholder ?? paragraph.placeholder

  return (
    <div
      {...props}
      ref={forwardedRef}
      {...{
        [BLOCK_ATTR_NAME]: '',
        [BLOCK_ID_DATA_NAME]: block.id,
        [BLOCK_INDEX_DATA_NAME]: blockIndex.toString(),
        [PARAGRAPH_BLOCK_ATTR_NAME]: '',
      }}
      data-active={isActive ?? undefined}
      aria-roledescription='paragraph-block'
    >
      <div
        id={editableId}
        role={canEdit ? 'textbox' : undefined}
        aria-roledescription='paragraph-block-editable'
        aria-multiline={canEdit ? 'true' : undefined}
        contentEditable={canEdit ? 'true' : undefined}
        suppressContentEditableWarning
        data-active={isActive ?? undefined}
        data-empty={isEmpty ?? undefined}
        {...{
          [BLOCK_CONTENT_ATTR_NAME]: '',
          [BLOCK_CONTENT_EDITABLE_DATA_NAME]: canEdit ? 'true' : 'false',
          [BLOCK_PLACEHOLDER_ATTR_NAME]: placeholder,
        }}
        style={{ ...EDITABLE_OUTLINE_STYLE }}
      >
        <ComposerSlotInlineContent content={block.content} />
      </div>
    </div>
  )
})
ComposerParagraphBlock.displayName = COMPOSER_PARAGRAPH_BLOCK_NAME

/** Adds a {@link QuoteBlock} to the composer. */
const ComposerQuoteBlock = forwardRef<HTMLDivElement, ComposerQuoteBlockProps>(
  ({ block, blockIndex, overrides, ...props }, forwardedRef) => {
    const { quote } = useEditorConfig()
    const { canEdit, editableId, isActive, isEmpty } = useEditableBlock(block)

    const placeholder = overrides?.placeholder ?? quote.placeholder

    return (
      <div
        {...props}
        ref={forwardedRef}
        {...{
          [BLOCK_ATTR_NAME]: '',
          [BLOCK_ID_DATA_NAME]: block.id,
          [BLOCK_INDEX_DATA_NAME]: blockIndex.toString(),
          [QUOTE_BLOCK_ATTR_NAME]: '',
        }}
        data-active={isActive ?? undefined}
        aria-roledescription='quote-block'
      >
        <div
          contentEditable={false}
          aria-roledescription='quote-block-marker'
          {...{ [QUOTE_BLOCK_MARKER_ATTR_NAME]: '' }}
        >
          <div
            aria-roledescription='quote-block-marker-border'
            {...{ [QUOTE_BLOCK_MARKER_BORDER_ATTR_NAME]: '' }}
          />
        </div>
        <div
          id={editableId}
          role={canEdit ? 'textbox' : undefined}
          aria-roledescription='quote-block-editable'
          aria-multiline={canEdit ? 'true' : undefined}
          contentEditable={canEdit ? 'true' : undefined}
          suppressContentEditableWarning
          data-active={isActive ?? undefined}
          data-empty={isEmpty ?? undefined}
          {...{
            [BLOCK_CONTENT_ATTR_NAME]: '',
            [BLOCK_CONTENT_EDITABLE_DATA_NAME]: canEdit ? 'true' : 'false',
            [BLOCK_PLACEHOLDER_ATTR_NAME]: placeholder,
          }}
          style={{ ...EDITABLE_OUTLINE_STYLE }}
        >
          <ComposerSlotInlineContent content={block.content} />
        </div>
      </div>
    )
  },
)
ComposerQuoteBlock.displayName = COMPOSER_QUOTE_BLOCK_NAME

/** Primitive heading components for the composer. */
const ComposerHeadingsPrimitive = COMPOSER_HEADING_LEVELS.reduce(
  (headings, level) => {
    const Heading = forwardRef<
      HTMLHeadingElement,
      React.HTMLAttributes<HTMLHeadingElement>
    >((props, forwardedRef) => {
      const Comp = COMPOSER_HEADING_TAGS[level]
      return <Comp {...props} ref={forwardedRef} />
    })
    Heading.displayName = COMPOSER_HEADING_NAME(level)
    headings[level] = Heading

    return headings
  },
  {} as Record<
    HeadingBlock['level'],
    React.ComponentType<React.HTMLAttributes<HTMLHeadingElement>>
  >,
)

/** Adds a {@link HeadingBlock} to the composer. */
const ComposerHeadingBlock = forwardRef<
  HTMLDivElement,
  ComposerHeadingBlockProps
>(({ block, blockIndex, overrides, ...props }, forwardedRef) => {
  const { heading } = useEditorConfig()
  const { canEdit, editableId, isActive, isEmpty } = useEditableBlock(block)

  const Heading = ComposerHeadingsPrimitive[block.level]
  const placeholder = (overrides?.placeholder ?? heading.placeholder).replace(
    HEADING_LEVEL_REPLACER,
    block.level.toString(),
  )

  return (
    <div
      {...props}
      ref={forwardedRef}
      {...{
        [BLOCK_ATTR_NAME]: '',
        [BLOCK_ID_DATA_NAME]: block.id,
        [BLOCK_INDEX_DATA_NAME]: blockIndex.toString(),
        [HEADING_BLOCK_ATTR_NAME]: '',
        [HEADING_BLOCK_LEVEL_DATA_NAME]: block.level.toString(),
      }}
      data-active={isActive ?? undefined}
      aria-roledescription='heading-block'
    >
      <Heading
        id={editableId}
        role={canEdit ? 'textbox' : undefined}
        aria-roledescription='heading-block-editable'
        aria-multiline={canEdit ? 'true' : undefined}
        contentEditable={canEdit ? 'true' : undefined}
        suppressContentEditableWarning
        data-active={isActive ?? undefined}
        data-empty={isEmpty ?? undefined}
        {...{
          [BLOCK_CONTENT_ATTR_NAME]: '',
          [BLOCK_CONTENT_EDITABLE_DATA_NAME]: canEdit ? 'true' : 'false',
          [BLOCK_PLACEHOLDER_ATTR_NAME]: placeholder,
        }}
        style={{ ...EDITABLE_OUTLINE_STYLE }}
      >
        <ComposerSlotInlineContent content={block.content} />
      </Heading>
    </div>
  )
})
ComposerHeadingBlock.displayName = COMPOSER_HEADING_BLOCK_NAME

/** Adds a {@link BulletListItemBlock} to the composer. */
const ComposerBulletListItemBlock = forwardRef<
  HTMLDivElement,
  ComposerBulletListItemBlockProps
>(({ block, blockIndex, overrides, ...props }, forwardedRef) => {
  const { bulletedList } = useEditorConfig()
  const { canEdit, editableId, isActive, isEmpty } = useEditableBlock(block)

  const placeholder = overrides?.placeholder ?? bulletedList.placeholder

  return (
    <div
      {...props}
      ref={forwardedRef}
      {...{
        [BLOCK_ATTR_NAME]: '',
        [BLOCK_ID_DATA_NAME]: block.id,
        [BLOCK_INDEX_DATA_NAME]: blockIndex.toString(),
        [BULLET_LIST_ITEM_BLOCK_ATTR_NAME]: '',
      }}
      data-active={isActive ?? undefined}
      aria-roledescription='bullet-list-item-block'
    >
      <div
        contentEditable={false}
        aria-roledescription='bullet-list-item-marker'
        {...{ [BULLET_LIST_ITEM_MARKER_ATTR_NAME]: '' }}
      >
        <div
          aria-roledescription='bullet-list-item-marker-dot'
          {...{ [BULLET_LIST_ITEM_MARKER_DOT_ATTR_NAME]: '' }}
        />
      </div>
      <div
        id={editableId}
        role={canEdit ? 'textbox' : undefined}
        aria-roledescription='bullet-list-item-block-editable'
        aria-multiline={canEdit ? 'true' : undefined}
        contentEditable={canEdit ? 'true' : undefined}
        suppressContentEditableWarning
        data-active={isActive ?? undefined}
        data-empty={isEmpty ?? undefined}
        {...{
          [BLOCK_CONTENT_ATTR_NAME]: '',
          [BLOCK_CONTENT_EDITABLE_DATA_NAME]: canEdit ? 'true' : 'false',
          [BLOCK_PLACEHOLDER_ATTR_NAME]: placeholder,
        }}
        style={{ ...EDITABLE_OUTLINE_STYLE }}
      >
        <ComposerSlotInlineContent content={block.content} />
      </div>
    </div>
  )
})
ComposerBulletListItemBlock.displayName = COMPOSER_BULLET_LIST_ITEM_BLOCK_NAME

/** Adds a {@link NumberedListItemBlock} to the composer. */
const ComposerNumberedListItemBlock = forwardRef<
  HTMLDivElement,
  ComposerNumberedListItemBlockProps
>(({ block, blockIndex, ...props }, forwardedRef) => {
  const { numberedList } = useEditorConfig()
  const { canEdit, editableId, isActive, isEmpty } = useEditableBlock(block)

  return (
    <div
      {...props}
      ref={forwardedRef}
      {...{
        [BLOCK_ATTR_NAME]: '',
        [BLOCK_ID_DATA_NAME]: block.id,
        [BLOCK_INDEX_DATA_NAME]: blockIndex.toString(),
        [NUMBERED_LIST_ITEM_BLOCK_ATTR_NAME]: '',
        [NUMBERED_LIST_ITEM_VARIANT_DATA_NAME]: block.variant,
      }}
      data-active={isActive ?? undefined}
      aria-roledescription='numbered-list-item-block'
    >
      <div
        contentEditable={false}
        aria-roledescription='numbered-list-item-marker'
        {...{ [NUMBERED_LIST_ITEM_MARKER_ATTR_NAME]: '' }}
      >
        <div
          aria-roledescription='numbered-list-item-marker-index'
          {...{ [NUMBERED_LIST_ITEM_MARKER_INDEX_ATTR_NAME]: '' }}
        >
          {block.markerNumbering}
        </div>
      </div>
      <div
        id={editableId}
        aria-roledescription='bullet-list-item-block-editable'
        aria-multiline={canEdit ? 'true' : undefined}
        contentEditable={canEdit ? 'true' : undefined}
        suppressContentEditableWarning
        data-active={isActive ?? undefined}
        data-empty={isEmpty ?? undefined}
        {...{
          [BLOCK_CONTENT_ATTR_NAME]: '',
          [BLOCK_CONTENT_EDITABLE_DATA_NAME]: canEdit ? 'true' : 'false',
          [BLOCK_PLACEHOLDER_ATTR_NAME]: numberedList.placeholder,
        }}
        style={{ ...EDITABLE_OUTLINE_STYLE }}
      >
        <ComposerSlotInlineContent content={block.content} />
      </div>
    </div>
  )
})
ComposerNumberedListItemBlock.displayName =
  COMPOSER_NUMBERED_LIST_ITEM_BLOCK_NAME

/** Adds a {@link CheckboxListItemBlock} to the composer. */
const ComposerCheckboxListItemBlock = forwardRef<
  HTMLDivElement,
  ComposerCheckboxListItemBlockProps
>(
  (
    { block, blockIndex, overrides, onCheckedChange, ...props },
    forwardedRef,
  ) => {
    const { checkboxList } = useEditorConfig()
    const { canEdit, editableId, isActive, isEmpty } = useEditableBlock(block)
    const { patch } = useCheckboxLists()

    const placeholder = overrides?.placeholder ?? checkboxList.placeholder

    const handleClick = useStableCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault()
        e.stopPropagation()

        const checked = !block.checked

        patch(block.id, { checked })
        onCheckedChange?.(checked)
      },
    )

    return (
      <div
        {...props}
        ref={forwardedRef}
        {...{
          [BLOCK_ATTR_NAME]: '',
          [BLOCK_ID_DATA_NAME]: block.id,
          [BLOCK_INDEX_DATA_NAME]: blockIndex.toString(),
          [CHECKBOX_LIST_ITEM_BLOCK_ATTR_NAME]: '',
          [CHECKBOX_LIST_ITEM_CHECKED_DATA_NAME]: block.checked.toString(),
        }}
        data-active={isActive ?? undefined}
        aria-roledescription='checkbox-list-item-block'
      >
        <div
          contentEditable={false}
          aria-roledescription='checkbox-list-item-marker'
          {...{ [CHECKBOX_LIST_ITEM_MARKER_ATTR_NAME]: '' }}
        >
          <button
            type='button'
            role='checkbox'
            disabled={!canEdit}
            onClick={handleClick}
            aria-checked={block.checked ? 'true' : 'false'}
            aria-roledescription='checkbox-list-item-marker-input'
            {...{ [CHECKBOX_LIST_ITEM_MARKER_INPUT_ATTR_NAME]: '' }}
          />
        </div>
        <div
          id={editableId}
          role={canEdit ? 'textbox' : undefined}
          aria-roledescription='checkbox-list-item-block-editable'
          aria-multiline={canEdit ? 'true' : undefined}
          contentEditable={canEdit ? 'true' : undefined}
          suppressContentEditableWarning
          data-active={isActive ?? undefined}
          data-empty={isEmpty ?? undefined}
          {...{
            [BLOCK_CONTENT_ATTR_NAME]: '',
            [BLOCK_CONTENT_EDITABLE_DATA_NAME]: canEdit ? 'true' : 'false',
            [BLOCK_PLACEHOLDER_ATTR_NAME]: placeholder,
          }}
          style={{ ...EDITABLE_OUTLINE_STYLE }}
        >
          <ComposerSlotInlineContent content={block.content} />
        </div>
      </div>
    )
  },
)
ComposerCheckboxListItemBlock.displayName =
  COMPOSER_CHECKBOX_LIST_ITEM_BLOCK_NAME

/** Adds a {@link DividerBlock} to the composer. */
const ComposerDividerBlock = forwardRef<
  HTMLDivElement,
  ComposerDividerBlockProps
>(({ block, blockIndex, ...props }, forwardedRef) => (
  <div
    {...props}
    ref={forwardedRef}
    contentEditable={false}
    {...{
      [BLOCK_ATTR_NAME]: '',
      [BLOCK_ID_DATA_NAME]: block.id,
      [BLOCK_INDEX_DATA_NAME]: blockIndex.toString(),
      [DIVIDER_BLOCK_ATTR_NAME]: '',
    }}
    aria-roledescription='divider-block'
  >
    <div
      aria-roledescription='divider-block-content'
      {...{ [BLOCK_CONTENT_ATTR_NAME]: '' }}
    >
      <div {...{ [DIVIDER_SEPARATOR_ATTR_NAME]: '' }} />
    </div>
  </div>
))
ComposerDividerBlock.displayName = COMPOSER_DIVIDER_BLOCK_NAME

/** Renders a block based on its type. */
const ComposerSlotBlock = memo<ComposerSlotBlockProps>(
  ({ blockId, ...props }) => {
    const { components } = useComposerEditable()
    const block = useBlock(blockId)

    const ParagraphBlockComp =
      components.ParagraphBlock ?? ComposerParagraphBlock
    const QuoteBlockComp = components.QuoteBlock ?? ComposerQuoteBlock
    const HeadingBlockComp = components.HeadingBlock ?? ComposerHeadingBlock
    const BulletListItemBlockComp =
      components.BulletListItemBlock ?? ComposerBulletListItemBlock
    const NumberedListItemBlockComp =
      components.NumberedListItemBlock ?? ComposerNumberedListItemBlock
    const CheckboxListItemBlockComp =
      components.CheckboxListItemBlock ?? ComposerCheckboxListItemBlock
    const DividerBlockComp = components.DividerBlock ?? ComposerDividerBlock

    /**
     * Skipping rendering for blocks that are not in the document state.
     * It should never happens because `blockOrderById` from {@link DocumentState}
     * is always n sync `blocks` after each inserts.
     *
     * 👉🏻 We don't throw an error because we don't want to break users' UI
     * to keep a seamless experience.
     */
    if (!block) {
      return null
    }

    const type = block.__type
    switch (type) {
      case 'paragraph': {
        return <ParagraphBlockComp key={block.id} {...props} block={block} />
      }
      case 'quote': {
        return <QuoteBlockComp key={block.id} {...props} block={block} />
      }
      case 'heading': {
        return <HeadingBlockComp key={block.id} {...props} block={block} />
      }
      case 'bullet_list_item': {
        return (
          <BulletListItemBlockComp key={block.id} {...props} block={block} />
        )
      }
      case 'numbered_list_item': {
        return (
          <NumberedListItemBlockComp key={block.id} {...props} block={block} />
        )
      }
      case 'checkbox_list_item': {
        return (
          <CheckboxListItemBlockComp key={block.id} {...props} block={block} />
        )
      }
      case 'divider': {
        return <DividerBlockComp key={block.id} {...props} block={block} />
      }
      default: {
        warnOnce(`Skipping rendering for unsupported block type: ${type}.`)
        return null
      }
    }
  },
)
ComposerSlotBlock.displayName = COMPOSER_SLOT_BLOCK_NAME

/** Renders the composed blocks. */
const ComposerBlocks = memo(
  forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    (props, forwardedRef) => {
      const blockOrderById = useBlockOrderById()

      return (
        <div
          ref={forwardedRef}
          {...props}
          {...{ [BLOCKS_ATTR_NAME]: '' }}
          role='group'
          aria-roledescription='blocks'
        >
          {blockOrderById.map((blockId, index) => (
            <ComposerSlotBlock
              key={blockId}
              blockId={blockId}
              blockIndex={index}
            />
          ))}
        </div>
      )
    },
  ),
)
ComposerBlocks.displayName = COMPOSER_BLOCKS_NAME

/**
 * Adds the editable area of the composer.
 * @example
 * ```tsx
 * import { Composer } from '@liveblocks/dactylo/react'
 *
 * <Composer.Root placeholder='Write something…'>
 *   <Composer.Editable autoFocus>
 *     {children}
 *   </Composer.Editable>
 * </Composer.Root>
 * ```
 */
const ComposerEditable = forwardRef<HTMLDivElement, ComposerEditableProps>(
  (
    {
      children,
      autoFocus,
      components,
      translate = 'no',
      spellCheck = 'true',
      ...props
    },
    forwardedRef,
  ) => {
    const ctx = useStableValue<ComposerEditableContext>({
      components: components ?? {},
    })

    const didAutoFocusRef = useRef(false)

    const { editableRef, canEdit, focused } = useEditable()
    const mergedRefs = mergeRefs(forwardedRef, editableRef)

    const { focus } = useFocus()

    useEffect(() => {
      if (!canEdit) {
        didAutoFocusRef.current = false
      }
    }, [canEdit])

    useIsomorphicLayoutEffect(() => {
      if (canEdit && autoFocus && !focused && !didAutoFocusRef.current) {
        didAutoFocusRef.current = true
        focus()
      }
    }, [autoFocus, canEdit, focused, focus])

    return (
      <ComposerEditableProvider value={ctx}>
        <div
          {...props}
          ref={mergedRefs}
          role='group'
          aria-roledescription='editable'
          contentEditable={canEdit ? 'true' : undefined}
          suppressContentEditableWarning
          translate={translate}
          spellCheck={spellCheck}
          data-disabled={!canEdit || undefined}
          data-focused={focused || undefined}
          {...{ [EDITABLE_ATTR_NAME]: '' }}
          tabIndex={canEdit ? 0 : undefined}
          style={{ ...EDITABLE_OUTLINE_STYLE }}
        >
          <ComposerBlocks translate={translate} spellCheck={spellCheck} />
          {children}
        </div>
      </ComposerEditableProvider>
    )
  },
)
ComposerEditable.displayName = COMPOSER_EDITABLE_NAME

export {
  ComposerBulletListItemBlock as BulletListItemBlock,
  ComposerCheckboxListItemBlock as CheckboxListItemBlock,
  ComposerEditable as Editable,
  ComposerDividerBlock as DividerBlock,
  ComposerHeadingBlock as HeadingBlock,
  ComposerLineBreakNode as LineBreakNode,
  ComposerLinkNode as LinkNode,
  ComposerMentionNode as MentionNode,
  ComposerNumberedListItemBlock as NumberedListItemBlock,
  ComposerParagraphBlock as ParagraphBlock,
  ComposerQuoteBlock as QuoteBlock,
  ComposerRoot as Root,
  ComposerTextNode as TextNode,
}
