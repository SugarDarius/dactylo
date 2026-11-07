import { describe, expect, test } from 'vitest'

import {
  createLineBreakNode,
  createLinkNode,
  createTextNode,
  generateNodeId,
  isInlineContentEmpty,
  isInlineContentTextEmpty,
  isInlineContentWithoutVisibleText,
} from '../../src/internals/nodes'
import type { MentionNode } from '../../src/internals/nodes'

function mention(): MentionNode {
  return {
    __type: 'mention',
    artefact: { key: 'user', type: 'user' },
    createdAt: new Date(),
    id: generateNodeId(),
    metadata: {},
    updatedAt: null,
  }
}

function emptyLink() {
  return createLinkNode({
    text: '',
    url: { href: 'https://example.com', title: '' },
  })
}

describe('isInlineContentEmpty', () => {
  test('is true for empty text and empty link nodes', () => {
    expect(isInlineContentEmpty([createTextNode({ text: '' })])).toBe(true)
    expect(isInlineContentEmpty([emptyLink()])).toBe(true)
  })

  test('is false once any characters are inserted, including spaces', () => {
    expect(isInlineContentEmpty([createTextNode({ text: ' ' })])).toBe(false)
    expect(isInlineContentEmpty([createTextNode({ text: '  ' })])).toBe(false)
    expect(isInlineContentEmpty([createTextNode({ text: 'a' })])).toBe(false)
  })

  test('is false for structural inlines', () => {
    expect(isInlineContentEmpty([createLineBreakNode()])).toBe(false)
    expect(isInlineContentEmpty([mention()])).toBe(false)
  })
})

describe('isInlineContentWithoutVisibleText', () => {
  test('treats whitespace-only editable text as empty', () => {
    expect(
      isInlineContentWithoutVisibleText([createTextNode({ text: '' })]),
    ).toBe(true)
    expect(
      isInlineContentWithoutVisibleText([createTextNode({ text: ' ' })]),
    ).toBe(true)
    expect(
      isInlineContentWithoutVisibleText([createTextNode({ text: '  ' })]),
    ).toBe(true)
    expect(isInlineContentWithoutVisibleText([emptyLink()])).toBe(true)
  })

  test('is false for visible text and structural inlines', () => {
    expect(
      isInlineContentWithoutVisibleText([createTextNode({ text: 'a' })]),
    ).toBe(false)
    expect(isInlineContentWithoutVisibleText([createLineBreakNode()])).toBe(
      false,
    )
    expect(isInlineContentWithoutVisibleText([mention()])).toBe(false)
  })
})

describe('isInlineContentTextEmpty', () => {
  test('is false for spaces and true when every node has text length 0', () => {
    expect(isInlineContentTextEmpty([createTextNode({ text: ' ' })])).toBe(
      false,
    )
    expect(isInlineContentTextEmpty([createTextNode({ text: '  ' })])).toBe(
      false,
    )
    expect(isInlineContentTextEmpty([createTextNode({ text: 'a' })])).toBe(
      false,
    )
    expect(isInlineContentTextEmpty([createTextNode({ text: '' })])).toBe(true)
    expect(isInlineContentTextEmpty([emptyLink()])).toBe(true)
    expect(isInlineContentTextEmpty([createLineBreakNode()])).toBe(true)
    expect(isInlineContentTextEmpty([mention()])).toBe(true)
  })
})
