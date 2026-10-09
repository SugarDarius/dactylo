import { NODE_ATTR_NAME, NODE_ID_DATA_NAME } from '../internals/constants'
import type { NodeId } from '../internals/nodes'
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

/** Reads `data-dactylo-node-id` from a `[dactylo-node]` element. */
export function readNodeIdFromElement(element: HTMLElement): NodeId | null {
  const id = element.dataset[toDatasetProperty(NODE_ID_DATA_NAME)]
  return (id ?? null) as NodeId | null
}

/** Finds the DOM editable element with the given `nodeId` inside
 * the block content `[dactylo-block-content]` html div element.
 */
export function findEditableElement(
  editable: HTMLDivElement,
  nodeId: string,
): HTMLSpanElement | HTMLAnchorElement | null {
  let current = editable.firstChild
  while (current !== null) {
    if (
      (current instanceof HTMLSpanElement ||
        current instanceof HTMLAnchorElement) &&
      current.getAttribute(NODE_ATTR_NAME) !== null &&
      readNodeIdFromElement(current) === nodeId
    ) {
      return current
    }
    current = current.nextSibling
  }
  return null
}
