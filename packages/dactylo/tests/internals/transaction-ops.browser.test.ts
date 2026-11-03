import { describe, expect, test } from 'vitest'

import { DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT } from '../../src/internals/constants'
import { paintTextForDOM } from '../../src/internals/dom'
import type { EditorContext } from '../../src/internals/editor-context'
import {
  parseMarkdownLinkShortcut,
  parseMarkdownMarkShortcut,
} from '../../src/internals/markdown-shortcut-ops-builder'
import { isMarkEnabled } from '../../src/internals/marks'
import type { MarkKey } from '../../src/internals/marks'
import {
  isInlineNodeWithEditableText,
  isLinkNode,
  isTextNode,
} from '../../src/internals/nodes'
import type { TextNode } from '../../src/internals/nodes'
import type { TransactionPipeline } from '../../src/internals/transaction'
import {
  blockTexts,
  deleteBackward,
  endOfBlock,
  firstInlineBlock,
  focus,
  hardBreak,
  makePipeline,
  nthInlineBlock,
  pastePlainText,
  requireCursor,
  selectOffsetsInCurrentNode,
  selectRange,
  setCursor,
  snapshot,
  softBreak,
  startOfBlock,
  tryDeleteBackward,
  typeLines,
  typeText,
} from '../utils/pipeline'
import type { DocumentSnapshot } from '../utils/pipeline'

const MARK_KEYS: MarkKey[] = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'code',
]

/** Undo must restore `before`; redo must restore the post-edit snapshot. */
function assertUndoRedo(
  pipeline: TransactionPipeline,
  before: DocumentSnapshot,
): void {
  const after = snapshot(pipeline.context)
  expect(pipeline.canUndo()).toBe(true)
  pipeline.undo()
  expect(snapshot(pipeline.context)).toEqual(before)
  expect(pipeline.canRedo()).toBe(true)
  pipeline.redo()
  expect(snapshot(pipeline.context)).toEqual(after)
}

/** Non-empty inlines must not store or paint a ZWSP after a mark/link split. */
function assertNonEmptyInlinesPaintWithoutZwsp(context: EditorContext): void {
  const block = firstInlineBlock(context)
  for (const node of block.content) {
    if (!isInlineNodeWithEditableText(node)) {
      continue
    }

    expect(node.text).not.toContain(DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT)
    if (node.text.length === 0) {
      continue
    }

    expect(paintTextForDOM(node.text)).not.toContain(
      DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT,
    )
  }
}

describe('TransactionPipeline insertText', () => {
  test('types into the empty paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    typeText(pipeline, 'Hello')

    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
    expect(requireCursor(pipeline.context).offset).toBe(5)
    assertUndoRedo(pipeline, before)
  })

  test('typing over a selected run replaces it and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    selectOffsetsInCurrentNode(pipeline, 1, 4)
    const before = snapshot(pipeline.context)

    typeText(pipeline, 'y')

    expect(blockTexts(pipeline.context)).toEqual(['Hyo'])
    assertUndoRedo(pipeline, before)
  })

  test('typing over a cross-block range merges, inserts, and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
    )
    const before = snapshot(pipeline.context)

    typeText(pipeline, 'X')

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)).toEqual(['HelXrld'])
    assertUndoRedo(pipeline, before)
  })

  test('typing at the end of a link inserts a new text node; undo/redo round-trip', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    pastePlainText(pipeline, 'https://liveblocks.io/')
    deleteBackward(pipeline)

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: link.id,
      offset: link.text.length,
    })

    const before = snapshot(pipeline.context)

    typeText(pipeline, 'x')

    const nodes = firstInlineBlock(pipeline.context).content
    const typed = nodes.find(
      (node): node is TextNode => isTextNode(node) && node.text.includes('x'),
    )

    expect(blockTexts(pipeline.context)).toEqual([`${link.text}x`])
    expect(
      nodes.some((node) => isLinkNode(node) && node.text === link.text),
    ).toBe(true)
    expect(typed).toBeDefined()
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: typed?.id,
      offset: typed?.text.length,
    })
    assertUndoRedo(pipeline, before)
  })

  test('typing a space at the end of a markdown link inserts a new text node', () => {
    const pipeline = makePipeline({ autolink: true, markdown: true })
    focus(pipeline)
    typeText(pipeline, '[Liveblocks](https://liveblocks.io')
    typeText(pipeline, ')')

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

    expect(blockTexts(pipeline.context)).toEqual(['Liveblocks '])
    expect(
      nodes.some((node) => isLinkNode(node) && node.text === 'Liveblocks'),
    ).toBe(true)
    expect(
      nodes.some((node) => isTextNode(node) && node.text.includes(' ')),
    ).toBe(true)
  })

  test('typing at the end of a link with following text still inserts a new text node', () => {
    const pipeline = makePipeline({ autolink: true, markdown: true })
    focus(pipeline)
    typeText(pipeline, 'Hello World')
    setCursor(pipeline, {
      ...requireCursor(pipeline.context),
      offset: 'Hello'.length,
    })
    typeText(pipeline, ' [Liveblocks](https://liveblocks.io')
    typeText(pipeline, ')')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: link.id,
      offset: link.text.length,
    })

    typeText(pipeline, 'X')

    const nodes = firstInlineBlock(pipeline.context).content.filter(
      isInlineNodeWithEditableText,
    )
    const typed = nodes.find((node) => isTextNode(node) && node.text === 'X')

    expect(blockTexts(pipeline.context)).toEqual(['Hello LiveblocksX World'])
    expect(
      nodes.some((node) => isLinkNode(node) && node.text === 'Liveblocks'),
    ).toBe(true)
    expect(typed).toBeDefined()
    expect(requireCursor(pipeline.context)).toMatchObject({
      nodeId: typed?.id,
      offset: 1,
    })
  })

  test('typing in the middle of a link still extends the link', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    pastePlainText(pipeline, 'https://liveblocks.io/')

    const link = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!link) {
      throw new Error('Expected a link node')
    }

    const mid = Math.floor(link.text.length / 2)
    setCursor(pipeline, {
      blockId: firstInlineBlock(pipeline.context).id,
      nodeId: link.id,
      offset: mid,
    })

    typeText(pipeline, 'X')

    const updated = firstInlineBlock(pipeline.context).content.find(isLinkNode)
    if (!updated) {
      throw new Error('Expected a link node after typing')
    }

    expect(updated.text).toBe(
      `${link.text.slice(0, mid)}X${link.text.slice(mid)}`,
    )
    expect(
      firstInlineBlock(pipeline.context).content.some(
        (node) => isTextNode(node) && node.text.includes('X'),
      ),
    ).toBe(false)
  })
})

describe('TransactionPipeline hard break', () => {
  test('Enter at block end inserts a paragraph and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hello', ''])
    expect(pipeline.context.state.blockOrderById).toHaveLength(2)
    assertUndoRedo(pipeline, before)
  })

  test('Enter in the middle of a paragraph splits it and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 2 })
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['He', 'llo'])
    assertUndoRedo(pipeline, before)
  })

  test('Enter over a cross-block range deletes it, splits, and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
    )
    const before = snapshot(pipeline.context)

    hardBreak(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Hel', 'rld'])
    assertUndoRedo(pipeline, before)
  })
})

describe('TransactionPipeline soft break', () => {
  test('Shift+Enter in the middle of a paragraph splits the node and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    setCursor(pipeline, { ...requireCursor(pipeline.context), offset: 2 })
    const before = snapshot(pipeline.context)

    softBreak(pipeline)

    expect(
      firstInlineBlock(pipeline.context).content.map((node) => node.__type),
    ).toEqual(['text', 'line_break', 'text'])
    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
    assertUndoRedo(pipeline, before)
  })

  test('Shift+Enter inserts a line break and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    const before = snapshot(pipeline.context)

    softBreak(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.content.map((node) => node.__type)).toEqual([
      'text',
      'line_break',
      'text',
    ])
    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
    assertUndoRedo(pipeline, before)
  })

  test('Shift+Enter over a cross-block range deletes it, inserts a line break, and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
    )
    const before = snapshot(pipeline.context)

    softBreak(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(
      firstInlineBlock(pipeline.context).content.map((node) => node.__type),
    ).toEqual(['text', 'line_break', 'text'])
    expect(blockTexts(pipeline.context)).toEqual(['Helrld'])
    assertUndoRedo(pipeline, before)
  })
})

describe('TransactionPipeline delete content', () => {
  test('Backspace at the start of the document is a no-op', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    setCursor(pipeline, { ...requireCursor(pipeline.context), offset: 0 })
    const before = snapshot(pipeline.context)

    expect(tryDeleteBackward(pipeline)).toBe(false)
    expect(snapshot(pipeline.context)).toEqual(before)
  })

  test('Backspace deletes the previous character and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['H'])
    assertUndoRedo(pipeline, before)
  })

  test('Backspace over a same-node range deletes it and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    selectOffsetsInCurrentNode(pipeline, 1, 4)
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Ho'])
    assertUndoRedo(pipeline, before)
  })

  test('Backspace over a same-block range across a line break and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    softBreak(pipeline)
    typeText(pipeline, 'Yo')
    const block = firstInlineBlock(pipeline.context)
    const [first] = block.content
    const last = block.content.at(-1)
    if (!first || !last || !isInlineNodeWithEditableText(last)) {
      throw new Error('Expected text around a line break')
    }
    selectRange(
      pipeline,
      { blockId: block.id, nodeId: first.id, offset: 1 },
      { blockId: block.id, nodeId: last.id, offset: 1 },
    )
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['Ho'])
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at the empty node after a line break removes the break and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    softBreak(pipeline)
    const before = snapshot(pipeline.context)

    expect(
      firstInlineBlock(pipeline.context).content.map((node) => node.__type),
    ).toEqual(['text', 'line_break', 'text'])

    deleteBackward(pipeline)

    const block = firstInlineBlock(pipeline.context)
    expect(block.content.map((node) => node.__type)).toEqual(['text'])
    expect(blockTexts(pipeline.context)).toEqual(['Hello'])
    expect(requireCursor(pipeline.context).offset).toBe(5)
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at the start of text after a line break joins the lines and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    softBreak(pipeline)
    typeText(pipeline, 'World')
    setCursor(pipeline, { ...requireCursor(pipeline.context), offset: 0 })
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(
      firstInlineBlock(pipeline.context).content.map((node) => node.__type),
    ).toEqual(['text'])
    expect(blockTexts(pipeline.context)).toEqual(['HelloWorld'])
    expect(requireCursor(pipeline.context).offset).toBe(5)
    assertUndoRedo(pipeline, before)
  })

  test('Backspace at the start of the next block merges and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    typeText(pipeline, 'World')
    const cursor = requireCursor(pipeline.context)
    setCursor(pipeline, { ...cursor, offset: 0 })
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(blockTexts(pipeline.context)).toEqual(['HelloWorld'])
    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    assertUndoRedo(pipeline, before)
  })

  test('deleting a range across two blocks merges the survivors and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
    )
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)[0]).toBe('Helrld')
    assertUndoRedo(pipeline, before)
  })

  test('deleting four paragraphs from the first letter through the last letter', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['F', 'S', 'D', 'E'])
    selectRange(
      pipeline,
      startOfBlock(nthInlineBlock(pipeline.context, 0)),
      endOfBlock(nthInlineBlock(pipeline.context, 3)),
    )
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)).toEqual([''])
    assertUndoRedo(pipeline, before)
  })

  test('deleting four paragraphs through the last letter, leaving a trailing empty node', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['F', 'S', 'D', 'E'])
    pipeline.toggleMark('bold', 'user')
    pipeline.toggleMark('bold', 'user')

    const last = nthInlineBlock(pipeline.context, 3)
    expect(last.content).toHaveLength(2)
    const [eNode] = last.content
    if (!eNode || !isInlineNodeWithEditableText(eNode)) {
      throw new Error('Expected the last block to start with "E"')
    }

    selectRange(pipeline, startOfBlock(nthInlineBlock(pipeline.context, 0)), {
      blockId: last.id,
      nodeId: eNode.id,
      offset: eNode.text.length,
    })
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)).toEqual([''])
    assertUndoRedo(pipeline, before)
  })

  test('deleting a reversed cross-block range still merges in document order', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
    )
    const before = snapshot(pipeline.context)

    deleteBackward(pipeline)

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)[0]).toBe('Helrld')
    assertUndoRedo(pipeline, before)
  })
})

describe('TransactionPipeline paste', () => {
  test('pastes plain text at the caret and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    const before = snapshot(pipeline.context)

    pastePlainText(pipeline, ' there')

    expect(blockTexts(pipeline.context)).toEqual(['Hi there'])
    assertUndoRedo(pipeline, before)
  })

  test('pastes over a cross-block range and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hello', 'World'])
    selectRange(
      pipeline,
      { ...startOfBlock(nthInlineBlock(pipeline.context, 0)), offset: 3 },
      { ...startOfBlock(nthInlineBlock(pipeline.context, 1)), offset: 2 },
    )
    const before = snapshot(pipeline.context)

    pastePlainText(pipeline, 'X')

    expect(pipeline.context.state.blockOrderById).toHaveLength(1)
    expect(blockTexts(pipeline.context)).toEqual(['HelXrld'])
    assertUndoRedo(pipeline, before)
  })

  test('pasting a URL after a trailing space does not paint ZWSP on the prefix', () => {
    const pipeline = makePipeline({ autolink: true, markdown: false })
    focus(pipeline)
    typeText(pipeline, "Hello code what's up? ")
    pastePlainText(pipeline, 'https://localhost:3008/')

    const block = firstInlineBlock(pipeline.context)
    const [prefix] = block.content
    const link = block.content.find((node) => isLinkNode(node))

    if (!prefix || !isInlineNodeWithEditableText(prefix) || !link) {
      throw new Error('Expected a text prefix and a link node')
    }

    expect(prefix.text.endsWith(' ')).toBe(true)
    expect(isLinkNode(link)).toBe(true)
    assertNonEmptyInlinesPaintWithoutZwsp(pipeline.context)
  })
})

describe('TransactionPipeline marks', () => {
  test('toggling bold on a collapsed caret updates active marks and is not a history entry', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)

    pipeline.toggleMark('bold', 'user')

    expect(pipeline.context.activeMarks.bold).toBe(true)
    expect(pipeline.canUndo()).toBe(false)
  })

  test('toggling bold on a range and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    selectOffsetsInCurrentNode(pipeline, 0, 5)
    const before = snapshot(pipeline.context)

    pipeline.toggleMark('bold', 'user')

    const marked = firstInlineBlock(pipeline.context).content.filter(
      (node) =>
        isInlineNodeWithEditableText(node) && isMarkEnabled(node.marks, 'bold'),
    )
    expect(marked.length).toBeGreaterThan(0)
    assertUndoRedo(pipeline, before)
  })

  test('toggling bold on a word in the middle of a paragraph splits the node and keeps the range', () => {
    const pipeline = makePipeline({ markdown: false })
    const text =
      'Culpa ullamco consequat quis sit consectetur nostrud ullamco et est. Exercitation ullamco proident qui elit irure consectetur ea do elit ut esse sit ea commodo enim. Irure elit enim est esse aliquip. Anim laboris excepteur eiusmod Lorem laboris deserunt Lorem aute labore reprehenderit nulla minim non. Incididunt minim sunt ut aute quis labore laborum sint non ullamco. Excepteur commodo aliqua incididunt culpa ex quis culpa ad adipisicing cupidatat.'
    focus(pipeline)
    typeText(pipeline, text)
    const from = text.indexOf('Anim')
    const to = from + 'Anim'.length
    selectOffsetsInCurrentNode(pipeline, from, to)
    const before = snapshot(pipeline.context)

    pipeline.toggleMark('bold', 'user')

    const block = firstInlineBlock(pipeline.context)
    const marked = block.content.filter(
      (node) =>
        isInlineNodeWithEditableText(node) && isMarkEnabled(node.marks, 'bold'),
    )
    expect(marked).toHaveLength(1)
    const [anim] = marked
    if (!anim || !isInlineNodeWithEditableText(anim)) {
      throw new Error('Expected a bold "Anim" node')
    }
    expect(anim.text).toBe('Anim')

    const { selection } = pipeline.context
    expect(selection?.__type).toBe('range')
    if (selection?.__type !== 'range') {
      throw new Error('Expected the marked word to stay selected')
    }
    expect(selection.anchor.nodeId).toBe(anim.id)
    expect(selection.anchor.offset).toBe(0)
    expect(selection.focus.nodeId).toBe(anim.id)
    expect(selection.focus.offset).toBe('Anim'.length)

    const [prefix] = block.content
    if (!prefix || !isInlineNodeWithEditableText(prefix)) {
      throw new Error('Expected a prefix node')
    }
    expect(prefix.text).toHaveLength(from)
    expect(isMarkEnabled(prefix.marks, 'bold')).toBe(false)

    assertUndoRedo(pipeline, before)
  })

  test('toggling bold from the start of a node keeps the original id and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    const originalId = requireCursor(pipeline.context).nodeId
    selectOffsetsInCurrentNode(pipeline, 0, 3)
    const before = snapshot(pipeline.context)

    pipeline.toggleMark('bold', 'user')

    const block = firstInlineBlock(pipeline.context)
    expect(block.content).toHaveLength(2)
    const [head, tail] = block.content
    if (
      !head ||
      !tail ||
      !isInlineNodeWithEditableText(head) ||
      !isInlineNodeWithEditableText(tail)
    ) {
      throw new Error('Expected a split head/tail')
    }
    expect(head.id).toBe(originalId)
    expect(head.text).toBe('Hel')
    expect(isMarkEnabled(head.marks, 'bold')).toBe(true)
    expect(tail.text).toBe('lo')
    expect(isMarkEnabled(tail.marks, 'bold')).toBe(false)
    assertUndoRedo(pipeline, before)
  })

  test('toggling bold through the end of a node splits off the marked suffix and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    selectOffsetsInCurrentNode(pipeline, 2, 5)
    const before = snapshot(pipeline.context)

    pipeline.toggleMark('bold', 'user')

    const block = firstInlineBlock(pipeline.context)
    expect(block.content).toHaveLength(2)
    const [head, tail] = block.content
    if (
      !head ||
      !tail ||
      !isInlineNodeWithEditableText(head) ||
      !isInlineNodeWithEditableText(tail)
    ) {
      throw new Error('Expected a split head/tail')
    }
    expect(head.text).toBe('He')
    expect(isMarkEnabled(head.marks, 'bold')).toBe(false)
    expect(tail.text).toBe('llo')
    expect(isMarkEnabled(tail.marks, 'bold')).toBe(true)

    const { selection } = pipeline.context
    expect(selection?.__type).toBe('range')
    if (selection?.__type !== 'range') {
      throw new Error('Expected the marked suffix to stay selected')
    }
    expect(selection.anchor.nodeId).toBe(tail.id)
    expect(selection.anchor.offset).toBe(0)
    expect(selection.focus.offset).toBe(3)
    assertUndoRedo(pipeline, before)
  })

  test('toggling bold twice on a mid-node word restores unmarked text', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    selectOffsetsInCurrentNode(pipeline, 1, 4)
    const before = snapshot(pipeline.context)

    pipeline.toggleMark('bold', 'user')
    pipeline.toggleMark('bold', 'user')

    expect(
      firstInlineBlock(pipeline.context).content.every(
        (node) =>
          !isInlineNodeWithEditableText(node) ||
          !isMarkEnabled(node.marks, 'bold'),
      ),
    ).toBe(true)
    pipeline.undo()
    pipeline.undo()
    expect(snapshot(pipeline.context)).toEqual(before)
  })

  test('toggling bold across two blocks and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    typeLines(pipeline, ['Hi', 'Yo'])
    selectRange(
      pipeline,
      startOfBlock(nthInlineBlock(pipeline.context, 0)),
      endOfBlock(nthInlineBlock(pipeline.context, 1)),
    )
    const before = snapshot(pipeline.context)

    pipeline.toggleMark('bold', 'user')

    for (const index of [0, 1]) {
      const block = nthInlineBlock(pipeline.context, index)
      expect(
        block.content.some(
          (node) =>
            isInlineNodeWithEditableText(node) &&
            isMarkEnabled(node.marks, 'bold'),
        ),
      ).toBe(true)
    }
    assertUndoRedo(pipeline, before)
  })

  test('toggling a mark on a mid-paragraph word does not paint ZWSP on neighboring nodes', () => {
    const text = "Hello code what's up?"
    const from = text.indexOf('code')
    const to = from + 'code'.length

    for (const mark of MARK_KEYS) {
      const pipeline = makePipeline({ markdown: false })
      focus(pipeline)
      typeText(pipeline, text)
      selectOffsetsInCurrentNode(pipeline, from, to)

      pipeline.toggleMark(mark, 'user')

      const block = firstInlineBlock(pipeline.context)
      expect(block.content).toHaveLength(3)

      const [prefix, marked, suffix] = block.content
      if (
        !prefix ||
        !marked ||
        !suffix ||
        !isInlineNodeWithEditableText(prefix) ||
        !isInlineNodeWithEditableText(marked) ||
        !isInlineNodeWithEditableText(suffix)
      ) {
        throw new Error(`Expected a three-way split after toggling ${mark}`)
      }

      expect(prefix.text).toBe('Hello ')
      expect(marked.text).toBe('code')
      expect(isMarkEnabled(marked.marks, mark)).toBe(true)
      expect(suffix.text).toBe(" what's up?")

      assertNonEmptyInlinesPaintWithoutZwsp(pipeline.context)
    }
  })
})

describe('TransactionPipeline markdown shortcuts', () => {
  const longParagraph =
    'Minim minim sit dolore laboris aliqua minim. Est aliqua cupidatat ut occaecat quis reprehenderit sunt do Lorem veniam qui eiusmod exercitation cupidatat aliquip. Proident voluptate minim eiusmod. Duis cillum eu cupidatat enim nisi cupidatat reprehenderit duis occaecat exercitation duis ipsum velit. Reprehenderit in dolore Lorem tempor anim in culpa voluptate id incididunt esse reprehenderit ex excepteur eiusmod. Dolore culpa sit aute minim voluptate culpa.'

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

describe('TransactionPipeline block commands', () => {
  test('insertParagraphBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    pipeline.insertParagraphBlock({}, 'user')

    expect(pipeline.context.state.blockOrderById).toHaveLength(2)
    assertUndoRedo(pipeline, before)
  })

  test('insertHeadingBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    pipeline.insertHeadingBlock(1, {}, 'user')

    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toContain('heading')
    assertUndoRedo(pipeline, before)
  })

  test('insertDividerBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    pipeline.insertDividerBlock({}, 'user')

    expect(
      pipeline.context.state.blockOrderById.map(
        (id) => pipeline.context.state.blocks.get(id)?.__type,
      ),
    ).toContain('divider')
    assertUndoRedo(pipeline, before)
  })

  test('deleteBlock and undo/redo round-trip', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    pipeline.insertParagraphBlock({ pos: { type: 'end' } }, 'user')
    const extraId = pipeline.context.state.blockOrderById.at(-1)
    if (!extraId) {
      throw new Error('Expected an inserted block')
    }
    const before = snapshot(pipeline.context)

    pipeline.deleteBlock(extraId, 'user')

    expect(pipeline.context.state.blockOrderById).not.toContain(extraId)
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
