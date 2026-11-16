import { describe, expect, test } from 'vitest'

import { isMarkEnabled } from '../../src/internals/marks'
import { isInlineNodeWithEditableText } from '../../src/internals/nodes'
import {
  assertUndoRedo,
  blockTexts,
  deleteForward,
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
  tryDeleteForward,
  typeLines,
  typeText,
} from '../utils/pipeline'

describe('TransactionPipeline delete content forward', () => {
  test('Delete at the end of the document is a no-op', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    const before = snapshot(pipeline.context)

    expect(tryDeleteForward(pipeline)).toBe(false)
    expect(snapshot(pipeline.context)).toEqual(before)
  })

  test('Delete deletes the next character and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    setCursor(pipeline, { ...requireCursor(pipeline.context), offset: 1 })
    const before = snapshot(pipeline.context)

    deleteForward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['H'])
    assertUndoRedo(pipeline, before)
  })

  test('Delete deletes the next grapheme and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'A👍B')
    setCursor(pipeline, { ...requireCursor(pipeline.context), offset: 1 })
    const before = snapshot(pipeline.context)

    deleteForward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['AB'])
    assertUndoRedo(pipeline, before)
  })

  test('Delete over a same-node range deletes it and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    selectOffsetsInCurrentNode(pipeline, 1, 4)
    const before = snapshot(pipeline.context)

    deleteForward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Ho'])
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

    deleteForward(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)[0]).toBe('Helrld')
    assertUndoRedo(pipeline, before)
  })

  test('Delete at the end of a block merges with the next and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    typeText(pipeline, 'World')
    setCursor(pipeline, endOfBlock(nthInlineBlock(pipeline.context, 0)))
    const before = snapshot(pipeline.context)

    deleteForward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['HelloWorld'])
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    assertUndoRedo(pipeline, before)
  })

  test('Delete at the empty node after a line break removes the break and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    softBreak(pipeline)
    const block = firstInlineBlock(pipeline.context)
    const [first] = block.content
    if (!first || !isInlineNodeWithEditableText(first)) {
      throw new Error('Expected text before a line break')
    }
    setCursor(pipeline, {
      blockId: block.id,
      nodeId: first.id,
      offset: first.text.length,
    })
    const before = snapshot(pipeline.context)

    expect(
      firstInlineBlock(pipeline.context).content.map((node) => node.__type),
    ).toEqual(['text', 'line_break', 'text'])

    deleteForward(pipeline)

    expect(
      firstInlineBlock(pipeline.context).content.map((node) => node.__type),
    ).toEqual(['text'])
    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
    expect(requireCursor(pipeline.context).offset).toBe(5)
    assertUndoRedo(pipeline, before)
  })

  test('Delete at the end of text before a line break joins the lines and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    softBreak(pipeline)
    typeText(pipeline, 'World')
    const block = firstInlineBlock(pipeline.context)
    const [first] = block.content
    if (!first || !isInlineNodeWithEditableText(first)) {
      throw new Error('Expected text before a line break')
    }
    setCursor(pipeline, {
      blockId: block.id,
      nodeId: first.id,
      offset: first.text.length,
    })
    const before = snapshot(pipeline.context)

    deleteForward(pipeline)

    expect(
      firstInlineBlock(pipeline.context).content.map((node) => node.__type),
    ).toEqual(['text'])
    expect(blockTexts(pipeline.context)).toEqual(['HelloWorld'])
    expect(requireCursor(pipeline.context).offset).toBe(5)
    assertUndoRedo(pipeline, before)
  })

  test('Delete at node end drops a following empty runway instead of merging into it', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'HelloWorld')
    setCursor(pipeline, { ...requireCursor(pipeline.context), offset: 5 })
    pipeline.toggleMark('bold', 'user')

    const block = firstInlineBlock(pipeline.context)
    const hello = block.content.find(
      (node) => isInlineNodeWithEditableText(node) && node.text === 'Hello',
    )
    if (!hello || !isInlineNodeWithEditableText(hello)) {
      throw new Error('Expected a Hello node before the empty runway')
    }
    setCursor(pipeline, {
      blockId: block.id,
      nodeId: hello.id,
      offset: hello.text.length,
    })
    const before = snapshot(pipeline.context)

    deleteForward(pipeline)

    const after = firstInlineBlock(pipeline.context)
    const empty = after.content.filter(
      (node) => isInlineNodeWithEditableText(node) && node.text.length === 0,
    )
    expect(empty).toHaveLength(0)
    const worldAfter = after.content.find(
      (node) =>
        isInlineNodeWithEditableText(node) && node.text.includes('World'),
    )
    if (!worldAfter || !isInlineNodeWithEditableText(worldAfter)) {
      throw new Error('Expected World to remain after dropping the runway')
    }
    expect(isMarkEnabled(worldAfter.marks, 'bold')).toBe(false)
    assertUndoRedo(pipeline, before)
  })
})
