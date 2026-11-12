import { describe, expect, test } from 'vitest'

import {
  createParagraphBlockAfter,
  isParagraphBlock,
} from '../../src/internals/blocks'
import type { Block, ParagraphBlock } from '../../src/internals/blocks'
import {
  createInitialEmptyDocumentState,
  putBlock,
  putBlocks,
} from '../../src/internals/document'
import type { DocumentState } from '../../src/internals/document'
import { createTextNode, isTextNode } from '../../src/internals/nodes'
import { after } from '../../src/internals/position'

function firstParagraph(state: DocumentState): ParagraphBlock {
  const [id] = state.blockOrderById
  if (!id) {
    throw new Error('Expected a block')
  }

  const block = state.blocks.get(id)
  if (!block || !isParagraphBlock(block)) {
    throw new Error('Expected a paragraph')
  }

  return block
}

function withText(block: ParagraphBlock, text: string): ParagraphBlock {
  return { ...block, content: [createTextNode({ text })] }
}

function paragraphAfter(block: Block, text: string): ParagraphBlock {
  return createParagraphBlockAfter(block, [createTextNode({ text })])
}

describe('putBlock', () => {
  test('keeps blockOrderById when posKey is unchanged', () => {
    const state = createInitialEmptyDocumentState()
    const next = putBlock(state, withText(firstParagraph(state), 'Hello'))

    expect(next.blockOrderById).toBe(state.blockOrderById)
    expect(next.blocks).not.toBe(state.blocks)
    const [firstNode] = firstParagraph(state).content
    expect(
      firstNode && isTextNode(firstNode) ? firstNode.text : undefined,
    ).toBe('')
  })

  test('inserts a block and keeps existing ones', () => {
    const state = createInitialEmptyDocumentState()
    const first = firstParagraph(state)
    const second = paragraphAfter(first, 'B')
    const next = putBlock(state, second)

    expect(next.blocks.size).toBe(2)
    expect(next.blockOrderById).toEqual([first.id, second.id])
    expect(state.blocks.size).toBe(1)
  })

  test('reorders when posKey changes', () => {
    let state = createInitialEmptyDocumentState()
    state = putBlock(state, withText(firstParagraph(state), 'A'))
    const second = paragraphAfter(firstParagraph(state), 'B')
    state = putBlock(state, second)

    const moved = {
      ...firstParagraph(state),
      posKey: after(second.posKey),
    }
    const next = putBlock(state, moved)

    expect(next.blockOrderById).toEqual([second.id, moved.id])
  })
})

describe('putBlocks', () => {
  test('merges into the existing map instead of replacing it', () => {
    let state = createInitialEmptyDocumentState()
    const first = firstParagraph(state)
    state = putBlock(state, withText(first, 'A'))
    const second = paragraphAfter(firstParagraph(state), 'B')
    state = putBlock(state, second)
    const third = paragraphAfter(second, 'C')
    state = putBlock(state, third)

    const extra = paragraphAfter(third, 'D')
    const next = putBlocks(state, [
      withText(firstParagraph(state), 'A!'),
      extra,
    ])

    expect(next.blocks.size).toBe(4)
    expect(next.blockOrderById).toEqual([
      first.id,
      second.id,
      third.id,
      extra.id,
    ])
    const [patchedNode] = firstParagraph(next).content
    expect(
      patchedNode && isTextNode(patchedNode) ? patchedNode.text : undefined,
    ).toBe('A!')
  })

  test('keeps blockOrderById when every posKey is unchanged', () => {
    const state = createInitialEmptyDocumentState()
    const next = putBlocks(state, [withText(firstParagraph(state), 'Hello')])

    expect(next.blockOrderById).toBe(state.blockOrderById)
    expect(next.blocks.size).toBe(1)
  })
})

describe('createInitialEmptyDocumentState', () => {
  test('applies paragraph and text metadata to the empty document', () => {
    const state = createInitialEmptyDocumentState({
      paragraphMetadata: { source: 'paragraph' },
      textMetadata: { source: 'text' },
    })
    const block = firstParagraph(state)
    const [node] = block.content

    expect(block.metadata).toEqual({ source: 'paragraph' })
    expect(node && isTextNode(node) ? node.metadata : undefined).toEqual({
      source: 'text',
    })
  })
})
