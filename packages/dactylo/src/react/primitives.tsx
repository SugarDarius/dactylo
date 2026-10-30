'use client'

import {
  forwardRef,
  memo,
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
} from 'react'

import { Dactylo } from '../dactylo'
import { warnOnce } from '../internals/console'
import {
  BLOCKS_ATTR_NAME,
  BLOCK_CONTENT_EDITABLE_DATA_NAME,
  EDITABLE_ATTR_NAME,
  PARAGRAPH_BLOCK_ATTR_NAME,
  BLOCK_PLACEHOLDER_ATTR_NAME,
  ROOT_ATTR_NAME,
  TEXT_NODE_ATTR_NAME,
  LINE_BREAK_NODE_ATTR_NAME,
  BLOCK_ID_DATA_NAME,
  BLOCK_CONTENT_ATTR_NAME,
  NODE_ID_DATA_NAME,
  NODE_ATTR_NAME,
  BLOCK_ATTR_NAME,
  LINK_NODE_ATTR_NAME,
  DIVIDER_BLOCK_ATTR_NAME,
  DIVIDER_SEPARATOR_ATTR_NAME,
  HEADING_BLOCK_ATTR_NAME,
  HEADING_BLOCK_LEVEL_DATA_NAME,
  BLOCK_INDEX_DATA_NAME,
} from '../internals/constants'
import { assertNever } from '../internals/utils'
import {
  ComposerProvider,
  useSelectionCommands,
  useEditorConfig,
  useEditableBlock,
  useEditable,
  useEditableNode,
  useBlock,
  useBlockOrderById,
} from './composer'
import type { ComposerContext } from './composer'
import {
  COMPOSER_EDITABLE_NAME,
  COMPOSER_PARAGRAPH_BLOCK_NAME,
  COMPOSER_ROOT_NAME,
  COMPOSER_BLOCKS_NAME,
  COMPOSER_TEXT_NODE_NAME,
  COMPOSER_LINE_BREAK_NODE_NAME,
  COMPOSER_LINK_NODE_NAME,
  COMPOSER_BLOCK_NAME,
  COMPOSER_DIVIDER_BLOCK_NAME,
  COMPOSER_HEADING_BLOCK_NAME,
  COMPOSER_HEADING_NAME,
} from './internals/constants'
import {
  useIsMounted,
  useIsomorphicLayoutEffect,
  useStableValue,
} from './internals/hooks'
import { mergeRefs } from './internals/utils'
import type {
  ComposerRootProps,
  ComposerEditableProps,
  ComposerParagraphBlockProps,
  ComposerTextNodeProps,
  ComposerInlineContentProps,
  ComposerLineBreakNodeProps,
  ComposerLinkNodeProps,
  ComposerBlockProps,
  ComposerDividerBlockProps,
  ComposerHeadingBlockProps,
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
      editable = true,
      debug = false,
      placeholder,
      config,
      ...props
    },
    forwardedRef,
  ) => {
    const isMounted = useIsMounted()
    const ctx = useStableValue<ComposerContext>({
      /** Dactylo editor instance. */
      editor: new Dactylo({ config, debug, editable, placeholder }),
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
      >
        <ComposerProvider value={ctx}>{children}</ComposerProvider>
      </div>
    )
  },
)
ComposerRoot.displayName = COMPOSER_ROOT_NAME

// --- Composer.Editable ─────────────────────────────────────────---

/** Adds a {@link TextNode} to the composer. */
const ComposerTextNode = forwardRef<HTMLSpanElement, ComposerTextNodeProps>(
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
        {renderedText}
      </span>
    )
  },
)
ComposerTextNode.displayName = COMPOSER_TEXT_NODE_NAME

/** Adds a {@link LinkNode} to the composer. */
const ComposerLinkNode = forwardRef<HTMLAnchorElement, ComposerLinkNodeProps>(
  ({ node, ...props }, forwardedRef) => {
    const { renderedText, nodeAttributes } = useEditableNode(node)
    return (
      <a
        {...props}
        ref={forwardedRef}
        {...{
          [LINK_NODE_ATTR_NAME]: '',
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
)
ComposerLinkNode.displayName = COMPOSER_LINK_NODE_NAME

/** Adds a {@link LineBreakNode} to the composer. */
export const ComposerLineBreakNode = forwardRef<
  HTMLBRElement,
  ComposerLineBreakNodeProps
>(({ node, ...props }, forwardedRef) => (
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
))
ComposerLineBreakNode.displayName = COMPOSER_LINE_BREAK_NODE_NAME

/** Adds inline content for a block to the composer. */
const ComposerInlineContent = ({ content }: ComposerInlineContentProps) => {
  // @todo: add performance rendering optimization
  const children = useMemo(() => {
    const items = []

    for (const node of content) {
      const type = node.__type
      switch (type) {
        case 'text': {
          items.push(<ComposerTextNode key={node.id} node={node} />)
          break
        }
        case 'link': {
          items.push(<ComposerLinkNode key={node.id} node={node} />)
          break
        }
        case 'line_break': {
          items.push(<ComposerLineBreakNode key={node.id} node={node} />)
          break
        }
        default: {
          warnOnce(`Skipping rendering for unsupported node type: ${type}.`)
        }
      }
    }

    return items
  }, [content])

  return children
}

/** Adds a {@link ParagraphBlock} to the composer. */
const ComposerParagraphBlock = forwardRef<
  HTMLDivElement,
  ComposerParagraphBlockProps
>(({ block, indexOfRendering, ...props }, forwardedRef) => {
  const { paragraph } = useEditorConfig()
  const { canEdit, editableId, withActiveSelection, isEmpty } =
    useEditableBlock(block.id)

  const content = useMemo(() => [...block.content], [block.content])
  const isActive = canEdit && withActiveSelection

  return (
    <div
      {...props}
      ref={forwardedRef}
      {...{
        [BLOCK_ATTR_NAME]: '',
        [BLOCK_ID_DATA_NAME]: block.id,
        [BLOCK_INDEX_DATA_NAME]: indexOfRendering.toString(),
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
          [BLOCK_PLACEHOLDER_ATTR_NAME]: paragraph.placeholder,
        }}
        style={{ ...EDITABLE_OUTLINE_STYLE }}
      >
        <ComposerInlineContent content={content} />
      </div>
    </div>
  )
})
ComposerParagraphBlock.displayName = COMPOSER_PARAGRAPH_BLOCK_NAME

/** Adds a {@link HeadingBlock} to the composer. */
const ComposerHeadingOne = forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>((props, forwardedRef) => <h1 {...props} ref={forwardedRef} />)
ComposerHeadingOne.displayName = COMPOSER_HEADING_NAME(1)

const ComposerHeadingTwo = forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>((props, forwardedRef) => <h2 {...props} ref={forwardedRef} />)
ComposerHeadingTwo.displayName = COMPOSER_HEADING_NAME(2)

const ComposerHeadingThree = forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>((props, forwardedRef) => <h3 {...props} ref={forwardedRef} />)
ComposerHeadingThree.displayName = COMPOSER_HEADING_NAME(3)

const ComposerHeadingFour = forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>((props, forwardedRef) => <h4 {...props} ref={forwardedRef} />)
ComposerHeadingFour.displayName = COMPOSER_HEADING_NAME(4)

const ComposerHeadingFive = forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>((props, forwardedRef) => <h5 {...props} ref={forwardedRef} />)
ComposerHeadingFive.displayName = COMPOSER_HEADING_NAME(5)

const ComposerHeadingSix = forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>((props, forwardedRef) => <h6 {...props} ref={forwardedRef} />)
ComposerHeadingSix.displayName = COMPOSER_HEADING_NAME(6)

const ComposerHeadingBlock = forwardRef<
  HTMLDivElement,
  ComposerHeadingBlockProps
>(({ block, indexOfRendering, ...props }, forwardedRef) => {
  const { heading } = useEditorConfig()
  const { canEdit, editableId, withActiveSelection, isEmpty } =
    useEditableBlock(block.id)

  const Comp = useMemo(() => {
    const { level } = block
    switch (level) {
      case 1: {
        return ComposerHeadingOne
      }
      case 2: {
        return ComposerHeadingTwo
      }
      case 3: {
        return ComposerHeadingThree
      }
      case 4: {
        return ComposerHeadingFour
      }
      case 5: {
        return ComposerHeadingFive
      }
      case 6: {
        return ComposerHeadingSix
      }
      default: {
        assertNever(level, { hint: 'react/primitives/ComposerHeadingBlock' })
      }
    }
  }, [block])

  const placeholder = useMemo(
    () => heading.placeholder.replace('%level%', block.level.toString()),
    [block.level, heading.placeholder],
  )
  const content = useMemo(() => [...block.content], [block.content])

  const isActive = canEdit && withActiveSelection

  return (
    <div
      {...props}
      ref={forwardedRef}
      {...{
        [BLOCK_ATTR_NAME]: '',
        [BLOCK_ID_DATA_NAME]: block.id,
        [BLOCK_INDEX_DATA_NAME]: indexOfRendering.toString(),
        [HEADING_BLOCK_ATTR_NAME]: '',
        [HEADING_BLOCK_LEVEL_DATA_NAME]: block.level.toString(),
      }}
      data-active={isActive ?? undefined}
      aria-roledescription='heading-block'
    >
      <Comp
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
        <ComposerInlineContent content={content} />
      </Comp>
    </div>
  )
})
ComposerHeadingBlock.displayName = COMPOSER_HEADING_BLOCK_NAME

/** Adds a {@link DividerBlock} to the composer. */
const ComposerDividerBlock = forwardRef<
  HTMLDivElement,
  ComposerDividerBlockProps
>(({ block, indexOfRendering, ...props }, forwardedRef) => (
  <div
    {...props}
    ref={forwardedRef}
    {...{
      [BLOCK_ATTR_NAME]: '',
      [BLOCK_ID_DATA_NAME]: block.id,
      [BLOCK_INDEX_DATA_NAME]: indexOfRendering.toString(),
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
const ComposerBlock = memo<ComposerBlockProps>(({ blockId, ...props }) => {
  const block = useBlock(blockId)
  const rendered = useMemo(() => {
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
        return (
          <ComposerParagraphBlock key={block.id} {...props} block={block} />
        )
      }
      case 'heading': {
        return <ComposerHeadingBlock key={block.id} {...props} block={block} />
      }
      case 'divider': {
        return <ComposerDividerBlock key={block.id} {...props} block={block} />
      }
      default: {
        warnOnce(`Skipping rendering for unsupported block type: ${type}.`)
        return null
      }
    }
  }, [block, props])

  return rendered
})
ComposerBlock.displayName = COMPOSER_BLOCK_NAME

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
            <ComposerBlock
              key={blockId}
              blockId={blockId}
              indexOfRendering={index}
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
    { children, autoFocus, translate = 'no', spellCheck = 'true', ...props },
    forwardedRef,
  ) => {
    const didAutoFocusRef = useRef(false)

    const { editableRef, canEdit, focused } = useEditable()
    const mergedRefs = mergeRefs(forwardedRef, editableRef)

    const { focus } = useSelectionCommands()

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
    )
  },
)
ComposerEditable.displayName = COMPOSER_EDITABLE_NAME

export {
  ComposerRoot as Root,
  ComposerEditable as Editable,
  ComposerParagraphBlock as ParagraphBlock,
  ComposerHeadingBlock as HeadingBlock,
  ComposerDividerBlock as DividerBlock,
  ComposerTextNode as TextNode,
  ComposerLinkNode as LinkNode,
}
