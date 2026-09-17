import { describe, expect, test } from 'vitest'

import type { BlockId } from '../../src/internals/blocks'
import { HistoryStack } from '../../src/internals/history'
import type { HistoryEntry } from '../../src/internals/history'
import type { NodeId } from '../../src/internals/nodes'
import type { InsertTextOp } from '../../src/internals/operations'

const createInsertHistoryEntry = (opts: {
  blockId: BlockId
  nodeId: NodeId
  offset: number
  char: string
}): Pick<HistoryEntry, 'ops' | 'inverseOps'> => {
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

describe('History', () => {
  test('coalesces adjacent single-char inserts', () => {
    const stack = new HistoryStack()
    const ids = {
      blockId: 'bl_0001' as BlockId,
      nodeId: 'nd_0001' as NodeId,
    }

    stack.push(
      createInsertHistoryEntry({
        blockId: ids.blockId,
        char: 'a',
        nodeId: ids.nodeId,
        offset: 0,
      }),
      true,
    )

    // oxlint-disable-next-line unicorn/prefer-single-call
    stack.push(
      createInsertHistoryEntry({
        blockId: ids.blockId,
        char: 'b',
        nodeId: ids.nodeId,
        offset: 1,
      }),
      true,
    )

    expect(stack.undoDepth).toBe(1)

    const entry = stack.popUndo()

    expect(entry).toBeDefined()
    expect(entry?.ops).toHaveLength(1)
    expect(entry?.ops[0]).toMatchObject({
      __type: 'insert_text',
      offset: 0,
      text: 'ab',
    })
  })

  test('clears redo stack on new push', () => {
    const stack = new HistoryStack()
    const ids = {
      blockId: 'bl_0001' as BlockId,
      nodeId: 'nd_0001' as NodeId,
    }

    stack.push(
      createInsertHistoryEntry({
        blockId: ids.blockId,
        char: 'a',
        nodeId: ids.nodeId,
        offset: 0,
      }),
      true,
    )
    stack.popUndo()

    expect(stack.canRedo()).toBe(true)

    stack.push(
      createInsertHistoryEntry({
        blockId: ids.blockId,
        char: 'x',
        nodeId: ids.nodeId,
        offset: 0,
      }),
      true,
    )

    expect(stack.canRedo()).toBe(false)
  })

  test('skip coalesce when disabled', () => {
    const stack = new HistoryStack()
    const ids = {
      blockId: 'bl_0001' as BlockId,
      nodeId: 'nd_0001' as NodeId,
    }

    stack.push(
      createInsertHistoryEntry({
        blockId: ids.blockId,
        char: 'a',
        nodeId: ids.nodeId,
        offset: 0,
      }),
      false,
    )
    // oxlint-disable-next-line unicorn/prefer-single-call
    stack.push(
      createInsertHistoryEntry({
        blockId: ids.blockId,
        char: 'b',
        nodeId: ids.nodeId,
        offset: 1,
      }),
      false,
    )

    expect(stack.undoDepth).toBe(2)

    const entry = stack.popUndo()

    expect(entry).toBeDefined()
    expect(entry?.ops).toHaveLength(1)
    expect(entry?.ops[0]).toMatchObject({
      __type: 'insert_text',
      offset: 1,
      text: 'b',
    })

    const entry2 = stack.popUndo()

    expect(entry2).toBeDefined()
    expect(entry2?.ops).toHaveLength(1)
    expect(entry2?.ops[0]).toMatchObject({
      __type: 'insert_text',
      offset: 0,
      text: 'a',
    })

    expect(stack.canUndo()).toBe(false)
    expect(stack.canRedo()).toBe(true)
  })

  test('respects max depth', () => {
    const stack = new HistoryStack({ maxDepth: 2 })
    const ids = {
      blockId: 'bl_0001' as BlockId,
      nodeId: 'nd_0001' as NodeId,
    }

    stack.push(
      createInsertHistoryEntry({
        blockId: ids.blockId,
        char: 'a',
        nodeId: ids.nodeId,
        offset: 0,
      }),
      false,
    )
    // oxlint-disable-next-line unicorn/prefer-single-call
    stack.push(
      createInsertHistoryEntry({
        blockId: ids.blockId,
        char: 'b',
        nodeId: ids.nodeId,
        offset: 1,
      }),
      false,
    )
    // oxlint-disable-next-line unicorn/prefer-single-call
    stack.push(
      createInsertHistoryEntry({
        blockId: ids.blockId,
        char: 'c',
        nodeId: ids.nodeId,
        offset: 2,
      }),
      false,
    )

    expect(stack.undoDepth).toBe(2)
  })
})
