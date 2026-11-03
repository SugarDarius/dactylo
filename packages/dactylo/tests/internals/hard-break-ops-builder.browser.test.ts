import { describe, expect, test } from 'vitest'

import { isMarkEnabled } from '../../src/internals/marks'
import { isInlineNodeWithEditableText } from '../../src/internals/nodes'
import {
  assertUndoRedo,
  blockTexts,
  firstInlineBlock,
  focus,
  hardBreak,
  makePipeline,
  nthInlineBlock,
  requireCursor,
  selectOffsetsInCurrentNode,
  selectRange,
  setCursor,
  snapshot,
  startOfBlock,
  typeLines,
  typeText,
} from '../utils/pipeline'

describe('TransactionPipeline hard break', () => {
  test('Enter at block end inserts a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hello', ''])
    expect(pipeline.context.state.blockOrderById).toHaveLength(2)
    assertUndoRedo(pipeline, before)
  })

  test('Enter in the middle of a paragraph splits it and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 2 })
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['He', 'llo'])
    assertUndoRedo(pipeline, before)
  })

  test('Enter over a cross-block range deletes it, splits, and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
    )
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hel', 'rld'])
    assertUndoRedo(pipeline, before)
  })

  test('Enter at the end of a bold node leaves the new paragraph unmarked', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    selectOffsetsInCurrentNode(pipeline, 0, 5)
    pipeline.toggleMark('bold', 'user')
    const headBlock = firstInlineBlock(pipeline.context)
    const [marked] = headBlock.content
    if (!marked || !isInlineNodeWithEditableText(marked)) {
      throw new Error('Expected the paragraph to stay one bold node')
    }
    setCursor(pipeline, {
      blockId: headBlock.id,
      nodeId: marked.id,
      offset: marked.text.length,
    })

    hardBreak(pipeline)

    const head = firstInlineBlock(pipeline.context)
    const tail = nthInlineBlock(pipeline.context, 1)
    const [headNode] = head.content
    const [tailNode] = tail.content
    if (
      !headNode ||
      !tailNode ||
      !isInlineNodeWithEditableText(headNode) ||
      !isInlineNodeWithEditableText(tailNode)
    ) {
      throw new Error('Expected editable text nodes on both sides of the break')
    }
    expect(head.content).toHaveLength(1)
    expect(headNode.text).toBe('Hello')
    expect(isMarkEnabled(headNode.marks, 'bold')).toBe(true)
    expect(tailNode.text).toBe('')
    expect(isMarkEnabled(tailNode.marks, 'bold')).toBe(false)
  })

  test('Enter from a trailing empty runway drops it and inserts an unmarked paragraph', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    pipeline.toggleMark('bold', 'user')
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    const head = firstInlineBlock(pipeline.context)
    const tail = nthInlineBlock(pipeline.context, 1)
    const [headNode] = head.content
    const [tailNode] = tail.content
    if (
      !headNode ||
      !tailNode ||
      !isInlineNodeWithEditableText(headNode) ||
      !isInlineNodeWithEditableText(tailNode)
    ) {
      throw new Error('Expected editable text nodes on both sides of the break')
    }
    expect(head.content).toHaveLength(1)
    expect(headNode.text).toBe('Hello')
    expect(isMarkEnabled(headNode.marks, 'bold')).toBe(false)
    expect(tailNode.text).toBe('')
    expect(isMarkEnabled(tailNode.marks, 'bold')).toBe(false)
    assertUndoRedo(pipeline, before)
  })

  test('Enter in the middle of a bold node keeps marks on both sides', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    selectOffsetsInCurrentNode(pipeline, 0, 5)
    pipeline.toggleMark('bold', 'user')
    const source = firstInlineBlock(pipeline.context)
    const [sourceNode] = source.content
    if (!sourceNode || !isInlineNodeWithEditableText(sourceNode)) {
      throw new Error('Expected the paragraph to stay one bold node')
    }
    setCursor(pipeline, {
      blockId: source.id,
      nodeId: sourceNode.id,
      offset: 2,
    })

    hardBreak(pipeline)

    const head = firstInlineBlock(pipeline.context)
    const tail = nthInlineBlock(pipeline.context, 1)
    const [headNode] = head.content
    const [tailNode] = tail.content
    if (
      !headNode ||
      !tailNode ||
      !isInlineNodeWithEditableText(headNode) ||
      !isInlineNodeWithEditableText(tailNode)
    ) {
      throw new Error('Expected editable text nodes on both sides of the split')
    }
    expect(headNode.text).toBe('He')
    expect(tailNode.text).toBe('llo')
    expect(isMarkEnabled(headNode.marks, 'bold')).toBe(true)
    expect(isMarkEnabled(tailNode.marks, 'bold')).toBe(true)
  })
})
