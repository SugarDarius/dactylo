import type { Block, BlockId } from '../../../src/internals/blocks'
import type { PosKey } from '../../../src/internals/position'
import type { Metadata } from '../../../src/internals/types'

export function createEmptyParagraphBlock(
  opts: {
    id?: BlockId
    metadata?: Metadata
    parentId?: BlockId | null
    posKey?: PosKey
    updatedAt?: Date | null
  } = {},
): Block {
  const {
    id = 'bl_0001',
    metadata = {},
    parentId = null,
    posKey = '!',
    updatedAt = null,
  } = opts

  return {
    __type: 'paragraph',
    content: [],
    createdAt: new Date(),
    id: id as BlockId,
    metadata,
    parentId,
    posKey: posKey as PosKey,
    updatedAt,
  }
}
