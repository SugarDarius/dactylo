/**
 * Catalog of all blocks supported by Dactylo.
 *
 * Blocks are the fundamental units of the document.
 * They can own an inline content tree (not a flat string with offsets).
 * In that case, text is stored in text nodes: structural inline elements (soft line breaks, inline code spans, ...)
 * that are typed inline nodes.
 *
 * @todo supports parents/nested blocks
 */

import { nanoid } from 'nanoid'

import { DactyloError } from './errors'
import { cloneInlineNode } from './nodes'
import type { InlineNode, NodeId } from './nodes'
import { after, comparePositions } from './position'
import type { PosKey } from './position'
import type { Brand, Metadata } from './types'
import { assertNever } from './utils'

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
   * to give better mutation performances while staying memory-conscious.
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

/** Block representing a bullet list item. */
export interface BulletListItemBlock extends IBlockWithInlineContext {
  readonly __type: 'bullet-list-item'
}

/** Block representing a checkbox list item. */
export interface CheckboxListItemBlock extends IBlockWithInlineContext {
  readonly __type: 'checkbox-list-item'

  /** Whether the item is checked. */
  readonly checked: boolean
}

/** Block representing a divider. */
export interface DividerBlock extends IBlock {
  readonly __type: 'divider'
}

/** Discriminated union of blocks supported by {@link Dactylo}, */
export type Block =
  | HeadingBlock
  | ParagraphBlock
  | BulletListItemBlock
  | CheckboxListItemBlock
  | DividerBlock

/** Allowed blocks to own inline content */
export type BlockWithInlineContent =
  | HeadingBlock
  | ParagraphBlock
  | BulletListItemBlock
  | CheckboxListItemBlock

/** Discriminated union of block types.. */
export type BlockType = Block['__type']

/** Generates a 24 characters long unique block ID. */
export function generateBlockId(): BlockId {
  return `bl_${nanoid(21)}` as BlockId
}

/** Creates a {@link ParagraphBlock}. */
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

/** Whether the block is a paragraph block. */
export function isParagraphBlock(block: Block): block is ParagraphBlock {
  return block.__type === 'paragraph'
}

/**
 * Creates a {@link ParagraphBlock} after a given existing block.
 * Computes `posKey` of the new block based on the `afterBlock` position.
 */
export function createParagraphBlockAfter(
  afterBlock: Block,
  content: InlineNode[],
  metadata?: Metadata,
): ParagraphBlock {
  const posKey = after(afterBlock.posKey)
  return createParagraphBlock({
    content,
    metadata,
    parentId: afterBlock.parentId,
    posKey,
  })
}

/** Creates an {@link HeadingBlock}. */
export function createHeadingBlock(opts: {
  level: 1 | 2 | 3 | 4 | 5 | 6
  content: InlineNode[]
  metadata?: Metadata
  posKey: PosKey
  parentId?: BlockId | null
}): HeadingBlock {
  return {
    __type: 'heading',
    content: opts.content,
    createdAt: new Date(),
    id: generateBlockId(),
    level: opts.level,
    metadata: opts.metadata ?? {},
    parentId: opts.parentId ?? null,
    posKey: opts.posKey,
    updatedAt: null,
  }
}

/** Whether the block is a heading block. */
export function isHeadingBlock(block: Block): block is HeadingBlock {
  return block.__type === 'heading'
}

/** Creates a {@link BulletListItemBlock}. */
export function createBulletListItemBlock(opts: {
  content: InlineNode[]
  metadata?: Metadata
  posKey: PosKey
  parentId?: BlockId | null
}): BulletListItemBlock {
  return {
    __type: 'bullet-list-item',
    content: opts.content,
    createdAt: new Date(),
    id: generateBlockId(),
    metadata: opts.metadata ?? {},
    parentId: opts.parentId ?? null,
    posKey: opts.posKey,
    updatedAt: null,
  }
}

/** Whether the block is a bullet list item block. */
export function isBulletListItemBlock(
  block: Block,
): block is BulletListItemBlock {
  return block.__type === 'bullet-list-item'
}

/** Creates a {@link CheckboxListItemBlock}. */
export function createCheckboxListItemBlock(opts: {
  content: InlineNode[]
  metadata?: Metadata
  posKey: PosKey
  parentId?: BlockId | null
  checked?: boolean
}): CheckboxListItemBlock {
  return {
    __type: 'checkbox-list-item',
    checked: opts.checked ?? false,
    content: opts.content,
    createdAt: new Date(),
    id: generateBlockId(),
    metadata: opts.metadata ?? {},
    parentId: opts.parentId ?? null,
    posKey: opts.posKey,
    updatedAt: null,
  }
}

/** Whether the block is a checkbox list item block. */
export function isCheckboxListItemBlock(
  block: Block,
): block is CheckboxListItemBlock {
  return block.__type === 'checkbox-list-item'
}

/** Creates a {@link DividerBlock}. */
export function createDividerBlock(opts: {
  metadata?: Metadata
  posKey: PosKey
  parentId?: BlockId | null
}): DividerBlock {
  return {
    __type: 'divider',
    createdAt: new Date(),
    id: generateBlockId(),
    metadata: opts.metadata ?? {},
    parentId: opts.parentId ?? null,
    posKey: opts.posKey,
    updatedAt: null,
  }
}

/** Whether the block is a divider block. */
export function isDividerBlock(block: Block): block is DividerBlock {
  return block.__type === 'divider'
}

/** Whether the block is allowed to have inline content. */
export function isBlockWithInlineContent(
  block: Block,
): block is BlockWithInlineContent {
  return (
    isHeadingBlock(block) ||
    isParagraphBlock(block) ||
    isBulletListItemBlock(block) ||
    isCheckboxListItemBlock(block)
  )
}

/** Returns a shallow copy of a block with a fresh `updatedAt` timestamp. */
export function touchBlock(block: Block): Block {
  return { ...block, updatedAt: new Date() }
}

/** Clones the inline content of an allowed block. */
export function cloneBlockInlineContent(
  content: readonly InlineNode[],
): InlineNode[] {
  const cloned: InlineNode[] = []
  for (const node of content) {
    cloned.push(cloneInlineNode(node))
  }
  return cloned
}

/**
 * Clones a block by:
 *  - Copying properties
 *  - Creating a new identity
 *  - Assigning a new defined `posKey`
 */
export function cloneBlock(source: Block, posKey: PosKey): Block {
  const type = source.__type
  switch (type) {
    case 'paragraph': {
      return createParagraphBlock({
        content: cloneBlockInlineContent(source.content),
        metadata: source.metadata,
        parentId: source.parentId,
        posKey,
      })
    }
    case 'heading': {
      return createHeadingBlock({
        content: cloneBlockInlineContent(source.content),
        level: source.level,
        metadata: source.metadata,
        parentId: source.parentId,
        posKey,
      })
    }
    case 'bullet-list-item': {
      return createBulletListItemBlock({
        content: cloneBlockInlineContent(source.content),
        metadata: source.metadata,
        parentId: source.parentId,
        posKey,
      })
    }
    case 'checkbox-list-item': {
      return createCheckboxListItemBlock({
        checked: source.checked,
        content: cloneBlockInlineContent(source.content),
        metadata: source.metadata,
        parentId: source.parentId,
        posKey,
      })
    }
    case 'divider': {
      return createDividerBlock({
        metadata: source.metadata,
        parentId: source.parentId,
        posKey,
      })
    }
    default: {
      assertNever(type, { hint: 'Blocks/cloneBlock' })
    }
  }
}

/** Rebuilds block order from a blocks map (after posKey changes). */
export function sortBlockOrder(blocks: ReadonlyMap<BlockId, Block>): BlockId[] {
  return [...blocks.values()]
    .toSorted((a, b) => comparePositions(a.posKey, b.posKey))
    .map((b) => b.id)
}

/** Finds a node inside a block's content array. */
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

/** Finds the first inline node in a block. */
export function findFirstInlineNodeInBlock(
  block: BlockWithInlineContent,
): InlineNode {
  const [first] = block.content
  if (!first) {
    throw DactyloError.from({
      code: 'BLOCK_HAS_NO_CONTENT',
      hint: 'Blocks/findFirstInlineNodeInBlock',
      message: 'No first inline node found in block',
      payload: { block },
    })
  }

  return first
}

/** Finds the last inline node in a block. */
export function findLastInlineNodeInBlock(
  block: BlockWithInlineContent,
): InlineNode {
  const last = block.content[block.content.length - 1]
  if (!last) {
    throw DactyloError.from({
      code: 'UNKNOWN_NODE_IN_BLOCK',
      hint: 'Blocks/findLastInlineNodeInBlock',
      message: 'No last inline node found in block',
      payload: { block },
    })
  }

  return last
}
