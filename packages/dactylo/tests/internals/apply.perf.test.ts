/**
 * insert_text CPU gate and structural-sharing patterns.
 *
 * Local only: 10k `insert_text` via `applyOp` < 200ms.
 * Always on: unchanged blocks keep identity; 10k chars in one paragraph → 1 text node.
 */
import { describe, expect, test } from 'vitest'

import { createParagraphBlockAfter } from '../../src/internals/blocks'
import {
  getBlockWithInlineContent,
  putBlock,
} from '../../src/internals/document'
import { createInitialEditorContext } from '../../src/internals/editor-context'
import type { EditorContext } from '../../src/internals/editor-context'
import { createTextNode, isTextNode } from '../../src/internals/nodes'
import type { InsertTextOp } from '../../src/internals/operations'
import { applyOp } from '../../src/internals/operations-runtime'
import { timeMs } from '../utils/perf'

const OPS = 10_000
const INSERT_TEXT_BUDGET_MS = 200
const WARMUP_OPS = 50

function firstTextTarget(context: EditorContext): {
  blockId: InsertTextOp['blockId']
  nodeId: InsertTextOp['nodeId']
} {
  const [blockId] = context.state.blockOrderById
  if (!blockId) {
    throw new Error('Expected a block')
  }

  const block = getBlockWithInlineContent(context.state, blockId)
  const [node] = block.content
  if (!node || !isTextNode(node)) {
    throw new Error('Expected a text node')
  }

  return { blockId, nodeId: node.id }
}

function applyInsertChars(
  context: EditorContext,
  count: number,
  offsetStart = 0,
): EditorContext {
  const { blockId, nodeId } = firstTextTarget(context)
  let next = context

  for (let i = 0; i < count; i += 1) {
    const op: InsertTextOp = {
      __type: 'insert_text',
      blockId,
      nodeId,
      offset: offsetStart + i,
      text: 'x',
    }
    next = applyOp(next, op)
  }

  return next
}

describe('apply perf', () => {
  test(`10k insert_text ops complete under ${INSERT_TEXT_BUDGET_MS}ms`, () => {
    const elapsed = timeMs(
      () => {
        applyInsertChars(createInitialEditorContext(), OPS)
      },
      () => {
        applyInsertChars(createInitialEditorContext(), WARMUP_OPS)
      },
    )

    expect(elapsed).toBeLessThan(INSERT_TEXT_BUDGET_MS)
  })

  test('insert_text reuses unchanged block identity and blockOrderById', () => {
    let context = createInitialEditorContext()
    const [firstId] = context.state.blockOrderById
    if (!firstId) {
      throw new Error('Expected a block')
    }

    const first = getBlockWithInlineContent(context.state, firstId)
    const second = createParagraphBlockAfter(first, [
      createTextNode({ text: 'other' }),
    ])
    context = {
      ...context,
      state: putBlock(context.state, second),
    }

    const orderBefore = context.state.blockOrderById
    const { nodeId } = firstTextTarget(context)

    const op: InsertTextOp = {
      __type: 'insert_text',
      blockId: first.id,
      nodeId,
      offset: 0,
      text: 'x',
    }
    const next = applyOp(context, op)

    expect(next.state.blocks.get(second.id)).toBe(second)
    expect(next.state.blockOrderById).toBe(orderBefore)
  })

  test('10k chars into one paragraph stay on a single text node', () => {
    const context = applyInsertChars(createInitialEditorContext(), OPS)
    const { blockId } = firstTextTarget(context)
    const block = getBlockWithInlineContent(context.state, blockId)
    const [node] = block.content

    expect(block.content).toHaveLength(1)
    expect(node && isTextNode(node) ? node.text : '').toHaveLength(OPS)
  })
})
