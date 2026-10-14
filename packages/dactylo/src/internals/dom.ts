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
  BLOCK_CONTENT_EDITABLE_DATA_NAME,
  LINE_BREAK_NODE_ATTR_NAME,
  TEXT_NODE_ATTR_NAME,
} from './constants'
import type { NodeId } from './nodes'
import type { TextCursor } from './selection'

/** A browser selection selection point. */
export interface DOMPoint {
  /** Node the collapsed selection is at. */
  node: Node

  /** Character index, or child index when `node` is an element. */
  offset: number
}

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

/**
 * Counts model characters represented by painted DOM text.
 *
 * {@link paintTextForDOM} inserts ZWSP (and sometimes NBSP) that are not
 * stored on `TextNode.text`. DOM→model mapping must use this helper.
 */
export function modelLengthFromPaintedDOMText(painted: string): number {
  let model = 0
  // oxlint-disable-next-line typescript/prefer-for-of
  for (let i = 0; i < painted.length; i += 1) {
    if (painted[i] === DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT) {
      continue
    }
    model += 1
  }
  return model
}

/**
 * Model offset for a caret inside one `[dactylo-node]` host that may contain
 * several `#text` nodes (splits, marks, browser normalization).
 */
export function modelOffsetInInlineTextHost(
  host: HTMLElement,
  targetText: Text,
  domOffsetInTarget: number,
): number {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  let model = 0
  let text = walker.nextNode() as Text | null
  while (text) {
    if (text === targetText) {
      return (
        model +
        modelLengthFromPaintedDOMText(text.data.slice(0, domOffsetInTarget))
      )
    }
    model += modelLengthFromPaintedDOMText(text.data)
    text = walker.nextNode() as Text | null
  }
  return model
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

/** Finds the block id from a DOM node. */
export function findBlockIdFromDomNode(node: Node | null): BlockId | null {
  let current: Node | null = node
  while (current) {
    if (
      current instanceof HTMLElement &&
      current.getAttribute(BLOCK_ATTR_NAME) !== null
    ) {
      return readBlockIdFromElement(current)
    }
    current = current.parentNode
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
 * Nearest `[dactylo-block-content]` with `data-dactylo-block-content-editable="true"`.
 * That node is the per-block `contentEditable` surface.
 */
export function findBlockContentEditableFromDOMNode(
  node: Node | null,
): HTMLDivElement | null {
  let current: Node | null = node
  while (current) {
    if (current instanceof HTMLElement) {
      if (!current.hasAttribute(BLOCK_CONTENT_ATTR_NAME)) {
        current = current.parentNode
        continue
      }
      const flag =
        current.dataset[toDatasetProperty(BLOCK_CONTENT_EDITABLE_DATA_NAME)]
      if (flag === 'true' && current instanceof HTMLDivElement) {
        return current
      }
    }
    current = current.parentNode
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

/** Nearest ancestor marked `[dactylo-node]`. */
export function findClosestDactyloNode(node: Node): HTMLElement | null {
  let current: Node | null = node
  while (current) {
    if (
      current instanceof HTMLElement &&
      current.getAttribute(NODE_ATTR_NAME) !== null
    ) {
      return current
    }
    current = current.parentNode
  }
  return null
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

/** Maps a text host boundary to a model offset (start or end of inline text). */
export function cursorAtTextHostBoundary(
  host: HTMLElement,
  blockId: BlockId,
  nodeId: NodeId,
  domChildOffset: number,
): TextCursor {
  if (domChildOffset <= 0) {
    return { blockId, nodeId, offset: 0 }
  }
  let model = 0
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  let text = walker.nextNode() as Text | null
  while (text) {
    model += modelLengthFromPaintedDOMText(text.data)
    text = walker.nextNode() as Text | null
  }
  return { blockId, nodeId, offset: model }
}

/** Maps child-index on `[dactylo-block-content]` to {@link TextCursor}. */
export function cursorAtBlockContentChildIndex(
  blockContent: HTMLDivElement,
  blockId: BlockId,
  index: number,
): TextCursor | null {
  const { childNodes } = blockContent
  if (childNodes.length === 0) {
    return null
  }
  const clamped = Math.max(0, Math.min(index, childNodes.length))
  const child = childNodes[clamped] ?? childNodes[clamped - 1]
  if (!(child instanceof HTMLElement)) {
    return null
  }
  if (child.getAttribute(NODE_ATTR_NAME) === null) {
    return null
  }
  const nodeId = readNodeIdFromElement(child)
  if (!nodeId) {
    return null
  }
  if (clamped < childNodes.length) {
    return { blockId, nodeId, offset: 0 }
  }
  if (child.hasAttribute(LINE_BREAK_NODE_ATTR_NAME)) {
    return { blockId, nodeId, offset: 0 }
  }
  return cursorAtTextHostBoundary(child, blockId, nodeId, 1)
}

/** Maps one live selection endpoint (`anchor` or `focus`) to {@link TextCursor}. */
export function getTextCursorFromDOMPoint(
  blockContent: HTMLDivElement,
  blockId: BlockId,
  point: DOMPoint,
): TextCursor | null {
  const { node, offset } = point
  if (node.nodeType === Node.TEXT_NODE) {
    const host = findClosestDactyloNode(node)
    if (!host?.hasAttribute(TEXT_NODE_ATTR_NAME)) {
      return null
    }
    const nodeId = readNodeIdFromElement(host)
    if (!nodeId) {
      return null
    }
    return {
      blockId,
      nodeId,
      offset: modelOffsetInInlineTextHost(host, node as Text, offset),
    }
  }
  if (
    node instanceof HTMLElement &&
    node.getAttribute(NODE_ATTR_NAME) !== null
  ) {
    const nodeId = readNodeIdFromElement(node)
    if (!nodeId) {
      return null
    }
    if (node.hasAttribute(LINE_BREAK_NODE_ATTR_NAME)) {
      return { blockId, nodeId, offset: 0 }
    }
    if (node.hasAttribute(TEXT_NODE_ATTR_NAME)) {
      return cursorAtTextHostBoundary(node, blockId, nodeId, offset)
    }
  }
  if (node === blockContent) {
    return cursorAtBlockContentChildIndex(blockContent, blockId, offset)
  }
  return null
}

/** Whether both endpoints of the live DOM selection lie inside `[dactylo-editable]`. */
export function isWindowSelectionInsideEditable(
  editable: HTMLDivElement,
  domSelection: Selection,
): boolean {
  const { anchorNode, focusNode } = domSelection
  if (!anchorNode || !focusNode) {
    return false
  }
  return editable.contains(anchorNode) && editable.contains(focusNode)
}

/**
 * Whether the live caret is already the collapsed point `point`.
 * Skipping that case keeps a render from resetting the selection while typing.
 */
export function isCaretAt(domSelection: Selection, point: DOMPoint): boolean {
  return (
    domSelection.isCollapsed &&
    domSelection.anchorNode === point.node &&
    domSelection.anchorOffset === point.offset
  )
}

/**
 * Whether the live range is already the collapsed point `point`.
 * Skipping that case keeps a render from resetting the selection while typing.
 */
export function isRangeAt(
  domSelection: Selection,
  anchorPoint: DOMPoint,
  focusPoint: DOMPoint,
): boolean {
  return (
    !domSelection.isCollapsed &&
    domSelection.anchorNode === anchorPoint.node &&
    domSelection.anchorOffset === anchorPoint.offset &&
    domSelection.focusNode === focusPoint.node &&
    domSelection.focusOffset === focusPoint.offset
  )
}
