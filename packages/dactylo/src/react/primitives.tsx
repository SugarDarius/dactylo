'use client'

import { forwardRef, useId, useMemo, useRef } from 'react'

import { Dactylo } from '../dactylo'
import {
  DactyloProvider,
  useCanEdit,
  useDocumentState,
  useWithActiveTextCursorInBlock,
  useIsFocused,
  useSelectionCommands,
} from './composer'
import {
  COMPOSER_CONTENT_EDITABLE_ATTR,
  COMPOSER_EDITABLE_ATTR,
  COMPOSER_EDITABLE_NAME,
  COMPOSER_PARAGRAPH_BLOCK_ATTR,
  COMPOSER_PARAGRAPH_BLOCK_ID_ATTR,
  COMPOSER_PARAGRAPH_BLOCK_CONTENT_ATTR,
  COMPOSER_PARAGRAPH_BLOCK_NAME,
  COMPOSER_ROOT_ATTR,
  COMPOSER_ROOT_NAME,
  COMPOSER_BLOCKS_NAME,
  COMPOSER_BLOCKS_ATTR,
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
      placeholder,
      config,
      ...props
    },
    forwardedRef,
  ) => {
    const isMounted = useIsMounted()
    const ctx = useStableValue({
      editor: new Dactylo({ config, editable, placeholder }),
    })

    if (!isMounted && clientOnly) {
      return null
    }

    return (
      <div {...props} ref={forwardedRef} {...{ [COMPOSER_ROOT_ATTR]: '' }}>
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

  const canEdit = useCanEdit()
  const withActiveCursor = useWithActiveTextCursorInBlock(block.id)

  // @todo: add handlers
  // @todo: add sync selection and reconciliation

  return (
    <div
      {...props}
      ref={mergedRefs}
      {...{
        [COMPOSER_PARAGRAPH_BLOCK_ATTR]: '',
        [COMPOSER_PARAGRAPH_BLOCK_ID_ATTR]: block.id,
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
        {...{
          [COMPOSER_CONTENT_EDITABLE_ATTR]: canEdit ? 'true' : 'false',
          [COMPOSER_PARAGRAPH_BLOCK_CONTENT_ATTR]: '',
        }}
      >
        {/** @todo add placeholder and inline content. */}
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
    <div ref={forwardedRef} {...props} {...{ [COMPOSER_BLOCKS_ATTR]: '' }}>
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
    const isFocused = useIsFocused()

    const { focus } = useSelectionCommands()

    /** Focus the editor after initial mount if `autoFocus` is true. */
    useIsomorphicLayoutEffect(() => {
      if (autoFocus && !isFocused && canEdit) {
        focus()
      }
    }, [canEdit, isFocused])

    return (
      <div
        {...props}
        ref={forwardedRef}
        {...{ [COMPOSER_EDITABLE_ATTR]: '' }}
        translate={translate}
        spellCheck={spellCheck}
      >
        <ComposerBlocks translate={translate} spellCheck={spellCheck} />
        {children}
      </div>
    )
  },
)
ComposerEditable.displayName = COMPOSER_EDITABLE_NAME

export { ComposerRoot as Root, ComposerEditable as Editable }
