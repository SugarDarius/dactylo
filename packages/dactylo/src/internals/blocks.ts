/**
 * Catalog of all blocks supported by Dactylo.
 *
 * Blocks are the fundamental units of the document.
 * Each block owns an inline content tree (not a flat string with offsets).
 * Text is stored in text nodes: structural inline elements (soft line breaks, inline code spans, ...)
 * that are typed inline nodes.
 */

import type { Brand, Relax } from './types'

/**
 * Brand type for block unique IDs.
 *
 * @example
 * ```txt
 * blk_1234567890
 * ```
 */
export type BlockId = Brand<`blk_${string}`, 'BlockId'>

/**
 * Base interface to implement by all
 * existing blocks in Dactylo.
 */
export interface IBlock {
  /** Unique identifier for the block. */
  readonly id: BlockId
}

/** Block representing a heading. */
export interface HeadingBlock extends IBlock {
  readonly type: 'heading'
  /** Level of the heading. */
  readonly level: 1 | 2 | 3 | 4 | 5 | 6
}

/** Discriminated union of all existing blocks in Dactylo. */
export type Block = Relax<HeadingBlock>
