'use client'

import { forwardRef, useId, useMemo, useRef } from 'react'

import { Dactylo } from '../dactylo'
import {
  BLOCKS_ATTR_NAME,
  CONTENT_EDITABLE_ATTR_NAME,
  EDITABLE_ATTR_NAME,
  PARAGRAPH_BLOCK_ATTR_NAME,
  PARAGRAPH_BLOCK_CONTENT_ATTR_NAME,
  PARAGRAPH_BLOCK_ID_ATTR_NAME,
  BLOCK_PLACEHOLDER_ATTR_NAME,
  ROOT_ATTR_NAME,
} from '../internals/constants'
import {
  DactyloProvider,
  useCanEdit,
  useDocumentState,
  useIsWithActiveCursor,
  useIsFocused,
  useSelectionCommands,
  useEditorConfig,
} from './composer'
import {
  COMPOSER_EDITABLE_NAME,
  COMPOSER_PARAGRAPH_BLOCK_NAME,
  COMPOSER_ROOT_NAME,
  COMPOSER_BLOCKS_NAME,
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
      <div {...props} ref={forwardedRef} {...{ [ROOT_ATTR_NAME]: '' }}>
        <DactyloProvider value={ctx}>{children}</DactyloProvider>
      </div>
    )
  },
)
ComposerRoot.displayName = COMPOSER_ROOT_NAME

// --- Composer.Editable ─────────────────────────────────────────---

/** Adds a paragraph block to the composer. */
const ComposerParagraphBlock = forwardRef<
  HTMLDivElement,
  ComposerParagraphBlockProps
>(({ block, ...props }, forwardedRef) => {
  const id = useId()

  const ref = useRef<HTMLDivElement>(null)
  const mergedRefs = mergeRefs(forwardedRef, ref)

  const { paragraph } = useEditorConfig()
  const canEdit = useCanEdit()
  const withActiveCursor = useIsWithActiveCursor(block.id)

  // @todo: add handlers
  // @todo: add sync selection and reconciliation
  // @todo: add custom hook + request animation frame

  return (
    <div
      {...props}
      ref={mergedRefs}
      {...{
        [PARAGRAPH_BLOCK_ATTR_NAME]: '',
        [PARAGRAPH_BLOCK_ID_ATTR_NAME]: block.id,
      }}
      data-active={withActiveCursor ?? undefined}
    >
      <div
        id={id}
        role={canEdit ? 'textbox' : undefined}
        aria-roledescription='paragraph'
        aria-multiline={canEdit ? 'true' : undefined}
        contentEditable={canEdit ? 'true' : undefined}
        suppressContentEditableWarning
        data-active={withActiveCursor ?? undefined}
        {...{
          [CONTENT_EDITABLE_ATTR_NAME]: canEdit ? 'true' : 'false',
          [PARAGRAPH_BLOCK_CONTENT_ATTR_NAME]: '',
          [BLOCK_PLACEHOLDER_ATTR_NAME]: paragraph.placeholder,
        }}
      >
        {/** @todo add inline content. */}
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
    <div ref={forwardedRef} {...props} {...{ [BLOCKS_ATTR_NAME]: '' }}>
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
      >
        <ComposerBlocks translate={translate} spellCheck={spellCheck} />
        {children}
      </div>
    )
  },
)
ComposerEditable.displayName = COMPOSER_EDITABLE_NAME

export { ComposerRoot as Root, ComposerEditable as Editable }
