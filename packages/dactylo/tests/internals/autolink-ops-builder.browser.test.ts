import { describe, expect, test } from 'vitest'

import { parsePlainTextAutolink } from '../../src/internals/autolink-ops-builder'
import { isMarkEnabled } from '../../src/internals/marks'
import {
  isInlineNodeWithEditableText,
  isLinkNode,
  isTextNode,
} from '../../src/internals/nodes'
import {
  assertNonEmptyInlinesPaintWithoutZwsp,
  blockTexts,
  deleteBackward,
  firstInlineBlock,
  focus,
  makePipeline,
  pastePlainText,
  requireCursor,
  setCursor,
  snapshot,
  typeText,
} from '../utils/pipeline'

describe('TransactionPipeline autolink', () => {
  test('space after a URL creates a link; undo restores plain text; redo converts again', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'https://liveblocks.io')

    expect(blockTexts(pipeline.context)).toEqual(['https://liveblocks.io'])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)

    typeText(pipeline, ' ')

    const nodes = firstInlineBlock(pipeline.context).content
    const link = nodes.find((node) => isLinkNode(node))
    if (!link || !isLinkNode(link)) {
      throw new Error('Expected a link node')
    }

    expect(blockTexts(pipeline.context)).toEqual(['https://liveblocks.io '])
    expect(link.text).toBe('https://liveblocks.io')
    expect(link.url.href).toBe('https://liveblocks.io/')
    const continuation = nodes.find(
      (node) => isTextNode(node) && node.id !== link.id,
    )
    expect(continuation).toBeDefined()
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: continuation?.id,
      offset: 1,
    })
    assertNonEmptyInlinesPaintWithoutZwsp(pipeline.context)

    const converted = snapshot(pipeline.context)
    pipeline.undo()
    expect(blockTexts(pipeline.context)).toEqual(['https://liveblocks.io '])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)
    pipeline.redo()
    expect(snapshot(pipeline.context)).toEqual(converted)

    typeText(pipeline, 'more')
    expect(blockTexts(pipeline.context)).toEqual(['https://liveblocks.io more'])
    expect(
      firstInlineBlock(pipeline.context).content.some(
        (node) => isLinkNode(node) && node.text === 'https://liveblocks.io',
      ),
    ).toBe(true)
    expect(
      firstInlineBlock(pipeline.context).content.some(
        (node) => isTextNode(node) && node.text === ' more',
      ),
    ).toBe(true)
  })

  test('space after a URL mid-paragraph keeps prefix text and a trailing space', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'see https://liveblocks.io')
    typeText(pipeline, ' ')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )

    expect(blockTexts(pipeline.context)).toEqual(['see https://liveblocks.io '])
    expect(
      nodes.map((node) => ({
        href: isLinkNode(node) ? node.url.href : undefined,
        text: node.text,
        type: node.__type,
      })),
    ).toEqual([
      { href: undefined, text: 'see ', type: 'text' },
      {
        href: 'https://liveblocks.io/',
        text: 'https://liveblocks.io',
        type: 'link',
      },
      { href: undefined, text: ' ', type: 'text' },
    ])
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: nodes[2]?.id,
      offset: 1,
    })
    assertNonEmptyInlinesPaintWithoutZwsp(pipeline.context)
  })

  test('space in the middle of a node wraps only the URL before the caret', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'https://liveblocks.iomore')
    setCursor(pipeline, {
      ...requireCursor(pipeline.context),
      offset: 'https://liveblocks.io'.length,
    })
    typeText(pipeline, ' ')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )

    expect(blockTexts(pipeline.context)).toEqual(['https://liveblocks.io more'])
    expect(
      nodes.map((node) => ({
        href: isLinkNode(node) ? node.url.href : undefined,
        text: node.text,
        type: node.__type,
      })),
    ).toEqual([
      {
        href: 'https://liveblocks.io/',
        text: 'https://liveblocks.io',
        type: 'link',
      },
      { href: undefined, text: ' more', type: 'text' },
    ])
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: nodes[1]?.id,
      offset: 1,
    })
  })

  test('two URLs convert only the match immediately before the space', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'https://liveblocks.io https://example.com')
    typeText(pipeline, ' ')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )

    expect(
      nodes.map((node) => ({
        href: isLinkNode(node) ? node.url.href : undefined,
        text: node.text,
        type: node.__type,
      })),
    ).toEqual([
      { href: undefined, text: 'https://liveblocks.io ', type: 'text' },
      {
        href: 'https://example.com/',
        text: 'https://example.com',
        type: 'link',
      },
      { href: undefined, text: ' ', type: 'text' },
    ])
  })

  test('autolink inherits marks from the caret text node', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    pipeline.toggleMark('bold', 'user')
    typeText(pipeline, 'https://liveblocks.io')
    typeText(pipeline, ' ')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    expect(isMarkEnabled(link.marks, 'bold')).toBe(true)
  })

  test('space after a URL inside a heading creates a link', () => {
    const pipeline = makePipeline({ autolink: true, markdown: true })
    focus(pipeline)
    typeText(pipeline, '##')
    typeText(pipeline, ' ')
    typeText(pipeline, 'https://liveblocks.io')
    typeText(pipeline, ' ')

    const block = firstInlineBlock(pipeline.context)
    expect(block.__type).toBe('heading')
    expect(block.content.some(isLinkNode)).toBe(true)
    expect(blockTexts(pipeline.context)).toEqual(['https://liveblocks.io '])
  })

  test('leftover [text](url) does not convert on space', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, '[Liveblocks](https://liveblocks.io)')
    typeText(pipeline, ' ')

    expect(blockTexts(pipeline.context)).toEqual([
      '[Liveblocks](https://liveblocks.io) ',
    ])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)
  })

  test('https localhost URL converts when sanitize yields a href', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'https://localhost:3000')
    typeText(pipeline, ' ')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link || !isLinkNode(link)) {
      throw new Error('Expected a link node')
    }

    expect(link.text).toBe('https://localhost:3000')
    expect(link.url.href).toBe('https://localhost:3000/')
  })

  test('scheme-less www URL converts to an https link', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'www.google.com')
    typeText(pipeline, ' ')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link || !isLinkNode(link)) {
      throw new Error('Expected a link node')
    }

    expect(link.text).toBe('www.google.com')
    expect(link.url.href).toBe('https://www.google.com/')
    expect(blockTexts(pipeline.context)).toEqual(['www.google.com '])
  })

  test('scheme-less bare domain converts to an https link', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'google.com')
    typeText(pipeline, ' ')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link || !isLinkNode(link)) {
      throw new Error('Expected a link node')
    }

    expect(link.text).toBe('google.com')
    expect(link.url.href).toBe('https://google.com/')
    expect(blockTexts(pipeline.context)).toEqual(['google.com '])
  })

  test('autolink disabled leaves the URL as text', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'https://liveblocks.io')
    typeText(pipeline, ' ')

    expect(blockTexts(pipeline.context)).toEqual(['https://liveblocks.io '])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)
  })

  test('a single insertText of URL plus space does not convert', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'https://liveblocks.io ')

    expect(blockTexts(pipeline.context)).toEqual(['https://liveblocks.io '])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)
  })

  test('space after non-URL text does not convert', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'hello')
    typeText(pipeline, ' ')

    expect(blockTexts(pipeline.context)).toEqual(['hello '])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)
  })

  test('space in the middle of a URL does not convert', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'https://exam')
    typeText(pipeline, ' ')
    typeText(pipeline, 'ple.com')

    expect(blockTexts(pipeline.context)).toEqual(['https://exam ple.com'])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)
  })

  test('glued URL does not convert', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'seehttps://liveblocks.io')
    typeText(pipeline, ' ')

    expect(blockTexts(pipeline.context)).toEqual(['seehttps://liveblocks.io '])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)
  })

  test('space after later text does not convert an earlier URL', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'https://liveblocks.io and')
    typeText(pipeline, ' ')

    expect(blockTexts(pipeline.context)).toEqual(['https://liveblocks.io and '])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)
  })

  test('space at the end of an existing link inserts text instead of wrapping again', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    pastePlainText(pipeline, 'https://liveblocks.io/')
    deleteBackward(pipeline)

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: link.id,
      offset: link.text.length,
    })
    typeText(pipeline, ' ')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )
    expect(nodes.filter(isLinkNode)).toHaveLength(1)
    expect(
      nodes.some((node) => isTextNode(node) && node.text.includes(' ')),
    ).toBe(true)
  })

  test('ATX heading on space still wins over autolink', () => {
    const pipeline = makePipeline({ autolink: true, markdown: true })
    focus(pipeline)
    typeText(pipeline, '#')
    typeText(pipeline, ' ')

    const block = firstInlineBlock(pipeline.context)
    expect(block.__type).toBe('heading')
    if (block.__type === 'heading') {
      expect(block.level).toBe(1)
    }
    expect(block.content.every((node) => !isLinkNode(node))).toBe(true)
  })

  test('bare email does not convert', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, 'user@example.com')
    typeText(pipeline, ' ')

    expect(blockTexts(pipeline.context)).toEqual(['user@example.com '])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)
  })
})

describe('parsePlainTextAutolink', () => {
  test('accepts a trailing URL immediately before the space', () => {
    expect(
      parsePlainTextAutolink(
        'https://liveblocks.io ',
        'https://liveblocks.io '.length,
      ),
    ).toMatchObject({
      href: 'https://liveblocks.io/',
      start: 0,
      text: 'https://liveblocks.io',
    })
    expect(
      parsePlainTextAutolink(
        'see https://liveblocks.io ',
        'see https://liveblocks.io '.length,
      ),
    ).toMatchObject({
      href: 'https://liveblocks.io/',
      start: 4,
      text: 'https://liveblocks.io',
    })
    expect(
      parsePlainTextAutolink(
        'https://liveblocks.io more',
        'https://liveblocks.io '.length,
      ),
    ).toMatchObject({
      href: 'https://liveblocks.io/',
      start: 0,
      text: 'https://liveblocks.io',
    })
    expect(
      parsePlainTextAutolink('www.google.com ', 'www.google.com '.length),
    ).toMatchObject({
      href: 'https://www.google.com/',
      start: 0,
      text: 'www.google.com',
    })
    expect(
      parsePlainTextAutolink('google.com ', 'google.com '.length),
    ).toMatchObject({
      href: 'https://google.com/',
      start: 0,
      text: 'google.com',
    })
  })

  test('ignores missing trigger space, empty href, and glued forms', () => {
    expect(
      parsePlainTextAutolink(
        'https://liveblocks.io',
        'https://liveblocks.io'.length,
      ),
    ).toBeNull()
    expect(parsePlainTextAutolink('hello ', 'hello '.length)).toBeNull()
    expect(
      parsePlainTextAutolink(
        'https://liveblocks.io and ',
        'https://liveblocks.io and '.length,
      ),
    ).toBeNull()
    expect(
      parsePlainTextAutolink(
        'https://liveblocks.io more',
        'https://liveblocks.io more'.length,
      ),
    ).toBeNull()
    expect(
      parsePlainTextAutolink(
        '[Liveblocks](https://liveblocks.io) ',
        '[Liveblocks](https://liveblocks.io) '.length,
      ),
    ).toBeNull()
    expect(
      parsePlainTextAutolink(
        'Hello [Liveblocks](https://liveblocks.io) ',
        'Hello [Liveblocks](https://liveblocks.io) '.length,
      ),
    ).toBeNull()
    expect(
      parsePlainTextAutolink(
        '[Liveblocks](javascript:alert(1)) ',
        '[Liveblocks](javascript:alert(1)) '.length,
      ),
    ).toBeNull()
    expect(
      parsePlainTextAutolink(
        'seehttps://liveblocks.io ',
        'seehttps://liveblocks.io '.length,
      ),
    ).toBeNull()
    expect(
      parsePlainTextAutolink(
        'Hello[Liveblocks](https://liveblocks.io) ',
        'Hello[Liveblocks](https://liveblocks.io) '.length,
      ),
    ).toBeNull()
  })
})
