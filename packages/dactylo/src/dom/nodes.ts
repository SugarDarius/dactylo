import { NODE_ATTR_NAME, NODE_ID_DATA_NAME } from '../internals/constants'
import { toDatasetProperty } from './utils'

/**
 * Clamps `offset` to the range `Range.setStart` accepts for `node`.
 *
 * The model offset is already validated, but the DOM text can be shorter for
 * a frame. Past the end, `setStart` throws `IndexSizeError`.
 */
export function clampNodeOffset(node: Node, offset: number): number {
  const max =
    node.nodeType === Node.TEXT_NODE
      ? (node as Text).length
      : node.childNodes.length
  return Math.max(0, Math.min(offset, max))
}

/** Finds the DOM editable node with the given `nodeId` inside `editable`. */
export function findEditableNode(
  editable: HTMLDivElement,
  nodeId: string,
): HTMLSpanElement | null {
  let current = editable.firstChild
  while (current) {
    if (
      current instanceof HTMLSpanElement &&
      current.getAttribute(NODE_ATTR_NAME) !== null &&
      current.dataset[toDatasetProperty(NODE_ID_DATA_NAME)] === nodeId
    ) {
      return current
    }
    current = current.nextSibling
  }
  return null
}
