import { describe, expect, test } from 'vitest'

import {
  isInlineNodeWithEditableText,
  isLinkNode,
  isTextNode,
} from '../../src/internals/nodes'
import type { TextNode } from '../../src/internals/nodes'
import {
  assertUndoRedo,
  blockTexts,
  deleteBackward,
  firstInlineBlock,
  focus,
  makePipeline,
  nthInlineBlock,
  pastePlainText,
  requireCursor,
  selectOffsetsInCurrentNode,
  selectRange,
  setCursor,
  snapshot,
  startOfBlock,
  typeLines,
  typeText,
} from '../utils/pipeline'

describe('TransactionPipeline insertText', () => {
  test('types into the empty paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    typeText(pipeline, 'Hello')

    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
    expect(requireCursor(pipeline.context).offset).toBe(5)
    assertUndoRedo(pipeline, before)
  })

  test('typing over a selected run replaces it and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    selectOffsetsInCurrentNode(pipeline, 1, 4)
    const before = snapshot(pipeline.context)

    typeText(pipeline, 'y')

    expect(blockTexts(pipeline.context)).toEqual(['Hyo'])
    assertUndoRedo(pipeline, before)
  })

  test('typing over a cross-block range merges, inserts, and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
    )
    const before = snapshot(pipeline.context)

    typeText(pipeline, 'X')

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)).toEqual(['HelXrld'])
    assertUndoRedo(pipeline, before)
  })

  test('typing at the end of a link inserts a new text node; undo/redo round-trip', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    pastePlainText(pipeline, 'https://liveblocks.io/')
    deleteBackward(pipeline)

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: link.id,
      offset: link.text.length,
    })

    const before = snapshot(pipeline.context)

    typeText(pipeline, 'x')

    const nodes = firstInlineBlock(pipeline.context).content
    const typed = nodes.find(
      (node): node is TextNode => isTextNode(node) && node.text.includes('x'),
    )

    expect(blockTexts(pipeline.context)).toEqual([`${link.text}x`])
    expect(
      nodes.some((node) => isLinkNode(node) && node.text === link.text),
    ).toBe(true)
    expect(typed).toBeDefined()
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: typed?.id,
      offset: typed?.text.length,
    })
    assertUndoRedo(pipeline, before)
  })

  test('typing a space at the end of a markdown link inserts a new text node', () => {
    const pipeline = makePipeline({ autolink: true, markdown: true })
    focus(pipeline)
    typeText(pipeline, '[Liveblocks](https://liveblocks.io')
    typeText(pipeline, ')')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: link.id,
      offset: link.text.length,
    })

    typeText(pipeline, ' ')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )

    expect(blockTexts(pipeline.context)).toEqual(['Liveblocks '])
    expect(
      nodes.some((node) => isLinkNode(node) && node.text === 'Liveblocks'),
    ).toBe(true)
    expect(
      nodes.some((node) => isTextNode(node) && node.text.includes(' ')),
    ).toBe(true)
  })

  test('typing at the end of a link with following text still inserts a new text node', () => {
    const pipeline = makePipeline({ autolink: true, markdown: true })
    focus(pipeline)
    typeText(pipeline, 'Hello World')
    setCursor(pipeline, {
      ...requireCursor(pipeline.context),
      offset: 'Hello'.length,
    })
    typeText(pipeline, ' [Liveblocks](https://liveblocks.io')
    typeText(pipeline, ')')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: link.id,
      offset: link.text.length,
    })

    typeText(pipeline, 'X')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )
    const typed = nodes.find((node) => isTextNode(node) && node.text === 'X')

    expect(blockTexts(pipeline.context)).toEqual(['Hello LiveblocksX World'])
    expect(
      nodes.some((node) => isLinkNode(node) && node.text === 'Liveblocks'),
    ).toBe(true)
    expect(typed).toBeDefined()
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: typed?.id,
      offset: 1,
    })
  })

  test('typing at the beginning of a link inserts a new text node; undo/redo round-trip', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    pastePlainText(pipeline, 'https://liveblocks.io/')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: link.id,
      offset: 0,
    })
    const before = snapshot(pipeline.context)

    typeText(pipeline, 'x')

    const nodes = firstInlineBlock(pipeline.context).content
    const typed = nodes.find(
      (node): node is TextNode => isTextNode(node) && node.text.includes('x'),
    )

    expect(blockTexts(pipeline.context)).toEqual([`x${link.text} `])
    expect(
      nodes.some((node) => isLinkNode(node) && node.text === link.text),
    ).toBe(true)
    expect(typed).toBeDefined()
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: typed?.id,
      offset: typed?.text.length,
    })
    assertUndoRedo(pipeline, before)
  })

  test('typing a space at the beginning of a markdown link inserts a new text node', () => {
    const pipeline = makePipeline({ autolink: true, markdown: true })
    focus(pipeline)
    typeText(pipeline, '[Liveblocks](https://liveblocks.io')
    typeText(pipeline, ')')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: link.id,
      offset: 0,
    })

    typeText(pipeline, ' ')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )

    expect(blockTexts(pipeline.context)).toEqual([' Liveblocks'])
    expect(
      nodes.some((node) => isLinkNode(node) && node.text === 'Liveblocks'),
    ).toBe(true)
    expect(
      nodes.some((node) => isTextNode(node) && node.text.includes(' ')),
    ).toBe(true)
  })

  test('typing at the beginning of a link with preceding text still inserts a new text node', () => {
    const pipeline = makePipeline({ autolink: true, markdown: true })
    focus(pipeline)
    typeText(pipeline, 'Hello World')
    setCursor(pipeline, {
      ...requireCursor(pipeline.context),
      offset: 'Hello'.length,
    })
    typeText(pipeline, ' [Liveblocks](https://liveblocks.io')
    typeText(pipeline, ')')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: link.id,
      offset: 0,
    })

    typeText(pipeline, 'X')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )
    const typed = nodes.find((node) => isTextNode(node) && node.text === 'X')

    expect(blockTexts(pipeline.context)).toEqual(['Hello XLiveblocks World'])
    expect(
      nodes.some((node) => isLinkNode(node) && node.text === 'Liveblocks'),
    ).toBe(true)
    expect(typed).toBeDefined()
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: typed?.id,
      offset: 1,
    })
  })

  test('typing in the middle of a link still extends the link', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    pastePlainText(pipeline, 'https://liveblocks.io/')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    const mid = Math.floor(link.text.length / 2)
    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: link.id,
      offset: mid,
    })

    typeText(pipeline, 'X')

    const updated = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!updated) {
      throw new Error('Expected a link node after typing')
    }

    expect(updated.text).toBe(
      `${link.text.slice(0, mid)}X${link.text.slice(mid)}`,
    )
    expect(
      firstInlineBlock(pipeline.context).content.some(
        (node) => isTextNode(node) && node.text.includes('X'),
      ),
    ).toBe(false)
  })
})
