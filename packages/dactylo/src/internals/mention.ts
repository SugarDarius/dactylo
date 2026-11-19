import type { Block, BlockWithInlineContent } from './blocks'
import type { MentionNode } from './nodes'

export interface Mention {
  /** {@link MentionNode} in document tree. */
  readonly node: MentionNode

  /** {@link BlockWithInlineContent} that owns the mention. */
  readonly block: BlockWithInlineContent

  /** Index of the mention in the block's inline content tree.. */
  readonly index: number

  /**
   * Adjacent blocks to the mention.
   */
  readonly neighbors: {
    readonly prev: Block | null
    readonly next: Block | null
  }
}
