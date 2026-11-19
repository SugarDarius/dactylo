import { isBlockWithInlineContent } from './blocks'
import type { Block, BlockWithInlineContent } from './blocks'
import type { DocumentState } from './document'
import { isMentionNode } from './nodes'
import type { MentionNode, NodeId } from './nodes'
import { nonNegativeNumber, omit } from './utils'

/**
 * Snapshot for exposing a {@link MentionNode} externally from {@link DocumentState}.
 *
 * Exposes:
 *  - {@link MentionNode}'s data.
 *  - {@link BlockWithInlineContent}'s base data that owns the mention.
 *  - Index of the mention in the block's inline content tree.
 *  - Adjacent blocks in document tree, up to the requested radius.
 */
export interface MentionWithContext extends MentionNode {
  /** {@link BlockWithInlineContent} that owns the mention. */
  readonly block: Omit<BlockWithInlineContent, 'posKey' | 'parentId'>

  /** Index of the mention in the block's inline content tree. */
  readonly index: number

  /**
   * Adjacent blocks in document tree, up to the requested radius.
   * Empty when at document edges.
   */
  readonly neighbors: {
    /** Previous blocks in document tree. */
    readonly prev: readonly Omit<Block, 'posKey' | 'parentId'>[]

    /** Next blocks in document tree. */
    readonly next: readonly Omit<Block, 'posKey' | 'parentId'>[]
  }
}

/** Options for extracting a {@link MentionWithContext} against {@link DocumentState}. */
export interface ExtractMentionQuery {
  /**
   * How many blocks to include before and after the mention's block.
   * `0` (default) leaves neighbors empty.
   *
   * @example
   * ```ts
   * neighbors: 0 // 👉🏻  Empty neighbors
   * neighbors: 1 // 👉🏻  Include 1 block before and after the mention
   * neighbors: { prev: 1, next: 2 } // 👉🏻  Include 1 block before and 2 blocks after the mention
   * ```
   */
  readonly neighbors?: number | { prev?: number; next?: number }
}

/** Omits props `posKey` and `parentId` that are not relevant for a mention. */
export function omitBlockProps<B extends Block | BlockWithInlineContent>(
  block: B,
): Omit<B, 'posKey' | 'parentId'> {
  return omit(block, ['posKey', 'parentId'])
}

/**
 * Resolves the block neighbors radii for a mention.
 * Ensures non-negative numbers are used.
 */
export function resolveMentionBlockNeighborsRadii(
  neighbors: ExtractMentionQuery['neighbors'],
): { prev: number; next: number } {
  if (typeof neighbors === 'number') {
    const count = nonNegativeNumber(neighbors)

    return {
      next: count,
      prev: count,
    }
  }

  if (typeof neighbors === 'object') {
    return {
      next: neighbors.next ? nonNegativeNumber(neighbors.next) : 0,
      prev: neighbors.prev ? nonNegativeNumber(neighbors.prev) : 0,
    }
  }

  return {
    next: 0,
    prev: 0,
  }
}

/**
 * Resolves the blocks neighbors for the one containing the mention at the given index
 * from {@link DocumentState}'s `blockOrderById` index.
 *
 * Returns a finite number of blocks as neighbors based on `radii` parameter.
 */
export function resolveMentionBlockNeighborsAt(
  state: DocumentState,
  index: number,
  radii: { prev: number; next: number },
): MentionWithContext['neighbors'] {
  if (radii.prev <= 0 && radii.next <= 0) {
    return { next: [], prev: [] }
  }

  const prev: Omit<Block, 'posKey' | 'parentId'>[] = []
  const next: Omit<Block, 'posKey' | 'parentId'>[] = []

  const prevStart = Math.max(0, index - radii.prev)
  for (let i = prevStart; i < index; i += 1) {
    const id = state.blockOrderById[i]

    const block = id ? state.blocks.get(id) : undefined
    if (block) {
      prev.push(omitBlockProps(block))
    }
  }

  const nextEnd = Math.min(state.blockOrderById.length, index + 1 + radii.next)
  for (let i = index + 1; i < nextEnd; i += 1) {
    const id = state.blockOrderById[i]

    const block = id ? state.blocks.get(id) : undefined
    if (block) {
      next.push(omitBlockProps(block))
    }
  }

  return { next, prev }
}

/**
 * Extracts a mention by its node's ID from {@link DocumentState}.
 * and gets the neighbors blocks based on the {@link MentionQuery} parameter.
 *
 * Returns the mention if found, otherwise `null`.
 */
export function extractMention(
  state: DocumentState,
  nodeId: NodeId,
  query: ExtractMentionQuery = {},
): MentionWithContext | null {
  const { prev, next } = resolveMentionBlockNeighborsRadii(query.neighbors)

  for (let i = 0; i < state.blockOrderById.length; i += 1) {
    const blockId = state.blockOrderById[i]
    if (!blockId) {
      continue
    }

    const block = state.blocks.get(blockId)
    if (!block || !isBlockWithInlineContent(block)) {
      continue
    }

    for (const [index, node] of block.content.entries()) {
      if (!isMentionNode(node) || node.id !== nodeId) {
        continue
      }

      const neighbors = resolveMentionBlockNeighborsAt(state, i, { next, prev })
      return {
        block: omitBlockProps(block),
        index,
        neighbors,
        ...node,
      }
    }
  }

  return null
}
