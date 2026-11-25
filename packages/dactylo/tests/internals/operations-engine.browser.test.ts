import { describe, expect, test } from 'vitest'

import {
  isNumberedListItemBlock,
  isParagraphBlock,
} from '../../src/internals/blocks'
import type { DocumentJsonInput } from '../../src/internals/document-json-input'
import {
  createTextNode,
  isMentionNode,
  isTextNode,
} from '../../src/internals/nodes'
import type { InsertBlockOp } from '../../src/internals/operations'
import type { OperationsBuilderInitialMetadata } from '../../src/internals/operations-builder'
import { resolvePatchContent } from '../../src/internals/operations-builder'
import { OperationsEngine } from '../../src/internals/operations-engine'
import { makeInitialPosition, makePosition } from '../../src/internals/position'
import { TransactionPipeline } from '../../src/internals/transaction'

const CREATED_AT = '2026-11-23T00:00:00.000Z'

function nodeBase() {
  return {
    createdAt: CREATED_AT,
    metadata: {},
    updatedAt: null,
  }
}

function blockBase() {
  return {
    createdAt: CREATED_AT,
    metadata: {},
    parentId: null,
    updatedAt: null,
  }
}

function marks() {
  return {
    bold: false,
    code: false,
    italic: false,
    strikethrough: false,
    underline: false,
  }
}

function textNode(text = 'Hello') {
  return {
    ...nodeBase(),
    marks: marks(),
    text,
    type: 'text' as const,
  }
}

function coveringDocument(): DocumentJsonInput {
  return {
    blocks: [
      {
        ...blockBase(),
        content: [textNode('Title')],
        level: 1,
        type: 'heading',
      },
      {
        ...blockBase(),
        content: [
          textNode('Hello'),
          {
            ...nodeBase(),
            marks: marks(),
            text: 'link',
            type: 'link',
            url: { href: 'https://example.com', title: 'Example' },
          },
          {
            ...nodeBase(),
            entity: { data: { email: 'jane@example.com' }, id: 'user_1' },
            type: 'mention',
          },
          {
            ...nodeBase(),
            type: 'line_break',
          },
          textNode('world'),
        ],
        type: 'paragraph',
      },
      {
        ...blockBase(),
        content: [textNode('quoted')],
        type: 'quote',
      },
      {
        ...blockBase(),
        content: [textNode('item')],
        type: 'bullet_list_item',
      },
      {
        ...blockBase(),
        content: [textNode('one')],
        markerNumbering: '1.',
        type: 'numbered_list_item',
        variant: 'default',
      },
      {
        ...blockBase(),
        checked: false,
        content: [textNode('todo')],
        type: 'checkbox_list_item',
      },
      {
        ...blockBase(),
        type: 'divider',
      },
    ],
  }
}

function emptyInitialMetadata(): OperationsBuilderInitialMetadata {
  return {
    bulletedList: {},
    checkboxList: {},
    divider: {},
    heading: {},
    lineBreak: {},
    link: {},
    mentions: {},
    numberedList: {},
    paragraph: { source: 'init-paragraph' },
    quote: {},
    text: { source: 'init-text' },
  }
}

function makeEngine(): OperationsEngine {
  return new OperationsEngine({
    autolink: { enabled: false },
    debug: false,
    initialMetadata: emptyInitialMetadata(),
    locales: 'en-US',
  })
}

function expectInsertBlockOps(
  ops: readonly { readonly __type: string }[],
): asserts ops is InsertBlockOp[] {
  for (const op of ops) {
    expect(op.__type).toBe('insert_block')
  }
}

describe('OperationsEngine.buildInitialEmptyDocumentOps', () => {
  test('inserts one empty paragraph at the initial position', () => {
    const { label, ops } = makeEngine().buildInitialEmptyDocumentOps()

    expect(label).toBe('initialize-empty-document')
    expectInsertBlockOps(ops)
    expect(ops).toHaveLength(1)

    const [op] = ops
    if (op === undefined) {
      throw new Error('op is undefined')
    }

    expect(op.afterBlockId).toBeNull()
    expect(isParagraphBlock(op.block)).toBe(true)
    if (!isParagraphBlock(op.block)) {
      return
    }

    expect(op.block.posKey).toBe(makeInitialPosition())
    expect(op.block.metadata).toEqual({ source: 'init-paragraph' })
    if (op.block.content[0] === undefined) {
      throw new Error('op.block.content[0] is undefined')
    }
    expect(isTextNode(op.block.content[0]) && op.block.content[0].text).toBe('')
    expect(op.block.content[0]?.metadata).toEqual({ source: 'init-text' })
  })
})

describe('OperationsEngine.buildInitialDocumentOps', () => {
  test('falls back to an empty document when JSON has no blocks', () => {
    const engine = makeEngine()
    const empty = engine.buildInitialEmptyDocumentOps()
    const fromJson = engine.buildInitialDocumentOps({ blocks: [] })

    expect(fromJson.label).toBe(empty.label)
    expect(fromJson.ops).toHaveLength(empty.ops.length)
    expect(fromJson.ops[0]?.__type).toBe('insert_block')
  })

  test('emits one insert_block per JSON block, chained in order', () => {
    const { label, ops } =
      makeEngine().buildInitialDocumentOps(coveringDocument())

    expect(label).toBe('initialize-document-from-json')
    expectInsertBlockOps(ops)
    expect(ops).toHaveLength(7)

    expect(ops.map((op) => op.block.__type)).toEqual([
      'heading',
      'paragraph',
      'quote',
      'bullet_list_item',
      'numbered_list_item',
      'checkbox_list_item',
      'divider',
    ])

    expect(ops[0]?.afterBlockId).toBeNull()
    expect(ops[0]?.block.posKey).toBe(makeInitialPosition())

    for (let i = 1; i < ops.length; i += 1) {
      const prev = ops[i - 1]
      const current = ops[i]
      expect(current?.afterBlockId).toBe(prev?.block.id)
      expect(current?.block.posKey).toBe(makePosition(prev?.block.posKey))
      expect(prev && current && prev.block.posKey < current.block.posKey).toBe(
        true,
      )
    }

    const numbered = ops[4]?.block
    expect(numbered?.__type).toBe('numbered_list_item')
    if (numbered?.__type === 'numbered_list_item') {
      expect(numbered.markerNumbering).toBe('1.')
      expect(numbered.variant).toBe('default')
    }

    const paragraph = ops[1]?.block
    expect(paragraph?.__type).toBe('paragraph')
    if (paragraph?.__type === 'paragraph') {
      expect(paragraph.content.map((node) => node.__type)).toEqual([
        'text',
        'link',
        'mention',
        'line_break',
        'text',
      ])
    }
  })

  test('fills omitted JSON metadata from engine initialMetadata', () => {
    const { ops } = makeEngine().buildInitialDocumentOps({
      blocks: [
        {
          content: [{ text: 'Hello', type: 'text' }],
          type: 'paragraph',
        },
      ],
    })

    expectInsertBlockOps(ops)
    const [op] = ops
    if (op === undefined) {
      throw new Error('op is undefined')
    }

    expect(isParagraphBlock(op.block)).toBe(true)
    if (!isParagraphBlock(op.block)) {
      return
    }

    expect(op.block.metadata).toEqual({ source: 'init-paragraph' })
    expect(op.block.parentId).toBeNull()
    if (op.block.content[0] === undefined) {
      throw new Error('op.block.content[0] is undefined')
    }
    expect(isTextNode(op.block.content[0])).toBe(true)
    if (!isTextNode(op.block.content[0])) {
      return
    }
    expect(op.block.content[0].metadata).toEqual({ source: 'init-text' })
  })
})

describe('TransactionPipeline JSON initialContent', () => {
  test('applies JSON init ops onto document state', () => {
    const pipeline = new TransactionPipeline({
      autolink: { enabled: false },
      commandTrigger: { character: '/', enabled: false },
      debug: false,
      engine: { locales: 'en-US' },
      initialContent: coveringDocument(),
      markdown: { enabled: false },
      mentions: { character: '@', enabled: false },
    })

    const { state } = pipeline.context
    expect(pipeline.documentStatus).toBe('ready')
    expect(state.blockOrderById).toHaveLength(7)
    expect(
      state.blockOrderById.map((id) => state.blocks.get(id)?.__type),
    ).toEqual([
      'heading',
      'paragraph',
      'quote',
      'bullet_list_item',
      'numbered_list_item',
      'checkbox_list_item',
      'divider',
    ])
  })

  test('reindexes gapped numbered-list markers after JSON init', () => {
    const pipeline = new TransactionPipeline({
      autolink: { enabled: false },
      commandTrigger: { character: '/', enabled: false },
      debug: false,
      engine: { locales: 'en-US' },
      initialContent: {
        blocks: [
          {
            ...blockBase(),
            content: [textNode('one')],
            markerNumbering: '1.',
            type: 'numbered_list_item',
            variant: 'default',
          },
          {
            ...blockBase(),
            content: [textNode('two')],
            markerNumbering: '9.',
            type: 'numbered_list_item',
            variant: 'default',
          },
          {
            ...blockBase(),
            content: [textNode('gap')],
            type: 'paragraph',
          },
          {
            ...blockBase(),
            content: [textNode('alpha')],
            markerNumbering: 'c.',
            type: 'numbered_list_item',
            variant: 'alpha',
          },
          {
            ...blockBase(),
            content: [textNode('next')],
            markerNumbering: 'z.',
            type: 'numbered_list_item',
            variant: 'alpha',
          },
        ],
      },
      markdown: { enabled: false },
      mentions: { character: '@', enabled: false },
    })

    const markers = pipeline.context.state.blockOrderById.map((id) => {
      const block = pipeline.context.state.blocks.get(id)
      return block && isNumberedListItemBlock(block)
        ? block.markerNumbering
        : ''
    })

    expect(markers).toEqual(['1.', '2.', '', 'c.', 'd.'])
  })
})

describe('resolvePatchContent', () => {
  const source = [createTextNode({ text: 'Hello' })]

  test('keeps source and returns no mentions when patchJsonInput is omitted', () => {
    const [content, mentions] = resolvePatchContent({
      initialMetadata: emptyInitialMetadata(),
      source,
    })

    expect(content).toBe(source)
    expect(mentions).toBeNull()
  })

  test('keeps source and returns no mentions when patchJsonInput is empty', () => {
    const [content, mentions] = resolvePatchContent({
      initialMetadata: emptyInitialMetadata(),
      patchJsonInput: [],
      source,
    })

    expect(content).toBe(source)
    expect(mentions).toBeNull()
  })

  test('replaces content and returns an empty mentions list for text-only patches', () => {
    const [content, mentions] = resolvePatchContent({
      initialMetadata: emptyInitialMetadata(),
      patchJsonInput: [{ text: 'World', type: 'text' }],
      source,
    })

    expect(content).not.toBe(source)
    expect(content).toHaveLength(1)
    const [node] = content
    if (node === undefined || !isTextNode(node)) {
      throw new Error('Expected a text node')
    }
    expect(node.text).toBe('World')
    expect(mentions).toEqual([])
  })

  test('collects mentions created from the patch json input', () => {
    const [content, mentions] = resolvePatchContent({
      initialMetadata: emptyInitialMetadata(),
      patchJsonInput: [
        {
          entity: { data: { email: 'jane@example.com' }, id: 'user_1' },
          type: 'mention',
        },
        { text: 'hi', type: 'text' },
      ],
      source,
    })

    expect(content.map((node) => node.__type)).toEqual(['mention', 'text'])
    expect(mentions).toHaveLength(1)
    expect(mentions?.[0]).toBe(content.find(isMentionNode))
  })
})
