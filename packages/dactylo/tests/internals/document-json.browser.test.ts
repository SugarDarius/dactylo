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
  createBlockFromJsonInput,
  createInlineContentFromJsonInput,
  createInlineNodeFromJsonInput,
} from '../../src/internals/document-json-input'
import type {
  BlockJsonInput,
  InlineNodeJsonInput,
} from '../../src/internals/document-json-input'
import { createBaseMarks } from '../../src/internals/marks'
import {
  isLineBreakNode,
  isLinkNode,
  isMentionNode,
  isTextNode,
} from '../../src/internals/nodes'
import type { OperationsBuilderInitialMetadata } from '../../src/internals/operations-builder'
import { makeInitialPosition } from '../../src/internals/position'

const CREATED_AT = '2026-11-23T00:00:00.000Z'
const UPDATED_AT = '2026-11-23T12:00:00.000Z'

const INITIAL_METADATA: OperationsBuilderInitialMetadata = {
  bulletedList: { origin: 'init-bulleted' },
  checkboxList: { origin: 'init-checkbox' },
  divider: { origin: 'init-divider' },
  heading: { origin: 'init-heading' },
  lineBreak: { origin: 'init-line-break' },
  link: { origin: 'init-link' },
  mentions: { origin: 'init-mention' },
  numberedList: { origin: 'init-numbered' },
  paragraph: { origin: 'init-paragraph' },
  quote: { origin: 'init-quote' },
  text: { origin: 'init-text' },
}

const JSON_OPTS = { initialMetadata: INITIAL_METADATA }

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
): Extract<InlineNodeJsonInput, { type: 'text' }> {
  return {
    ...nodeBase(),
    marks: marks(markOverrides),
    text,
    type: 'text',
  }
}

function paragraphJson(
  content: InlineNodeJsonInput[] = [textJson()],
): Extract<BlockJsonInput, { type: 'paragraph' }> {
  return {
    ...blockBase(),
    content,
    type: 'paragraph',
  }
}

describe('createInlineNodeFromJsonInput', () => {
  test('mints a text node, copies marks, and sanitizes control characters', () => {
    const node = createInlineNodeFromJsonInput(
      textJson('a\u0000b', { bold: true }),
      JSON_OPTS,
    )

    expect(isTextNode(node)).toBe(true)
    if (!isTextNode(node)) {
      return
    }

    expect(node.id.startsWith('nd_')).toBe(true)
    expect(node.text).toBe('ab')
    expect(node.marks.bold).toBe(true)
    expect(node.metadata).toEqual({ bag: 'from-json' })
    expect(node.createdAt.toISOString()).toBe(CREATED_AT)
    expect(node.updatedAt).toBeNull()
  })

  test('mints a link node and strips a javascript href', () => {
    const node = createInlineNodeFromJsonInput(
      {
        ...nodeBase(),
        marks: marks({ italic: true }),
        text: 'click',
        type: 'link',
        url: {
          // oxlint-disable-next-line no-script-url
          href: 'javascript:alert(1)',
          title: 'Example',
        },
      },
      JSON_OPTS,
    )

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
    const node = createInlineNodeFromJsonInput(
      {
        ...nodeBase(),
        entity: { data: { email: 'jane@example.com' }, id: 'user_1' },
        type: 'mention',
      },
      JSON_OPTS,
    )

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
    const node = createInlineNodeFromJsonInput(
      {
        ...nodeBase(),
        type: 'line_break',
      },
      JSON_OPTS,
    )

    expect(isLineBreakNode(node)).toBe(true)
    expect(node.metadata).toEqual({ bag: 'from-json' })
    expect(node.createdAt.toISOString()).toBe(CREATED_AT)
  })

  test('fills omitted metadata from initialMetadata and merges partial marks', () => {
    const node = createInlineNodeFromJsonInput(
      { marks: { code: true }, text: 'Hello', type: 'text' },
      JSON_OPTS,
    )

    expect(isTextNode(node)).toBe(true)
    if (!isTextNode(node)) {
      return
    }

    expect(node.metadata).toEqual(INITIAL_METADATA.text)
    expect(node.marks).toEqual({ ...createBaseMarks(), code: true })
  })

  test('parses JSON updatedAt onto the node', () => {
    const node = createInlineNodeFromJsonInput(
      { ...textJson(), updatedAt: UPDATED_AT },
      JSON_OPTS,
    )

    expect(node.updatedAt?.toISOString()).toBe(UPDATED_AT)
  })

  test('uses initialMetadata when JSON omits it on link, mention, and line break', () => {
    const link = createInlineNodeFromJsonInput(
      {
        text: 'click',
        type: 'link',
        url: { href: 'https://example.com', title: '' },
      },
      JSON_OPTS,
    )
    const mention = createInlineNodeFromJsonInput(
      {
        entity: { data: { email: 'jane@example.com' }, id: 'user_1' },
        type: 'mention',
      },
      JSON_OPTS,
    )
    const lineBreak = createInlineNodeFromJsonInput(
      { type: 'line_break' },
      JSON_OPTS,
    )

    expect(link.metadata).toEqual(INITIAL_METADATA.link)
    expect(mention.metadata).toEqual(INITIAL_METADATA.mentions)
    expect(lineBreak.metadata).toEqual(INITIAL_METADATA.lineBreak)
  })
})

describe('createInlineContentFromJsonInput', () => {
  test('inserts one empty text node when the JSON array is empty', () => {
    const content = createInlineContentFromJsonInput([], JSON_OPTS)

    expect(content).toHaveLength(1)
    const [node] = content
    expect(node && isTextNode(node)).toBe(true)
    if (!node || !isTextNode(node)) {
      return
    }

    expect(node.text).toBe('')
    expect(node.marks).toEqual(createBaseMarks())
    expect(node.metadata).toEqual(INITIAL_METADATA.text)
  })

  test('maps JSON nodes in order and ignores the empty-text metadata bag', () => {
    const content = createInlineContentFromJsonInput(
      [
        textJson('Hello'),
        {
          ...nodeBase(),
          type: 'line_break',
        },
        textJson('world'),
      ],
      JSON_OPTS,
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

describe('createBlockFromJsonInput', () => {
  const posKey = makeInitialPosition()

  test('builds a paragraph, drops JSON parentId, and uses the given posKey', () => {
    const block = createBlockFromJsonInput(paragraphJson(), posKey, JSON_OPTS)

    expect(isParagraphBlock(block)).toBe(true)
    if (!isParagraphBlock(block)) {
      return
    }

    expect(block.id.startsWith('bl_')).toBe(true)
    expect(block.parentId).toBeNull()
    expect(block.posKey).toBe(posKey)
    expect(block.metadata).toEqual({ bag: 'from-json' })
    expect(block.createdAt.toISOString()).toBe(CREATED_AT)
    expect(block.updatedAt).toBeNull()
    if (block.content[0] === undefined) {
      throw new Error('block.content[0] is undefined')
    }
    expect(isTextNode(block.content[0]) && block.content[0].text).toBe('Hello')
  })

  test('fills empty inline content with an empty text node', () => {
    const block = createBlockFromJsonInput(paragraphJson([]), posKey, JSON_OPTS)

    expect(isParagraphBlock(block)).toBe(true)
    if (!isParagraphBlock(block)) {
      return
    }

    expect(block.content).toHaveLength(1)
    const [node] = block.content
    expect(node && isTextNode(node) && node.text).toBe('')
    expect(node?.metadata).toEqual(INITIAL_METADATA.text)
  })

  test('fills omitted block metadata from initialMetadata', () => {
    const paragraph = createBlockFromJsonInput(
      { content: [{ text: 'Hello', type: 'text' }], type: 'paragraph' },
      posKey,
      JSON_OPTS,
    )
    const divider = createBlockFromJsonInput(
      { type: 'divider' },
      posKey,
      JSON_OPTS,
    )

    expect(paragraph.metadata).toEqual(INITIAL_METADATA.paragraph)
    expect(paragraph.parentId).toBeNull()
    expect(divider.metadata).toEqual(INITIAL_METADATA.divider)
  })

  test('parses JSON updatedAt onto the block', () => {
    const block = createBlockFromJsonInput(
      { ...paragraphJson(), updatedAt: UPDATED_AT },
      posKey,
      JSON_OPTS,
    )

    expect(block.updatedAt?.toISOString()).toBe(UPDATED_AT)
  })

  test('builds a heading with the JSON level', () => {
    const block = createBlockFromJsonInput(
      {
        ...blockBase(),
        content: [textJson('Title')],
        level: 3,
        type: 'heading',
      },
      posKey,
      JSON_OPTS,
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
    const quote = createBlockFromJsonInput(
      {
        ...blockBase(),
        content: [textJson('quoted')],
        type: 'quote',
      },
      posKey,
      JSON_OPTS,
    )
    const bullet = createBlockFromJsonInput(
      {
        ...blockBase(),
        content: [textJson('item')],
        type: 'bullet_list_item',
      },
      posKey,
      JSON_OPTS,
    )

    expect(isQuoteBlock(quote)).toBe(true)
    expect(isBulletListItemBlock(bullet)).toBe(true)
  })

  test('keeps numbered-list variant and marker numbering as written', () => {
    const block = createBlockFromJsonInput(
      {
        ...blockBase(),
        content: [textJson('one')],
        markerNumbering: 'ii.',
        type: 'numbered_list_item',
        variant: 'roman',
      },
      posKey,
      JSON_OPTS,
    )

    expect(isNumberedListItemBlock(block)).toBe(true)
    if (!isNumberedListItemBlock(block)) {
      return
    }

    expect(block.variant).toBe('roman')
    expect(block.markerNumbering).toBe('ii.')
  })

  test('builds a checkbox list item with the JSON checked flag', () => {
    const block = createBlockFromJsonInput(
      {
        ...blockBase(),
        checked: true,
        content: [textJson('todo')],
        type: 'checkbox_list_item',
      },
      posKey,
      JSON_OPTS,
    )

    expect(isCheckboxListItemBlock(block)).toBe(true)
    if (!isCheckboxListItemBlock(block)) {
      return
    }

    expect(block.checked).toBe(true)
  })

  test('builds a divider and drops leftover JSON content', () => {
    const block = createBlockFromJsonInput(
      {
        ...blockBase(),
        type: 'divider',
      },
      posKey,
      JSON_OPTS,
    )

    expect(isDividerBlock(block)).toBe(true)
    expect(block.parentId).toBeNull()
    expect(block.createdAt.toISOString()).toBe(CREATED_AT)
    expect('content' in block).toBe(false)
  })
})
