import { describe, expect, test } from 'vitest'

import {
  assertUndoRedo,
  blockTexts,
  focus,
  hardBreak,
  makePipeline,
  nthInlineBlock,
  requireCursor,
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
})
