import { describe, expect, test } from 'vitest'

import {
  isBulletListItemBlock,
  isCheckboxListItemBlock,
  isDividerBlock,
  isHeadingBlock,
  isNumberedListItemBlock,
  isParagraphBlock,
  isQuoteBlock,
} from '../../src/internals/blocks'
import {
  createBlockFromJson,
  createInlineContentFromJson,
  createInlineNodeFromJson,
} from '../../src/internals/document-json'
import type {
  BlockJsonSchema,
  InlineNodeJsonSchema,
} from '../../src/internals/document-json-schema'
import { createBaseMarks } from '../../src/internals/marks'
import {
  isLineBreakNode,
  isLinkNode,
  isMentionNode,
  isTextNode,
} from '../../src/internals/nodes'
import { makeInitialPosition } from '../../src/internals/position'

const CREATED_AT = '2026-11-23T00:00:00.000Z'
const EMPTY_TEXT_METADATA = { origin: 'empty-fallback' }

function nodeBase() {
  return {
    createdAt: CREATED_AT,
    metadata: { bag: 'from-json' },
    updatedAt: null,
  }
}

function blockBase() {
  return {
    createdAt: CREATED_AT,
    metadata: { bag: 'from-json' },
    parentId: 'bl_parent',
    updatedAt: null,
  }
}

function marks(overrides: Partial<ReturnType<typeof createBaseMarks>> = {}) {
  return {
    ...createBaseMarks(),
    ...overrides,
  }
}

function textJson(
  text = 'Hello',
  markOverrides: Partial<ReturnType<typeof createBaseMarks>> = {},
): Extract<InlineNodeJsonSchema, { type: 'text' }> {
  return {
    ...nodeBase(),
    marks: marks(markOverrides),
    text,
    type: 'text',
  }
}

function paragraphJson(
  content: InlineNodeJsonSchema[] = [textJson()],
): Extract<BlockJsonSchema, { type: 'paragraph' }> {
  return {
    ...blockBase(),
    content,
    type: 'paragraph',
  }
}

describe('createInlineNodeFromJson', () => {
  test('mints a text node, copies marks, and sanitizes control characters', () => {
    const node = createInlineNodeFromJson(textJson('a\u0000b', { bold: true }))

    expect(isTextNode(node)).toBe(true)
    if (!isTextNode(node)) {
      return
    }

    expect(node.id.startsWith('nd_')).toBe(true)
    expect(node.text).toBe('ab')
    expect(node.marks.bold).toBe(true)
    expect(node.metadata).toEqual({ bag: 'from-json' })
    expect(node.createdAt).toBeInstanceOf(Date)
    expect(node.updatedAt).toBeNull()
  })

  test('mints a link node and strips a javascript href', () => {
    const node = createInlineNodeFromJson({
      ...nodeBase(),
      marks: marks({ italic: true }),
      text: 'click',
      type: 'link',
      url: {
        // oxlint-disable-next-line no-script-url
        href: 'javascript:alert(1)',
        title: 'Example',
      },
    })

    expect(isLinkNode(node)).toBe(true)
    if (!isLinkNode(node)) {
      return
    }

    expect(node.text).toBe('click')
    expect(node.url.href).toBe('')
    expect(node.url.title).toBe('Example')
    expect(node.marks.italic).toBe(true)
  })

  test('mints a mention node with the JSON entity', () => {
    const node = createInlineNodeFromJson({
      ...nodeBase(),
      entity: { data: { email: 'jane@example.com' }, id: 'user_1' },
      type: 'mention',
    })

    expect(isMentionNode(node)).toBe(true)
    if (!isMentionNode(node)) {
      return
    }

    expect(node.entity).toEqual({
      data: { email: 'jane@example.com' },
      id: 'user_1',
    })
  })

  test('mints a line break node', () => {
    const node = createInlineNodeFromJson({
      ...nodeBase(),
      type: 'line_break',
    })

    expect(isLineBreakNode(node)).toBe(true)
    expect(node.metadata).toEqual({ bag: 'from-json' })
  })
})

describe('createInlineContentFromJson', () => {
  test('inserts one empty text node when the JSON array is empty', () => {
    const content = createInlineContentFromJson([], EMPTY_TEXT_METADATA)

    expect(content).toHaveLength(1)
    const [node] = content
    expect(node && isTextNode(node)).toBe(true)
    if (!node || !isTextNode(node)) {
      return
    }

    expect(node.text).toBe('')
    expect(node.marks).toEqual(createBaseMarks())
    expect(node.metadata).toEqual(EMPTY_TEXT_METADATA)
  })

  test('maps JSON nodes in order and ignores the empty-text metadata bag', () => {
    const content = createInlineContentFromJson(
      [
        textJson('Hello'),
        {
          ...nodeBase(),
          type: 'line_break',
        },
        textJson('world'),
      ],
      EMPTY_TEXT_METADATA,
    )

    expect(content.map((node) => node.__type)).toEqual([
      'text',
      'line_break',
      'text',
    ])
    expect(content.map((node) => node.metadata)).toEqual([
      { bag: 'from-json' },
      { bag: 'from-json' },
      { bag: 'from-json' },
    ])
  })
})

describe('createBlockFromJson', () => {
  const posKey = makeInitialPosition()
  const opts = { textMetadata: EMPTY_TEXT_METADATA }

  test('builds a paragraph, drops JSON parentId, and uses the given posKey', () => {
    const block = createBlockFromJson(paragraphJson(), posKey, opts)

    expect(isParagraphBlock(block)).toBe(true)
    if (!isParagraphBlock(block)) {
      return
    }

    expect(block.id.startsWith('bl_')).toBe(true)
    expect(block.parentId).toBeNull()
    expect(block.posKey).toBe(posKey)
    expect(block.metadata).toEqual({ bag: 'from-json' })
    expect(block.createdAt).toBeInstanceOf(Date)
    expect(block.updatedAt).toBeNull()
    if (block.content[0] === undefined) {
      throw new Error('block.content[0] is undefined')
    }
    expect(isTextNode(block.content[0]) && block.content[0].text).toBe('Hello')
  })

  test('fills empty inline content with an empty text node', () => {
    const block = createBlockFromJson(paragraphJson([]), posKey, opts)

    expect(isParagraphBlock(block)).toBe(true)
    if (!isParagraphBlock(block)) {
      return
    }

    expect(block.content).toHaveLength(1)
    const [node] = block.content
    expect(node && isTextNode(node) && node.text).toBe('')
    expect(node?.metadata).toEqual(EMPTY_TEXT_METADATA)
  })

  test('builds a heading with the JSON level', () => {
    const block = createBlockFromJson(
      {
        ...blockBase(),
        content: [textJson('Title')],
        level: 3,
        type: 'heading',
      },
      posKey,
      opts,
    )

    expect(isHeadingBlock(block)).toBe(true)
    if (!isHeadingBlock(block)) {
      return
    }

    expect(block.level).toBe(3)
    if (block.content[0] === undefined) {
      throw new Error('block.content[0] is undefined')
    }
    expect(isTextNode(block.content[0]) && block.content[0].text).toBe('Title')
  })

  test('builds quote and bullet list item blocks', () => {
    const quote = createBlockFromJson(
      {
        ...blockBase(),
        content: [textJson('quoted')],
        type: 'quote',
      },
      posKey,
      opts,
    )
    const bullet = createBlockFromJson(
      {
        ...blockBase(),
        content: [textJson('item')],
        type: 'bullet_list_item',
      },
      posKey,
      opts,
    )

    expect(isQuoteBlock(quote)).toBe(true)
    expect(isBulletListItemBlock(bullet)).toBe(true)
  })

  test('keeps numbered-list variant and marker numbering as written', () => {
    const block = createBlockFromJson(
      {
        ...blockBase(),
        content: [textJson('one')],
        markerNumbering: 'ii.',
        type: 'numbered_list_item',
        variant: 'roman',
      },
      posKey,
      opts,
    )

    expect(isNumberedListItemBlock(block)).toBe(true)
    if (!isNumberedListItemBlock(block)) {
      return
    }

    expect(block.variant).toBe('roman')
    expect(block.markerNumbering).toBe('ii.')
  })

  test('builds a checkbox list item with the JSON checked flag', () => {
    const block = createBlockFromJson(
      {
        ...blockBase(),
        checked: true,
        content: [textJson('todo')],
        type: 'checkbox_list_item',
      },
      posKey,
      opts,
    )

    expect(isCheckboxListItemBlock(block)).toBe(true)
    if (!isCheckboxListItemBlock(block)) {
      return
    }

    expect(block.checked).toBe(true)
  })

  test('builds a divider and drops leftover JSON content', () => {
    const block = createBlockFromJson(
      {
        ...blockBase(),
        type: 'divider',
      },
      posKey,
      opts,
    )

    expect(isDividerBlock(block)).toBe(true)
    expect(block.parentId).toBeNull()
    expect('content' in block).toBe(false)
  })
})
