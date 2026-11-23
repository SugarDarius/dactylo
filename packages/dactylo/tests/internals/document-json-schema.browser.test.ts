import { describe, expect, test } from 'vitest'

import { validateDocumentJsonSchema } from '../../src/internals/document-json-schema'
import { DactyloError, isDactyloError } from '../../src/internals/errors'

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

function paragraph(content: unknown[] = [textNode()]) {
  return {
    ...blockBase(),
    content,
    type: 'paragraph' as const,
  }
}

function documentOf(block: unknown) {
  return { blocks: [block] }
}

function coveringDocument() {
  return {
    blocks: [
      {
        ...blockBase(),
        content: [textNode('Title')],
        level: 1,
        type: 'heading' as const,
      },
      {
        ...blockBase(),
        content: [
          textNode('Hello'),
          {
            ...nodeBase(),
            marks: marks(),
            text: 'link',
            type: 'link' as const,
            url: { href: 'https://example.com', title: 'Example' },
          },
          {
            ...nodeBase(),
            entity: { data: { email: 'jane@example.com' }, id: 'user_1' },
            type: 'mention' as const,
          },
          {
            ...nodeBase(),
            type: 'line_break' as const,
          },
          textNode('world'),
        ],
        extra: 'ignored',
        type: 'paragraph' as const,
      },
      {
        ...blockBase(),
        content: [textNode('quoted')],
        type: 'quote' as const,
      },
      {
        ...blockBase(),
        content: [textNode('item')],
        type: 'bullet_list_item' as const,
      },
      {
        ...blockBase(),
        content: [textNode('one')],
        markerNumbering: '1.',
        type: 'numbered_list_item' as const,
        variant: 'default' as const,
      },
      {
        ...blockBase(),
        checked: false,
        content: [textNode('todo')],
        type: 'checkbox_list_item' as const,
      },
      {
        ...blockBase(),
        content: [textNode('ignored on divider')],
        type: 'divider' as const,
      },
    ],
  }
}

function expectSchemaError(json: unknown): void {
  try {
    validateDocumentJsonSchema(json)
  } catch (error) {
    expect(error).toBeInstanceOf(DactyloError)
    expect(isDactyloError(error) ? error.code : undefined).toBe(
      'DESERIALIZE_DOCUMENT_JSON_SCHEMA',
    )
    return
  }

  expect.unreachable('Expected validateDocumentJsonSchema to throw')
}

describe('validateDocumentJsonSchema', () => {
  test('accepts an empty blocks array', () => {
    expect(() => validateDocumentJsonSchema({ blocks: [] })).not.toThrow()
  })

  test('accepts every block and inline type', () => {
    expect(() => validateDocumentJsonSchema(coveringDocument())).not.toThrow()
  })

  test('accepts a block with parentId omitted', () => {
    expect(() =>
      validateDocumentJsonSchema(
        documentOf({
          content: [textNode()],
          createdAt: CREATED_AT,
          metadata: {},
          type: 'paragraph',
          updatedAt: null,
        }),
      ),
    ).not.toThrow()
  })

  test.each([
    { json: null, name: 'null' },
    { json: [], name: 'array' },
    { json: 'nope', name: 'string' },
    { json: {}, name: 'missing blocks' },
    { json: { blocks: {} }, name: 'non-array blocks' },
    {
      json: documentOf({ ...blockBase(), type: 'table' }),
      name: 'unknown block type',
    },
    {
      json: documentOf(paragraph([{ ...textNode(), type: 'unknown' }])),
      name: 'unknown inline type',
    },
    {
      json: documentOf({
        ...blockBase(),
        content: [textNode()],
        level: 0,
        type: 'heading',
      }),
      name: 'heading level 0',
    },
    {
      json: documentOf({
        ...blockBase(),
        content: [textNode()],
        level: 1.5,
        type: 'heading',
      }),
      name: 'heading level 1.5',
    },
    {
      json: documentOf({
        ...blockBase(),
        content: [textNode()],
        markerNumbering: '1.',
        type: 'numbered_list_item',
        variant: 'decimal',
      }),
      name: 'bad numbered list variant',
    },
    {
      json: documentOf({
        ...blockBase(),
        checked: 'true',
        content: [textNode()],
        type: 'checkbox_list_item',
      }),
      name: 'non-boolean checked',
    },
    {
      json: documentOf(
        paragraph([{ ...textNode(), marks: { ...marks(), bold: 'yes' } }]),
      ),
      name: 'non-boolean mark flag',
    },
    {
      json: documentOf({ ...paragraph(), updatedAt: 1 }),
      name: 'updatedAt neither string nor null',
    },
    {
      json: documentOf({ ...paragraph(), metadata: null }),
      name: 'metadata not a plain object',
    },
    {
      json: documentOf({ ...blockBase(), type: 'paragraph' }),
      name: 'content missing on paragraph',
    },
    {
      json: documentOf({ ...blockBase(), content: 'hello', type: 'paragraph' }),
      name: 'content not an array',
    },
  ])('rejects $name', ({ json }) => {
    expectSchemaError(json)
  })
})
