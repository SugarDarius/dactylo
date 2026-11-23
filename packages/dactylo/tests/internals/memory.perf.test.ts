/**
 * In-memory size budgets for a 10k-char document (50 paragraphs) and 100 history entries.
 * Estimator is JSON UTF-8 + UTF-16 text bytes (not V8 RSS). Ceilings are 2× the design table.
 */
import { describe, expect, test } from 'vitest'

import {
  createParagraphBlock,
  createParagraphBlockAfter,
  isBlockWithInlineContent,
} from '../../src/internals/blocks'
import type { BlockId, ParagraphBlock } from '../../src/internals/blocks'
import { createDocumentState, putBlocks } from '../../src/internals/document'
import type { DocumentState } from '../../src/internals/document'
import type { HistoryEntry } from '../../src/internals/history'
import type { InlineNode, NodeId } from '../../src/internals/nodes'
import {
  createTextNode,
  isInlineNodeWithEditableText,
} from '../../src/internals/nodes'
import { makeInitialPosition } from '../../src/internals/position'
import { jsonBytes, utf16Bytes } from '../utils/perf'

const BLOCK_COUNT = 50
const CHARS_PER_BLOCK = 200
const TOTAL_CHARS = BLOCK_COUNT * CHARS_PER_BLOCK
const HISTORY_ENTRIES = 100
const KB = 1024

/** Design ~25 KB → 2× ceiling. */
const BLOCKS_MAP_CEILING = 50 * KB
/** 10k chars × 2 bytes/code unit, plus slack. */
const TEXT_UTF16_CEILING = 24 * KB
/** Design ~10 KB → 2× ceiling. */
const NODE_OVERHEAD_CEILING = 20 * KB
/** Design ~40 KB → 2× ceiling. */
const HISTORY_CEILING = 80 * KB

function createTenKCharDocument(): DocumentState {
  const chunk = 'x'.repeat(CHARS_PER_BLOCK)
  const first = createParagraphBlock({
    content: [createTextNode({ text: chunk })],
    posKey: makeInitialPosition(),
  })
  const incoming: ParagraphBlock[] = [first]
  let prev = first

  for (let i = 1; i < BLOCK_COUNT; i += 1) {
    const next = createParagraphBlockAfter(prev, [
      createTextNode({ text: chunk }),
    ])
    incoming.push(next)
    prev = next
  }

  return putBlocks(createDocumentState(), incoming)
}

function collectInlineNodes(state: DocumentState): InlineNode[] {
  const nodes: InlineNode[] = []

  for (const id of state.blockOrderById) {
    const block = state.blocks.get(id)
    if (!block || !isBlockWithInlineContent(block)) {
      continue
    }
    for (const node of block.content) {
      nodes.push(node)
    }
  }

  return nodes
}

function documentText(nodes: readonly InlineNode[]): string {
  let text = ''
  for (const node of nodes) {
    if (isInlineNodeWithEditableText(node)) {
      text += node.text
    }
  }
  return text
}

function nodeOverheadPayload(nodes: readonly InlineNode[]): unknown[] {
  return nodes.map((node) => {
    if (!isInlineNodeWithEditableText(node)) {
      return node
    }
    const { text: _text, ...rest } = node
    return rest
  })
}

function createHistoryEntries(count: number): HistoryEntry[] {
  const blockId = 'bl_0001' as BlockId
  const nodeId = 'nd_0001' as NodeId
  const text = 'hello'
  const entries: HistoryEntry[] = []

  for (let i = 0; i < count; i += 1) {
    const offset = i * text.length
    entries.push({
      inverseOps: [
        {
          __type: 'delete_text',
          blockId,
          length: text.length,
          nodeId,
          offset,
          snapshot: { text },
        },
      ],
      ops: [
        {
          __type: 'insert_text',
          blockId,
          nodeId,
          offset,
          text,
        },
      ],
      timestamp: 0,
    })
  }

  return entries
}

describe('memory perf', () => {
  test('50-block 10k-char document stays within size budgets', () => {
    const state = createTenKCharDocument()
    const nodes = collectInlineNodes(state)
    const text = documentText(nodes)

    expect(state.blocks.size).toBe(BLOCK_COUNT)
    expect(text).toHaveLength(TOTAL_CHARS)
    expect(jsonBytes([...state.blocks.values()])).toBeLessThan(
      BLOCKS_MAP_CEILING,
    )
    expect(utf16Bytes(text)).toBeLessThan(TEXT_UTF16_CEILING)
    expect(jsonBytes(nodeOverheadPayload(nodes))).toBeLessThan(
      NODE_OVERHEAD_CEILING,
    )
  })

  test('100 history entries stay within size budget', () => {
    const entries = createHistoryEntries(HISTORY_ENTRIES)

    expect(entries).toHaveLength(HISTORY_ENTRIES)
    expect(jsonBytes(entries)).toBeLessThan(HISTORY_CEILING)
  })
})
