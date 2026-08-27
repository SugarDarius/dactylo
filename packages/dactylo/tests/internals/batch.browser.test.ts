import { describe, expect, test, vi } from 'vitest'

import { Batch } from '../../src/internals/batch'
import { createEmptyParagraphBlock } from './utils/blocks'
import { createInsertBlockOperation } from './utils/operations'

describe('Batch', () => {
  test('run() defers flush until outermost scope ends', () => {
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
})
