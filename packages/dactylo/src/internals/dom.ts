import type { BlockId } from './blocks'
import {
  NODE_ATTR_NAME,
  NODE_ID_DATA_NAME,
  BLOCK_ATTR_NAME,
  BLOCK_CONTENT_ATTR_NAME,
  BLOCK_ID_DATA_NAME,
  BLOCKS_ATTR_NAME,
  DOM_SPACE_UNICODE_CODEPOINT,
  DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT,
} from './constants'
import type { NodeId } from './nodes'
import type { TextCursor } from './selection'

/**
 * Converts a dataset attribute name to a JavaScript property name.
 * @example
 * ```ts
 * toDatasetProperty('data-foo-bar') // 'fooBar'
 * ```
 */
export function toDatasetProperty(attr: string): string {
  return (
    attr
      .replace(/^data-/u, '')
      // oxlint-disable-next-line prefer-named-capture-group
      .replaceAll(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase())
  )
}

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

/** Paints model text into DOM characters.*/
export function paintTextForDOM(text: string): string {
  let rendered = ''

  if (text.length === 0) {
    rendered += DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT
    return rendered
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    // oxlint-disable-next-line unicorn/prefer-ternary
    const isSpace =
      char === ' ' &&
      (i === 0 ||
        text.length - 1 === i ||
        text[i - 1] === ' ' ||
        text[i + 1] === ' ')
    rendered += isSpace ? DOM_SPACE_UNICODE_CODEPOINT : char
  }

  if (
    rendered.endsWith(DOM_SPACE_UNICODE_CODEPOINT) ||
    rendered.endsWith(' ')
  ) {
    rendered += DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT
  }

  return rendered
}
