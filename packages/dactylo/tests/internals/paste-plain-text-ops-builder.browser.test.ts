import { describe, expect, test } from 'vitest'

import {
  isInlineNodeWithEditableText,
  isLinkNode,
} from '../../src/internals/nodes'
import {
  assertNonEmptyInlinesPaintWithoutZwsp,
  assertUndoRedo,
  blockTexts,
  firstInlineBlock,
  focus,
  makePipeline,
  nthInlineBlock,
  pastePlainText,
  selectRange,
  snapshot,
  startOfBlock,
  typeLines,
  typeText,
} from '../utils/pipeline'

describe('TransactionPipeline paste', () => {
  test('pastes plain text at the caret and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    const before = snapshot(pipeline.context)

    pastePlainText(pipeline, ' there')

    expect(blockTexts(pipeline.context)).toEqual(['Hi there'])
    assertUndoRedo(pipeline, before)
  })

  test('pastes over a cross-block range and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
    )
    const before = snapshot(pipeline.context)

    pastePlainText(pipeline, 'X')

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)).toEqual(['HelXrld'])
    assertUndoRedo(pipeline, before)
  })

  test('pasting a URL after a trailing space does not paint ZWSP on the prefix', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, "Hello code what's up? ")
    pastePlainText(pipeline, 'https://localhost:3008/')

    const block = firstInlineBlock(pipeline.context)
    const [prefix] = block.content
    const link = block.content.find((node) => isLinkNode(node))

    if (!prefix || !isInlineNodeWithEditableText(prefix) || !link) {
      throw new Error('Expected a text prefix and a link node')
    }

    expect(prefix.text.endsWith(' ')).toBe(true)
    expect(isLinkNode(link)).toBe(true)
    assertNonEmptyInlinesPaintWithoutZwsp(pipeline.context)
  })
})
