/**
 * Catalog of all blocks supported by Dactylo.
 *
 * Blocks are the fundamental units of the document.
 * Each block owns an inline content tree (not a flat string with offsets).
 * Text is stored in text nodes: structural inline elements (soft line breaks, inline code spans, ...)
 * that are typed inline nodes.
 */
import { nanoid } from 'nanoid'

import type { InlineNode } from './node'
import type { PosKey } from './position'
import type { Brand, Relax, Metadata } from './types'

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
  readonly parentId: BlockId | null

  /**
   * Inline content tree for the block.
   * By design, this array is kept lightweight as an inline sequence
   * with coalesced text nodes to give better mutation performances
   * while staying memory-conscious.
   * */
  readonly content: readonly InlineNode[]

  /** When the block was created.  */
  readonly createdAt: Date

  /** When the block was last updated. */
  readonly updatedAt: Date | null

  /**
   * Custom metadata defined by developers.
   * Useful to store data inside a block to use outside Dactylo itself.
   */
  readonly metadata: Metadata
}

/** Block representing a heading with markdown level (1-6). */
export interface HeadingBlock extends IBlock {
  readonly __type: 'heading'
  /** Level of the heading. */
  readonly level: 1 | 2 | 3 | 4 | 5 | 6
}

/** Block representing a paragraph (plain text) -- default block type. */
export interface ParagraphBlock extends IBlock {
  readonly __type: 'paragraph'
}

/** Block representing a divider */
export interface DividerBlock extends IBlock {
  readonly __type: 'divider'
  /** Empty content array, no inline nodes allowed */
  readonly content: readonly []
}

/** Discriminated union of all existing blocks in Dactylo. */
export type Block = Relax<HeadingBlock | ParagraphBlock | DividerBlock>

/** Generates a 24 characters long unique block ID */
export function generateBlockId(): BlockId {
  return `bl_${nanoid(21)}` as BlockId
}
