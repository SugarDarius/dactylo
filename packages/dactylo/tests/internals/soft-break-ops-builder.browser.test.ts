import { describe, expect, test } from 'vitest'

import {
  assertUndoRedo,
  blockTexts,
  firstInlineBlock,
  focus,
  makePipeline,
  nthInlineBlock,
  requireCursor,
  selectRange,
  setCursor,
  snapshot,
  softBreak,
  startOfBlock,
  typeLines,
  typeText,
} from '../utils/pipeline'

describe('TransactionPipeline soft break', () => {
  test('Shift+Enter in the middle of a paragraph splits the node and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    setCursor(pipeline, { ...requireCursor(pipeline.context), offset: 2 })
    const before = snapshot(pipeline.context)

    softBreak(pipeline)

    expect(
      firstInlineBlock(pipeline.context).content.map((node) => node.__type),
    ).toEqual(['text', 'line_break', 'text'])
    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
    assertUndoRedo(pipeline, before)
  })

  test('Shift+Enter inserts a line break and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    const before = snapshot(pipeline.context)

    softBreak(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.content.map((node) => node.__type)).toEqual([
      'text',
      'line_break',
      'text',
    ])
    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
    assertUndoRedo(pipeline, before)
  })

  test('Shift+Enter over a cross-block range deletes it, inserts a line break, and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
    )
    const before = snapshot(pipeline.context)

    softBreak(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(
      firstInlineBlock(pipeline.context).content.map((node) => node.__type),
    ).toEqual(['text', 'line_break', 'text'])
    expect(blockTexts(pipeline.context)).toEqual(['Helrld'])
    assertUndoRedo(pipeline, before)
  })
})
