import { describe, expect, test } from 'vitest'

import type { BlockId } from '../../src/internals/blocks'
import {
  assertUndoRedo,
  blockTexts,
  focus,
  makePipeline,
  requireCursor,
  selectOffsetsInCurrentNode,
  snapshot,
  typeLines,
  typeText,
} from '../utils/pipeline'

describe('TransactionPipeline block commands', () => {
  test('insertParagraphBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    const blockId = pipeline.insertParagraphBlock({}, 'user')
    if (!blockId) {
      throw new Error('Expected an inserted paragraph')
    }

    expect(pipeline.context.state.blockOrderById).toContain(blockId)
    expect(pipeline.context.state.blockOrderById).toHaveLength(2)
    assertUndoRedo(pipeline, before)
  })

  test('insertHeadingBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    const blockId = pipeline.insertHeadingBlock(1, {}, 'user')
    if (!blockId) {
      throw new Error('Expected an inserted heading')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe('heading')
    assertUndoRedo(pipeline, before)
  })

  test('insertQuoteBlock returns the inserted block id', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    const blockId = pipeline.insertQuoteBlock({}, 'user')
    if (!blockId) {
      throw new Error('Expected an inserted quote')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe('quote')
  })

  test('insertBulletListItemBlock returns the inserted block id', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    const blockId = pipeline.insertBulletListItemBlock({}, 'user')
    if (!blockId) {
      throw new Error('Expected an inserted bullet list item')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe(
      'bullet_list_item',
    )
  })

  test('insertNumberedListItemBlock returns the inserted block id', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    const blockId = pipeline.insertNumberedListItemBlock({}, 'user')
    if (!blockId) {
      throw new Error('Expected an inserted numbered list item')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe(
      'numbered_list_item',
    )
  })

  test('insertCheckboxListItemBlock returns the inserted block id', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    const blockId = pipeline.insertCheckboxListItemBlock({}, 'user')
    if (!blockId) {
      throw new Error('Expected an inserted checkbox list item')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe(
      'checkbox_list_item',
    )
  })

  test('insertDividerBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    const blockId = pipeline.insertDividerBlock({}, 'user')
    if (!blockId) {
      throw new Error('Expected an inserted divider')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe('divider')
    assertUndoRedo(pipeline, before)
  })

  test('insert block commands return null without a position or selection', () => {
    const pipeline = makePipeline({ markdown: false })

    expect(pipeline.insertParagraphBlock({}, 'user')).toBeNull()
    expect(pipeline.insertQuoteBlock({}, 'user')).toBeNull()
    expect(pipeline.insertHeadingBlock(1, {}, 'user')).toBeNull()
    expect(pipeline.insertBulletListItemBlock({}, 'user')).toBeNull()
    expect(pipeline.insertNumberedListItemBlock({}, 'user')).toBeNull()
    expect(pipeline.insertCheckboxListItemBlock({}, 'user')).toBeNull()
    expect(pipeline.insertDividerBlock({}, 'user')).toBeNull()
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
  })

  test('deleteBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const extraId = pipeline.insertParagraphBlock(
      { pos: { type: 'end' } },
      'user',
    )
    if (!extraId) {
      throw new Error('Expected an inserted block')
    }
    const before = snapshot(pipeline.context)

    pipeline.deleteBlock(extraId, 'user')

    expect(pipeline.context.state.blockOrderById).not.toContain(extraId)
    assertUndoRedo(pipeline, before)
  })

  test('duplicateBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })

    focus(pipeline)
    typeText(pipeline, 'Hello')

    const [sourceId] = pipeline.context.state.blockOrderById

    if (!sourceId) {
      throw new Error('Expected a source block')
    }

    const before = snapshot(pipeline.context)

    pipeline.duplicateBlock(sourceId, 'user')

    const order = pipeline.context.state.blockOrderById
    // oxlint-disable-next-line prefer-destructuring
    const cloneId = order[1]
    if (!cloneId) {
      throw new Error('Expected a duplicated block')
    }

    expect(order).toHaveLength(2)
    expect(order[0]).toBe(sourceId)
    expect(cloneId).not.toBe(sourceId)
    expect(blockTexts(pipeline.context)).toEqual(['Hello', 'Hello'])
    expect(requireCursor(pipeline.context).blockId).toBe(cloneId)
    assertUndoRedo(pipeline, before)
  })

  test('moveBlock after another block and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['A', 'B', 'C'])

    const [firstId, middleId, lastId] = pipeline.context.state.blockOrderById
    if (!(firstId && middleId && lastId)) {
      throw new Error('Expected three blocks')
    }

    const before = snapshot(pipeline.context)

    pipeline.moveBlock(firstId, { blockId: middleId, type: 'after' }, 'user')

    expect(pipeline.context.state.blockOrderById).toEqual([
      middleId,
      firstId,
      lastId,
    ])
    expect(blockTexts(pipeline.context)).toEqual(['B', 'A', 'C'])
    expect(pipeline.context.state.blocks.get(firstId)?.id).toBe(firstId)

    const moved = pipeline.context.state.blocks.get(firstId)
    const prev = pipeline.context.state.blocks.get(middleId)
    const next = pipeline.context.state.blocks.get(lastId)
    if (!(moved && prev && next)) {
      throw new Error('Expected moved block and neighbors')
    }
    expect(prev.posKey < moved.posKey).toBe(true)
    expect(moved.posKey < next.posKey).toBe(true)

    assertUndoRedo(pipeline, before)
  })

  test('moveBlock before another block', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['A', 'B', 'C'])

    const [firstId, middleId, lastId] = pipeline.context.state.blockOrderById
    if (!(firstId && middleId && lastId)) {
      throw new Error('Expected three blocks')
    }

    pipeline.moveBlock(lastId, { blockId: firstId, type: 'before' }, 'user')

    expect(pipeline.context.state.blockOrderById).toEqual([
      lastId,
      firstId,
      middleId,
    ])
    expect(blockTexts(pipeline.context)).toEqual(['C', 'A', 'B'])
  })

  test('moveBlock to start and end', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['A', 'B', 'C'])

    const [firstId, middleId, lastId] = pipeline.context.state.blockOrderById
    if (!(firstId && middleId && lastId)) {
      throw new Error('Expected three blocks')
    }

    pipeline.moveBlock(lastId, { type: 'start' }, 'user')

    expect(pipeline.context.state.blockOrderById).toEqual([
      lastId,
      firstId,
      middleId,
    ])
    expect(blockTexts(pipeline.context)).toEqual(['C', 'A', 'B'])

    pipeline.moveBlock(lastId, { type: 'end' }, 'user')

    expect(pipeline.context.state.blockOrderById).toEqual([
      firstId,
      middleId,
      lastId,
    ])
    expect(blockTexts(pipeline.context)).toEqual(['A', 'B', 'C'])
  })

  test('moveBlock is a no-op when already at the destination', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['A', 'B', 'C'])

    const [firstId, middleId, lastId] = pipeline.context.state.blockOrderById
    if (!(firstId && middleId && lastId)) {
      throw new Error('Expected three blocks')
    }

    const posKeysBefore = [firstId, middleId, lastId].map(
      (id) => pipeline.context.state.blocks.get(id)?.posKey,
    )
    const canUndoBefore = pipeline.canUndo()
    const orderBefore = pipeline.context.state.blockOrderById

    pipeline.moveBlock(firstId, { type: 'start' }, 'user')
    pipeline.moveBlock(lastId, { type: 'end' }, 'user')
    pipeline.moveBlock(middleId, { blockId: firstId, type: 'after' }, 'user')
    pipeline.moveBlock(middleId, { blockId: lastId, type: 'before' }, 'user')
    pipeline.moveBlock(firstId, { blockId: firstId, type: 'after' }, 'user')
    pipeline.moveBlock(firstId, { blockId: firstId, type: 'before' }, 'user')

    expect(pipeline.context.state.blockOrderById).toEqual(orderBefore)
    expect(
      [firstId, middleId, lastId].map(
        (id) => pipeline.context.state.blocks.get(id)?.posKey,
      ),
    ).toEqual(posKeysBefore)
    expect(pipeline.canUndo()).toBe(canUndoBefore)
  })

  test('moveBlock keeps the caret on the moved block', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['A', 'B', 'C'])

    const [firstId, middleId, lastId] = pipeline.context.state.blockOrderById
    if (!(firstId && middleId && lastId)) {
      throw new Error('Expected three blocks')
    }

    expect(requireCursor(pipeline.context).blockId).toBe(lastId)

    pipeline.moveBlock(lastId, { type: 'start' }, 'user')

    expect(pipeline.context.state.blockOrderById).toEqual([
      lastId,
      firstId,
      middleId,
    ])
    expect(requireCursor(pipeline.context).blockId).toBe(lastId)
  })

  test('moveBlock throws for an unknown block id', () => {
    const pipeline = makePipeline({ markdown: false })

    expect(() =>
      pipeline.moveBlock('bl_unknown' as BlockId, { type: 'end' }, 'user'),
    ).toThrow()
  })
})

describe('TransactionPipeline selection', () => {
  test('clearSelection drops the caret without a history entry', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    expect(pipeline.context.selection).not.toBeNull()

    pipeline.clearSelection('user')

    expect(pipeline.context.selection).toBeNull()
    expect(blockTexts(pipeline.context)).toEqual(['Hi'])
  })

  test('updateSelection places a range without a history entry', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    const canUndoBefore = pipeline.canUndo()

    selectOffsetsInCurrentNode(pipeline, 1, 4)

    expect(pipeline.context.selection?.__type).toBe('range')
    expect(pipeline.canUndo()).toBe(canUndoBefore)
  })
})
