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

  test('typing over a fully selected link replaces it with a text node; undo/redo round-trip', () => {
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
    selectOffsetsInCurrentNode(pipeline, 0, link.text.length)
    const before = snapshot(pipeline.context)

    typeText(pipeline, 'X')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )
    const typed = nodes.find((node) => isTextNode(node) && node.text === 'X')

    expect(blockTexts(pipeline.context)).toEqual(['X'])
    expect(nodes.some((node) => isLinkNode(node))).toBe(false)
    expect(typed).toBeDefined()
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: typed?.id,
      offset: 1,
    })
    assertUndoRedo(pipeline, before)
  })

  test('typing over a prefix of a link replaces that run with a text node', () => {
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
    selectOffsetsInCurrentNode(pipeline, 0, 'Live'.length)
    typeText(pipeline, 'X')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      (node) => isInlineNodeWithEditableText(node) && node.text.length > 0,
    )

    expect(blockTexts(pipeline.context)).toEqual(['Xblocks'])
    expect(
      nodes
        .filter(isInlineNodeWithEditableText)
        .map((node) => ({ text: node.text, type: node.__type })),
    ).toEqual([
      { text: 'X', type: 'text' },
      { text: 'blocks', type: 'link' },
    ])
  })

  test('typing over a suffix of a link replaces that run with a text node', () => {
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
    selectOffsetsInCurrentNode(pipeline, 'Live'.length, link.text.length)
    typeText(pipeline, 'X')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      (node) => isInlineNodeWithEditableText(node) && node.text.length > 0,
    )

    expect(blockTexts(pipeline.context)).toEqual(['LiveX'])
    expect(
      nodes
        .filter(isInlineNodeWithEditableText)
        .map((node) => ({ text: node.text, type: node.__type })),
    ).toEqual([
      { text: 'Live', type: 'link' },
      { text: 'X', type: 'text' },
    ])
  })

  test('typing over a middle run of a link splits it around a text node', () => {
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
    selectOffsetsInCurrentNode(pipeline, 1, 8)
    typeText(pipeline, 'X')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      (node) => isInlineNodeWithEditableText(node) && node.text.length > 0,
    )

    expect(blockTexts(pipeline.context)).toEqual(['LXks'])
    expect(
      nodes
        .filter(isInlineNodeWithEditableText)
        .map((node) => ({ text: node.text, type: node.__type })),
    ).toEqual([
      { text: 'L', type: 'link' },
      { text: 'X', type: 'text' },
      { text: 'ks', type: 'link' },
    ])
  })

  test('typing over a URL link suffix replaces that run with a text node', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    pastePlainText(pipeline, 'https://localhost:3008/')
    deleteBackward(pipeline)

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    const suffix = ':3008/'
    const from = link.text.indexOf(suffix)
    if (from === -1) {
      throw new Error('Expected the URL to contain :3008/')
    }

    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: link.id,
      offset: from,
    })
    selectOffsetsInCurrentNode(pipeline, from, link.text.length)
    typeText(pipeline, 'x')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      (node) => isInlineNodeWithEditableText(node) && node.text.length > 0,
    )
    const typed = nodes.find((node) => isTextNode(node) && node.text === 'x')

    expect(blockTexts(pipeline.context)).toEqual(['https://localhostx'])
    expect(
      nodes.some((node) => isLinkNode(node) && node.text.includes('x')),
    ).toBe(false)
    expect(
      nodes.some(
        (node) => isLinkNode(node) && node.text === 'https://localhost',
      ),
    ).toBe(true)
    expect(typed).toBeDefined()
  })

  test('typing over a link suffix that spills into the following text node inserts a text node', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    pastePlainText(pipeline, 'https://localhost:3008/')

    const block = firstInlineBlock(pipeline.context)
    const link = block.content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    const linkIndex = block.content.findIndex((node) => node.id === link.id)
    const nextNode = block.content[linkIndex + 1]
    if (!nextNode || !isTextNode(nextNode)) {
      throw new Error('Expected a text node after the pasted link')
    }

    const suffix = ':3008/'
    const from = link.text.indexOf(suffix)
    if (from === -1) {
      throw new Error('Expected the URL to contain :3008/')
    }

    selectRange(
      pipeline,
      {
        blockId: block.id,
        nodeId: link.id,
        offset: from,
      },
      {
        blockId: block.id,
        nodeId: nextNode.id,
        offset: nextNode.text.length,
      },
    )
    typeText(pipeline, 'x')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      (node) => isInlineNodeWithEditableText(node) && node.text.length > 0,
    )

    expect(
      nodes.some((node) => isLinkNode(node) && node.text.includes('x')),
    ).toBe(false)
    expect(
      nodes.some(
        (node) => isLinkNode(node) && node.text === 'https://localhost',
      ),
    ).toBe(true)
    expect(
      nodes.some((node) => isTextNode(node) && node.text.includes('x')),
    ).toBe(true)
  })
})
