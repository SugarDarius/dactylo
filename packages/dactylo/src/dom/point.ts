import type { TextCursor } from '../internals/selection'
import { findEditableElement } from './nodes'

/** A browser selection selection point. */
export interface DOMPoint {
  /** Node the collapsed selection is at. */
  node: Node

  /** Character index, or child index when `node` is an element. */
  offset: number
}

/**
 * Whether the live caret is already the collapsed point `point`.
 * Skipping that case keeps a render from resetting the selection while typing.
 */
export function isCaretAt(selection: Selection, point: DOMPoint): boolean {
  return (
    selection.isCollapsed &&
    selection.anchorNode === point.node &&
    selection.anchorOffset === point.offset
  )
}

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
  const node = findEditableElement(editable, nodeId)

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
