import type { BlockId } from '../../../src/internals/blocks'
import type { HistoryEntry } from '../../../src/internals/history'
import type { NodeId } from '../../../src/internals/nodes'
import type { InsertTextOp } from '../../../src/internals/operations'

/** Builds a single-character insert history entry */
export function createChartInsertHistoryEntry(opts: {
  blockId: BlockId
  nodeId: NodeId
  offset: number
  char: string
}): Pick<HistoryEntry, 'ops' | 'inverseOps'> {
  const op: InsertTextOp = {
    __type: 'insert_text',
    blockId: opts.blockId,
    nodeId: opts.nodeId,
    offset: opts.offset,
    text: opts.char,
  }

  return {
    inverseOps: [
      {
        __type: 'delete_text',
        blockId: opts.blockId,
        length: opts.char.length,
        nodeId: opts.nodeId,
        offset: opts.offset,
        snapshot: { marks: {}, text: opts.char },
      },
    ],
    ops: [op],
  }
}
