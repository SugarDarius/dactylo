import { describe, expect, test, vi } from 'vitest'

import { Batch } from '../../src/internals/transaction'
import { makeFixtureSetupApi } from '../utils/fixture'

describe('Batch', () => {
  const api = makeFixtureSetupApi()

  test('`run()` defers flush until outermost scope ends', () => {
    const flush = vi.fn()
    const batch = new Batch({ onFlush: flush })

    const block = api.blocks.createEmptyParagraphBlock()
    const op = api.operations.createInsertBlockOperation({ block })

    batch.run(() => {
      batch.enqueue([op])
      expect(flush).not.toHaveBeenCalled()
    })

    expect(flush).toHaveBeenCalledOnce()
  })

  test('`flush()` commits without closing batch scope', () => {
    const flush = vi.fn()
    const batch = new Batch({ onFlush: flush })

    const block1 = api.blocks.createEmptyParagraphBlock()
    const block2 = api.blocks.createEmptyParagraphBlock()

    const op1 = api.operations.createInsertBlockOperation({ block: block1 })
    const op2 = api.operations.createInsertBlockOperation({
      afterBlockId: block1.id,
      block: block2,
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
    const batch = new Batch({ maxSize: 2, onFlush: flush })

    const block1 = api.blocks.createEmptyParagraphBlock()
    const block2 = api.blocks.createEmptyParagraphBlock()
    const block3 = api.blocks.createEmptyParagraphBlock()

    const op1 = api.operations.createInsertBlockOperation({ block: block1 })
    const op2 = api.operations.createInsertBlockOperation({
      afterBlockId: block1.id,
      block: block2,
    })
    const op3 = api.operations.createInsertBlockOperation({
      afterBlockId: block2.id,
      block: block3,
    })

    batch.enqueue([op1, op2, op3])

    expect(flush).toHaveBeenCalledOnce()
    expect(batch.pendingCount).toBe(1)
  })

  test('`discard()` clears queue without flush', () => {
    const flush = vi.fn()
    const batch = new Batch({ onFlush: flush })

    const block = api.blocks.createEmptyParagraphBlock()
    const op = api.operations.createInsertBlockOperation({ block })

    batch.enqueue([op])
    batch.discard()

    expect(flush).not.toHaveBeenCalled()
    expect(batch.pendingCount).toBe(0)
  })

  test('nested `run()` only flushes once at end', () => {
    const flush = vi.fn()
    const batch = new Batch({ onFlush: flush })

    const block1 = api.blocks.createEmptyParagraphBlock()
    const block2 = api.blocks.createEmptyParagraphBlock()

    const op1 = api.operations.createInsertBlockOperation({ block: block1 })
    const op2 = api.operations.createInsertBlockOperation({
      afterBlockId: block1.id,
      block: block2,
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
