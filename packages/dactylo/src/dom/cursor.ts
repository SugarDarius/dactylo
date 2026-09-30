import type { TextCursor } from '../internals/selection'
import type { DOMPoint } from './point'

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
): DOMPoint {
  const { nodeId } = cursor

  // @todo: handle link nodes, line breaks and mentions
}

/**
 * Paints a collapsed caret at cursor position in the DOM
 * and focuses the `editable` element.
 */
export function putCursorCaretAtPositionInDOM(
  editable: HTMLDivElement,
  cursor: TextCursor,
): void {
  // @todo: implement
}
