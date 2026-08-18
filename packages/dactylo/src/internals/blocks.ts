/**
 * Catalog of all blocks supported by Dactylo.
 *
 * Blocks are the fundamental units of the document.
 * Each block owns an inline content tree (not a flat string with offsets).
 * Text is stored in text nodes: structural inline elements (soft line breaks, inline code spans, ...)
 * that are typed inline nodes.
 */

import type { Node } from './node'
import type { PosKey } from './position'
import type { Brand, Relax } from './types'

/**
 * Brand type for block unique IDs.
 *
 * @example
 * ```txt
 * bl_1234567890
 * ```
 */
export type BlockId = Brand<`bl_${string}`, 'BlockId'>

/**
 * Base interface to implement by all
 * existing blocks in Dactylo.
 */
export interface IBlock {
  /** Unique identifier for the block. */
  readonly id: BlockId

  /** Position key of the block. */
  readonly posKey: PosKey

  /**
   * Parent block identifier with nested blocks
   * like list or quotes.
   *
   * `null` for root blocks.
   */
  parentId: BlockId | null

  /** Inline content tree for the block. */
  content: Node[]

  /** When the block was created.  */
  createdAt: Date

  /** When the block was last updated. */
  updatedAt: Date | null

  /**
   * Custom metadata defined by developers.
   * Useful to store data inside a block to use outside Dactylo itself.
   */
  metadata: Record<string, string | number | boolean | null | undefined>
}

/** Block representing a heading with markdown level (1-6). */
export interface HeadingBlock extends IBlock {
  readonly __type: 'heading'
  /** Level of the heading. */
  level: 1 | 2 | 3 | 4 | 5 | 6
}

/** Block representing a paragraph (plain text) -- default block type. */
export interface ParagraphBlock extends IBlock {
  readonly __type: 'paragraph'
}

/** Discriminated union of all existing blocks in Dactylo. */
export type Block = Relax<HeadingBlock | ParagraphBlock>
