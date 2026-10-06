import { describe, expect, test } from 'vitest'

import type { BlockId } from '../../src/internals/blocks'
import { HistoryStack, orderInverseOps } from '../../src/internals/history'
import type { HistoryEntry } from '../../src/internals/history'
import type { NodeId } from '../../src/internals/nodes'
import type {
  InsertTextOp,
  SetSelectionOp,
} from '../../src/internals/operations'

const ids = () => ({
  blockId: 'bl_0001' as BlockId,
  nodeId: 'nd_0001' as NodeId,
})

const createInsertHistoryEntry = (opts: {
  blockId: BlockId
  nodeId: NodeId
  offset: number
  char: string
}): Pick<HistoryEntry, 'ops' | 'inverseOps'> => {
  const op: InsertTextOp = {
    __type: 'insert_text',
    blockId: opts.blockId,
    marks: {},
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

const createTypingHistoryEntry = (opts: {
  blockId: BlockId
  nodeId: NodeId
  offset: number
  char: string
  cursorAfter: number
  cursorBefore: number
}): Pick<HistoryEntry, 'ops' | 'inverseOps'> => {
  const insert: InsertTextOp = {
    __type: 'insert_text',
    blockId: opts.blockId,
    marks: {},
    nodeId: opts.nodeId,
    offset: opts.offset,
    text: opts.char,
  }
  const selection: SetSelectionOp = {
    __type: 'set_selection',
    next: {
      __type: 'cursor',
      anchor: {
        blockId: opts.blockId,
        nodeId: opts.nodeId,
        offset: opts.cursorAfter,
      },
    },
    prev: {
      __type: 'cursor',
      anchor: {
        blockId: opts.blockId,
        nodeId: opts.nodeId,
        offset: opts.cursorBefore,
      },
    },
  }

  const rawInverseOps = [
    {
      __type: 'delete_text' as const,
      blockId: opts.blockId,
      length: 1,
      nodeId: opts.nodeId,
      offset: opts.offset,
      snapshot: { marks: {}, text: opts.char },
    },
    {
      __type: 'set_selection' as const,
      next: selection.prev,
      prev: selection.next,
    },
  ]

  return {
    inverseOps: orderInverseOps(rawInverseOps),
    ops: [insert, selection],
  }
}

describe('Order inverse ops', () => {
  test('applies document inverses before selection inverses', () => {
    const ordered = orderInverseOps([
      {
        __type: 'set_selection',
        next: null,
        prev: null,
      },
      {
        __type: 'delete_text',
        blockId: 'bl_0001' as BlockId,
        length: 1,
        nodeId: 'nd_0001' as NodeId,
        offset: 0,
        snapshot: { marks: {}, text: 'a' },
      },
    ])

    expect(ordered[0]?.__type).toBe('delete_text')
    expect(ordered[1]?.__type).toBe('set_selection')
  })
})

describe('History', () => {
  test('coalesces adjacent single-char inserts with set_selection', () => {
    const stack = new HistoryStack()
    const { blockId, nodeId } = ids()

    stack.push(
      createTypingHistoryEntry({
        blockId,
        char: 'a',
        cursorAfter: 1,
        cursorBefore: 0,
        nodeId,
        offset: 0,
      }),
      true,
    )

    // oxlint-disable-next-line unicorn/prefer-single-call
    stack.push(
      createTypingHistoryEntry({
        blockId,
        char: 'b',
        cursorAfter: 2,
        cursorBefore: 1,
        nodeId,
        offset: 1,
      }),
      true,
    )

    expect(stack.undoDepth).toBe(1)

    const entry = stack.popUndo()

    expect(entry).toBeDefined()
    expect(entry?.ops).toHaveLength(2)
    expect(entry?.ops[0]).toMatchObject({
      __type: 'insert_text',
      offset: 0,
      text: 'ab',
    })
    expect(entry?.ops[1]).toMatchObject({
      __type: 'set_selection',
      next: {
        __type: 'cursor',
        anchor: { blockId, nodeId, offset: 2 },
      },
      prev: {
        __type: 'cursor',
        anchor: { blockId, nodeId, offset: 0 },
      },
    })

    expect(entry?.inverseOps[0]?.__type).toBe('delete_text')
    expect(entry?.inverseOps[1]?.__type).toBe('set_selection')
    expect(entry?.inverseOps[0]).toMatchObject({
      __type: 'delete_text',
      length: 2,
      offset: 0,
      snapshot: { text: 'ab' },
    })
  })

  test('coalesces more than two adjacent typing keystrokes', () => {
    const stack = new HistoryStack()
    const { blockId, nodeId } = ids()
    const word = 'Hello'

    for (let i = 0; i < word.length; i += 1) {
      const char = word[i] ?? ''
      stack.push(
        createTypingHistoryEntry({
          blockId,
          char,
          cursorAfter: i + 1,
          cursorBefore: i,
          nodeId,
          offset: i,
        }),
        true,
      )
    }

    expect(stack.undoDepth).toBe(1)

    const entry = stack.popUndo()

    expect(entry?.ops[0]).toMatchObject({
      __type: 'insert_text',
      offset: 0,
      text: 'Hello',
    })
    expect(entry?.inverseOps[0]).toMatchObject({
      __type: 'delete_text',
      length: 5,
      offset: 0,
      snapshot: { text: 'Hello' },
    })
  })

  test('clears redo stack on new push', () => {
    const stack = new HistoryStack()
    const { blockId, nodeId } = ids()

    stack.push(
      createInsertHistoryEntry({
        blockId,
        char: 'a',
        nodeId,
        offset: 0,
      }),
      true,
    )
    stack.popUndo()

    expect(stack.canRedo()).toBe(true)

    stack.push(
      createInsertHistoryEntry({
        blockId,
        char: 'x',
        nodeId,
        offset: 0,
      }),
      true,
    )

    expect(stack.canRedo()).toBe(false)
  })

  test('skip coalesce when disabled', () => {
    const stack = new HistoryStack()
    const { blockId, nodeId } = ids()

    stack.push(
      createTypingHistoryEntry({
        blockId,
        char: 'a',
        cursorAfter: 1,
        cursorBefore: 0,
        nodeId,
        offset: 0,
      }),
      false,
    )
    // oxlint-disable-next-line unicorn/prefer-single-call
    stack.push(
      createTypingHistoryEntry({
        blockId,
        char: 'b',
        cursorAfter: 2,
        cursorBefore: 1,
        nodeId,
        offset: 1,
      }),
      false,
    )

    expect(stack.undoDepth).toBe(2)

    const entry = stack.popUndo()

    expect(entry).toBeDefined()
    expect(entry?.ops).toHaveLength(2)
    expect(entry?.ops[0]).toMatchObject({
      __type: 'insert_text',
      offset: 1,
      text: 'b',
    })

    const entry2 = stack.popUndo()

    expect(entry2).toBeDefined()
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
    const { blockId, nodeId } = ids()

    stack.push(
      createInsertHistoryEntry({
        blockId,
        char: 'a',
        nodeId,
        offset: 0,
      }),
      false,
    )
    // oxlint-disable-next-line unicorn/prefer-single-call
    stack.push(
      createInsertHistoryEntry({
        blockId,
        char: 'b',
        nodeId,
        offset: 1,
      }),
      false,
    )
    // oxlint-disable-next-line unicorn/prefer-single-call
    stack.push(
      createInsertHistoryEntry({
        blockId,
        char: 'c',
        nodeId,
        offset: 2,
      }),
      false,
    )

    expect(stack.undoDepth).toBe(2)
  })
})
