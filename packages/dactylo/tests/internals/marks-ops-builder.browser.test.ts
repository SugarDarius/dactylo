import { describe, expect, test } from 'vitest'

import { isMarkEnabled } from '../../src/internals/marks'
import type { MarkKey } from '../../src/internals/marks'
import { isInlineNodeWithEditableText } from '../../src/internals/nodes'
import {
  assertNonEmptyInlinesPaintWithoutZwsp,
  assertUndoRedo,
  deleteBackward,
  endOfBlock,
  firstInlineBlock,
  focus,
  makePipeline,
  nthInlineBlock,
  requireCursor,
  selectOffsetsInCurrentNode,
  selectRange,
  setCursor,
  snapshot,
  startOfBlock,
  typeLines,
  typeText,
} from '../utils/pipeline'

const MARK_KEYS: MarkKey[] = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'code',
]

describe('TransactionPipeline marks', () => {
  test('toggling bold on a collapsed caret marks the current node and is a history entry', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    const before = snapshot(pipeline.context)

    pipeline.toggleMark('bold', 'user')

    const [node] = firstInlineBlock(pipeline.context).content
    if (!node || !isInlineNodeWithEditableText(node)) {
      throw new Error('Expected an editable text node')
    }
    expect(node.text).toBe('')
    expect(isMarkEnabled(node.marks, 'bold')).toBe(true)
    expect(pipeline.canUndo()).toBe(true)
    assertUndoRedo(pipeline, before)
  })

  test('toggling bold at the end of a node inserts a marked node; existing text stays unmarked', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')

    pipeline.toggleMark('bold', 'user')
    typeText(pipeline, '!')

    const [head, marked] = firstInlineBlock(pipeline.context).content
    if (
      !head ||
      !marked ||
      !isInlineNodeWithEditableText(head) ||
      !isInlineNodeWithEditableText(marked)
    ) {
      throw new Error('Expected the original node plus a marked continuation')
    }
    expect(head.text).toBe('Hello')
    expect(isMarkEnabled(head.marks, 'bold')).toBe(false)
    expect(marked.text).toBe('!')
    expect(isMarkEnabled(marked.marks, 'bold')).toBe(true)
  })

  test('toggling bold inside a node splits at the caret and does not mark existing text', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hello')
    setCursor(pipeline, { ...requireCursor(pipeline.context), offset: 2 })

    pipeline.toggleMark('bold', 'user')
    typeText(pipeline, 'X')

    const [prefix, marked, suffix] = firstInlineBlock(pipeline.context).content
    if (
      !prefix ||
      !marked ||
      !suffix ||
      !isInlineNodeWithEditableText(prefix) ||
      !isInlineNodeWithEditableText(marked) ||
      !isInlineNodeWithEditableText(suffix)
    ) {
      throw new Error('Expected a three-way split around the caret')
    }
    expect(prefix.text).toBe('He')
    expect(isMarkEnabled(prefix.marks, 'bold')).toBe(false)
    expect(marked.text).toBe('X')
    expect(isMarkEnabled(marked.marks, 'bold')).toBe(true)
    expect(suffix.text).toBe('llo')
    expect(isMarkEnabled(suffix.marks, 'bold')).toBe(false)
  })

  test('deleting a bold block resets marks; toggling on the empty node keeps bold', () => {
    const pipeline = makePipeline({ markdown: false })
    focus(pipeline)
    typeText(pipeline, 'Hi')
    selectOffsetsInCurrentNode(pipeline, 0, 2)
    pipeline.toggleMark('bold', 'user')
    deleteBackward(pipeline)

    const [emptied] = firstInlineBlock(pipeline.context).content
    if (!emptied || !isInlineNodeWithEditableText(emptied)) {
      throw new Error('Expected an empty placeholder node')
    }
    expect(emptied.text).toBe('')
    expect(isMarkEnabled(emptied.marks, 'bold')).toBe(false)

    pipeline.toggleMark('bold', 'user')

    const [marked] = firstInlineBlock(pipeline.context).content
    if (!marked || !isInlineNodeWithEditableText(marked)) {
      throw new Error('Expected the empty node to keep toggled marks')
    }
    expect(marked.text).toBe('')
    expect(isMarkEnabled(marked.marks, 'bold')).toBe(true)
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
