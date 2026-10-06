import {
  TEXT_NODE_ATTR_NAME,
  TEXT_NODE_ID_DATA_NAME,
} from '../internals/constants'
import { toDatasetProperty } from './utils'

/** Finds the DOM text node with the given `nodeId` inside `editable`. */
// @todo: handle handle links attributes
export function findEditableTextNode(
  editable: HTMLDivElement,
  nodeId: string,
): HTMLSpanElement | null {
  let current = editable.firstChild
  while (current) {
    if (
      current instanceof HTMLSpanElement &&
      current.getAttribute(TEXT_NODE_ATTR_NAME) !== null &&
      current.dataset[toDatasetProperty(TEXT_NODE_ID_DATA_NAME)] === nodeId
    ) {
      return current
    }
    current = current.nextSibling
  }
  return null
}

/**
 * Clamps `offset` to the range `Range.setStart` accepts for `node`.
 *
 * The model offset is already validated, but the DOM text can be shorter for
 * a frame. Past the end, `setStart` throws `IndexSizeError`.
 */
export function clampOffset(node: Node, offset: number): number {
  const max =
    node.nodeType === Node.TEXT_NODE
      ? (node as Text).length
      : node.childNodes.length
  return Math.max(0, Math.min(offset, max))
}
