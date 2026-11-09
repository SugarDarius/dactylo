import type { HeadingBlock } from '../../internals/blocks'

/** Root component name. */
export const COMPOSER_ROOT_NAME = 'Composer.Root'

/** Editable component name. */
export const COMPOSER_EDITABLE_NAME = 'Composer.Editable'

/** Blocks component name. */
export const COMPOSER_BLOCKS_NAME = 'Composer.Blocks'

/** Block component name. */
export const COMPOSER_BLOCK_NAME = 'Composer.Block'

/** Paragraph block component name. */
export const COMPOSER_PARAGRAPH_BLOCK_NAME = 'Composer.ParagraphBlock'

/** Quote block component name. */
export const COMPOSER_QUOTE_BLOCK_NAME = 'Composer.QuoteBlock'

/** Divider block component name. */
export const COMPOSER_DIVIDER_BLOCK_NAME = 'Composer.DividerBlock'

/** Heading block component name. */
export const COMPOSER_HEADING_BLOCK_NAME = 'Composer.HeadingBlock'

/** Levels of the heading blocks. */
export const COMPOSER_HEADING_LEVELS: HeadingBlock['level'][] = [
  1, 2, 3, 4, 5, 6,
]

/** Heading tags for the heading blocks. */
export const COMPOSER_HEADING_TAGS: Record<
  HeadingBlock['level'],
  `h${HeadingBlock['level']}`
> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
}

/** Heading component name. */
export const COMPOSER_HEADING_NAME = (level: HeadingBlock['level']) =>
  `Composer.Heading${level}`

/** Bullet list item block component name. */
export const COMPOSER_BULLET_LIST_ITEM_BLOCK_NAME =
  'Composer.BulletListItemBlock'

/** Numbered list item block component name. */
export const COMPOSER_NUMBERED_LIST_ITEM_BLOCK_NAME =
  'Composer.NumberedListItemBlock'

/** Checkbox list item block component name. */
export const COMPOSER_CHECKBOX_LIST_ITEM_BLOCK_NAME =
  'Composer.CheckboxListItemBlock'

/** Text node component name. */
export const COMPOSER_TEXT_NODE_NAME = 'Composer.TextNode'

/** Link node component name. */
export const COMPOSER_LINK_NODE_NAME = 'Composer.LinkNode'

/** Line break node component name. */
export const COMPOSER_LINE_BREAK_NODE_NAME = 'Composer.LineBreakNode'
