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

    pipeline.insertParagraphBlock({}, 'user')

    expect(pipeline.context.state.blockOrderById).toHaveLength(2)
    assertUndoRedo(pipeline, before)
  })

  test('insertHeadingBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    pipeline.insertHeadingBlock(1, {}, 'user')

    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toContain('heading')
    assertUndoRedo(pipeline, before)
  })

  test('insertDividerBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    pipeline.insertDividerBlock({}, 'user')

    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toContain('divider')
    assertUndoRedo(pipeline, before)
  })

  test('deleteBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    pipeline.insertParagraphBlock({ pos: { type: 'end' } }, 'user')
    const extraId = pipeline.context.state.blockOrderById.at(-1)
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
