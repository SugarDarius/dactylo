import { describe, expect, test } from 'vitest'

import type { BlockId } from '../../src/internals/blocks'
import { isNumberedListItemBlock } from '../../src/internals/blocks'
import {
  createLineBreakNode,
  createTextNode,
  isTextNode,
} from '../../src/internals/nodes'
import {
  assertUndoRedo,
  blockTexts,
  focus,
  hardBreak,
  makePipeline,
  requireCursor,
  selectOffsetsInCurrentNode,
  snapshot,
  typeLines,
  typeText,
} from '../utils/pipeline'

describe('TransactionPipeline block commands', () => {
  test('insertBlock paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    const blockId = pipeline.insertBlock(
      { spec: { type: 'paragraph' } },
      'user',
    )
    if (!blockId) {
      throw new Error('Expected an inserted paragraph')
    }

    expect(pipeline.context.state.blockOrderById).toContain(blockId)
    expect(pipeline.context.state.blockOrderById).toHaveLength(2)
    assertUndoRedo(pipeline, before)
  })

  test('insertBlock heading and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    const blockId = pipeline.insertBlock(
      { spec: { level: 1, type: 'heading' } },
      'user',
    )
    if (!blockId) {
      throw new Error('Expected an inserted heading')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe('heading')
    assertUndoRedo(pipeline, before)
  })

  test('insertBlock quote returns the inserted block id', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    const blockId = pipeline.insertBlock({ spec: { type: 'quote' } }, 'user')
    if (!blockId) {
      throw new Error('Expected an inserted quote')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe('quote')
  })

  test('insertBlock bullet list item returns the inserted block id', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    const blockId = pipeline.insertBlock(
      { spec: { type: 'bullet_list_item' } },
      'user',
    )
    if (!blockId) {
      throw new Error('Expected an inserted bullet list item')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe(
      'bullet_list_item',
    )
  })

  test('insertBlock numbered list item returns the inserted block id', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    const blockId = pipeline.insertBlock(
      { spec: { type: 'numbered_list_item' } },
      'user',
    )
    if (!blockId) {
      throw new Error('Expected an inserted numbered list item')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe(
      'numbered_list_item',
    )
  })

  test('insertBlock checkbox list item returns the inserted block id', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    const blockId = pipeline.insertBlock(
      { spec: { type: 'checkbox_list_item' } },
      'user',
    )
    if (!blockId) {
      throw new Error('Expected an inserted checkbox list item')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe(
      'checkbox_list_item',
    )
  })

  test('insertBlock divider and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    const blockId = pipeline.insertBlock({ spec: { type: 'divider' } }, 'user')
    if (!blockId) {
      throw new Error('Expected an inserted divider')
    }

    expect(pipeline.context.state.blocks.get(blockId)?.__type).toBe('divider')
    assertUndoRedo(pipeline, before)
  })

  test('insertBlock uses the given spec content', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const text = createTextNode({ text: 'Hello' })

    const blockId = pipeline.insertBlock(
      { spec: { content: [text], level: 2, type: 'heading' } },
      'user',
    )
    if (!blockId) {
      throw new Error('Expected an inserted heading')
    }

    const inserted = pipeline.context.state.blocks.get(blockId)
    expect(inserted?.__type).toBe('heading')
    expect(inserted).toMatchObject({ content: [text], level: 2 })
    expect(blockTexts(pipeline.context)).toEqual(['', 'Hello'])
    expect(requireCursor(pipeline.context)).toMatchObject({
      blockId,
      nodeId: text.id,
      offset: text.text.length,
    })
  })

  test('insertBlock appends an empty text node when spec content ends without editable text', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const hello = createTextNode({ text: 'Hello' })
    const lineBreak = createLineBreakNode()

    const blockId = pipeline.insertBlock(
      { spec: { content: [hello, lineBreak], type: 'quote' } },
      'user',
    )
    if (!blockId) {
      throw new Error('Expected an inserted quote')
    }

    const inserted = pipeline.context.state.blocks.get(blockId)
    if (inserted?.__type !== 'quote') {
      throw new Error('Expected a quote block')
    }
    const [first, second, trailing] = inserted.content
    expect(inserted.content).toHaveLength(3)
    expect(first).toEqual(hello)
    expect(second).toEqual(lineBreak)
    expect(isTextNode(trailing)).toBe(true)
    if (!isTextNode(trailing)) {
      throw new Error('Expected a trailing empty text node')
    }
    expect(trailing.text).toBe('')
    expect(requireCursor(pipeline.context)).toMatchObject({
      blockId,
      nodeId: trailing.id,
      offset: 0,
    })
  })

  test('insert block commands return null without a position or selection', () => {
    const pipeline = makePipeline({ markdown: false })

    expect(
      pipeline.insertBlock({ spec: { type: 'paragraph' } }, 'user'),
    ).toBeNull()
    expect(pipeline.insertBlock({ spec: { type: 'quote' } }, 'user')).toBeNull()
    expect(
      pipeline.insertBlock({ spec: { level: 1, type: 'heading' } }, 'user'),
    ).toBeNull()
    expect(
      pipeline.insertBlock({ spec: { type: 'bullet_list_item' } }, 'user'),
    ).toBeNull()
    expect(
      pipeline.insertBlock({ spec: { type: 'numbered_list_item' } }, 'user'),
    ).toBeNull()
    expect(
      pipeline.insertBlock({ spec: { type: 'checkbox_list_item' } }, 'user'),
    ).toBeNull()
    expect(
      pipeline.insertBlock({ spec: { type: 'divider' } }, 'user'),
    ).toBeNull()
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
  })

  test('deleteBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const extraId = pipeline.insertBlock(
      { pos: { type: 'end' }, spec: { type: 'paragraph' } },
      'user',
    )
    if (!extraId) {
      throw new Error('Expected an inserted block')
    }
    const before = snapshot(pipeline.context)

    expect(pipeline.deleteBlock(extraId, 'user')).toBe(true)

    expect(pipeline.context.state.blockOrderById).not.toContain(extraId)
    assertUndoRedo(pipeline, before)
  })

  test('deleteBlock returns false for the first empty block', () => {
    const pipeline = makePipeline({ markdown: false })
    const [emptyId] = pipeline.context.state.blockOrderById
    if (!emptyId) {
      throw new Error('Expected the initial empty paragraph')
    }
    const before = snapshot(pipeline.context)

    expect(pipeline.deleteBlock(emptyId, 'user')).toBe(false)
    expect(snapshot(pipeline.context)).toEqual(before)
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

    expect(pipeline.duplicateBlock(sourceId, 'user')).toBe(true)

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

    expect(
      pipeline.moveBlock(firstId, { blockId: middleId, type: 'after' }, 'user'),
    ).toBe(true)

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

    expect(
      pipeline.moveBlock(lastId, { blockId: firstId, type: 'before' }, 'user'),
    ).toBe(true)

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

    expect(pipeline.moveBlock(lastId, { type: 'start' }, 'user')).toBe(true)

    expect(pipeline.context.state.blockOrderById).toEqual([
      lastId,
      firstId,
      middleId,
    ])
    expect(blockTexts(pipeline.context)).toEqual(['C', 'A', 'B'])

    expect(pipeline.moveBlock(lastId, { type: 'end' }, 'user')).toBe(true)

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

    expect(pipeline.moveBlock(firstId, { type: 'start' }, 'user')).toBe(false)
    expect(pipeline.moveBlock(lastId, { type: 'end' }, 'user')).toBe(false)
    expect(
      pipeline.moveBlock(middleId, { blockId: firstId, type: 'after' }, 'user'),
    ).toBe(false)
    expect(
      pipeline.moveBlock(middleId, { blockId: lastId, type: 'before' }, 'user'),
    ).toBe(false)
    expect(
      pipeline.moveBlock(firstId, { blockId: firstId, type: 'after' }, 'user'),
    ).toBe(false)
    expect(
      pipeline.moveBlock(firstId, { blockId: firstId, type: 'before' }, 'user'),
    ).toBe(false)

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

    expect(pipeline.moveBlock(lastId, { type: 'start' }, 'user')).toBe(true)

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

  test('mutateBlock converts a paragraph to a heading and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')

    const [paragraphId] = pipeline.context.state.blockOrderById
    if (!paragraphId) {
      throw new Error('Expected the initial paragraph')
    }

    const before = snapshot(pipeline.context)

    expect(
      pipeline.mutateBlock(
        paragraphId,
        { kind: 'to_heading', level: 2 },
        'user',
      ),
    ).toBe(true)

    const mutated = pipeline.context.state.blocks.get(paragraphId)
    expect(mutated?.id).toBe(paragraphId)
    expect(mutated?.__type).toBe('heading')
    expect(mutated).toMatchObject({ level: 2 })
    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
    assertUndoRedo(pipeline, before)
  })

  test('mutateBlock returns false for a divider', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const dividerId = pipeline.insertBlock(
      { spec: { type: 'divider' } },
      'user',
    )
    if (!dividerId) {
      throw new Error('Expected an inserted divider')
    }
    const before = snapshot(pipeline.context)

    expect(
      pipeline.mutateBlock(dividerId, { kind: 'to_paragraph' }, 'user'),
    ).toBe(false)
    expect(snapshot(pipeline.context)).toEqual(before)
  })

  test('mutateBlock of a numbered item compactifies leftover markers', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const [leftoverId] = pipeline.context.state.blockOrderById
    if (!leftoverId) {
      throw new Error('Expected the initial paragraph')
    }
    pipeline.insertBlock(
      { pos: { type: 'start' }, spec: { type: 'numbered_list_item' } },
      'user',
    )
    pipeline.deleteBlock(leftoverId, 'user')
    focus(pipeline)
    typeText(pipeline, 'A')
    hardBreak(pipeline)
    typeText(pipeline, 'B')
    hardBreak(pipeline)
    typeText(pipeline, 'C')

    const [, middleId] = pipeline.context.state.blockOrderById
    if (!middleId) {
      throw new Error('Expected a middle numbered item')
    }
    const before = snapshot(pipeline.context)

    expect(
      pipeline.mutateBlock(middleId, { kind: 'to_paragraph' }, 'user'),
    ).toBe(true)

    expect(pipeline.context.state.blocks.get(middleId)?.__type).toBe(
      'paragraph',
    )
    expect(blockTexts(pipeline.context)).toEqual(['A', 'B', 'C'])
    expect(
      pipeline.context.state.blockOrderById.map((id) => {
        const block = pipeline.context.state.blocks.get(id)
        return block && isNumberedListItemBlock(block)
          ? block.markerNumbering
          : ''
      }),
    ).toEqual(['1.', '', '2.'])
    assertUndoRedo(pipeline, before)
  })

  test('mutateBlock of a paragraph into a numbered run continues the suffix', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const [leftoverId] = pipeline.context.state.blockOrderById
    if (!leftoverId) {
      throw new Error('Expected the initial paragraph')
    }
    pipeline.insertBlock(
      { pos: { type: 'start' }, spec: { type: 'numbered_list_item' } },
      'user',
    )
    pipeline.deleteBlock(leftoverId, 'user')
    focus(pipeline)
    typeText(pipeline, 'A')
    hardBreak(pipeline)
    typeText(pipeline, 'B')
    hardBreak(pipeline)
    typeText(pipeline, 'C')

    const [firstId] = pipeline.context.state.blockOrderById
    if (!firstId) {
      throw new Error('Expected a first numbered item')
    }
    const paragraphId = pipeline.insertBlock(
      {
        pos: { blockId: firstId, type: 'after' },
        spec: { type: 'paragraph' },
      },
      'user',
    )
    if (!paragraphId) {
      throw new Error('Expected an inserted paragraph')
    }
    const before = snapshot(pipeline.context)

    expect(
      pipeline.mutateBlock(
        paragraphId,
        { kind: 'to_numbered_list_item' },
        'user',
      ),
    ).toBe(true)

    expect(pipeline.context.state.blocks.get(paragraphId)?.__type).toBe(
      'numbered_list_item',
    )
    expect(
      pipeline.context.state.blockOrderById.map((id) => {
        const block = pipeline.context.state.blocks.get(id)
        return block && isNumberedListItemBlock(block)
          ? block.markerNumbering
          : ''
      }),
    ).toEqual(['1.', '2.', '3.', '4.'])
    assertUndoRedo(pipeline, before)
  })

  test('patch block commands return true when applied', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')

    const [paragraphId] = pipeline.context.state.blockOrderById
    if (!paragraphId) {
      throw new Error('Expected the initial paragraph')
    }

    expect(
      pipeline.patchParagraphBlock(paragraphId, { metadata: { a: 1 } }, 'user'),
    ).toBe(true)
    expect(pipeline.context.state.blocks.get(paragraphId)?.metadata).toEqual({
      a: 1,
    })

    const quoteId = pipeline.insertBlock({ spec: { type: 'quote' } }, 'user')
    const headingId = pipeline.insertBlock(
      { spec: { level: 1, type: 'heading' } },
      'user',
    )
    const bulletId = pipeline.insertBlock(
      { spec: { type: 'bullet_list_item' } },
      'user',
    )
    const numberedId = pipeline.insertBlock(
      { spec: { type: 'numbered_list_item' } },
      'user',
    )
    if (!(quoteId && headingId && bulletId && numberedId)) {
      throw new Error('Expected inserted blocks to patch')
    }

    expect(
      pipeline.patchQuoteBlock(quoteId, { metadata: { a: 1 } }, 'user'),
    ).toBe(true)
    expect(pipeline.patchHeadingBlock(headingId, { level: 3 }, 'user')).toBe(
      true,
    )
    expect(
      pipeline.patchBulletListItemBlock(
        bulletId,
        { metadata: { a: 1 } },
        'user',
      ),
    ).toBe(true)
    expect(
      pipeline.patchNumberedListItemBlock(
        numberedId,
        { variant: 'alpha' },
        'user',
      ),
    ).toBe(true)

    expect(pipeline.context.state.blocks.get(quoteId)?.metadata).toEqual({
      a: 1,
    })
    expect(pipeline.context.state.blocks.get(headingId)).toMatchObject({
      level: 3,
    })
    expect(pipeline.context.state.blocks.get(bulletId)?.metadata).toEqual({
      a: 1,
    })
    expect(pipeline.context.state.blocks.get(numberedId)).toMatchObject({
      variant: 'alpha',
    })
  })

  test('patch block commands return false when the block type does not match', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')

    const [paragraphId] = pipeline.context.state.blockOrderById
    if (!paragraphId) {
      throw new Error('Expected the initial paragraph')
    }
    const before = snapshot(pipeline.context)

    expect(pipeline.patchQuoteBlock(paragraphId, {}, 'user')).toBe(false)
    expect(pipeline.patchHeadingBlock(paragraphId, { level: 2 }, 'user')).toBe(
      false,
    )
    expect(pipeline.patchBulletListItemBlock(paragraphId, {}, 'user')).toBe(
      false,
    )
    expect(pipeline.patchNumberedListItemBlock(paragraphId, {}, 'user')).toBe(
      false,
    )
    expect(snapshot(pipeline.context)).toEqual(before)

    const headingId = pipeline.insertBlock(
      { spec: { level: 1, type: 'heading' } },
      'user',
    )
    if (!headingId) {
      throw new Error('Expected an inserted heading')
    }
    const afterInsert = snapshot(pipeline.context)

    expect(pipeline.patchParagraphBlock(headingId, {}, 'user')).toBe(false)
    expect(snapshot(pipeline.context)).toEqual(afterInsert)
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
