import { findFirstInlineNodeInBlock, findLastInlineNodeInBlock } from './blocks'
import type { BlockId, BlockWithInlineContent } from './blocks'
import { getInlineNodeTextLength, isInlineNodeWithEditableText } from './nodes'
import type { InlineNode, NodeId } from './nodes'
import type { Relax } from './types'
import { assertNever } from './utils'

/**
 * {@link Selection} defines how Dactylo tracks cursor position and text selection
 * then combine with {@link DocumentState} into {@link EditorContext} (the full snapshot the transaction pipeline mutates)
 *
 * {@link EditorContext} is not a convenience wrapper. It's the atomic unit of changes for the entire editor:
 * content, caret and empty-doc semantics commit together.
 *
 * {@link DocumentState} alone answers "what is written?" but not "when is the user editing?",
 * and those two must stay in sync.
 *
 * Without {@link EditorContext}:
 * - Undo/redo would restore text but leave the cursor in the same place/deleted block/delete text.
 * - `keydown` events should need the cursor passed in UI libraries on every call.
 * - Export would risk leaking selection into saved JSON/markdown.
 * - Subscribers would need two separate update channels (content + caret)
 *
 * {@link EditorContext} blocks `state` + `selection` + `isPlaceholder` so one transaction
 * produces one complete next snapshot
 *
 * Why not put selection inside {@link DocumentState}?
 *
 * Treating selection as part of the document would blur two concerns:
 * 1. Content → what gets saved, exported, synced, indexed by Ai.
 * 2. Interaction → where the user is pointing while editing.
 *
 * | If selection were inside `DocState` | Problem                                                      |
 * |-------------------------------------|--------------------------------------------------------------|
 * | Export to JSON                      | Cursor coordinates leak into saved files                     |
 * | `toMarkdown()`                      | Must strip selection before every export                     |
 * | Undo of content-only AI patch       | Would accidentally restore stale cursor from another session |
 * | Two users editing (future)          | Remote cursor is not document content                        |
 *
 * Keeping {@link DocumentState} pure means export, import, and persistence never need to filter out UI state.
 * Selection travels with the editing session, not the document.
 *
 * Why the pipeline mutates {@link EditorContext} instead of {@link DocumentState}?
 *
 * Every transaction can change both content and selection in one atomic step.
 * Consider the user pressing `Enter` mid-paragraph:
 * ```
 * Before:  [ paragraph: "Hello|World" ]     selection: cursor at offset 5
 * After:   [ paragraph: "Hello" ]           selection: cursor at start of new block
 *          [ paragraph: "World" ]
 * ```
 *
 * That is one user action, but it requires:
 * - A `split_block` operation (doc change)
 * - A `set_selection` operation (cursor moves to the new block)
 *
 * If the pipeline only returned {@link DocumentState}, we would need a second, parallel mechanism to update the cursor,
 * and nothing would guarantee they stay in sync. Two updates means two subscriber notifications, two changes for UI libraries
 * to render inconsistent intermediate frames, and undo that must manually coordinate two separate stacks.
 *
 * With {@link EditorContext} one transaction produces one next snapshot:
 * ```ts
 * const nextContext = applyOps(prevContext, [
 * {
 *    type: 'split_block',
 *   blockId: block.id,
 *   atNodeId: cursor.nodeId,
 *   atOffset: cursor.offset,
 *   newBlock,
 *   tailSnapshot,
 * },
 * {
 *   type: 'set_selection',
 *   selection: cursorInNewBlock,
 *   prevSelection: prevContext.selection,
 * },
 * ])
 * // nextContext: EditorContext (state AND selection updated together)
 * ```
 *
 * This is the core meaning of {@link EditorContext}: it's the atomic unit of editor changes, not just the document.
 */

/** A cursor position inside a text-bearing inline node. */
export interface TextCursor {
  /** Block containing the target inline node. */
  readonly blockId: BlockId

  /** Inline node the cursor is anchored to. */
  readonly nodeId: NodeId

  /** Character offset within the node's text (or 0 at line_break). */
  readonly offset: number
}

/** Collapsed cursor (insertion point). */
export interface CursorSelection {
  readonly __type: 'cursor'

  /** Cursor position (anchor equals focus). */
  readonly anchor: TextCursor
}

/** Non-empty text range. anchor/focus order matters for delete direction. */
export interface RangeSelection {
  readonly __type: 'range'

  /** Range start in document order (may be after focus when selecting backward). */
  readonly anchor: TextCursor

  /** Range end in document order. */
  readonly focus: TextCursor
}

/** Discriminated union of all supported selection shapes in {@link Dactylo}. */
export type Selection = Relax<CursorSelection | RangeSelection>

/** The topology of a range selection. */
export type RangeSelectionTopology = 'same-node' | 'same-block' | 'cross-blocks'

/** Checks whether the selection is active or not. */
export function isSelectionActive(
  selection: Selection | null,
): selection is Selection {
  return selection !== null
}

/** Checks whether a selection is a collapsed cursor selection. */
export function isCursorSelection(
  selection: Selection | null,
): selection is CursorSelection {
  return isSelectionActive(selection) && selection.__type === 'cursor'
}

/** Checks wether a selection is a range selection. */
export function isRangeSelection(
  selection: Selection | null,
): selection is RangeSelection {
  return isSelectionActive(selection) && selection.__type === 'range'
}

/** Gets the topology of a range selection. */
export function getRangeSelectionTopology(
  range: RangeSelection,
): RangeSelectionTopology {
  const { anchor, focus } = range
  if (anchor.blockId !== focus.blockId) {
    return 'cross-blocks'
  }

  if (anchor.nodeId === focus.nodeId) {
    return 'same-node'
  }

  return 'same-block'
}

/** Checks whether the block has an active cursor selection within. */
export function isBlockWithActiveCursor(
  selection: Selection | null,
  blockId: BlockId,
): boolean {
  return isCursorSelection(selection) && selection.anchor.blockId === blockId
}

/** Checks whether the block has an active range selection within. */
export function isBlockWithActiveRange(
  selection: Selection | null,
  blockId: BlockId,
): boolean {
  return (
    isRangeSelection(selection) &&
    (selection.anchor.blockId === blockId ||
      selection.focus.blockId === blockId)
  )
}

/** Checks whether the block has an active selection within. */
export function isBlockWithActiveSelection(
  selection: Selection | null,
  blockId: BlockId,
): boolean {
  return (
    isBlockWithActiveCursor(selection, blockId) ||
    isBlockWithActiveRange(selection, blockId)
  )
}

/** A contiguous `[from, to)` slice inside one text node, part of a larger range. */
export interface TextSpanInRange {
  /** Block containing the text node. */
  readonly blockId: BlockId

  /** Text node ID. */
  readonly nodeId: NodeId

  /** Start offset (inclusive) within the text node. */
  readonly from: number

  /** End offset (exclusive) within the text node. */
  readonly to: number
}

/**
 * Appends partial or full text-node slices from one block's inline content.
 * Returns an accumulator for output slices.
 */
export function appendTextSpansInRangeFromBlock(
  /** Incoming spans. */
  incomingSpans: TextSpanInRange[],
  /** Block being scanned. */
  blockId: BlockId,
  /** Inline content array (not mutated). */
  content: readonly InlineNode[],
  /** First content index to visit (inclusive). */
  fromNi: number,
  /** Last content index to visit (inclusive). */
  toNi: number,
  /** Start offset when `fromNi` is the anchor node; otherwise ignored. */
  fromBound: number,
  /** End offset when `toNi` is the focus node; `undefined` means node end. */
  toBound?: number,
): TextSpanInRange[] {
  const outgoingSpans = [...incomingSpans]

  for (let ni = fromNi; ni <= toNi; ni += 1) {
    const node = content[ni]
    if (!node || node.__type !== 'text') {
      continue
    }

    const from = ni === fromNi ? fromBound : 0
    const to = ni === toNi ? (toBound ?? node.text.length) : node.text.length

    if (from < to) {
      outgoingSpans.push({ blockId, from, nodeId: node.id, to })
    }
  }

  return outgoingSpans
}

/** Creates a range selection from anchor and focus cursors. */
export function createRange(
  anchor: TextCursor,
  focus: TextCursor,
): RangeSelection {
  return { __type: 'range', anchor, focus }
}

/** Creates a collapsed cursor selection. */
export function createCursor(anchor: TextCursor): CursorSelection {
  return { __type: 'cursor', anchor }
}

/** Places a collapsed cursor at the end of the last text node in a block. */
export function cursorAtBlockEnd(
  blockId: BlockId,
  block: BlockWithInlineContent,
): CursorSelection {
  let offset = 0
  const last = findLastInlineNodeInBlock(block)

  const type = last.__type
  switch (type) {
    case 'text': {
      offset = last.text.length
      break
    }
    case 'link': {
      offset = last.text.length
      break
    }
    case 'mention': {
      offset = last.text.length
      break
    }
    case 'line_break': {
      offset = 0
      break
    }
    default: {
      assertNever(type, { hint: 'Selection/#cursorAtBlockEnd' })
    }
  }

  return createCursor({ blockId, nodeId: last.id, offset })
}

/** Checks whether is a {@link TextCursor} is at block end. */
export function isCursorAtBlockEnd(
  cursor: TextCursor,
  block: BlockWithInlineContent,
): boolean {
  const last = findLastInlineNodeInBlock(block)
  const length = getInlineNodeTextLength(last)

  return cursor.offset === length
}

/** Places a collapsed cursor at the start of the first text node in a block. */
export function cursorAtBlockStart(
  blockId: BlockId,
  block: BlockWithInlineContent,
): CursorSelection | null {
  const first = findFirstInlineNodeInBlock(block)
  return createCursor({ blockId, nodeId: first.id, offset: 0 })
}

/** Returns the linear offset of a cursor in a block. */
export function getLinearOffsetInBlock(
  block: BlockWithInlineContent,
  cursor: TextCursor,
): number {
  let linear = 0
  for (const node of block.content) {
    if (node.id === cursor.nodeId) {
      if (
        node.__type === 'text' ||
        node.__type === 'link' ||
        node.__type === 'mention'
      ) {
        return linear + cursor.offset
      }
      return linear
    }
    if (node.__type !== 'line_break') {
      linear += getInlineNodeTextLength(node)
    }
  }
  return linear
}

/** Returns the linear length of a block’s inline content (line breaks contribute 0). */
export function getBlockLinearLength(block: BlockWithInlineContent): number {
  let linear = 0
  for (const node of block.content) {
    if (node.__type !== 'line_break') {
      linear += getInlineNodeTextLength(node)
    }
  }
  return linear
}

/** Start linear offset of each visual line (split on `line_break`). */
export function getVisualLineStartLinears(
  block: BlockWithInlineContent,
): number[] {
  const starts = [0]
  let linear = 0
  for (const node of block.content) {
    if (node.__type === 'line_break') {
      starts.push(linear)
      continue
    }
    linear += getInlineNodeTextLength(node)
  }
  return starts
}

/** Maps a cursor to a visual line index and column (for up/down). */
export function getVisualLineContext(
  block: BlockWithInlineContent,
  cursor: TextCursor,
): { column: number; lineIndex: number; lineStartLinear: number } | null {
  let lineIndex = 0
  let lineStartLinear = 0
  let linear = 0
  for (const node of block.content) {
    if (node.id === cursor.nodeId) {
      if (node.__type === 'line_break') {
        return {
          column: 0,
          lineIndex: lineIndex + 1,
          lineStartLinear: linear,
        }
      }
      if (
        node.__type === 'text' ||
        node.__type === 'link' ||
        node.__type === 'mention'
      ) {
        return {
          column: cursor.offset,
          lineIndex,
          lineStartLinear,
        }
      }
      return {
        column: 0,
        lineIndex,
        lineStartLinear,
      }
    }
    if (node.__type === 'line_break') {
      lineIndex += 1
      lineStartLinear = linear
      continue
    }
    linear += getInlineNodeTextLength(node)
  }
  return null
}

/** Places a collapsed cursor at the start of an inline node. */
export function cursorAtInlineNodeStart(
  blockId: BlockId,
  node: InlineNode,
): TextCursor {
  return { blockId, nodeId: node.id, offset: 0 }
}

/** Places a collapsed cursor at the end of an inline node. */
export function cursorAtInlineNodeEnd(
  blockId: BlockId,
  node: InlineNode,
): TextCursor {
  if (node.__type === 'line_break') {
    return { blockId, nodeId: node.id, offset: 0 }
  }
  if (node.__type === 'text') {
    return { blockId, nodeId: node.id, offset: node.text.length }
  }
  return { blockId, nodeId: node.id, offset: getInlineNodeTextLength(node) }
}

/** Creates a cursor from a linear offset in a block. */
export function cursorFromLinearOffsetInBlock(
  blockId: BlockId,
  block: BlockWithInlineContent,
  linear: number,
  snapOffsetToBoundary: (text: string, offset: number) => number,
): TextCursor {
  let remaining = Math.max(0, linear)
  for (const node of block.content) {
    if (isInlineNodeWithEditableText(node)) {
      if (remaining <= node.text.length) {
        return {
          blockId,
          nodeId: node.id,
          offset: snapOffsetToBoundary(node.text, remaining),
        }
      }
      remaining -= node.text.length
      continue
    }
    if (node.__type === 'line_break') {
      if (remaining === 0) {
        return cursorAtInlineNodeStart(blockId, node)
      }
      continue
    }
    const len = getInlineNodeTextLength(node)
    if (remaining <= len) {
      return cursorAtInlineNodeEnd(blockId, node)
    }
    remaining -= len
  }
  return cursorAtBlockEnd(blockId, block).anchor
}

/** Checks if two selections are equal. */
export function areSelectionsEqual(
  a: { anchor: TextCursor; focus?: TextCursor } | null,
  b: { anchor: TextCursor; focus?: TextCursor } | null,
): boolean {
  if (a === null && b === null) {
    return true
  }

  if (a === null || b === null) {
    return false
  }

  const aFocus = a.focus ?? a.anchor
  const bFocus = b.focus ?? b.anchor

  return (
    a.anchor.blockId === b.anchor.blockId &&
    a.anchor.nodeId === b.anchor.nodeId &&
    a.anchor.offset === b.anchor.offset &&
    aFocus.blockId === bFocus.blockId &&
    aFocus.nodeId === bFocus.nodeId &&
    aFocus.offset === bFocus.offset
  )
}

/**
 * Builds a forward range that selects inline content inside one
 * {@link BlockWithInlineContent} (paragraph, heading, …).
 *
 * Anchor is at the start of the first inline node with text in `block.content`;
 * focus is at the end of the last text/link/line_break. Inline nodes between
 * them (including mentions) are included in the range topology.
 *
 * Returns `null` when:
 * - there is no valid endpoint (e.g. mention-only block),.
 *
 * Used by the `select-all` keyboard shortcut when the selection is a cursor.
 */
export function createRangeSelectingInlineContentInBlock(
  block: BlockWithInlineContent,
): RangeSelection | null {
  const first = findFirstInlineNodeInBlock(block)
  const last = findLastInlineNodeInBlock(block)

  const anchor = cursorAtInlineNodeStart(block.id, first)
  const focus = cursorAtInlineNodeEnd(block.id, last)

  if (anchor.nodeId === focus.nodeId && anchor.offset === focus.offset) {
    return null
  }

  return createRange(anchor, focus)
}
