import { describe, expect, test, vi } from 'vitest'

import type { BlockId } from '../../src/internals/blocks'
import { Batch } from '../../src/internals/transaction'
import { createEmptyParagraphBlock } from './utils/blocks'
import { createInsertBlockOperation } from './utils/operations'

describe('Batch', () => {
  test('`run()` defers flush until outermost scope ends', () => {
    const flush = vi.fn()
    const batch = new Batch({ onFlush: flush })

    const block = createEmptyParagraphBlock()
    const op = createInsertBlockOperation({ block })

    batch.run(() => {
      batch.enqueue([op])
      expect(flush).not.toHaveBeenCalled()
    })

    expect(flush).toHaveBeenCalledOnce()
  })

  test('`flush()` commits without closing batch scope', () => {
    const flush = vi.fn()
    const batch = new Batch({ onFlush: flush })

    const block1 = createEmptyParagraphBlock({ id: 'bl_0001' as BlockId })
    const block2 = createEmptyParagraphBlock({ id: 'bl_0002' as BlockId })

    const op1 = createInsertBlockOperation({ block: block1 })
    const op2 = createInsertBlockOperation({
      block: block2,
      afterBlockId: block1.id,
    })

    batch.run(() => {
      batch.enqueue([op1])
      batch.flush()

      expect(flush).toHaveBeenCalledOnce()

      batch.enqueue([op2])
    })

    expect(flush).toHaveBeenCalledTimes(2)
  })

  test('auto-flushes when `maxSize` exceeded', () => {
    const flush = vi.fn()
    const batch = new Batch({ onFlush: flush, maxSize: 2 })

    const block1 = createEmptyParagraphBlock({ id: 'bl_0001' as BlockId })
    const block2 = createEmptyParagraphBlock({ id: 'bl_0002' as BlockId })
    const block3 = createEmptyParagraphBlock({ id: 'bl_0003' as BlockId })

    const op1 = createInsertBlockOperation({ block: block1 })
    const op2 = createInsertBlockOperation({
      block: block2,
      afterBlockId: block1.id,
    })
    const op3 = createInsertBlockOperation({
      block: block3,
      afterBlockId: block2.id,
    })

    batch.enqueue([op1, op2, op3])

    expect(flush).toHaveBeenCalledOnce()
    expect(batch.pendingCount).toBe(1)
  })

  test('`discard()` clears queue without flush', () => {
    const flush = vi.fn()
    const batch = new Batch({ onFlush: flush })

    const block = createEmptyParagraphBlock()
    const op = createInsertBlockOperation({ block })

    batch.enqueue([op])
    batch.discard()

    expect(flush).not.toHaveBeenCalled()
    expect(batch.pendingCount).toBe(0)
  })

  test('nested `run()` only flushes once at end', () => {
    const flush = vi.fn()
    const batch = new Batch({ onFlush: flush })

    const block1 = createEmptyParagraphBlock({ id: 'bl_0001' as BlockId })
    const block2 = createEmptyParagraphBlock({ id: 'bl_0002' as BlockId })

    const op1 = createInsertBlockOperation({ block: block1 })
    const op2 = createInsertBlockOperation({
      block: block2,
      afterBlockId: block1.id,
    })

    batch.run(() => {
      batch.run(() => {
        batch.enqueue([op1])
      })
      batch.enqueue([op2])
    })

    expect(flush).toHaveBeenCalledOnce()
  })
})
