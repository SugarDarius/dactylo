/**
 * Catalog of all nodes supported by Dactylo.
 */

import type { Brand, Relax } from './types'

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
  createdAt: Date

  /** When the node was last updated. */
  updatedAt: Date | null
}

/** Node representing a text -- default node type. */
export interface TextNode extends INode {
  readonly __type: 'text'

  /** Text content of the node. */
  text: string

  /**
   * Marks decorating the text content
   */
  readonly marks: {
    /**
     * Whether the text content is bold
     */
    bold?: boolean

    /**
     * Whether the text content is italic
     */
    italic?: boolean

    /**
     * Whether the text content is strikethrough
     */
    strikethrough?: boolean

    /**
     * Whether the text content is underlined
     */
    underline?: boolean

    /**
     * Whether the text content is code
     */
    code?: boolean
  }
}

/** Node representing a link */
export interface LinkNode extends INode {
  readonly __type: 'link'

  /** URL of the link */
  readonly url: {
    /** Href of the link */
    href: string

    /** Title of the link */
    title?: string
  }

  /** Text Node representing the link text */
  textNode: TextNode
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
export type Node = Relax<TextNode | LinkNode | MentionNode | LineBreakNode>
