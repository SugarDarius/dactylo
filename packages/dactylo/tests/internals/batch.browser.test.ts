import { describe, expect, test, vi } from 'vitest'

import { Batch } from '../../src/internals/batch'
import type { BlockId } from '../../src/internals/blocks'
import type { PosKey } from '../../src/internals/position'

describe('Batch', () => {
  test('run() defers flush until outermost scope ends', () => {
    const flush = vi.fn()
    const batch = new Batch({ onFlush: flush })

    batch.run(() => {
      batch.enqueue([
        {
          __type: 'insert_block',
          block: {
            id: 'bl_0001' as BlockId,
            parentId: null,
            posKey: '!' as PosKey,
            __type: 'paragraph',
            content: [],
            updatedAt: null,
            createdAt: new Date(),
            metadata: {},
          },
          afterBlockId: null,
        },
      ])
      expect(flush).not.toHaveBeenCalled()
    })

    expect(flush).toHaveBeenCalledOnce()
  })
})
