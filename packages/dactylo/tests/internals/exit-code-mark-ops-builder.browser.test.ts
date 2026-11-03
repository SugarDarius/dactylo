import { describe, expect, test } from 'vitest'

import { isMarkEnabled } from '../../src/internals/marks'
import { isLinkNode, isTextNode } from '../../src/internals/nodes'
import {
  assertUndoRedo,
  deleteBackward,
  firstInlineBlock,
  focus,
  makePipeline,
  pastePlainText,
  pressKey,
  requireCursor,
  selectOffsetsInCurrentNode,
  setCursor,
  snapshot,
  typeText,
} from '../utils/pipeline'

describe('TransactionPipeline exit code mark', () => {
  test('ArrowRight at the end of a code text node inserts a space hatch and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    pipeline.toggleMark('code', 'user')
    typeText(pipeline, 'hello')
    const before = snapshot(pipeline.context)

    const handled = pressKey(pipeline, 'ArrowRight')

    expect(handled).toBe(true)
    const block = firstInlineBlock(pipeline.context)
    expect(block.content).toHaveLength(2)

    const [coded, hatch] = block.content
    if (!coded || !hatch || !isTextNode(coded) || !isTextNode(hatch)) {
      throw new Error('Expected a code text node followed by a space hatch')
    }
    expect(coded.text).toBe('hello')
    expect(isMarkEnabled(coded.marks, 'code')).toBe(true)
    expect(hatch.text).toBe(' ')
    expect(isMarkEnabled(hatch.marks, 'code')).toBe(false)

    const caret = requireCursor(pipeline.context)
    expect(caret.nodeId).toBe(hatch.id)
    expect(caret.offset).toBe(1)

    assertUndoRedo(pipeline, before)
  })

  test('ArrowRight is a no-op when a non-code text sibling already follows', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    pipeline.toggleMark('code', 'user')
    typeText(pipeline, 'hello')
    pressKey(pipeline, 'ArrowRight')
    const codeNodeId = firstInlineBlock(pipeline.context).content[0]?.id
    if (!codeNodeId) {
      throw new Error('Expected a code node')
    }
    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: codeNodeId,
      offset: 5,
    })
    const before = snapshot(pipeline.context)

    const handled = pressKey(pipeline, 'ArrowRight')

    expect(handled).toBe(false)
    expect(snapshot(pipeline.context)).toEqual(before)
  })

  test('ArrowRight mid-node does not insert a hatch', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    pipeline.toggleMark('code', 'user')
    typeText(pipeline, 'hello')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 2 })
    const before = snapshot(pipeline.context)

    const handled = pressKey(pipeline, 'ArrowRight')

    expect(handled).toBe(false)
    expect(snapshot(pipeline.context)).toEqual(before)
  })

  test('ArrowRight at the end of a code link inserts a text space hatch', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    pastePlainText(pipeline, 'https://liveblocks.io/')
    deleteBackward(pipeline)

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    selectOffsetsInCurrentNode(pipeline, 0, link.text.length)
    pipeline.toggleMark('code', 'user')
    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: link.id,
      offset: link.text.length,
    })
    const before = snapshot(pipeline.context)

    const handled = pressKey(pipeline, 'ArrowRight')

    expect(handled).toBe(true)
    const { content } = firstInlineBlock(pipeline.context)
    const hatch = content[content.length - 1]
    if (!hatch || !isTextNode(hatch)) {
      throw new Error('Expected a trailing text hatch')
    }
    expect(hatch.text).toBe(' ')
    expect(isMarkEnabled(hatch.marks, 'code')).toBe(false)
    expect(requireCursor(pipeline.context).nodeId).toBe(hatch.id)
    expect(requireCursor(pipeline.context).offset).toBe(1)
    assertUndoRedo(pipeline, before)
  })
})
