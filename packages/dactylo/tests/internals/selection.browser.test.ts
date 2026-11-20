// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'

import { generateBlockId, isDividerBlock } from '../../src/internals/blocks'
import type { BlockId } from '../../src/internals/blocks'
import {
  getBlockSelectionCoverageTopology,
  getInlineNodeSelectionCoverageTopology,
} from '../../src/internals/document'
import {
  generateNodeId,
  isLineBreakNode,
  isMentionNode,
  isTextNode,
} from '../../src/internals/nodes'
import type { NodeId } from '../../src/internals/nodes'
import { createRangeSelectingInlineContentInBlock } from '../../src/internals/selection'
import { TransactionPipeline } from '../../src/internals/transaction'
import {
  firstInlineBlock,
  focus,
  makePipeline,
  nthInlineBlock,
  selectRange,
  softBreak,
  typeLines,
  typeText,
} from '../utils/pipeline'

function blockCoverage(pipeline: TransactionPipeline, blockId: BlockId) {
  return getBlockSelectionCoverageTopology(
    pipeline.context.selection,
    pipeline.context.state,
    blockId,
  )
}

function nodeCoverage(pipeline: TransactionPipeline, nodeId: NodeId) {
  return getInlineNodeSelectionCoverageTopology(
    pipeline.context.selection,
    pipeline.context.state,
    nodeId,
  )
}

function textNodeId(block: ReturnType<typeof firstInlineBlock>, index = 0) {
  const node = block.content[index]
  if (!node || !isTextNode(node)) {
    throw new Error(`Expected a text node at index ${index}`)
  }
  return node.id
}

function makeMentionsPipeline() {
  return new TransactionPipeline({
    autolink: { enabled: false },
    commandTrigger: { character: '/', enabled: false },
    debug: false,
    engine: { locales: 'en-US' },
    markdown: { enabled: false },
    mentions: { character: '@', enabled: true },
  })
}

describe('getBlockSelectionCoverage / getNodeSelectionCoverage', () => {
  test('cursor selection is not coverage', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')

    const block = firstInlineBlock(pipeline.context)
    expect(blockCoverage(pipeline, block.id)).toBeNull()
    expect(nodeCoverage(pipeline, textNodeId(block))).toBeNull()
  })

  test('same-node partial and total', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')

    const block = firstInlineBlock(pipeline.context)
    const nodeId = textNodeId(block)

    selectRange(
      pipeline,
      { blockId: block.id, nodeId, offset: 1 },
      { blockId: block.id, nodeId, offset: 4 },
    )
    expect(nodeCoverage(pipeline, nodeId)).toBe('partial')
    expect(blockCoverage(pipeline, block.id)).toBe('partial')

    selectRange(
      pipeline,
      { blockId: block.id, nodeId, offset: 0 },
      { blockId: block.id, nodeId, offset: 5 },
    )
    expect(nodeCoverage(pipeline, nodeId)).toBe('total')
    expect(blockCoverage(pipeline, block.id)).toBe('total')
  })

  test('same-block: partial first node, total middle line-break, full-block total', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    softBreak(pipeline)
    typeText(pipeline, 'World')

    const block = firstInlineBlock(pipeline.context)
    const [hello, lineBreak, world] = block.content
    if (
      !hello ||
      !isTextNode(hello) ||
      !lineBreak ||
      !isLineBreakNode(lineBreak) ||
      !world ||
      !isTextNode(world)
    ) {
      throw new Error('Expected text, line-break, text')
    }

    selectRange(
      pipeline,
      { blockId: block.id, nodeId: hello.id, offset: 1 },
      { blockId: block.id, nodeId: hello.id, offset: 4 },
    )
    expect(nodeCoverage(pipeline, hello.id)).toBe('partial')
    expect(nodeCoverage(pipeline, lineBreak.id)).toBeNull()
    expect(nodeCoverage(pipeline, world.id)).toBeNull()
    expect(blockCoverage(pipeline, block.id)).toBe('partial')

    selectRange(
      pipeline,
      { blockId: block.id, nodeId: hello.id, offset: 2 },
      { blockId: block.id, nodeId: world.id, offset: 2 },
    )
    expect(nodeCoverage(pipeline, hello.id)).toBe('partial')
    expect(nodeCoverage(pipeline, lineBreak.id)).toBe('total')
    expect(nodeCoverage(pipeline, world.id)).toBe('partial')
    expect(blockCoverage(pipeline, block.id)).toBe('partial')

    const full = createRangeSelectingInlineContentInBlock(block)
    if (!full) {
      throw new Error('Expected a full-block range')
    }
    selectRange(pipeline, full.anchor, full.focus)
    expect(nodeCoverage(pipeline, hello.id)).toBe('total')
    expect(nodeCoverage(pipeline, lineBreak.id)).toBe('total')
    expect(nodeCoverage(pipeline, world.id)).toBe('total')
    expect(blockCoverage(pipeline, block.id)).toBe('total')
  })

  test('cross-block: start partial, middle total, end partial', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'Middle', 'World'])

    const start = nthInlineBlock(pipeline.context, 0)
    const middle = nthInlineBlock(pipeline.context, 1)
    const end = nthInlineBlock(pipeline.context, 2)

    selectRange(
      pipeline,
      { blockId: start.id, nodeId: textNodeId(start), offset: 2 },
      { blockId: end.id, nodeId: textNodeId(end), offset: 2 },
    )

    expect(blockCoverage(pipeline, start.id)).toBe('partial')
    expect(blockCoverage(pipeline, middle.id)).toBe('total')
    expect(blockCoverage(pipeline, end.id)).toBe('partial')
    expect(nodeCoverage(pipeline, textNodeId(start))).toBe('partial')
    expect(nodeCoverage(pipeline, textNodeId(middle))).toBe('total')
    expect(nodeCoverage(pipeline, textNodeId(end))).toBe('partial')
  })

  test('cross-block range marks a middle divider as total', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    if (!pipeline.insertBlock({ spec: { type: 'divider' } }, 'user')) {
      throw new Error('Expected a divider')
    }
    typeText(pipeline, 'World')

    const order = pipeline.context.state.blockOrderById
    const start = nthInlineBlock(pipeline.context, 0)
    const [, dividerId] = order
    const end = nthInlineBlock(pipeline.context, 2)
    if (!dividerId) {
      throw new Error('Expected a middle divider id')
    }
    const divider = pipeline.context.state.blocks.get(dividerId)
    if (!divider || !isDividerBlock(divider)) {
      throw new Error('Expected a divider block')
    }

    selectRange(
      pipeline,
      { blockId: start.id, nodeId: textNodeId(start), offset: 2 },
      { blockId: end.id, nodeId: textNodeId(end), offset: 2 },
    )

    expect(blockCoverage(pipeline, start.id)).toBe('partial')
    expect(blockCoverage(pipeline, dividerId)).toBe('total')
    expect(blockCoverage(pipeline, end.id)).toBe('partial')
  })

  test('mention inside a range is total and never partial', () => {
    const pipeline = makeMentionsPipeline()
    focus(pipeline)
    typeText(pipeline, 'Hi ')
    typeText(pipeline, '@')
    typeText(pipeline, 'john')
    expect(
      pipeline.confirmBufferedInlineMention(
        { entity: { data: { name: 'John Doe' }, id: 'user-123' } },
        'user',
      ),
    ).toBe(true)
    typeText(pipeline, ' there')

    const block = firstInlineBlock(pipeline.context)
    const [before, mention, after] = block.content
    if (
      !before ||
      !isTextNode(before) ||
      !mention ||
      !isMentionNode(mention) ||
      !after ||
      !isTextNode(after)
    ) {
      throw new Error('Expected text, mention, text')
    }

    selectRange(
      pipeline,
      { blockId: block.id, nodeId: before.id, offset: 0 },
      { blockId: block.id, nodeId: after.id, offset: after.text.length },
    )
    expect(nodeCoverage(pipeline, mention.id)).toBe('total')
    expect(blockCoverage(pipeline, block.id)).toBe('total')

    selectRange(
      pipeline,
      { blockId: block.id, nodeId: before.id, offset: 0 },
      { blockId: block.id, nodeId: before.id, offset: 2 },
    )
    expect(nodeCoverage(pipeline, mention.id)).toBeNull()
    expect(blockCoverage(pipeline, block.id)).toBe('partial')
  })

  test('unknown ids are not selected', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    const block = firstInlineBlock(pipeline.context)
    const nodeId = textNodeId(block)
    selectRange(
      pipeline,
      { blockId: block.id, nodeId, offset: 0 },
      { blockId: block.id, nodeId, offset: 5 },
    )

    expect(blockCoverage(pipeline, generateBlockId())).toBeNull()
    expect(nodeCoverage(pipeline, generateNodeId())).toBeNull()
  })

  test('backward range matches the normalized forward range', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])

    const start = nthInlineBlock(pipeline.context, 0)
    const end = nthInlineBlock(pipeline.context, 1)
    const from = { blockId: start.id, nodeId: textNodeId(start), offset: 2 }
    const to = { blockId: end.id, nodeId: textNodeId(end), offset: 2 }

    selectRange(pipeline, from, to)
    const forwardBlockStart = blockCoverage(pipeline, start.id)
    const forwardBlockEnd = blockCoverage(pipeline, end.id)
    const forwardNodeStart = nodeCoverage(pipeline, textNodeId(start))
    const forwardNodeEnd = nodeCoverage(pipeline, textNodeId(end))

    selectRange(pipeline, to, from)
    expect(blockCoverage(pipeline, start.id)).toBe(forwardBlockStart)
    expect(blockCoverage(pipeline, end.id)).toBe(forwardBlockEnd)
    expect(nodeCoverage(pipeline, textNodeId(start))).toBe(forwardNodeStart)
    expect(nodeCoverage(pipeline, textNodeId(end))).toBe(forwardNodeEnd)

    expect(forwardBlockStart).toBe('partial')
    expect(forwardBlockEnd).toBe('partial')
    expect(forwardNodeStart).toBe('partial')
    expect(forwardNodeEnd).toBe('partial')
  })
})
