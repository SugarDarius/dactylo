import { describe, expect, test } from 'vitest'

import type { BlockId } from '../../src/internals/blocks'
import { isNumberedListItemBlock } from '../../src/internals/blocks'
import type {
  DocumentJsonInput,
  InlineNodeJsonInput,
} from '../../src/internals/document-json-input'
import { DactyloError } from '../../src/internals/errors'
import { isLineBreakNode, isTextNode } from '../../src/internals/nodes'
import type { MutateBlockSpec } from '../../src/internals/operations-builder'
import {
  assertUndoRedo,
  blockTexts,
  collectDocumentLifecycleNotifies,
  firstInlineBlock,
  focus,
  hardBreak,
  makePipeline,
  requireCursor,
  selectOffsetsInCurrentNode,
  silenceDactyloErrorLog,
  snapshot,
  typeLines,
  typeText,
} from '../utils/pipeline'

/** JSON that fails schema validation so init can reach the error path. */
const INVALID_DOCUMENT_JSON = {
  blocks: {},
} as unknown as DocumentJsonInput

describe('TransactionPipeline initialization', () => {
  test('starts with one empty paragraph and no history', () => {
    const pipeline = makePipeline()
    const [blockId] = pipeline.context.state.blockOrderById

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(pipeline.context.selection).toBeNull()
    expect(pipeline.canUndo()).toBe(false)
    expect(pipeline.canRedo()).toBe(false)
    expect(blockTexts(pipeline.context)).toEqual([''])
    expect(blockId).toBeDefined()
  })

  test('empty pipeline is ready after construction', () => {
    const pipeline = makePipeline()

    expect(pipeline.documentStatus).toBe('ready')
  })

  test('documentStatus, documentReady, and documentError do not replay after construction', () => {
    const pipeline = makePipeline()
    const statuses: string[] = []
    let readyCount = 0
    let errorCount = 0

    pipeline.events.documentStatus.subscribe((status) => {
      statuses.push(status)
    })
    pipeline.events.documentReady.subscribe(() => {
      readyCount += 1
    })
    pipeline.events.documentError.subscribe(() => {
      errorCount += 1
    })

    expect(statuses).toEqual([])
    expect(readyCount).toBe(0)
    expect(errorCount).toBe(0)
  })

  test('documentReady emits durationMs when initialization succeeds', () => {
    const lifecycle = collectDocumentLifecycleNotifies(() => {
      const pipeline = makePipeline()
      expect(pipeline.documentStatus).toBe('ready')
    })

    expect(lifecycle.statuses).toEqual(['initializing', 'ready'])
    expect(lifecycle.ready).toHaveLength(1)
    expect(lifecycle.ready[0]?.durationMs).toBeGreaterThanOrEqual(0)
    expect(lifecycle.errors).toEqual([])
  })

  test('documentError emits when initial JSON is invalid', () => {
    const restoreErrorLog = silenceDactyloErrorLog()

    try {
      const lifecycle = collectDocumentLifecycleNotifies(() => {
        expect(() =>
          makePipeline({ initialContent: INVALID_DOCUMENT_JSON }),
        ).toThrow(DactyloError)
      })

      expect(lifecycle.statuses).toEqual(['initializing', 'error'])
      expect(lifecycle.ready).toEqual([])
      expect(lifecycle.errors).toHaveLength(1)
      expect(lifecycle.errors[0]?.durationMs).toBeGreaterThanOrEqual(0)
      expect(lifecycle.errors[0]?.error).toBeInstanceOf(DactyloError)
      expect(lifecycle.errors[0]?.error.code).toBe(
        'DESERIALIZE_DOCUMENT_JSON_INPUT',
      )
    } finally {
      restoreErrorLog()
    }
  })

  test('waitUntilDocumentReady resolves when the document is already ready', async () => {
    const pipeline = makePipeline()

    expect(pipeline.documentStatus).toBe('ready')
    await expect(pipeline.waitUntilDocumentReady()).resolves.toBeUndefined()
  })
})

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

    const blockId = pipeline.insertBlock(
      {
        spec: {
          content: [{ text: 'Hello', type: 'text' }],
          level: 2,
          type: 'heading',
        },
      },
      'user',
    )
    if (!blockId) {
      throw new Error('Expected an inserted heading')
    }

    const inserted = pipeline.context.state.blocks.get(blockId)
    expect(inserted?.__type).toBe('heading')
    if (inserted?.__type !== 'heading') {
      throw new Error('Expected a heading block')
    }

    const [node] = inserted.content
    if (node === undefined || !isTextNode(node)) {
      throw new Error('Expected a text node')
    }

    expect(inserted.level).toBe(2)
    expect(inserted.content).toHaveLength(1)
    expect(node.text).toBe('Hello')
    expect(blockTexts(pipeline.context)).toEqual(['', 'Hello'])
    expect(requireCursor(pipeline.context)).toMatchObject({
      blockId,
      nodeId: node.id,
      offset: node.text.length,
    })
  })

  test('insertBlock appends an empty text node when spec content ends without editable text', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    const blockId = pipeline.insertBlock(
      {
        spec: {
          content: [{ text: 'Hello', type: 'text' }, { type: 'line_break' }],
          type: 'quote',
        },
      },
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
    if (first === undefined || !isTextNode(first)) {
      throw new Error('Expected a leading text node')
    }
    expect(first.text).toBe('Hello')
    expect(second !== undefined && isLineBreakNode(second)).toBe(true)

    if (trailing === undefined || !isTextNode(trailing)) {
      throw new Error('Expected a trailing empty text node')
    }

    expect(isTextNode(trailing)).toBe(true)
    expect(trailing.text).toBe('')
    expect(requireCursor(pipeline.context)).toMatchObject({
      blockId,
      nodeId: trailing.id,
      offset: 0,
    })
  })

  test('insertBlock rejects invalid JSON spec content', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    try {
      pipeline.insertBlock(
        {
          spec: {
            content: [{ type: 'unknown' }] as unknown as InlineNodeJsonInput[],
            type: 'paragraph',
          },
        },
        'user',
      )
    } catch (error) {
      expect(error).toBeInstanceOf(DactyloError)
      expect(error instanceof DactyloError ? error.code : undefined).toBe(
        'DESERIALIZE_DOCUMENT_JSON_INPUT',
      )
      return
    }

    expect.unreachable('Expected insertBlock to throw')
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

  test('mutateBlock is a no-op when the block is already the target type', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    const [paragraphId] = pipeline.context.state.blockOrderById
    if (!paragraphId) {
      throw new Error('Expected the initial paragraph')
    }

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
    const checkboxId = pipeline.insertBlock(
      { spec: { type: 'checkbox_list_item' } },
      'user',
    )
    if (!(quoteId && headingId && bulletId && numberedId && checkboxId)) {
      throw new Error('Expected inserted blocks to mutate')
    }

    const cases: readonly {
      readonly blockId: BlockId
      readonly spec: MutateBlockSpec
    }[] = [
      { blockId: paragraphId, spec: { kind: 'to_paragraph' } },
      { blockId: quoteId, spec: { kind: 'to_quote' } },
      { blockId: headingId, spec: { kind: 'to_heading', level: 2 } },
      { blockId: bulletId, spec: { kind: 'to_bullet_list_item' } },
      {
        blockId: numberedId,
        spec: { kind: 'to_numbered_list_item', variant: 'default' },
      },
      {
        blockId: checkboxId,
        spec: { checked: true, kind: 'to_checkbox_list_item' },
      },
    ]

    const before = snapshot(pipeline.context)
    const canUndoBefore = pipeline.canUndo()

    for (const { blockId, spec } of cases) {
      expect(pipeline.mutateBlock(blockId, spec, 'user')).toBe(false)
    }

    expect(snapshot(pipeline.context)).toEqual(before)
    expect(pipeline.canUndo()).toBe(canUndoBefore)
  })

  test('mutateBlock of a numbered item to a different variant still applies', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const numberedId = pipeline.insertBlock(
      { spec: { type: 'numbered_list_item' } },
      'user',
    )
    if (!numberedId) {
      throw new Error('Expected an inserted numbered list item')
    }

    const before = snapshot(pipeline.context)

    expect(
      pipeline.mutateBlock(
        numberedId,
        { kind: 'to_numbered_list_item', variant: 'alpha' },
        'user',
      ),
    ).toBe(true)

    const mutated = pipeline.context.state.blocks.get(numberedId)
    expect(mutated?.__type).toBe('numbered_list_item')
    expect(mutated).toMatchObject({
      markerNumbering: 'a.',
      variant: 'alpha',
    })
    assertUndoRedo(pipeline, before)
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
      pipeline.patchBlock(
        {
          blockId: paragraphId,
          spec: { metadata: { value: { a: 1 } }, type: 'paragraph' },
        },
        'user',
      ),
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
    const checkboxId = pipeline.insertBlock(
      { spec: { type: 'checkbox_list_item' } },
      'user',
    )
    const dividerId = pipeline.insertBlock(
      { spec: { type: 'divider' } },
      'user',
    )
    if (
      !(
        quoteId &&
        headingId &&
        bulletId &&
        numberedId &&
        checkboxId &&
        dividerId
      )
    ) {
      throw new Error('Expected inserted blocks to patch')
    }

    expect(
      pipeline.patchBlock(
        {
          blockId: quoteId,
          spec: { metadata: { value: { a: 1 } }, type: 'quote' },
        },
        'user',
      ),
    ).toBe(true)
    expect(
      pipeline.patchBlock(
        { blockId: headingId, spec: { level: 3, type: 'heading' } },
        'user',
      ),
    ).toBe(true)
    expect(
      pipeline.patchBlock(
        {
          blockId: bulletId,
          spec: { metadata: { value: { a: 1 } }, type: 'bullet_list_item' },
        },
        'user',
      ),
    ).toBe(true)
    expect(
      pipeline.patchBlock(
        {
          blockId: numberedId,
          spec: { type: 'numbered_list_item', variant: 'alpha' },
        },
        'user',
      ),
    ).toBe(true)
    expect(
      pipeline.patchBlock(
        {
          blockId: checkboxId,
          spec: { checked: true, type: 'checkbox_list_item' },
        },
        'user',
      ),
    ).toBe(true)
    expect(
      pipeline.patchBlock(
        {
          blockId: dividerId,
          spec: { metadata: { value: { a: 1 } }, type: 'divider' },
        },
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
    expect(pipeline.context.state.blocks.get(checkboxId)).toMatchObject({
      checked: true,
    })
    expect(pipeline.context.state.blocks.get(dividerId)?.metadata).toEqual({
      a: 1,
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

    expect(
      pipeline.patchBlock(
        { blockId: paragraphId, spec: { type: 'quote' } },
        'user',
      ),
    ).toBe(false)
    expect(
      pipeline.patchBlock(
        { blockId: paragraphId, spec: { level: 2, type: 'heading' } },
        'user',
      ),
    ).toBe(false)
    expect(
      pipeline.patchBlock(
        { blockId: paragraphId, spec: { type: 'bullet_list_item' } },
        'user',
      ),
    ).toBe(false)
    expect(
      pipeline.patchBlock(
        { blockId: paragraphId, spec: { type: 'numbered_list_item' } },
        'user',
      ),
    ).toBe(false)
    expect(
      pipeline.patchBlock(
        { blockId: paragraphId, spec: { type: 'checkbox_list_item' } },
        'user',
      ),
    ).toBe(false)
    expect(
      pipeline.patchBlock(
        { blockId: paragraphId, spec: { type: 'divider' } },
        'user',
      ),
    ).toBe(false)
    expect(snapshot(pipeline.context)).toEqual(before)

    const headingId = pipeline.insertBlock(
      { spec: { level: 1, type: 'heading' } },
      'user',
    )
    if (!headingId) {
      throw new Error('Expected an inserted heading')
    }
    const afterInsert = snapshot(pipeline.context)

    expect(
      pipeline.patchBlock(
        { blockId: headingId, spec: { type: 'paragraph' } },
        'user',
      ),
    ).toBe(false)
    expect(snapshot(pipeline.context)).toEqual(afterInsert)
  })

  test('patchBlock uses the given spec content', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')

    const [paragraphId] = pipeline.context.state.blockOrderById
    if (!paragraphId) {
      throw new Error('Expected the initial paragraph')
    }

    expect(
      pipeline.patchBlock(
        {
          blockId: paragraphId,
          spec: {
            content: [{ text: 'World', type: 'text' }],
            type: 'paragraph',
          },
        },
        'user',
      ),
    ).toBe(true)

    const patched = pipeline.context.state.blocks.get(paragraphId)
    if (patched?.__type !== 'paragraph') {
      throw new Error('Expected a paragraph block')
    }

    const [node] = patched.content
    if (node === undefined || !isTextNode(node)) {
      throw new Error('Expected a text node')
    }

    expect(patched.content).toHaveLength(1)
    expect(node.text).toBe('World')
    expect(blockTexts(pipeline.context)).toEqual(['World'])
  })

  test('patchBlock keeps source content when spec content is empty', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')

    const [paragraphId] = pipeline.context.state.blockOrderById
    if (!paragraphId) {
      throw new Error('Expected the initial paragraph')
    }

    const source = pipeline.context.state.blocks.get(paragraphId)
    if (source?.__type !== 'paragraph') {
      throw new Error('Expected a paragraph block')
    }
    const { content } = source

    expect(
      pipeline.patchBlock(
        {
          blockId: paragraphId,
          spec: { content: [], type: 'paragraph' },
        },
        'user',
      ),
    ).toBe(true)

    const patched = pipeline.context.state.blocks.get(paragraphId)
    if (patched?.__type !== 'paragraph') {
      throw new Error('Expected a paragraph block')
    }

    expect(patched.content).toEqual(content)
    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
  })

  test('patchBlock rejects invalid JSON spec content', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')

    const [paragraphId] = pipeline.context.state.blockOrderById
    if (!paragraphId) {
      throw new Error('Expected the initial paragraph')
    }

    try {
      pipeline.patchBlock(
        {
          blockId: paragraphId,
          spec: {
            content: [{ type: 'unknown' }] as unknown as InlineNodeJsonInput[],
            type: 'paragraph',
          },
        },
        'user',
      )
    } catch (error) {
      expect(error).toBeInstanceOf(DactyloError)
      expect(error instanceof DactyloError ? error.code : undefined).toBe(
        'DESERIALIZE_DOCUMENT_JSON_INPUT',
      )
      return
    }

    expect.unreachable('Expected patchBlock to throw')
  })
})

describe('TransactionPipeline insertText', () => {
  test('inserts at a node offset and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    const block = firstInlineBlock(pipeline.context)
    const [node] = block.content
    if (!node || !isTextNode(node)) {
      throw new Error('Expected an empty text node')
    }
    const before = snapshot(pipeline.context)

    expect(
      pipeline.insertText(
        { blockId: block.id, nodeId: node.id, offset: 0, text: 'Hello' },
        'user',
      ),
    ).toBe(true)

    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
    expect(requireCursor(pipeline.context)).toEqual({
      blockId: block.id,
      nodeId: node.id,
      offset: 5,
    })
    assertUndoRedo(pipeline, before)
  })
})

describe('TransactionPipeline insertTextAt', () => {
  test('inserts at a snapshot selection after the caret is cleared', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    selectOffsetsInCurrentNode(pipeline, 1, 4)
    const at = pipeline.context.selection
    const before = snapshot(pipeline.context)
    pipeline.clearSelection('user')

    expect(pipeline.insertTextAt({ at, text: 'y' }, 'user')).toBe(true)

    expect(blockTexts(pipeline.context)).toEqual(['Hyo'])
    expect(requireCursor(pipeline.context).offset).toBe(2)
    assertUndoRedo(pipeline, before)
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
