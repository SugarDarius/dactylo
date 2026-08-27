import type { Block, BlockId } from '../../../src/internals/blocks'
import type { InsertBlockOp } from '../../../src/internals/operations'

export function createInsertBlockOperation(opts: {
  afterBlockId?: BlockId | null
  block: Block
}): InsertBlockOp {
  const { afterBlockId = null, block } = opts
  return {
    __type: 'insert_block',
    afterBlockId,
    block,
  }
}
