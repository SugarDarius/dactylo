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

import type { Brand, Relax } from './types'

/** Available marks decorating a text node. */
export interface Marks {
  /**
   * Whether the text  is bold
   */
  bold?: boolean

  /**
   * Whether the text  is italic
   */
  italic?: boolean

  /**
   * Whether the text  is strikethrough
   */
  strikethrough?: boolean

  /**
   * Whether the text  is underlined
   */
  underline?: boolean

  /**
   * Whether the text  is code
   */
  code?: boolean
}

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
  readonly metadata: Record<
    string,
    string | number | boolean | null | undefined
  >
}

/** Node representing a text -- default node type. */
export interface TextNode extends INode {
  readonly __type: 'text'

  /** Text content of the node. */
  readonly text: string

  /**
   * Marks decorating the text content
   */
  readonly marks: Readonly<Marks>
}

/** Node representing a link */
export interface LinkNode extends INode {
  readonly __type: 'link'

  /** URL of the link */
  readonly url: {
    /** Href of the link */
    readonly href: string

    /** Title of the link */
    readonly title?: string
  }

  /** Text Node representing the link text */
  readonly textNode: TextNode
}

/** Node representing a mention */
export interface MentionNode extends INode {
  readonly __type: 'mention'

  /**
   * Artefact key of the mention.
   * It can represent a user id, a group id, etc.
   * See it as the generic value to use when an artefact is mentioned.
   */
  readonly artefactKey: string
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
