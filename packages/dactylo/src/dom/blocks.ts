import type { BlockId } from '../internals/blocks'
import {
  BLOCK_ATTR_NAME,
  BLOCK_CONTENT_ATTR_NAME,
  BLOCK_ID_DATA_NAME,
  BLOCKS_ATTR_NAME,
} from '../internals/constants'
import { toDatasetProperty } from './utils'

/** Reads `data-dactylo-block-id` from a `[dactylo-paragraph-block]` wrapper. */
export function readBlockIdFromElement(element: HTMLElement): BlockId | null {
  const id = element.dataset[toDatasetProperty(BLOCK_ID_DATA_NAME)]
  return (id ?? null) as BlockId | null
}

/**
 * Finds the DOM blocks element inside
 * the editable `[dactylo-editable]` html div element.
 */
export function findBlocksElement(
  editable: HTMLDivElement,
): HTMLDivElement | null {
  let current = editable.firstChild
  while (current !== null) {
    if (
      current instanceof HTMLDivElement &&
      current.getAttribute(BLOCKS_ATTR_NAME) !== null
    ) {
      return current
    }
    current = current.nextSibling
  }

  return null
}

/**
 * Finds the DOM block element with the given `blockId` inside
 * the editable `[dactylo-editable]` html div element.
 */
export function findBlockElement(
  editable: HTMLDivElement,
  blockId: BlockId,
): HTMLDivElement | null {
  const blocks = findBlocksElement(editable)
  if (!blocks) {
    return null
  }

  let current = blocks.firstChild
  while (current !== null) {
    if (
      current instanceof HTMLDivElement &&
      current.getAttribute(BLOCK_ATTR_NAME) !== null &&
      readBlockIdFromElement(current) === blockId
    ) {
      return current
    }

    current = current.nextSibling
  }
  return null
}

/**
 * Finds the DOM editable element with the given `blockId` inside
 * the editable `[dactylo-editable]` html div element.
 */
export function findBlockEditableElement(
  editable: HTMLDivElement,
  blockId: BlockId,
): HTMLDivElement | null {
  const block = findBlockElement(editable, blockId)
  if (!block) {
    return null
  }

  let current = block.firstChild
  while (current !== null) {
    if (
      current instanceof HTMLDivElement &&
      current.getAttribute(BLOCK_CONTENT_ATTR_NAME) !== null
    ) {
      return current
    }
    current = current.nextSibling
  }
  return null
}
