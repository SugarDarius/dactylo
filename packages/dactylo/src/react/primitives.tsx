'use client'

import { forwardRef } from 'react'

import { Dactylo } from '../dactylo'
import {
  DactyloProvider,
  useCanEdit,
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
export const ComposerRoot = forwardRef<HTMLDivElement, ComposerRootProps>(
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
export const ComposerParagraphBlock = forwardRef<
  HTMLDivElement,
  ComposerParagraphBlockProps
>(({ children, blockId, ...props }, forwardedRef) => {
  const canEdit = useCanEdit()

  // @todo: add active state and handlers
  // @todo: add sync selection

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
    >
      {children}
    </div>
  )
})

ComposerParagraphBlock.displayName = COMPOSER_PARAGRAPH_BLOCK_NAME

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
export const ComposerEditable = forwardRef<
  HTMLDivElement,
  ComposerEditableProps
>(({ children, autoFocus, translate = 'no', ...props }, forwardedRef) => {
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
      {children}
    </div>
  )
})

ComposerEditable.displayName = COMPOSER_EDITABLE_NAME

export {
  ComposerRoot as Root,
  ComposerEditable as Editable,
  ComposerParagraphBlock as ParagraphBlock,
}
