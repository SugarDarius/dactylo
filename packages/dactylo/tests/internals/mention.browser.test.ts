import { describe, expect, test } from 'vitest'

import {
  createDividerBlock,
  createParagraphBlock,
  createParagraphBlockAfter,
} from '../../src/internals/blocks'
import { createDocumentState, putBlock } from '../../src/internals/document'
import {
  extractMention,
  omitBlockProps,
  resolveMentionBlockNeighborsRadii,
} from '../../src/internals/mention'
import {
  createMentionNode,
  createTextNode,
  generateNodeId,
  isTextNode,
} from '../../src/internals/nodes'
import { after, makeInitialPosition } from '../../src/internals/position'

function mentionNode(id: string) {
  return createMentionNode({
    entity: { data: { name: id }, id },
    metadata: { bgColor: 'blue' },
  })
}

/**
 * A → mention in first paragraph
 * B → text
 * C → text, mention, text
 * divider
 * E → mention in last paragraph
 */
function mentionDocument() {
  const mentionA = mentionNode('a')
  const mentionC = mentionNode('c')
  const mentionE = mentionNode('e')

  const a = createParagraphBlock({
    content: [mentionA],
    posKey: makeInitialPosition(),
  })
  let state = putBlock(createDocumentState(), a)

  const b = createParagraphBlockAfter(a, [createTextNode({ text: 'B' })])
  state = putBlock(state, b)

  const c = createParagraphBlockAfter(b, [
    createTextNode({ text: 'hi ' }),
    mentionC,
    createTextNode({ text: ' there' }),
  ])
  state = putBlock(state, c)

  const divider = createDividerBlock({ posKey: after(c.posKey) })
  state = putBlock(state, divider)

  const e = createParagraphBlockAfter(divider, [mentionE])
  state = putBlock(state, e)

  return { a, b, c, divider, e, mentionA, mentionC, mentionE, state }
}

describe('resolveMentionBlockNeighborsRadii', () => {
  test('defaults and non-positive numbers are zero on both sides', () => {
    expect(resolveMentionBlockNeighborsRadii(undefined)).toEqual({
      next: 0,
      prev: 0,
    })
    expect(resolveMentionBlockNeighborsRadii(0)).toEqual({ next: 0, prev: 0 })
    expect(resolveMentionBlockNeighborsRadii(-3)).toEqual({ next: 0, prev: 0 })
    expect(resolveMentionBlockNeighborsRadii({})).toEqual({ next: 0, prev: 0 })
  })

  test('a number is a symmetric radius', () => {
    expect(resolveMentionBlockNeighborsRadii(2)).toEqual({ next: 2, prev: 2 })
  })

  test('an object sets each side independently and treats omitted keys as zero', () => {
    expect(resolveMentionBlockNeighborsRadii({ next: 2, prev: 1 })).toEqual({
      next: 2,
      prev: 1,
    })
    expect(resolveMentionBlockNeighborsRadii({ prev: 1 })).toEqual({
      next: 0,
      prev: 1,
    })
    expect(resolveMentionBlockNeighborsRadii({ next: 2 })).toEqual({
      next: 2,
      prev: 0,
    })
    expect(resolveMentionBlockNeighborsRadii({ next: 3, prev: -2 })).toEqual({
      next: 3,
      prev: 0,
    })
  })
})

describe('omitBlockProps', () => {
  test('drops posKey and parentId', () => {
    const block = createParagraphBlock({
      content: [createTextNode({ text: '' })],
      posKey: makeInitialPosition(),
    })
    const omitted = omitBlockProps(block)

    expect(omitted).not.toHaveProperty('posKey')
    expect(omitted).not.toHaveProperty('parentId')
    expect(omitted.id).toBe(block.id)
    expect(omitted.__type).toBe('paragraph')
    expect(omitted.content).toBe(block.content)
  })
})

describe('extractMention', () => {
  test('returns null when the node is missing or is not a mention', () => {
    const { b, state } = mentionDocument()
    const [text] = b.content
    if (!text || !isTextNode(text)) {
      throw new Error('Expected a text node')
    }

    expect(extractMention(state, generateNodeId())).toBeNull()
    expect(extractMention(state, text.id)).toBeNull()
  })

  test('returns the mention node, owning block, and content index', () => {
    const { c, mentionC, state } = mentionDocument()
    const found = extractMention(state, mentionC.id)

    expect(found).toEqual({
      ...mentionC,
      block: omitBlockProps(c),
      index: 1,
      neighbors: { next: [], prev: [] },
    })
    expect(found).not.toHaveProperty('posKey')
    expect(found?.block).not.toHaveProperty('parentId')
  })

  test('includes one block on each side when neighbors is 1', () => {
    const { b, c, divider, mentionC, state } = mentionDocument()
    const found = extractMention(state, mentionC.id, { neighbors: 1 })

    expect(found?.neighbors.prev).toEqual([omitBlockProps(b)])
    expect(found?.neighbors.next).toEqual([omitBlockProps(divider)])
    expect(found?.block.id).toBe(c.id)
  })

  test('includes two blocks on each side when neighbors is 2', () => {
    const { a, b, divider, e, mentionC, state } = mentionDocument()
    const found = extractMention(state, mentionC.id, { neighbors: 2 })

    expect(found?.neighbors.prev.map((block) => block.id)).toEqual([a.id, b.id])
    expect(found?.neighbors.next.map((block) => block.id)).toEqual([
      divider.id,
      e.id,
    ])
  })

  test('supports an asymmetric radius', () => {
    const { b, divider, e, mentionC, state } = mentionDocument()
    const found = extractMention(state, mentionC.id, {
      neighbors: { next: 2, prev: 1 },
    })

    expect(found?.neighbors.prev.map((block) => block.id)).toEqual([b.id])
    expect(found?.neighbors.next.map((block) => block.id)).toEqual([
      divider.id,
      e.id,
    ])
  })

  test('omitted object keys and a radius past the document edge yield fewer neighbors', () => {
    const { b, c, divider, mentionA, mentionE, state } = mentionDocument()

    const first = extractMention(state, mentionA.id, { neighbors: 2 })
    expect(first?.neighbors.prev).toEqual([])
    expect(first?.neighbors.next.map((block) => block.id)).toEqual([b.id, c.id])

    const last = extractMention(state, mentionE.id, { neighbors: { prev: 2 } })
    expect(last?.neighbors.prev.map((block) => block.id)).toEqual([
      c.id,
      divider.id,
    ])
    expect(last?.neighbors.next).toEqual([])
  })

  test('skips divider blocks when locating the mention, but can return them as neighbors', () => {
    const { divider, mentionE, state } = mentionDocument()
    const found = extractMention(state, mentionE.id, { neighbors: 1 })

    expect(found?.neighbors.prev).toEqual([omitBlockProps(divider)])
    expect(found?.__type).toBe('mention')
  })
})
