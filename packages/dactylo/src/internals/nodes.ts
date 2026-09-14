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
import type { Brand, Relax, Metadata } from './types'

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

  /** Whether the node was created with a placeholder text node. */
  readonly isPlaceholder: boolean
}

/** Node representing a link */
export interface LinkNode extends INode {
  readonly __type: 'link'

  /** URL of the link */
  readonly url: {
    /** Href of the link */
    readonly href: string

    /** Title of the link */
    readonly title: string
  }

  /** Text Node representing the link text */
  readonly textNode: TextNode
}

/** Node representing a mention */
export interface MentionNode extends INode {
  readonly __type: 'mention'

  /** Structural data of the artefact representing the mention */
  readonly artefact: {
    /** The  key to use when you want to refer to the mention in the code. */
    readonly key: string

    /** The type to use when you want a specific rendering
     * in UI libraries for the mention.
     */
    readonly type: string

    /** The text to display for the mention */
    readonly text: string
  }
}

/** Node representing a like break (soft break, shift+enter) inside a block. */
export interface LineBreakNode extends INode {
  readonly __type: 'line_break'
}

/** Discriminated union of all existing nodes in Dactylo. */
export type InlineNode = Relax<
  TextNode | LinkNode | MentionNode | LineBreakNode
>

/** Generates a 24 characters long unique node ID */
export function generateNodeId(): NodeId {
  return `nd_${nanoid(21)}` as NodeId
}

/** Creates a text node */
export function createTextNode(opts: {
  text: string
  isPlaceholder?: boolean
  metadata?: Metadata
  marks?: Marks
}): TextNode {
  return {
    __type: 'text',
    createdAt: new Date(),
    id: generateNodeId(),
    isPlaceholder: opts.isPlaceholder ?? false,
    marks: opts.marks ?? {},
    metadata: opts.metadata ?? {},
    text: opts.text,
    updatedAt: null,
  }
}

/** Creates a placeholder text node */
export function createPlaceholderTextNode(text: string): TextNode {
  return createTextNode({ isPlaceholder: true, text })
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
    if (node.__type !== 'text') {
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
        /** Always false as we are merging nodes */
        isPlaceholder: false,
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

/**
 * Splits a text node into up to three segments around `[from, to)`.
 * Empty segments are omitted. The leading segment keeps the original node id.
 *
 * Returns a replacement inline nodes (one to three entries).
 */
export function splitTextNodeAt(
  /** Text node to split. */
  node: TextNode,
  /** Start offset (inclusive) within `node.text`. */
  from: number,
  /** End offset (exclusive) within `node.text`. */
  to: number,
  /** Marks applied to the middle segment when present. */
  middleMarks: Marks,
): InlineNode[] {
  const replacement: InlineNode[] = []

  const before = node.text.slice(0, from)
  const middle = node.text.slice(from, to)
  const after = node.text.slice(to)

  if (before.length > 0) {
    replacement.push({ ...node, text: before, updatedAt: new Date() })
  }

  if (middle.length > 0) {
    replacement.push(
      createTextNode({
        marks: middleMarks,
        metadata: node.metadata,
        text: middle,
      }),
    )
  }

  if (after.length > 0) {
    replacement.push(
      createTextNode({
        marks: node.marks,
        metadata: node.metadata,
        text: after,
      }),
    )
  }

  return replacement
}
