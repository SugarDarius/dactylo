import { DactyloError } from '../internals/errors'
import type { TextCursor } from '../internals/selection'
import { clampOffset, findEditableTextNode } from './nodes'
import type { DOMPoint } from './point'
import { isCaretAt } from './window-selection'

/**
 * Maps a {@link TextCursor} to the DOM point inside `editable`.
 *
 * The model offset counts characters in one inline node. It is not an index
 * into `editable.childNodes`. Spans and anchors are elements, so passing that
 * offset to `Range.setStart` on an element would count children and throw
 * once it walks past them.
 *
 * Returns `null` when the node is not in the DOM and the block already has
 * other children. An empty editable still returns a caret at the start of the
 * div, which is the empty paragraph before its text span is rendered.
 */
export function getDOMPointFromTextCursor(
  editable: HTMLDivElement,
  cursor: TextCursor,
): DOMPoint | null {
  const { nodeId } = cursor
  const node = findEditableTextNode(editable, nodeId)

  if (!node) {
    if (editable.childNodes.length === 0) {
      return { node: editable, offset: 0 }
    }
    return null
  }

  /**
   * One model text node can be several DOM text nodes once marks, or the
   * browser, split it. Walk only inside this host and consume `offset`.
   */
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  let remaining = cursor.offset
  let text = walker.nextNode() as Text | null

  while (text) {
    if (remaining <= text.length) {
      return { node: text, offset: remaining }
    }
    remaining -= text.length
    text = walker.nextNode() as Text | null
  }

  return { node, offset: cursor.offset }
}

/**
 * Paints a collapsed caret at cursor position in the DOM
 * and focuses the `editable` element.
 */
export function paintCursorCaretAtPositionInDOM(
  editable: HTMLDivElement,
  cursor: TextCursor,
): void {
  const point = getDOMPointFromTextCursor(editable, cursor)
  if (!point) {
    // @todo: improve this
    throw new Error('No point found')
  }
  const clamped = { ...point, offset: clampOffset(point.node, point.offset) }

  const domSelection = window.getSelection()
  if (!domSelection) {
    throw DactyloError.from({
      code: 'NO_WINDOW_SELECTION',
      hint: 'dom/#putCursorCaretAtPositionInDOM',
      message: 'No window selection found',
    })
  }

  /** Skip resetting the selection if the caret is already at the position. */
  if (document.activeElement === editable && isCaretAt(domSelection, clamped)) {
    return
  }

  const range = document.createRange()
  range.setStart(clamped.node, clamped.offset)
  range.collapse(true)

  /** Focus the editable if it is not already focused. */
  if (document.activeElement !== editable) {
    editable.focus({ preventScroll: true })
  }

  domSelection.removeAllRanges()
  domSelection.addRange(range)
}
