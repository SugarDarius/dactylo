import { describe, expect, test } from 'vitest'

import {
  createNumberedListItemBlock,
  createParagraphBlock,
  isNumberedListItemBlock,
} from '../../src/internals/blocks'
import type { Block, BlockId } from '../../src/internals/blocks'
import type { DocumentState } from '../../src/internals/document'
import { parseNumberedListMarkdownShortcut } from '../../src/internals/markdown-shortcut-ops-builder'
import { createTextNode } from '../../src/internals/nodes'
import {
  formatMarkerNumbering,
  getDefaultMarkerNumbering,
  getMarkerNumbering,
  markerNumberingAfterNeighbor,
  parseMarkerNumbering,
  toAlphaIndex,
  toRomanIndex,
} from '../../src/internals/numbered-list-marker'
import { buildReindexNumberedListSuffixOps } from '../../src/internals/operations-builder'
import { makeInitialPosition } from '../../src/internals/position'

const posKey = makeInitialPosition()
const emptyContent = [createTextNode({ text: '' })]

function numbered(
  variant: 'default' | 'alpha' | 'roman' = 'default',
  markerNumbering?: string,
) {
  return createNumberedListItemBlock({
    content: emptyContent,
    markerNumbering,
    posKey,
    variant,
  })
}

function paragraph() {
  return createParagraphBlock({ content: emptyContent, posKey })
}

function markerFromPatch(patch: Block | undefined): string | false {
  return (
    patch !== undefined &&
    isNumberedListItemBlock(patch) &&
    patch.markerNumbering
  )
}

function stateOf(blocks: Block[]): DocumentState {
  const order = blocks.map((block) => block.id)
  const map = new Map<BlockId, Block>(blocks.map((block) => [block.id, block]))
  return {
    blockOrderById: order,
    blocks: map,
    schemaVersion: 1,
  }
}

describe('formatMarkerNumbering', () => {
  test('formats default, alpha, and roman glyphs', () => {
    expect(formatMarkerNumbering(1, 'default')).toBe('1.')
    expect(formatMarkerNumbering(2, 'default')).toBe('2.')
    expect(formatMarkerNumbering(1, 'alpha')).toBe('a.')
    expect(formatMarkerNumbering(27, 'alpha')).toBe('aa.')
    expect(formatMarkerNumbering(1, 'roman')).toBe('i.')
    expect(formatMarkerNumbering(4, 'roman')).toBe('iv.')
  })
})

describe('toRomanIndex / toAlphaIndex', () => {
  test('maps 1-based values', () => {
    expect(toRomanIndex(1)).toBe('i')
    expect(toRomanIndex(14)).toBe('xiv')
    expect(toAlphaIndex(1)).toBe('a')
    expect(toAlphaIndex(26)).toBe('z')
    expect(toAlphaIndex(27)).toBe('aa')
  })
})

describe('parseMarkerNumbering / getMarkerNumbering', () => {
  test('round-trips ordinals and increments', () => {
    expect(parseMarkerNumbering('2.', 'default')).toBe(2)
    expect(parseMarkerNumbering('aa.', 'alpha')).toBe(27)
    expect(parseMarkerNumbering('iv.', 'roman')).toBe(4)
    expect(getMarkerNumbering('2.', 'default')).toBe('3.')
    expect(getMarkerNumbering('z.', 'alpha')).toBe('aa.')
    expect(getMarkerNumbering('iv.', 'roman')).toBe('v.')
  })
})

describe('markerNumberingAfterNeighbor', () => {
  test('increments a same-variant numbered neighbor and defaults otherwise', () => {
    const prev = numbered('default', '2.')
    expect(markerNumberingAfterNeighbor(prev, 'default')).toBe('3.')
    expect(markerNumberingAfterNeighbor(prev, 'roman')).toBe('i.')
    expect(markerNumberingAfterNeighbor(paragraph(), 'default')).toBe('1.')
    expect(markerNumberingAfterNeighbor(null, 'alpha')).toBe('a.')
    expect(getDefaultMarkerNumbering('roman')).toBe('i.')
  })
})

describe('parseNumberedListMarkdownShortcut', () => {
  test('parses default, alpha, and roman prefixes including the trigger space', () => {
    expect(parseNumberedListMarkdownShortcut('2. ')).toEqual({
      markerNumbering: '2.',
      variant: 'default',
    })
    expect(parseNumberedListMarkdownShortcut('a. ')).toEqual({
      markerNumbering: 'a.',
      variant: 'alpha',
    })
    expect(parseNumberedListMarkdownShortcut('ii. ')).toEqual({
      markerNumbering: 'ii.',
      variant: 'roman',
    })
    expect(parseNumberedListMarkdownShortcut('i. ')).toEqual({
      markerNumbering: 'i.',
      variant: 'roman',
    })
    expect(parseNumberedListMarkdownShortcut('c. ')).toEqual({
      markerNumbering: 'c.',
      variant: 'alpha',
    })
    expect(parseNumberedListMarkdownShortcut('- ')).toBeNull()
    expect(parseNumberedListMarkdownShortcut('0. ')).toBeNull()
  })
})

describe('buildReindexNumberedListSuffixOps', () => {
  test('continues a run after an assigned marker', () => {
    const a = numbered('default', '1.')
    const b = numbered('default', '2.')
    const c = numbered('default', '3.')
    const ops = buildReindexNumberedListSuffixOps(stateOf([a, b, c]), a.id, {
      kind: 'continue',
      markerNumbering: '2.',
      variant: 'default',
    })

    expect(ops).toHaveLength(2)
    expect(markerFromPatch(ops[0]?.patch)).toBe('3.')
    expect(markerFromPatch(ops[1]?.patch)).toBe('4.')
  })

  test('keep-start leaves the first suffix item and increments the rest', () => {
    const gap = paragraph()
    const b = numbered('default', '3.')
    const c = numbered('default', '9.')
    const ops = buildReindexNumberedListSuffixOps(
      stateOf([gap, b, c]),
      gap.id,
      { kind: 'keep-start' },
    )

    expect(ops).toHaveLength(1)
    expect(markerFromPatch(ops[0]?.patch)).toBe('4.')
  })

  test('restart forces the first matching item to 1.', () => {
    const a = numbered('roman', 'ii.')
    const b = numbered('default', '3.')
    const c = numbered('default', '4.')
    const ops = buildReindexNumberedListSuffixOps(stateOf([a, b, c]), a.id, {
      kind: 'restart',
      variant: 'default',
    })

    expect(ops).toHaveLength(2)
    expect(markerFromPatch(ops[0]?.patch)).toBe('1.')
    expect(markerFromPatch(ops[1]?.patch)).toBe('2.')
  })
})
