import { describe, expect, test } from 'vitest'

import {
  createBulletListItemBlock,
  createNumberedListItemBlock,
  createParagraphBlock,
} from '../../../src/internals/blocks'
import type { Block, BlockId } from '../../../src/internals/blocks'
import { createTextNode } from '../../../src/internals/nodes'
import { makeInitialPosition } from '../../../src/internals/position'
import {
  computeMarkerIndexes,
  formatMarkerIndex,
  toAlphaIndex,
  toRomanIndex,
} from '../../../src/react/internals/number-lists'

const posKey = makeInitialPosition()
const emptyContent = [createTextNode({ text: '' })]

function paragraph(): Block {
  return createParagraphBlock({ content: emptyContent, posKey })
}

function bullet(): Block {
  return createBulletListItemBlock({ content: emptyContent, posKey })
}

function numbered(variant: 'default' | 'alpha' | 'roman' = 'default'): Block {
  return createNumberedListItemBlock({
    content: emptyContent,
    posKey,
    variant,
  })
}

function indexesOf(blocks: Block[]) {
  const order = blocks.map((block) => block.id)
  const map = new Map<BlockId, Block>(blocks.map((block) => [block.id, block]))
  return { blocks, indexes: computeMarkerIndexes(order, map) }
}

describe('toRomanIndex', () => {
  test('maps 1-based values to lowercase roman numerals', () => {
    expect(toRomanIndex(1)).toBe('i')
    expect(toRomanIndex(4)).toBe('iv')
    expect(toRomanIndex(9)).toBe('ix')
    expect(toRomanIndex(14)).toBe('xiv')
  })
})

describe('toAlphaIndex', () => {
  test('maps 1-based values to lowercase alphabetic labels', () => {
    expect(toAlphaIndex(1)).toBe('a')
    expect(toAlphaIndex(26)).toBe('z')
    expect(toAlphaIndex(27)).toBe('aa')
  })
})

describe('formatMarkerIndex', () => {
  test('formats default, alpha, and roman glyphs', () => {
    expect(formatMarkerIndex(1, 'default')).toBe('1.')
    expect(formatMarkerIndex(2, 'default')).toBe('2.')
    expect(formatMarkerIndex(1, 'alpha')).toBe('a.')
    expect(formatMarkerIndex(27, 'alpha')).toBe('aa.')
    expect(formatMarkerIndex(1, 'roman')).toBe('i.')
    expect(formatMarkerIndex(4, 'roman')).toBe('iv.')
  })
})

describe('computeMarkerIndexes', () => {
  test('returns an empty map when the document has no blocks', () => {
    expect(computeMarkerIndexes([], new Map()).size).toBe(0)
  })

  test('numbers a consecutive same-variant run', () => {
    const a = numbered('default')
    const b = numbered('default')
    const c = numbered('default')
    const { indexes } = indexesOf([a, b, c])

    expect(indexes.get(a.id)).toBe('1.')
    expect(indexes.get(b.id)).toBe('2.')
    expect(indexes.get(c.id)).toBe('3.')
  })

  test('resets when the variant changes', () => {
    const a = numbered('default')
    const b = numbered('default')
    const c = numbered('roman')
    const d = numbered('roman')
    const e = numbered('alpha')
    const { indexes } = indexesOf([a, b, c, d, e])

    expect(indexes.get(a.id)).toBe('1.')
    expect(indexes.get(b.id)).toBe('2.')
    expect(indexes.get(c.id)).toBe('i.')
    expect(indexes.get(d.id)).toBe('ii.')
    expect(indexes.get(e.id)).toBe('a.')
  })

  test('resets when a non-numbered block breaks the run', () => {
    const a = numbered('default')
    const b = numbered('default')
    const gap = paragraph()
    const c = numbered('default')
    const { indexes } = indexesOf([a, b, gap, c])

    expect(indexes.get(a.id)).toBe('1.')
    expect(indexes.get(b.id)).toBe('2.')
    expect(indexes.has(gap.id)).toBe(false)
    expect(indexes.get(c.id)).toBe('1.')
  })

  test('resets when a bullet list item breaks the run', () => {
    const a = numbered('alpha')
    const gap = bullet()
    const b = numbered('alpha')
    const { indexes } = indexesOf([a, gap, b])

    expect(indexes.get(a.id)).toBe('a.')
    expect(indexes.has(gap.id)).toBe(false)
    expect(indexes.get(b.id)).toBe('a.')
  })

  test('resets when a block id in order is missing from the map', () => {
    const missing = numbered('default')
    const next = numbered('default')
    const indexes = computeMarkerIndexes(
      [missing.id, next.id],
      new Map([[next.id, next]]),
    )

    expect(indexes.has(missing.id)).toBe(false)
    expect(indexes.get(next.id)).toBe('1.')
  })
})
