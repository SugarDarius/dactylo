import { describe, expect, test } from 'vitest'

import { isMarkEnabled } from '../../src/internals/marks'
import { isInlineNodeWithEditableText } from '../../src/internals/nodes'
import {
  assertUndoRedo,
  blockTexts,
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

  test('Enter in the middle of the second of four paragraphs inserts the tail before the third', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['First', 'Second', 'Third', 'Fourth'])
    const second = nthInlineBlock(pipeline.context, 1)
    setCursor(pipeline, { ...startOfBlock(second), offset: 3 })
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual([
      'First',
      'Sec',
      'ond',
      'Third',
      'Fourth',
    ])
    expect(pipeline.context.state.blocks.size).toBe(5)
    assertUndoRedo(pipeline, before)
  })

  test('Enter at the end of the second of four paragraphs inserts before the third', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['First', 'Second', 'Third', 'Fourth'])
    setCursor(pipeline, endOfBlock(nthInlineBlock(pipeline.context, 1)))
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual([
      'First',
      'Second',
      '',
      'Third',
      'Fourth',
    ])
    expect(pipeline.context.state.blocks.size).toBe(5)
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

  test('Enter at the end of a bullet list item inserts another item and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '-')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hello', ''])
    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toEqual(['bullet_list_item', 'bullet_list_item'])
    assertUndoRedo(pipeline, before)
  })

  test('Enter in the middle of a bullet list item splits it and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '-')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 2 })
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['He', 'llo'])
    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toEqual(['bullet_list_item', 'bullet_list_item'])
    assertUndoRedo(pipeline, before)
  })

  test('Enter on an empty bullet list item mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '-')
    typeText(pipeline, ' ')
    const itemId = firstInlineBlock(pipeline.context).id
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.id).toBe(itemId)
    expect(block.__type).toBe('paragraph')
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    assertUndoRedo(pipeline, before)
  })

  test('Enter on a whitespace-only bullet list item mutates it to a paragraph', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '-')
    typeText(pipeline, ' ')
    typeText(pipeline, ' ')
    const itemId = firstInlineBlock(pipeline.context).id

    hardBreak(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.id).toBe(itemId)
    expect(block.__type).toBe('paragraph')
    expect(blockTexts(pipeline.context)).toEqual([' '])
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
  })

  test('Enter at the end of a checkbox list item inserts another item and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '[]')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hello', ''])
    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toEqual(['checkbox_list_item', 'checkbox_list_item'])
    assertUndoRedo(pipeline, before)
  })

  test('Enter in the middle of a checkbox list item splits it and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '[]')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 2 })
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['He', 'llo'])
    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toEqual(['checkbox_list_item', 'checkbox_list_item'])
    assertUndoRedo(pipeline, before)
  })

  test('Enter on an empty checkbox list item mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '[]')
    typeText(pipeline, ' ')
    const itemId = firstInlineBlock(pipeline.context).id
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.id).toBe(itemId)
    expect(block.__type).toBe('paragraph')
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    assertUndoRedo(pipeline, before)
  })

  test('Enter at the end of a numbered list item inserts another item and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const leftoverId = firstInlineBlock(pipeline.context).id
    pipeline.insertNumberedListItemBlock({ pos: { type: 'start' } }, 'user')
    pipeline.deleteBlock(leftoverId, 'user')
    focus(pipeline)
    typeText(pipeline, 'Hello')
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hello', ''])
    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toEqual(['numbered_list_item', 'numbered_list_item'])
    const successor = nthInlineBlock(pipeline.context, 1)
    expect(successor.__type).toBe('numbered_list_item')
    if (successor.__type === 'numbered_list_item') {
      expect(successor.variant).toBe('default')
      expect(successor.markerNumbering).toBe('2.')
    }
    assertUndoRedo(pipeline, before)
  })

  test('Enter in the middle of a numbered list item splits it and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const leftoverId = firstInlineBlock(pipeline.context).id
    pipeline.insertNumberedListItemBlock({ pos: { type: 'start' } }, 'user')
    pipeline.deleteBlock(leftoverId, 'user')
    focus(pipeline)
    typeText(pipeline, 'Hello')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 2 })
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['He', 'llo'])
    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toEqual(['numbered_list_item', 'numbered_list_item'])
    assertUndoRedo(pipeline, before)
  })

  test('Enter on an empty numbered list item mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const leftoverId = firstInlineBlock(pipeline.context).id
    pipeline.insertNumberedListItemBlock({ pos: { type: 'start' } }, 'user')
    pipeline.deleteBlock(leftoverId, 'user')
    focus(pipeline)
    const itemId = firstInlineBlock(pipeline.context).id
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.id).toBe(itemId)
    expect(block.__type).toBe('paragraph')
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    assertUndoRedo(pipeline, before)
  })

  test('Enter on a whitespace-only numbered list item mutates it to a paragraph', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const leftoverId = firstInlineBlock(pipeline.context).id
    pipeline.insertNumberedListItemBlock({ pos: { type: 'start' } }, 'user')
    pipeline.deleteBlock(leftoverId, 'user')
    focus(pipeline)
    typeText(pipeline, ' ')
    const itemId = firstInlineBlock(pipeline.context).id

    hardBreak(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.id).toBe(itemId)
    expect(block.__type).toBe('paragraph')
    expect(blockTexts(pipeline.context)).toEqual([' '])
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
  })

  test('Enter at the end of a quote inserts a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '>')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hello', ''])
    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toEqual(['quote', 'paragraph'])
    assertUndoRedo(pipeline, before)
  })

  test('Enter in the middle of a quote splits it into a quote then a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '>')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 2 })
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['He', 'llo'])
    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toEqual(['quote', 'paragraph'])
    assertUndoRedo(pipeline, before)
  })

  test('Enter on an empty quote mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '>')
    typeText(pipeline, ' ')
    const quoteId = firstInlineBlock(pipeline.context).id
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.id).toBe(quoteId)
    expect(block.__type).toBe('paragraph')
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    assertUndoRedo(pipeline, before)
  })

  test('Enter on a whitespace-only quote mutates it to a paragraph', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '>')
    typeText(pipeline, ' ')
    typeText(pipeline, ' ')
    const quoteId = firstInlineBlock(pipeline.context).id

    hardBreak(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.id).toBe(quoteId)
    expect(block.__type).toBe('paragraph')
    expect(blockTexts(pipeline.context)).toEqual([' '])
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
  })
})
