/**
 * Catalog of all nodes supported by Dactylo.
 *
 * Nodes are the inline content tree (not a flat string with offsets) of a block.
 * Text is stored in text nodes: structural inline elements (soft line breaks, inline code spans, ...)
 *
 * By design, this content tree is kept lightweight as an inline sequence
 * with coalesced text nodes to give better mutation performances while staying memory-conscious.
 */

import { nanoid } from 'nanoid'

import { isMarksEqual } from './marks'
import type { Marks } from './marks'
import { sanitizeLinkHref } from './sanitize-link'
import { sanitizeText } from './sanitize-text'
import type { Brand, Metadata } from './types'
import { assertNever } from './utils'

/**
 * Brand type for node unique IDs.
 *
 * @example
 * ```txt
 * nd_1234567890
 * ```
 */
export type NodeId = Brand<`nd_${string}`, 'NodeId'>

/** Base interface to implement by all existing nodes in Dactylo. */
export interface INode {
  /** Unique identifier for the node. */
  readonly id: NodeId

  /** When the node was created.  */
  readonly createdAt: Date

  /** When the node was last updated. */
  readonly updatedAt: Date | null

  /**
   * Custom metadata defined by developers.
   * Useful to store data inside a node to use outside Dactylo itself.
   */
  readonly metadata: Metadata
}

/** Node representing a text -- default node type. */
export interface TextNode extends INode {
  readonly __type: 'text'

  /** Text content of the node. */
  readonly text: string

  /** Marks decorating the text content */
  readonly marks: Readonly<Marks>
}

/** Node representing a link. */
export interface LinkNode extends INode {
  readonly __type: 'link'

  /** URL of the link. */
  readonly url: {
    /** Href of the link. */
    readonly href: string

    /** Title of the link. */
    readonly title: string
  }

  /** Text content of the node. */
  readonly text: string

  /** Marks decorating the text content */
  readonly marks: Readonly<Marks>
}

/** Node representing a mention. */
export interface MentionNode extends INode {
  readonly __type: 'mention'

  /** Structural data of the artefact representing the mention. */
  readonly artefact: {
    /** The  key to use when you want to refer to the mention in the code. */
    readonly key: string

    /** The type to use when you want a specific rendering
     * in UI libraries for the mention.
     */
    readonly type: string
  }

  /** The text to display for the mention */
  readonly text: string
}

/** Node representing a like break (soft break, shift+enter) inside a block. */
export interface LineBreakNode extends INode {
  readonly __type: 'line_break'
}

/** Discriminated union of inline nodes supported by {@link Dactylo} */
export type InlineNode = TextNode | LinkNode | MentionNode | LineBreakNode

/** Allowed nodes with editable text.*/
export type InlineNodeWithEditableText = TextNode | LinkNode

/** Generates a 24 characters long unique node ID. */
export function generateNodeId(): NodeId {
  return `nd_${nanoid(21)}` as NodeId
}

/**
 * Creates a {@link TextNode}.
 * By default, it sanitizes the text at creation time.
 */
export function createTextNode(opts: {
  text: string
  metadata?: Metadata
  marks: Marks
}): TextNode {
  return {
    __type: 'text',
    createdAt: new Date(),
    id: generateNodeId(),
    marks: opts.marks,
    metadata: opts.metadata ?? {},
    text: sanitizeText(opts.text),
    updatedAt: null,
  }
}

/** Whether the node is a text node. */
export function isTextNode(node: InlineNode): node is TextNode {
  return node.__type === 'text'
}

/** Creates a {@link LineBreakNode}.  */
export function createLineBreakNode(
  opts: {
    metadata?: Metadata
  } = {},
): LineBreakNode {
  return {
    __type: 'line_break',
    createdAt: new Date(),
    id: generateNodeId(),
    metadata: opts.metadata ?? {},
    updatedAt: null,
  }
}

/** Whether the node is a line break node. */
export function isLineBreakNode(node: InlineNode): node is LineBreakNode {
  return node.__type === 'line_break'
}

/** Creates a {@link LinkNode}.
 * By default, it sanitizes the text, href, and title at creation time.
 */
export function createLinkNode(opts: {
  url: {
    href: string
    title: string
  }
  metadata?: Metadata
  text: string
  marks: Marks
}): LinkNode {
  return {
    __type: 'link',
    createdAt: new Date(),
    id: generateNodeId(),
    marks: opts.marks,
    metadata: opts.metadata ?? {},
    text: sanitizeText(opts.text),
    updatedAt: null,
    url: {
      href: sanitizeLinkHref(opts.url.href),
      title: sanitizeText(opts.url.title),
    },
  }
}

/** Whether the node is a link node. */
export function isLinkNode(node: InlineNode): node is LinkNode {
  return node.__type === 'link'
}

/** Whether the node is a mention node. */
export function isMentionNode(node: InlineNode): node is MentionNode {
  return node.__type === 'mention'
}

/** Whether the node is an editable text node or a link node. */
export function isInlineNodeWithEditableText(
  node: InlineNode,
): node is InlineNodeWithEditableText {
  return isTextNode(node) || isLinkNode(node)
}

/** Creates a new inline node with editable text from an existing inline node. */
export function createFromInlineWithEditableText(
  node: InlineNodeWithEditableText,
  opts: {
    marks?: Marks
    metadata?: Metadata
    text?: string
  },
): InlineNodeWithEditableText {
  const type = node.__type
  switch (type) {
    case 'text': {
      return createTextNode({
        marks: opts.marks ?? node.marks,
        metadata: opts.metadata ?? node.metadata,
        text: opts.text ?? node.text,
      })
    }
    case 'link': {
      return createLinkNode({
        marks: opts.marks ?? node.marks,
        metadata: opts.metadata ?? node.metadata,
        text: opts.text ?? node.text,
        url: node.url,
      })
    }
    default: {
      assertNever(node, {
        hint: 'InlineNode/#createFromInlineWithEditableText',
      })
    }
  }
}

/** Returns a shallow copy of an inline node with a fresh `updatedAt` timestamp. */
export function touchInlineNode(node: InlineNode): InlineNode {
  return { ...node, updatedAt: new Date() }
}

/** Returns the text length of an inline node. */
export function getInlineNodeTextLength(node: InlineNode): number {
  switch (node.__type) {
    case 'text':
    case 'link':
    case 'mention': {
      return node.text.length
    }
    case 'line_break': {
      return 0
    }
    default: {
      assertNever(node, { hint: 'InlineNode/#getInlineNodeTextLength' })
    }
  }
}

/** Whether the inline content is empty. */
export function isInlineContentTextEmpty(
  content: readonly InlineNode[],
): boolean {
  for (const node of content) {
    if (getInlineNodeTextLength(node) > 0) {
      return false
    }
  }

  return true
}

/** Whether editable text has no user-visible characters (empty or whitespace only). */
export function isEditableTextWithoutVisibleCharacters(text: string): boolean {
  if (text.length === 0) {
    return true
  }
  return !/\S/u.test(text)
}

/**
 * Whether inline content has no user-visible text.
 *
 * Unlike {@link isCanonicalEmptyInlineContent}, does **not** compare
 * `TextNode.marks` to {@link EditorContext.activeMarks}. Use this for
 * placeholder / `data-empty` / `isWithEmptyInlineContent`.
 *
 * Collapse skip logic should keep using {@link isCanonicalEmptyInlineContent}.
 */
export function isInlineContentWithoutVisibleText(
  content: readonly InlineNode[],
): boolean {
  for (const node of content) {
    switch (node.__type) {
      case 'text':
      case 'link': {
        if (!isEditableTextWithoutVisibleCharacters(node.text)) {
          return false
        }
        break
      }
      case 'mention': {
        if (node.text.length > 0) {
          return false
        }
        break
      }
      case 'line_break': {
        return false
      }
      default: {
        assertNever(node, {
          hint: 'InlineNode/#isInlineContentWithoutVisibleText',
        })
      }
    }
  }
  return true
}

/**
 * Whether inline content matches the editor's canonical "empty paragraph" shape:
 * exactly one {@link TextNode} with `text === ""` and marks equal to `activeMarks`.
 *
 * Empty {@link LinkNode} (or other editable-text inline types) are **not** canonical:
 * an empty block must present as plain text so typing and placeholders stay on a
 * `<span>`/text node, not a lingering `<a>`.
 */
export function isCanonicalEmptyInlineContent(
  content: readonly InlineNode[],
  activeMarks: Marks,
): boolean {
  if (content.length !== 1) {
    return false
  }

  const [first] = content
  if (!first || !isTextNode(first)) {
    return false
  }

  return first.text.length === 0 && isMarksEqual(first.marks, activeMarks)
}

/**
 * Whether two adjacent inline nodes at a merge/split seam should become one node.
 * Used so `merge_blocks` undoes a mid-node `split_block` back to a single node.
 */
export function canJoinAtMergeSeam(
  left: InlineNode,
  right: InlineNode,
): boolean {
  if (
    !isInlineNodeWithEditableText(left) ||
    !isInlineNodeWithEditableText(right)
  ) {
    return false
  }

  if (left.__type !== right.__type) {
    return false
  }

  if (!isMarksEqual(left.marks, right.marks)) {
    return false
  }

  if (isLinkNode(left) && isLinkNode(right)) {
    return (
      left.url.href === right.url.href && left.url.title === right.url.title
    )
  }

  return true
}

/**
 * Concatenates `tail` onto `head`, joining the seam into one node when
 * {@link canJoinAtMergeSeam} is true. Preserves the head node's id.
 */
export function joinInlineContentAtMergeSeam(
  head: readonly InlineNode[],
  tail: readonly InlineNode[],
): InlineNode[] {
  const last = head[head.length - 1]
  const [first, ...rest] = tail

  if (
    last &&
    first &&
    canJoinAtMergeSeam(last, first) &&
    isInlineNodeWithEditableText(last) &&
    isInlineNodeWithEditableText(first)
  ) {
    return [
      ...head.slice(0, -1),
      touchInlineNode({ ...last, text: last.text + first.text }),
      ...rest,
    ]
  }

  return [...head, ...tail]
}

/**
 * Merges adjacent text nodes with identical marks into a single node.
 *
 * Preserves the ID of the first node in each merge group so downstream
 * cursors and undo snapshots remain stable.
 *
 * Returns a new array with adjacent compatible text nodes merged.
 */
export function coalesceInlineNodes(
  nodes: readonly InlineNode[],
): InlineNode[] {
  if (nodes.length <= 1) {
    return [...nodes]
  }

  const result: InlineNode[] = []
  let pending: TextNode | null = null

  for (const node of nodes) {
    /** We don't coalesce links and mentions, only text nodes. */
    if (!isTextNode(node)) {
      if (pending) {
        result.push(pending)
        pending = null
      }
      result.push(node)

      continue
    }

    if (pending && isMarksEqual(pending.marks, node.marks)) {
      pending = {
        __type: pending.__type,
        createdAt: pending.createdAt,
        id: pending.id,
        marks: pending.marks,
        metadata: pending.metadata,
        text: pending.text + node.text,
        updatedAt: pending.updatedAt,
      }
    } else {
      if (pending) {
        result.push(pending)
      }
      pending = node
    }
  }

  if (pending) {
    result.push(pending)
  }

  return result
}
