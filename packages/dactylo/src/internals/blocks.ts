/**
 * Catalog of all blocks supported by Dactylo.
 *
 * Blocks are the fundamental units of the document.
 * Each block owns an inline content tree (not a flat string with offsets).
 * Text is stored in text nodes: structural inline elements (soft line breaks, inline code spans, ...)
 * that are typed inline nodes.
 */

import { nanoid } from 'nanoid'

import { createPlaceholderTextNode } from './nodes'
import type { InlineNode, NodeId } from './nodes'
import { makeInitialPosition } from './position'
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

/** Base interface to implement by all existing blocks in Dactylo. */
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

/** Base interface for blocks with inline content. */
export interface IBlockWithInlineContext extends IBlock {
  /**
   * Inline content tree for the block.
   * By design, this array is kept lightweight as an inline sequence
   * with coalesced text nodes to give better mutation performances
   * while staying memory-conscious.
   * */
  readonly content: readonly InlineNode[]
}

/** Block representing a heading with markdown level (1-6). */
export interface HeadingBlock extends IBlockWithInlineContext {
  readonly __type: 'heading'
  /** Level of the heading. */
  readonly level: 1 | 2 | 3 | 4 | 5 | 6
}

/** Block representing a paragraph (plain text) -- default block type. */
export interface ParagraphBlock extends IBlockWithInlineContext {
  readonly __type: 'paragraph'
}

/** Block representing a divider */
export interface DividerBlock extends IBlock {
  readonly __type: 'divider'
}

/** Discriminated union of all existing blocks in Dactylo. */
export type Block = Relax<HeadingBlock | ParagraphBlock | DividerBlock>

/** Allowed blocks to own inline content */
export type BlockWithInlineContent = HeadingBlock | ParagraphBlock

/** Discriminated union of all existing blocks without `posKey` in Dactylo. */
export type BlockWithoutPosKey = Relax<
  | Omit<HeadingBlock, 'posKey'>
  | Omit<ParagraphBlock, 'posKey'>
  | Omit<DividerBlock, 'posKey'>
>

/** Generates a 24 characters long unique block ID */
export function generateBlockId(): BlockId {
  return `bl_${nanoid(21)}` as BlockId
}

/** Creates a paragraph block */
export function createParagraphBlock(opts: {
  content: InlineNode[]
  metadata?: Metadata
  posKey: PosKey
  parentId?: BlockId | null
}): ParagraphBlock {
  return {
    __type: 'paragraph',
    content: opts.content,
    createdAt: new Date(),
    id: generateBlockId(),
    metadata: opts.metadata ?? {},
    parentId: opts.parentId ?? null,
    posKey: opts.posKey,
    updatedAt: null,
  }
}

/** Creates an initial placeholder block (paragraph) for an empty document */
export function createInitialParagraphPlaceholderBlock(
  text: string,
): ParagraphBlock {
  return createParagraphBlock({
    content: [createPlaceholderTextNode(text)],
    posKey: makeInitialPosition(),
  })
}

/** Returns a shallow copy of a block with a fresh `updatedAt` timestamp. */
export function touchBlock(block: Block): Block {
  return { ...block, updatedAt: new Date() }
}

/** Whether the block is allowed to have inline content. */
export function isBlockWithInlineContent(
  block: Block,
): block is BlockWithInlineContent {
  return block.__type === 'heading' || block.__type === 'paragraph'
}

/** Whether the block was created with a placeholder text node. */
export function isBlockWithPlaceholder(block: Block): boolean {
  if (isBlockWithInlineContent(block)) {
    /** placeholders represents always one single text node. */
    if (block.content.length !== 1) {
      return false
    }

    const [first] = block.content
    return first?.__type === 'text' && first.isPlaceholder === true
  }

  return false
}

/** Rebuilds block order from a blocks map (after posKey changes). */
export function sortBlockOrder(blocks: ReadonlyMap<BlockId, Block>): BlockId[] {
  return [...blocks.values()]
    .toSorted((a, b) =>
      a.posKey < b.posKey ? -1 : a.posKey > b.posKey ? 1 : 0,
    )
    .map((b) => b.id)
}

/* Finds a node inside a block's content array. */
export function findNodeInBlockWithInlineContent(
  block: BlockWithInlineContent,
  nodeId: NodeId,
): { node: InlineNode; index: number } | null {
  const index = block.content.findIndex((n) => n.id === nodeId)
  if (index === -1) {
    return null
  }

  const node = block.content[index]
  if (!node) {
    return null
  }

  return { index, node }
}
