'use client'

import { forwardRef, useMemo, useRef } from 'react'

import { Dactylo } from '../dactylo'
import {
  BLOCKS_ATTR_NAME,
  BLOCK_CONTENT_EDITABLE_ATTR_NAME,
  EDITABLE_ATTR_NAME,
  PARAGRAPH_BLOCK_ATTR_NAME,
  PARAGRAPH_BLOCK_CONTENT_ATTR_NAME,
  PARAGRAPH_BLOCK_ID_ATTR_NAME,
  BLOCK_PLACEHOLDER_ATTR_NAME,
  ROOT_ATTR_NAME,
  TEXT_NODE_ATTR_NAME,
  TEXT_NODE_ID_DATA_NAME,
  DOM_PAINT_SPACE_CHARACTER,
  DOM_PAINT_CARET_ANCHOR,
} from '../internals/constants'
import { detectPlatformShortcut } from '../internals/keyboard'
import {
  DactyloProvider,
  useCanEdit,
  useDocumentState,
  useIsFocused,
  useSelectionCommands,
  useEditorConfig,
  useEditableBlock,
  useHistoryCommands,
  useHistoryTools,
} from './composer'
import {
  COMPOSER_EDITABLE_NAME,
  COMPOSER_PARAGRAPH_BLOCK_NAME,
  COMPOSER_ROOT_NAME,
  COMPOSER_BLOCKS_NAME,
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
  ComposerRootProps,
  ComposerEditableProps,
  ComposerParagraphBlockProps,
  ComposerTextNodeProps,
  ComposerInlineContentProps,
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
    const ctx = useStableValue({
      editor: new Dactylo({ config, debug, editable, placeholder }),
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
        <DactyloProvider value={ctx}>{children}</DactyloProvider>
      </div>
    )
  },
)
ComposerRoot.displayName = COMPOSER_ROOT_NAME

// --- Composer.Editable ─────────────────────────────────────────---

/**
 * Renders the text with DOM paint characters.
 * @private
 */
function useRenderText(text: string) {
  return useMemo(() => {
    let rendered = ''

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i]

      // oxlint-disable-next-line unicorn/prefer-ternary
      const isSpace =
        char === ' ' &&
        (i === 0 ||
          text.length - 1 === i ||
          text[i - 1] === ' ' ||
          text[i + 1] === ' ')
      rendered += isSpace ? DOM_PAINT_SPACE_CHARACTER : char
    }

    if (
      rendered.endsWith(DOM_PAINT_SPACE_CHARACTER) ||
      rendered.endsWith(' ')
    ) {
      rendered += DOM_PAINT_CARET_ANCHOR
    }

    return rendered
  }, [text])
}

/** Adds a text node to the composer. */
const ComposerTextNode = forwardRef<HTMLSpanElement, ComposerTextNodeProps>(
  ({ node, ...props }, forwardedRef) => {
    const rendered = useRenderText(node.text)

    return (
      <span
        {...props}
        ref={forwardedRef}
        {...{
          [TEXT_NODE_ATTR_NAME]: '',
          [TEXT_NODE_ID_DATA_NAME]: node.id,
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
  const ref = useRef<HTMLDivElement>(null)
  const mergedRefs = mergeRefs(forwardedRef, ref)

  const { paragraph } = useEditorConfig()
  const { canEdit, editableId, editableRef, withActiveCursor, isEmpty } =
    useEditableBlock(block.id)

  const content = useMemo(() => [...block.content], [block.content])

  const isActive = canEdit && withActiveCursor

  return (
    <div
      {...props}
      ref={mergedRefs}
      {...{
        [PARAGRAPH_BLOCK_ATTR_NAME]: '',
        [PARAGRAPH_BLOCK_ID_ATTR_NAME]: block.id,
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
          [BLOCK_CONTENT_EDITABLE_ATTR_NAME]: canEdit ? 'true' : 'false',
          [PARAGRAPH_BLOCK_CONTENT_ATTR_NAME]: '',
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
    const canEdit = useCanEdit()
    const focused = useIsFocused()
    const { focus } = useSelectionCommands()

    const { canUndo, canRedo } = useHistoryTools()
    const { undo, redo } = useHistoryCommands()

    const handleKeyDown = useStableCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.isDefaultPrevented()) {
          return
        }

        const prevent = () => {
          event.preventDefault()
        }

        const shortcut = detectPlatformShortcut(event.nativeEvent)
        if (shortcut !== null) {
          if (shortcut === 'undo' && canUndo) {
            prevent()
            undo()
          } else if (shortcut === 'redo' && canRedo) {
            prevent()
            redo()
          }
        }
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
        ref={forwardedRef}
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
}
