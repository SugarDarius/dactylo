import { describe, expect, test } from 'vitest'

import {
  parseMarkdownLinkShortcut,
  parseMarkdownMarkShortcut,
} from '../../src/internals/markdown-shortcut-ops-builder'
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
  requireCursor,
  setCursor,
  snapshot,
  typeText,
} from '../utils/pipeline'

describe('TransactionPipeline markdown shortcuts', () => {
  const longParagraph =
    'Minim minim sit dolore laboris aliqua minim. Est aliqua cupidatat ut occaecat quis reprehenderit sunt do Lorem veniam qui eiusmod exercitation cupidatat aliquip. Proident voluptate minim eiusmod. Duis cillum eu cupidatat enim nisi cupidatat reprehenderit duis occaecat exercitation duis ipsum velit. Reprehenderit in dolore Lorem tempor anim in culpa voluptate id incididunt esse reprehenderit ex excepteur eiusmod. Dolore culpa sit aute minim voluptate culpa.'

  test('quote on space converts the paragraph; undo restores the trigger; redo converts again', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '>')
    typeText(pipeline, ' ')

    expect(firstInlineBlock(pipeline.context).__type).toBe('quote')
    expect(blockTexts(pipeline.context)).toEqual([''])

    const converted = snapshot(pipeline.context)
    pipeline.undo()
    expect(firstInlineBlock(pipeline.context).__type).toBe('paragraph')
    expect(blockTexts(pipeline.context)).toEqual(['> '])
    pipeline.redo()
    expect(snapshot(pipeline.context)).toEqual(converted)
  })

  test('bullet list item on space converts the paragraph; undo restores the trigger; redo converts again', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '-')
    typeText(pipeline, ' ')

    expect(firstInlineBlock(pipeline.context).__type).toBe('bullet_list_item')
    expect(blockTexts(pipeline.context)).toEqual([''])

    const converted = snapshot(pipeline.context)
    pipeline.undo()
    expect(firstInlineBlock(pipeline.context).__type).toBe('paragraph')
    expect(blockTexts(pipeline.context)).toEqual(['- '])
    pipeline.redo()
    expect(snapshot(pipeline.context)).toEqual(converted)
  })

  test('checkbox list item on space converts the paragraph; undo restores the trigger; redo converts again', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '[]')
    typeText(pipeline, ' ')

    const block = firstInlineBlock(pipeline.context)
    expect(block.__type).toBe('checkbox_list_item')
    if (block.__type === 'checkbox_list_item') {
      expect(block.checked).toBe(false)
    }
    expect(blockTexts(pipeline.context)).toEqual([''])

    const converted = snapshot(pipeline.context)
    pipeline.undo()
    expect(firstInlineBlock(pipeline.context).__type).toBe('paragraph')
    expect(blockTexts(pipeline.context)).toEqual(['[] '])
    pipeline.redo()
    expect(snapshot(pipeline.context)).toEqual(converted)
  })

  test('ATX heading on space converts the paragraph; undo restores the trigger; redo converts again', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '##')
    typeText(pipeline, ' ')

    const block = firstInlineBlock(pipeline.context)
    expect(block.__type).toBe('heading')
    if (block.__type === 'heading') {
      expect(block.level).toBe(2)
    }

    const converted = snapshot(pipeline.context)
    pipeline.undo()
    expect(firstInlineBlock(pipeline.context).__type).toBe('paragraph')
    expect(blockTexts(pipeline.context)).toEqual(['## '])
    pipeline.redo()
    expect(snapshot(pipeline.context)).toEqual(converted)
  })

  test('horizontal rule on space inserts a divider; undo restores the trigger; redo converts again', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '---')
    typeText(pipeline, ' ')

    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toContain('divider')

    const converted = snapshot(pipeline.context)
    pipeline.undo()
    expect(firstInlineBlock(pipeline.context).__type).toBe('paragraph')
    expect(blockTexts(pipeline.context)).toEqual(['--- '])
    pipeline.redo()
    expect(snapshot(pipeline.context)).toEqual(converted)
  })

  test('**word** closing delimiter bolds the word; undo restores markdown text; redo bolds again', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '**hi*')

    expect(blockTexts(pipeline.context)).toEqual(['**hi*'])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) =>
          !isInlineNodeWithEditableText(node) ||
          (!isMarkEnabled(node.marks, 'bold') &&
            !isMarkEnabled(node.marks, 'italic')),
      ),
    ).toBe(true)

    typeText(pipeline, '*')

    expect(
      firstInlineBlock(pipeline.context).content.some(
        (node) =>
          isInlineNodeWithEditableText(node) &&
          isMarkEnabled(node.marks, 'bold') &&
          node.text === 'hi',
      ),
    ).toBe(true)

    const converted = snapshot(pipeline.context)
    pipeline.undo()
    expect(blockTexts(pipeline.context)).toEqual(['**hi**'])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) =>
          !isInlineNodeWithEditableText(node) ||
          !isMarkEnabled(node.marks, 'bold'),
      ),
    ).toBe(true)
    pipeline.redo()
    expect(snapshot(pipeline.context)).toEqual(converted)

    deleteBackward(pipeline)
    expect(blockTexts(pipeline.context)).toEqual(['h'])
    expect(requireCursor(pipeline.context).offset).toBe(1)
    expect(
      firstInlineBlock(pipeline.context).content.some(
        (node) =>
          isInlineNodeWithEditableText(node) &&
          isMarkEnabled(node.marks, 'bold') &&
          node.text === 'h',
      ),
    ).toBe(true)
  })

  test('*word* closing delimiter italicizes the word; undo restores markdown text; redo italicizes again', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '*hi')
    typeText(pipeline, '*')

    expect(
      firstInlineBlock(pipeline.context).content.some(
        (node) =>
          isInlineNodeWithEditableText(node) &&
          isMarkEnabled(node.marks, 'italic') &&
          node.text === 'hi',
      ),
    ).toBe(true)

    const converted = snapshot(pipeline.context)
    pipeline.undo()
    expect(blockTexts(pipeline.context)).toEqual(['*hi*'])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) =>
          !isInlineNodeWithEditableText(node) ||
          !isMarkEnabled(node.marks, 'italic'),
      ),
    ).toBe(true)
    pipeline.redo()
    expect(snapshot(pipeline.context)).toEqual(converted)

    deleteBackward(pipeline)
    expect(blockTexts(pipeline.context)).toEqual(['h'])
    expect(requireCursor(pipeline.context).offset).toBe(1)
    expect(
      firstInlineBlock(pipeline.context).content.some(
        (node) =>
          isInlineNodeWithEditableText(node) &&
          isMarkEnabled(node.marks, 'italic') &&
          node.text === 'h',
      ),
    ).toBe(true)
  })

  test('**word* does not italicize; CommonMark leaves mismatched delimiter runs literal', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '**word')
    typeText(pipeline, '*')

    expect(blockTexts(pipeline.context)).toEqual(['**word*'])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) =>
          !isInlineNodeWithEditableText(node) ||
          (!isMarkEnabled(node.marks, 'bold') &&
            !isMarkEnabled(node.marks, 'italic')),
      ),
    ).toBe(true)
  })

  test('**word** closing delimiter bolds mid-paragraph without an empty continuation node', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, longParagraph)

    const laborisEnd = longParagraph.indexOf('laboris') + 'laboris'.length
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: laborisEnd })
    typeText(pipeline, ' **test*')
    typeText(pipeline, '*')

    const prefix = `${longParagraph.slice(0, laborisEnd)} `
    const suffix = longParagraph.slice(laborisEnd)
    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )

    expect(blockTexts(pipeline.context)).toEqual([`${prefix}test${suffix}`])
    expect(
      nodes.map((node) => ({
        bold: isMarkEnabled(node.marks, 'bold'),
        text: node.text,
      })),
    ).toEqual([
      { bold: false, text: prefix },
      { bold: true, text: 'test' },
      { bold: false, text: suffix },
    ])
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: nodes[2]?.id,
      offset: 0,
    })
  })

  test('*word* closing delimiter italicizes mid-paragraph without an empty continuation node', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, longParagraph)

    const laborisEnd = longParagraph.indexOf('laboris') + 'laboris'.length
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: laborisEnd })
    typeText(pipeline, ' *test')
    typeText(pipeline, '*')

    const prefix = `${longParagraph.slice(0, laborisEnd)} `
    const suffix = longParagraph.slice(laborisEnd)
    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )

    expect(blockTexts(pipeline.context)).toEqual([`${prefix}test${suffix}`])
    expect(
      nodes.map((node) => ({
        italic: isMarkEnabled(node.marks, 'italic'),
        text: node.text,
      })),
    ).toEqual([
      { italic: false, text: prefix },
      { italic: true, text: 'test' },
      { italic: false, text: suffix },
    ])
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: nodes[2]?.id,
      offset: 0,
    })
  })

  test('[text](url) closing delimiter creates a link; undo restores markdown text; redo converts again', () => {
    const pipeline = makePipeline({ autolink: true, markdown: true })
    focus(pipeline)
    typeText(pipeline, '[Liveblocks](https://liveblocks.io')

    expect(blockTexts(pipeline.context)).toEqual([
      '[Liveblocks](https://liveblocks.io',
    ])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)

    typeText(pipeline, ')')

    const nodes = firstInlineBlock(pipeline.context).content
    const link = nodes.find((node) => isLinkNode(node))
    if (!link || !isLinkNode(link)) {
      throw new Error('Expected a link node')
    }

    expect(blockTexts(pipeline.context)).toEqual(['Liveblocks'])
    expect(link.text).toBe('Liveblocks')
    expect(link.url.href).toBe('https://liveblocks.io/')
    const continuation = nodes.find(
      (node) => isTextNode(node) && node.id !== link.id,
    )
    expect(continuation).toBeDefined()
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: continuation?.id,
      offset: 0,
    })

    const converted = snapshot(pipeline.context)
    pipeline.undo()
    expect(blockTexts(pipeline.context)).toEqual([
      '[Liveblocks](https://liveblocks.io)',
    ])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)
    pipeline.redo()
    expect(snapshot(pipeline.context)).toEqual(converted)

    typeText(pipeline, ' more')
    expect(blockTexts(pipeline.context)).toEqual(['Liveblocks more'])
    expect(
      firstInlineBlock(pipeline.context).content.some(
        (node) => isLinkNode(node) && node.text === 'Liveblocks',
      ),
    ).toBe(true)
    expect(
      firstInlineBlock(pipeline.context).content.some(
        (node) => isTextNode(node) && node.text === ' more',
      ),
    ).toBe(true)
  })

  test('[text](url) closing delimiter creates a link mid-paragraph without an empty continuation node', () => {
    const pipeline = makePipeline({ autolink: true, markdown: true })
    focus(pipeline)
    typeText(pipeline, longParagraph)

    const laborisEnd = longParagraph.indexOf('laboris') + 'laboris'.length
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: laborisEnd })
    typeText(pipeline, ' [Liveblocks](https://liveblocks.io')
    typeText(pipeline, ')')

    const prefix = `${longParagraph.slice(0, laborisEnd)} `
    const suffix = longParagraph.slice(laborisEnd)
    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )

    expect(blockTexts(pipeline.context)).toEqual([
      `${prefix}Liveblocks${suffix}`,
    ])
    expect(
      nodes.map((node) => ({
        href: isLinkNode(node) ? node.url.href : undefined,
        text: node.text,
        type: node.__type,
      })),
    ).toEqual([
      { href: undefined, text: prefix, type: 'text' },
      {
        href: 'https://liveblocks.io/',
        text: 'Liveblocks',
        type: 'link',
      },
      { href: undefined, text: suffix, type: 'text' },
    ])
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: nodes[2]?.id,
      offset: 0,
    })
    assertNonEmptyInlinesPaintWithoutZwsp(pipeline.context)
  })

  test('Hello[text](url) does not convert; opening [ needs a mark-style boundary', () => {
    const pipeline = makePipeline({ autolink: true, markdown: true })
    focus(pipeline)
    typeText(pipeline, 'Hello[Liveblocks](https://liveblocks.io')
    typeText(pipeline, ')')

    expect(blockTexts(pipeline.context)).toEqual([
      'Hello[Liveblocks](https://liveblocks.io)',
    ])
    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) => !isLinkNode(node),
      ),
    ).toBe(true)
  })
})

describe('parseMarkdownMarkShortcut', () => {
  test('pairs CommonMark/GFM delimiter runs and ignores mismatched closers', () => {
    expect(
      parseMarkdownMarkShortcut('*hello*', '*hello*'.length),
    ).toMatchObject({
      kind: 'italic',
      word: 'hello',
    })
    expect(
      parseMarkdownMarkShortcut('_hello_', '_hello_'.length),
    ).toMatchObject({
      kind: 'italic',
      word: 'hello',
    })
    expect(
      parseMarkdownMarkShortcut('**hello**', '**hello**'.length),
    ).toMatchObject({
      kind: 'bold',
      word: 'hello',
    })
    expect(
      parseMarkdownMarkShortcut('__hello__', '__hello__'.length),
    ).toMatchObject({
      kind: 'bold',
      word: 'hello',
    })
    expect(
      parseMarkdownMarkShortcut('Hello *world*', 'Hello *world*'.length),
    ).toMatchObject({
      kind: 'italic',
      openDelimiterOffset: 6,
      word: 'world',
    })
    expect(
      parseMarkdownMarkShortcut('*foo* bar *baz*', '*foo* bar *baz*'.length),
    ).toMatchObject({
      kind: 'italic',
      word: 'baz',
    })
    expect(
      parseMarkdownMarkShortcut(
        'Hello **world** there',
        'Hello **world**'.length,
      ),
    ).toMatchObject({
      kind: 'bold',
      openDelimiterOffset: 6,
      word: 'world',
    })
    expect(
      parseMarkdownMarkShortcut('Hello *world* there', 'Hello *world*'.length),
    ).toMatchObject({
      kind: 'italic',
      openDelimiterOffset: 6,
      word: 'world',
    })
    expect(
      parseMarkdownMarkShortcut(
        'Hello *world* there',
        'Hello *world* there'.length,
      ),
    ).toBeNull()
    expect(parseMarkdownMarkShortcut('**hello*', '**hello*'.length)).toBeNull()
    expect(parseMarkdownMarkShortcut('*hello**', '*hello**'.length)).toBeNull()
    expect(parseMarkdownMarkShortcut('__hello_', '__hello_'.length)).toBeNull()
    expect(parseMarkdownMarkShortcut('_hello__', '_hello__'.length)).toBeNull()
    expect(
      parseMarkdownMarkShortcut('Hello*world*', 'Hello*world*'.length),
    ).toBeNull()
    expect(
      parseMarkdownMarkShortcut('Hello_world_', 'Hello_world_'.length),
    ).toBeNull()
    expect(
      parseMarkdownMarkShortcut('~~hello~~', '~~hello~~'.length),
    ).toMatchObject({
      kind: 'strikethrough',
      word: 'hello',
    })
    expect(
      parseMarkdownMarkShortcut(
        'Hello ~~world~~ there',
        'Hello ~~world~~'.length,
      ),
    ).toMatchObject({
      kind: 'strikethrough',
      openDelimiterOffset: 6,
      word: 'world',
    })
    expect(parseMarkdownMarkShortcut('~~hello~', '~~hello~'.length)).toBeNull()
    expect(parseMarkdownMarkShortcut('~hello~~', '~hello~~'.length)).toBeNull()
    expect(
      parseMarkdownMarkShortcut(
        'Hello ~~world~~ there',
        'Hello ~~world~~'.length,
      ),
    ).toMatchObject({
      kind: 'strikethrough',
      word: 'world',
    })
    expect(
      parseMarkdownMarkShortcut('Hello ~world~ there', 'Hello ~world~'.length),
    ).toBeNull()
    expect(
      parseMarkdownMarkShortcut('`hello`', '`hello`'.length),
    ).toMatchObject({
      kind: 'code',
      word: 'hello',
    })
    expect(
      parseMarkdownMarkShortcut('Hello `world` there', 'Hello `world`'.length),
    ).toMatchObject({
      kind: 'code',
      openDelimiterOffset: 6,
      word: 'world',
    })
    expect(parseMarkdownMarkShortcut('``hello`', '`hello`'.length)).toBeNull()
  })
})

describe('parseMarkdownLinkShortcut', () => {
  test('pairs trailing [text](url) and ignores invalid or unbounded forms', () => {
    expect(
      parseMarkdownLinkShortcut(
        '[Liveblocks](https://liveblocks.io)',
        '[Liveblocks](https://liveblocks.io)'.length,
      ),
    ).toMatchObject({
      href: 'https://liveblocks.io/',
      kind: 'link',
      openDelimiterOffset: 0,
      text: 'Liveblocks',
    })
    expect(
      parseMarkdownLinkShortcut(
        'Hello [Liveblocks](https://liveblocks.io)',
        'Hello [Liveblocks](https://liveblocks.io)'.length,
      ),
    ).toMatchObject({
      href: 'https://liveblocks.io/',
      kind: 'link',
      openDelimiterOffset: 6,
      text: 'Liveblocks',
    })
    expect(
      parseMarkdownLinkShortcut(
        'Hello [Liveblocks](https://liveblocks.io) there',
        'Hello [Liveblocks](https://liveblocks.io)'.length,
      ),
    ).toMatchObject({
      kind: 'link',
      openDelimiterOffset: 6,
      text: 'Liveblocks',
    })
    expect(
      parseMarkdownLinkShortcut(
        'Hello [Liveblocks](https://liveblocks.io) there',
        'Hello [Liveblocks](https://liveblocks.io) there'.length,
      ),
    ).toBeNull()
    expect(
      parseMarkdownLinkShortcut(
        'Hello[Liveblocks](https://liveblocks.io)',
        'Hello[Liveblocks](https://liveblocks.io)'.length,
      ),
    ).toBeNull()
    expect(
      parseMarkdownLinkShortcut(
        '[](https://liveblocks.io)',
        '[](https://liveblocks.io)'.length,
      ),
    ).toBeNull()
    expect(
      parseMarkdownLinkShortcut('[Liveblocks]()', '[Liveblocks]()'.length),
    ).toBeNull()
    expect(
      parseMarkdownLinkShortcut(
        '[Liveblocks](javascript:alert(1))',
        '[Liveblocks](javascript:alert(1))'.length,
      ),
    ).toBeNull()
  })
})
