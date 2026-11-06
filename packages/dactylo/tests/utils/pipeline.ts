import { expect } from 'vitest'

import {
  isBulletListItemBlock,
  isCheckboxListItemBlock,
  isDividerBlock,
  isHeadingBlock,
  isParagraphBlock,
} from '../../src/internals/blocks'
import type { Block, BlockWithInlineContent } from '../../src/internals/blocks'
import { DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT } from '../../src/internals/constants'
import {
  getBlock,
  getBlockWithInlineContent,
} from '../../src/internals/document'
import { paintTextForDOM } from '../../src/internals/dom'
import type { EditorContext } from '../../src/internals/editor-context'
import type { Marks } from '../../src/internals/marks'
import type { InlineNode } from '../../src/internals/nodes'
import {
  isInlineNodeWithEditableText,
  isLinkNode,
  isTextNode,
} from '../../src/internals/nodes'
import {
  createCursor,
  createRange,
  cursorAtBlockEnd,
  cursorAtBlockStart,
} from '../../src/internals/selection'
import type { Selection, TextCursor } from '../../src/internals/selection'
import { TransactionPipeline } from '../../src/internals/transaction'

/** Snapshot of a document used to assert undo restores structure, not timestamps. */
export interface DocumentSnapshot {
  readonly blocks: readonly SerializedBlock[]
  readonly selection: Selection | null
}

type SerializedBlock =
  | {
      readonly id: Block['id']
      readonly type: 'divider'
    }
  | {
      readonly content: readonly SerializedInline[]
      readonly id: Block['id']
      readonly level?: number
      readonly type: 'heading' | 'paragraph' | 'bullet-list-item'
    }
  | {
      readonly checked: boolean
      readonly content: readonly SerializedInline[]
      readonly id: Block['id']
      readonly type: 'checkbox-list-item'
    }

type SerializedInline = {
  readonly href?: string
  readonly id: InlineNode['id']
  readonly marks?: Marks
  readonly text?: string
  readonly type: InlineNode['__type']
}

/** Builds a pipeline with markdown on, mentions off, autolink off by default (stable typing). */
export function makePipeline(
  opts: { markdown?: boolean; autolink?: boolean } = {},
): TransactionPipeline {
  return new TransactionPipeline({
    autolink: { enabled: opts.autolink ?? false },
    debug: false,
    engine: { locales: 'en-US' },
    inlineCommandTrigger: { character: '/', enabled: false },
    markdown: { enabled: opts.markdown ?? true },
    mentions: { character: '@', enabled: false },
  })
}

/** Places the caret at the end of the document. */
export function focus(pipeline: TransactionPipeline): void {
  pipeline.putCursorSelectionAtDocumentEnd('user')
}

function serializeInline(node: InlineNode): SerializedInline {
  if (isTextNode(node)) {
    return { id: node.id, marks: node.marks, text: node.text, type: 'text' }
  }
  if (isLinkNode(node)) {
    return {
      href: node.url.href,
      id: node.id,
      marks: node.marks,
      text: node.text,
      type: 'link',
    }
  }
  return { id: node.id, type: node.__type }
}

function serializeBlock(block: Block): SerializedBlock {
  if (isDividerBlock(block)) {
    return { id: block.id, type: 'divider' }
  }

  if (isHeadingBlock(block)) {
    return {
      content: block.content.map(serializeInline),
      id: block.id,
      level: block.level,
      type: 'heading',
    }
  }

  if (isParagraphBlock(block)) {
    return {
      content: block.content.map(serializeInline),
      id: block.id,
      type: 'paragraph',
    }
  }

  if (isBulletListItemBlock(block)) {
    return {
      content: block.content.map(serializeInline),
      id: block.id,
      type: 'bullet-list-item',
    }
  }

  if (isCheckboxListItemBlock(block)) {
    return {
      checked: block.checked,
      content: block.content.map(serializeInline),
      id: block.id,
      type: 'checkbox-list-item',
    }
  }

  throw new Error(`Unsupported block type ${(block as Block).__type}`)
}

/** Structural snapshot of context (ids, text, marks, selection). */
export function snapshot(context: EditorContext): DocumentSnapshot {
  return {
    blocks: context.state.blockOrderById.map((id) => {
      const block = getBlock(context.state, id)
      return serializeBlock(block)
    }),
    selection: context.selection,
  }
}

/** Visible text per block, concatenated in document order. */
export function blockTexts(context: EditorContext): string[] {
  return context.state.blockOrderById.map((id) => {
    const block = getBlock(context.state, id)
    if (isDividerBlock(block)) {
      return ''
    }
    return block.content
      .map((node) => (isInlineNodeWithEditableText(node) ? node.text : ''))
      .join('')
  })
}

/** Inline block at `index` in document order. */
export function nthInlineBlock(
  context: EditorContext,
  index: number,
): BlockWithInlineContent {
  const id = context.state.blockOrderById[index]
  if (!id) {
    throw new Error(`Document has no block at index ${index}`)
  }
  return getBlockWithInlineContent(context.state, id)
}

/** First (and typically only) inline block. */
export function firstInlineBlock(
  context: EditorContext,
): BlockWithInlineContent {
  return nthInlineBlock(context, 0)
}

/** Caret at the start of an inline block. */
export function startOfBlock(block: BlockWithInlineContent): TextCursor {
  const cursor = cursorAtBlockStart(block.id, block)
  if (!cursor) {
    throw new Error(`Block ${block.id} has no start caret`)
  }
  return cursor.anchor
}

/** Caret at the end of an inline block. */
export function endOfBlock(block: BlockWithInlineContent): TextCursor {
  return cursorAtBlockEnd(block.id, block).anchor
}

/** Current collapsed caret, or throw. */
export function requireCursor(context: EditorContext): TextCursor {
  const { selection } = context
  if (selection?.__type !== 'cursor') {
    throw new Error('Expected a collapsed cursor selection')
  }
  return selection.anchor
}

function inputEvent(
  inputType: string,
  data?: string,
  dataTransfer: DataTransfer | null = null,
): InputEvent {
  return {
    data: data ?? null,
    dataTransfer,
    inputType,
    preventDefault: () => {
      /* InputEvent stub */
    },
    stopPropagation: () => {
      /* InputEvent stub */
    },
  } as InputEvent
}

/** Dispatches a keydown with no modifiers. Returns whether it was handled. */
export function pressKey(pipeline: TransactionPipeline, key: string): boolean {
  return pipeline.digestKeydownEvent({
    altKey: false,
    code: key,
    ctrlKey: false,
    key,
    metaKey: false,
    preventDefault: () => {
      /* KeyboardEvent stub */
    },
    shiftKey: false,
    stopPropagation: () => {
      /* KeyboardEvent stub */
    },
  } as KeyboardEvent)
}

/** Types `text` as a single `insertText` transaction. */
export function typeText(pipeline: TransactionPipeline, text: string): void {
  const handled = pipeline.digestInputEvent(inputEvent('insertText', text))
  if (!handled) {
    throw new Error(`insertText was not handled: ${text}`)
  }
}

/** Enter → hard break. */
export function hardBreak(pipeline: TransactionPipeline): void {
  const handled = pipeline.digestInputEvent(inputEvent('insertParagraph'))
  if (!handled) {
    throw new Error('insertParagraph was not handled')
  }
}

/** Shift+Enter → soft break. */
export function softBreak(pipeline: TransactionPipeline): void {
  const handled = pipeline.digestInputEvent(inputEvent('insertLineBreak'))
  if (!handled) {
    throw new Error('insertLineBreak was not handled')
  }
}

/** Backspace / delete content backward. */
export function deleteBackward(pipeline: TransactionPipeline): void {
  const handled = pipeline.digestInputEvent(inputEvent('deleteContentBackward'))
  if (!handled) {
    throw new Error('deleteContentBackward was not handled')
  }
}

/** Pastes plain text. */
export function pastePlainText(
  pipeline: TransactionPipeline,
  text: string,
): void {
  const dataTransfer = {
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    types: ['text/plain'],
  } as unknown as DataTransfer

  const handled = pipeline.digestInputEvent(
    inputEvent('insertFromPaste', undefined, dataTransfer),
  )
  if (!handled) {
    throw new Error('insertFromPaste was not handled')
  }
}

/** Selects `[from, to)` inside the current caret node. */
export function selectOffsetsInCurrentNode(
  pipeline: TransactionPipeline,
  from: number,
  to: number,
): void {
  const cursor = requireCursor(pipeline.context)
  pipeline.updateSelection(
    createRange(
      { blockId: cursor.blockId, nodeId: cursor.nodeId, offset: from },
      { blockId: cursor.blockId, nodeId: cursor.nodeId, offset: to },
    ),
    'user',
  )
}

/** Places a collapsed caret in a node. */
export function setCursor(pipeline: TransactionPipeline, at: TextCursor): void {
  pipeline.updateSelection(createCursor(at), 'user')
}

/** Selects an exclusive range from `from` to `to`. */
export function selectRange(
  pipeline: TransactionPipeline,
  from: TextCursor,
  to: TextCursor,
): void {
  pipeline.updateSelection(createRange(from, to), 'user')
}

/** Types `lines` as separate paragraphs (Enter between them). */
export function typeLines(
  pipeline: TransactionPipeline,
  lines: readonly string[],
): void {
  focus(pipeline)
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      hardBreak(pipeline)
    }
    if (line.length > 0) {
      typeText(pipeline, line)
    }
  }
}

/** Backspace that may be a no-op (e.g. at the start of the document). */
export function tryDeleteBackward(pipeline: TransactionPipeline): boolean {
  return pipeline.digestInputEvent(inputEvent('deleteContentBackward'))
}

/** Undo must restore `before`; redo must restore the post-edit snapshot. */
export function assertUndoRedo(
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
export function assertNonEmptyInlinesPaintWithoutZwsp(
  context: EditorContext,
): void {
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
