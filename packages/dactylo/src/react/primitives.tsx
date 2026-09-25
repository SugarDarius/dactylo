'use client'

import { forwardRef, useMemo } from 'react'

import { Dactylo } from '../dactylo'
import {
  DactyloProvider,
  useCanEdit,
  useEditorContext,
  useIsFocused,
  useSelectionCommands,
} from './composer'
import {
  COMPOSER_EDITABLE_ATTR,
  COMPOSER_EDITABLE_NAME,
  COMPOSER_PARAGRAPH_BLOCK_ATTR,
  COMPOSER_PARAGRAPH_BLOCK_ATTR_ID,
  COMPOSER_PARAGRAPH_BLOCK_NAME,
  COMPOSER_ROOT_ATTR,
  COMPOSER_ROOT_NAME,
} from './internals/constants'
import { useIsomorphicLayoutEffect, useStableValue } from './internals/hooks'
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
    { children, editable = true, placeholder, config, ...props },
    forwardedRef,
  ) => {
    const ctx = useStableValue({
      editor: new Dactylo({ config, editable, placeholder }),
    })

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
>(({ children, blockId, ...props }, forwardedRef) => {
  const { state } = useEditorContext()
  const canEdit = useCanEdit()

  // @todo: add active state and handlers
  // @todo: add sync selection

  const block = state.blocks.get(blockId)
  if (!block) {
    return null
  }

  return (
    <div
      {...props}
      ref={forwardedRef}
      {...{
        [COMPOSER_PARAGRAPH_BLOCK_ATTR]: '',
        [COMPOSER_PARAGRAPH_BLOCK_ATTR_ID]: blockId,
      }}
      contentEditable={canEdit ? 'true' : undefined}
      suppressContentEditableWarning
      style={{ outlineColor: 'transparent' }}
    >
      {children}
    </div>
  )
})

ComposerParagraphBlock.displayName = COMPOSER_PARAGRAPH_BLOCK_NAME

/** Renders the composed blocks. */
function Blocks() {
  const { state } = useEditorContext()

  // @todo: add performance rendering optimization
  const blocks = useMemo(() => {
    const items = []

    for (const blockId of state.blockOrderById) {
      const block = state.blocks.get(blockId)
      if (!block) {
        continue
      }

      switch (block.__type) {
        case 'paragraph': {
          items.push(<ComposerParagraphBlock key={blockId} blockId={blockId} />)
          break
        }
        default: {
          continue
        }
      }
    }

    return items
  }, [state.blockOrderById, state.blocks])

  return blocks
}

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
  ({ children, autoFocus, translate = 'no', ...props }, forwardedRef) => {
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
        role={canEdit ? 'textbox' : undefined}
        aria-multiline={canEdit ? 'true' : undefined}
        translate={translate}
      >
        <Blocks />
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
}
