import { describe, expect, test } from 'vitest'

import { isInlineNodeWithEditableText } from '../../src/internals/nodes'
import {
  assertUndoRedo,
  blockTexts,
  deleteBackward,
  endOfBlock,
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
  softBreak,
  startOfBlock,
  tryDeleteBackward,
  typeLines,
  typeText,
} from '../utils/pipeline'

describe('TransactionPipeline delete content', () => {
  test('Backspace at the start of the document is a no-op', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    setCursor(pipeline, { ...requireCursor(pipeline.context), offset: 0 })
    const before = snapshot(pipeline.context)

    expect(tryDeleteBackward(pipeline)).toBe(false)
    expect(snapshot(pipeline.context)).toEqual(before)
  })

  test('Backspace deletes the previous character and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['H'])
    assertUndoRedo(pipeline, before)
  })

  test('Backspace over a same-node range deletes it and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    selectOffsetsInCurrentNode(pipeline, 1, 4)
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Ho'])
    assertUndoRedo(pipeline, before)
  })

  test('Backspace over a same-block range across a line break and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    softBreak(pipeline)
    typeText(pipeline, 'Yo')
    const block = firstInlineBlock(pipeline.context)
    const [first] = block.content
    const last = block.content.at(-1)
    if (!first || !last || !isInlineNodeWithEditableText(last)) {
      throw new Error('Expected text around a line break')
    }
    selectRange(
      pipeline,
      { blockId: block.id, nodeId: first.id, offset: 1 },
      { blockId: block.id, nodeId: last.id, offset: 1 },
    )
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Ho'])
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at the empty node after a line break removes the break and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    softBreak(pipeline)
    const before = snapshot(pipeline.context)

    expect(
      firstInlineBlock(pipeline.context).content.map((node) => node.__type),
    ).toEqual(['text', 'line_break', 'text'])

    deleteBackward(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.content.map((node) => node.__type)).toEqual(['text'])
    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
    expect(requireCursor(pipeline.context).offset).toBe(5)
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at the start of text after a line break joins the lines and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    softBreak(pipeline)
    typeText(pipeline, 'World')
    setCursor(pipeline, { ...requireCursor(pipeline.context), offset: 0 })
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(
      firstInlineBlock(pipeline.context).content.map((node) => node.__type),
    ).toEqual(['text'])
    expect(blockTexts(pipeline.context)).toEqual(['HelloWorld'])
    expect(requireCursor(pipeline.context).offset).toBe(5)
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at the start of the next block merges and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    typeText(pipeline, 'World')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 0 })
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['HelloWorld'])
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    assertUndoRedo(pipeline, before)
  })

  test('deleting a range across two blocks merges the survivors and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
    )
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)[0]).toBe('Helrld')
    assertUndoRedo(pipeline, before)
  })

  test('deleting four paragraphs from the first letter through the last letter', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['F', 'S', 'D', 'E'])
    selectRange(
      pipeline,
      startOfBlock(nthInlineBlock(pipeline.context, 0)),
      endOfBlock(nthInlineBlock(pipeline.context, 3)),
    )
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)).toEqual([''])
    assertUndoRedo(pipeline, before)
  })

  test('deleting four paragraphs through the last letter, leaving a trailing empty node', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['F', 'S', 'D', 'E'])
    pipeline.toggleMark('bold', 'user')
    pipeline.toggleMark('bold', 'user')

    const last = nthInlineBlock(pipeline.context, 3)
    expect(last.content).toHaveLength(2)
    const [eNode] = last.content
    if (!eNode || !isInlineNodeWithEditableText(eNode)) {
      throw new Error('Expected the last block to start with "E"')
    }

    selectRange(pipeline, startOfBlock(nthInlineBlock(pipeline.context, 0)), {
      blockId: last.id,
      nodeId: eNode.id,
      offset: eNode.text.length,
    })
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)).toEqual([''])
    assertUndoRedo(pipeline, before)
  })

  test('deleting a reversed cross-block range still merges in document order', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
    )
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)[0]).toBe('Helrld')
    assertUndoRedo(pipeline, before)
  })
})
