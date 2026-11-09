import { describe, expect, test } from 'vitest'

import { isMarkEnabled } from '../../src/internals/marks'
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
    softBreak(pipeline)

    const last = nthInlineBlock(pipeline.context, 3)
    expect(last.content).toHaveLength(3)
    const trailing = last.content.at(-1)
    if (!trailing || !isInlineNodeWithEditableText(trailing)) {
      throw new Error(
        'Expected a trailing empty text node after the line break',
      )
    }

    selectRange(pipeline, startOfBlock(nthInlineBlock(pipeline.context, 0)), {
      blockId: last.id,
      nodeId: trailing.id,
      offset: trailing.text.length,
    })
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)).toEqual([''])
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at the start of the next block drops a trailing empty runway', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    setCursor(pipeline, endOfBlock(nthInlineBlock(pipeline.context, 0)))
    pipeline.toggleMark('bold', 'user')
    setCursor(pipeline, startOfBlock(nthInlineBlock(pipeline.context, 1)))
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)).toEqual(['HelloWorld'])
    const merged = firstInlineBlock(pipeline.context)
    const empty = merged.content.filter(
      (node) => isInlineNodeWithEditableText(node) && node.text.length === 0,
    )
    expect(empty).toHaveLength(0)
    for (const node of merged.content) {
      if (isInlineNodeWithEditableText(node)) {
        expect(isMarkEnabled(node.marks, 'bold')).toBe(false)
      }
    }
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at node start drops a previous empty runway instead of merging into it', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'HelloWorld')
    setCursor(pipeline, { ...requireCursor(pipeline.context), offset: 5 })
    pipeline.toggleMark('bold', 'user')

    const block = firstInlineBlock(pipeline.context)
    const world = block.content.find(
      (node) => isInlineNodeWithEditableText(node) && node.text === 'World',
    )
    if (!world || !isInlineNodeWithEditableText(world)) {
      throw new Error('Expected a World node after the empty runway')
    }
    setCursor(pipeline, {
      blockId: block.id,
      nodeId: world.id,
      offset: 0,
    })
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

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

  test('deleting a same-block range over mixed marks leaves one empty unmarked node', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello ')
    pipeline.toggleMark('bold', 'user')
    typeText(pipeline, 'World')

    const block = firstInlineBlock(pipeline.context)
    expect(block.content).toHaveLength(2)
    selectRange(pipeline, startOfBlock(block), endOfBlock(block))
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    const after = firstInlineBlock(pipeline.context)
    expect(after.content).toHaveLength(1)
    const [only] = after.content
    if (!only || !isInlineNodeWithEditableText(only)) {
      throw new Error('Expected a single empty text node')
    }
    expect(only.text).toBe('')
    expect(isMarkEnabled(only.marks, 'bold')).toBe(false)
    expect(blockTexts(pipeline.context)).toEqual([''])
    assertUndoRedo(pipeline, before)
  })

  test('deleting through the end of a later marked node does not leave an empty sibling', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello ')
    pipeline.toggleMark('bold', 'user')
    typeText(pipeline, 'World')

    const block = firstInlineBlock(pipeline.context)
    const [first, last] = block.content
    if (
      !first ||
      !last ||
      !isInlineNodeWithEditableText(first) ||
      !isInlineNodeWithEditableText(last)
    ) {
      throw new Error('Expected two text nodes')
    }

    selectRange(
      pipeline,
      { blockId: block.id, nodeId: first.id, offset: 1 },
      { blockId: block.id, nodeId: last.id, offset: last.text.length },
    )
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    const after = firstInlineBlock(pipeline.context)
    expect(after.content).toHaveLength(1)
    const [only] = after.content
    if (!only || !isInlineNodeWithEditableText(only)) {
      throw new Error('Expected the surviving prefix')
    }
    expect(only.text).toBe('H')
    expect(isMarkEnabled(only.marks, 'bold')).toBe(false)
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

  test('Backspace on an empty bullet list item mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '-')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    const itemId = nthInlineBlock(pipeline.context, 1).id
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hello', ''])
    expect(nthInlineBlock(pipeline.context, 0).__type).toBe('bullet_list_item')
    const converted = nthInlineBlock(pipeline.context, 1)
    expect(converted.id).toBe(itemId)
    expect(converted.__type).toBe('paragraph')
    assertUndoRedo(pipeline, before)
  })

  test('Backspace on an empty first bullet list item mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '-')
    typeText(pipeline, ' ')
    const itemId = firstInlineBlock(pipeline.context).id
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.id).toBe(itemId)
    expect(block.__type).toBe('paragraph')
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at the start of a non-empty bullet list item merges and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '-')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    typeText(pipeline, 'World')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 0 })
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['HelloWorld'])
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(firstInlineBlock(pipeline.context).__type).toBe('bullet_list_item')
    assertUndoRedo(pipeline, before)
  })

  test('Backspace on an empty checkbox list item mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '[]')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    const itemId = nthInlineBlock(pipeline.context, 1).id
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hello', ''])
    expect(nthInlineBlock(pipeline.context, 0).__type).toBe(
      'checkbox_list_item',
    )
    const converted = nthInlineBlock(pipeline.context, 1)
    expect(converted.id).toBe(itemId)
    expect(converted.__type).toBe('paragraph')
    assertUndoRedo(pipeline, before)
  })

  test('Backspace on an empty first checkbox list item mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '[]')
    typeText(pipeline, ' ')
    const itemId = firstInlineBlock(pipeline.context).id
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.id).toBe(itemId)
    expect(block.__type).toBe('paragraph')
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at the start of a non-empty checkbox list item merges and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '[]')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    typeText(pipeline, 'World')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 0 })
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['HelloWorld'])
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(firstInlineBlock(pipeline.context).__type).toBe('checkbox_list_item')
    assertUndoRedo(pipeline, before)
  })

  test('Backspace on an empty numbered list item mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const leftoverId = firstInlineBlock(pipeline.context).id
    pipeline.insertNumberedListItemBlock({ pos: { type: 'start' } }, 'user')
    pipeline.deleteBlock(leftoverId, 'user')
    focus(pipeline)
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    const itemId = nthInlineBlock(pipeline.context, 1).id
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hello', ''])
    expect(nthInlineBlock(pipeline.context, 0).__type).toBe(
      'numbered_list_item',
    )
    const converted = nthInlineBlock(pipeline.context, 1)
    expect(converted.id).toBe(itemId)
    expect(converted.__type).toBe('paragraph')
    assertUndoRedo(pipeline, before)
  })

  test('Backspace on an empty first numbered list item mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const leftoverId = firstInlineBlock(pipeline.context).id
    pipeline.insertNumberedListItemBlock({ pos: { type: 'start' } }, 'user')
    pipeline.deleteBlock(leftoverId, 'user')
    focus(pipeline)
    const itemId = firstInlineBlock(pipeline.context).id
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.id).toBe(itemId)
    expect(block.__type).toBe('paragraph')
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at the start of a non-empty numbered list item merges and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const leftoverId = firstInlineBlock(pipeline.context).id
    pipeline.insertNumberedListItemBlock({ pos: { type: 'start' } }, 'user')
    pipeline.deleteBlock(leftoverId, 'user')
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
    expect(firstInlineBlock(pipeline.context).__type).toBe('numbered_list_item')
    assertUndoRedo(pipeline, before)
  })

  test('Backspace on an empty quote mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '>')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    typeText(pipeline, '>')
    typeText(pipeline, ' ')
    const quoteId = nthInlineBlock(pipeline.context, 1).id
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hello', ''])
    expect(nthInlineBlock(pipeline.context, 0).__type).toBe('quote')
    const converted = nthInlineBlock(pipeline.context, 1)
    expect(converted.id).toBe(quoteId)
    expect(converted.__type).toBe('paragraph')
    assertUndoRedo(pipeline, before)
  })

  test('Backspace on an empty first quote mutates it to a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '>')
    typeText(pipeline, ' ')
    const quoteId = firstInlineBlock(pipeline.context).id
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.id).toBe(quoteId)
    expect(block.__type).toBe('paragraph')
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at the start of a non-empty quote merges and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '>')
    typeText(pipeline, ' ')
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    typeText(pipeline, '>')
    typeText(pipeline, ' ')
    typeText(pipeline, 'World')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 0 })
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['HelloWorld'])
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(firstInlineBlock(pipeline.context).__type).toBe('quote')
    assertUndoRedo(pipeline, before)
  })
})
