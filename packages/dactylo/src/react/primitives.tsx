'use client'

import { forwardRef, useMemo } from 'react'

import { Dactylo } from '../dactylo'
import { Orchestrator } from '../dom/orchestrator'
import { paintTextForDOM } from '../dom/text'
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
} from '../internals/constants'
import {
  ComposerProvider,
  useDocumentState,
  useIsFocused,
  useSelectionCommands,
  useEditorConfig,
  useEditableBlock,
  useComposerCommands,
  useEditable,
} from './composer'
import type { ComposerContext } from './composer'
import {
  COMPOSER_EDITABLE_NAME,
  COMPOSER_PARAGRAPH_BLOCK_NAME,
  COMPOSER_ROOT_NAME,
  COMPOSER_BLOCKS_NAME,
  COMPOSER_TEXT_NODE_NAME,
  COMPOSER_LINE_BREAK_NODE_NAME,
} from './internals/constants'
import {
  useIsMounted,
  useIsomorphicLayoutEffect,
  useStableCallback,
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
} from './types'

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
      /** DOM selection orchestrator. */
      orchestrator: new Orchestrator(),
    })

    if (!isMounted && clientOnly) {
      return null
    }

    return (
      <div
        {...props}
        ref={forwardedRef}
        {...{ [ROOT_ATTR_NAME]: '' }}
        aria-roledescription='composer'
      >
        <ComposerProvider value={ctx}>{children}</ComposerProvider>
      </div>
    )
  },
)
ComposerRoot.displayName = COMPOSER_ROOT_NAME

// --- Composer.Editable ─────────────────────────────────────────---

/** Adds a text node to the composer. */
const ComposerTextNode = forwardRef<HTMLSpanElement, ComposerTextNodeProps>(
  ({ node, ...props }, forwardedRef) => {
    const rendered = useMemo(() => paintTextForDOM(node.text), [node.text])

    return (
      <span
        {...props}
        ref={forwardedRef}
        {...{
          [NODE_ATTR_NAME]: '',
          [NODE_ID_DATA_NAME]: node.id,
          [TEXT_NODE_ATTR_NAME]: '',
        }}
        aria-roledescription='text-node'
        // @todo: handle marks
      >
        {rendered}
      </span>
    )
  },
)
ComposerTextNode.displayName = COMPOSER_TEXT_NODE_NAME

/** Adds a line break to the composer. */
export const ComposerLineBreakNode = forwardRef<
  HTMLBRElement,
  ComposerLineBreakNodeProps
>(({ node, ...props }, forwardedRef) => (
  <br
    {...props}
    ref={forwardedRef}
    {...{
      [NODE_ATTR_NAME]: '',
      [NODE_ID_DATA_NAME]: node.id,
      [LINE_BREAK_NODE_ATTR_NAME]: '',
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
      switch (node.__type) {
        case 'text': {
          items.push(<ComposerTextNode key={node.id} node={node} />)
          break
        }
        case 'line_break': {
          items.push(<ComposerLineBreakNode key={node.id} node={node} />)
          break
        }
        default: {
          break
        }
      }
    }

    return items
  }, [content])

  return children
}

/** Adds a paragraph block to the composer. */
const ComposerParagraphBlock = forwardRef<
  HTMLDivElement,
  ComposerParagraphBlockProps
>(({ block, ...props }, forwardedRef) => {
  const { paragraph } = useEditorConfig()
  const { canEdit, editableId, editableRef, withActiveCursor, isEmpty } =
    useEditableBlock(block.id)

  const content = useMemo(() => [...block.content], [block.content])

  const isActive = canEdit && withActiveCursor

  return (
    <div
      {...props}
      ref={forwardedRef}
      {...{
        [BLOCK_ATTR_NAME]: '',
        [BLOCK_ID_DATA_NAME]: block.id,
        [PARAGRAPH_BLOCK_ATTR_NAME]: '',
      }}
      data-active={isActive ?? undefined}
      aria-roledescription='paragraph-block'
    >
      <div
        ref={editableRef}
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
        tabIndex={canEdit ? 0 : undefined}
      >
        <ComposerInlineContent content={content} />
      </div>
    </div>
  )
})
ComposerParagraphBlock.displayName = COMPOSER_PARAGRAPH_BLOCK_NAME

/** Renders the composed blocks. */
const ComposerBlocks = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>((props, forwardedRef) => {
  const { blockOrderById, blocks } = useDocumentState()

  // @todo: add performance rendering optimization
  const children = useMemo(() => {
    const items = []

    for (const blockId of blockOrderById) {
      const block = blocks.get(blockId)
      if (!block) {
        /** Skip blocks that are not in the document. It should never happen. */
        continue
      }

      switch (block.__type) {
        case 'paragraph': {
          items.push(
            <ComposerParagraphBlock key={blockId} block={block} {...props} />,
          )
          break
        }
        default: {
          break
        }
      }
    }

    return items
  }, [blockOrderById, blocks, props])

  return (
    <div
      ref={forwardedRef}
      {...props}
      {...{ [BLOCKS_ATTR_NAME]: '' }}
      role='group'
      aria-roledescription='blocks'
    >
      {children}
    </div>
  )
})
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
    const { editableRef, canEdit } = useEditable()
    const mergedRefs = mergeRefs(forwardedRef, editableRef)

    const focused = useIsFocused()

    const { focus } = useSelectionCommands()
    const { sendKeydown } = useComposerCommands()

    const handleKeyDown = useStableCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.isDefaultPrevented()) {
          return
        }

        sendKeydown(event.nativeEvent)
      },
    )

    useIsomorphicLayoutEffect(() => {
      if (autoFocus && !focused && canEdit) {
        focus()
      }
    }, [autoFocus, canEdit, focused, focus])

    return (
      <div
        {...props}
        ref={mergedRefs}
        {...{ [EDITABLE_ATTR_NAME]: '' }}
        translate={translate}
        spellCheck={spellCheck}
        data-disabled={!canEdit || undefined}
        data-focused={focused || undefined}
        onKeyDown={handleKeyDown}
        role='group'
        aria-roledescription='editable'
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
  ComposerTextNode as TextNode,
  ComposerLineBreakNode as LineBreakNode,
}
