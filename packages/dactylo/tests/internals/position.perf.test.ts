/**
 * PosKey CPU gates and length bound.
 *
 * Local only: 10k `after()` < 50ms, 10k `between()` < 100ms.
 * Always on: 10k `after()` → max key length < 20.
 */
import { describe, expect, test } from 'vitest'

import { after, between, makePosition } from '../../src/internals/position'
import type { PosKey } from '../../src/internals/position'
import { timeMs } from '../utils/perf'

const OPS = 10_000
const AFTER_BUDGET_MS = 50
const BETWEEN_BUDGET_MS = 100
const MAX_POS_KEY_LENGTH = 20
const WARMUP_OPS = 50

function warmupAfter(): void {
  let pos = makePosition()
  for (let i = 0; i < WARMUP_OPS; i += 1) {
    pos = after(pos)
  }
}

function warmupBetween(lo: PosKey, hi: PosKey): void {
  for (let i = 0; i < WARMUP_OPS; i += 1) {
    between(lo, hi)
  }
}

describe('position perf', () => {
  test(`10k after() calls complete under ${AFTER_BUDGET_MS}ms`, () => {
    const elapsed = timeMs(() => {
      let pos = makePosition()
      for (let i = 0; i < OPS; i += 1) {
        pos = after(pos)
      }
    }, warmupAfter)

    expect(elapsed).toBeLessThan(AFTER_BUDGET_MS)
  })

  test(`10k between() calls complete under ${BETWEEN_BUDGET_MS}ms`, () => {
    const lo = makePosition()
    const hi = after(after(lo))

    const elapsed = timeMs(
      () => {
        for (let i = 0; i < OPS; i += 1) {
          between(lo, hi)
        }
      },
      () => {
        warmupBetween(lo, hi)
      },
    )

    expect(elapsed).toBeLessThan(BETWEEN_BUDGET_MS)
  })

  test('10k after() keeps PosKey length under 20', () => {
    let pos = makePosition()
    let maxLen = pos.length

    for (let i = 0; i < OPS; i += 1) {
      pos = after(pos)
      maxLen = Math.max(maxLen, pos.length)
    }

    expect(maxLen).toBeLessThan(MAX_POS_KEY_LENGTH)
  })
})
