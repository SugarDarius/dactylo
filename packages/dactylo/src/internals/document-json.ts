/**
 * JSON → runtime nodes and blocks.
 *
 * The schema is a content dump, not an identity snapshot: no IDs, and nested
 * `parentId` is not wired up yet. These helpers mint new identities and always
 * parent at the root. Callers (document init) own `posKey`.
 */

import {
  createBulletListItemBlock,
  createCheckboxListItemBlock,
  createDividerBlock,
  createHeadingBlock,
  createNumberedListItemBlock,
  createParagraphBlock,
  createQuoteBlock,
} from './blocks'
import type { Block } from './blocks'
import type {
  BlockJsonSchema,
  InlineNodeJsonSchema,
} from './document-json-schema'
import { createBaseMarks } from './marks'
import {
  createLineBreakNode,
  createLinkNode,
  createMentionNode,
  createTextNode,
} from './nodes'
import type { InlineNode } from './nodes'
import type { OperationsBuilderInitialMetadata } from './operations-builder'
import type { PosKey } from './position'
import { assertNever } from './utils'

/** Builds a {@link InlineNode} from JSON. */
export function createInlineNodeFromJson(
  jsonNode: InlineNodeJsonSchema,
  opts: { initialMetadata: OperationsBuilderInitialMetadata },
): InlineNode {
  const { type } = jsonNode
  switch (type) {
    case 'text': {
      return createTextNode({
        createdAt: jsonNode.createdAt
          ? new Date(jsonNode.createdAt)
          : undefined,
        marks: { ...createBaseMarks(), ...jsonNode.marks },
        metadata: jsonNode.metadata ?? opts.initialMetadata.text,
        text: jsonNode.text,
        updatedAt: jsonNode.updatedAt
          ? new Date(jsonNode.updatedAt)
          : undefined,
      })
    }
    case 'link': {
      return createLinkNode({
        createdAt: jsonNode.createdAt
          ? new Date(jsonNode.createdAt)
          : undefined,
        marks: { ...createBaseMarks(), ...jsonNode.marks },
        metadata: jsonNode.metadata ?? opts.initialMetadata.link,
        text: jsonNode.text,
        updatedAt: jsonNode.updatedAt
          ? new Date(jsonNode.updatedAt)
          : undefined,
        url: jsonNode.url,
      })
    }
    case 'mention': {
      return createMentionNode({
        createdAt: jsonNode.createdAt
          ? new Date(jsonNode.createdAt)
          : undefined,
        entity: {
          data: jsonNode.entity.data,
          id: jsonNode.entity.id,
        },
        metadata: jsonNode.metadata ?? opts.initialMetadata.mentions,
        updatedAt: jsonNode.updatedAt
          ? new Date(jsonNode.updatedAt)
          : undefined,
      })
    }
    case 'line_break': {
      return createLineBreakNode({
        createdAt: jsonNode.createdAt
          ? new Date(jsonNode.createdAt)
          : undefined,
        metadata: jsonNode.metadata ?? opts.initialMetadata.lineBreak,
        updatedAt: jsonNode.updatedAt
          ? new Date(jsonNode.updatedAt)
          : undefined,
      })
    }
    default: {
      assertNever(type, { hint: 'DocumentJson/createInlineNodeFromJson' })
    }
  }
}

/**
 * Maps a JSON inline array onto {@link InlineNode}s, in order.
 * An empty array is not a legal caret host, so we insert a single empty {@link TextNode}.
 */
export function createInlineContentFromJson(
  content: readonly InlineNodeJsonSchema[],
  opts: { initialMetadata: OperationsBuilderInitialMetadata },
): InlineNode[] {
  if (content.length === 0) {
    return [createTextNode({ metadata: opts.initialMetadata.text, text: '' })]
  }

  const nodes: InlineNode[] = []
  for (const json of content) {
    nodes.push(createInlineNodeFromJson(json, opts))
  }

  return nodes
}

/**
 * Builds a {@link Block} from JSON at the given {@link PosKey}.
 * Nested blocks are not supported yet.
 */
export function createBlockFromJson(
  jsonBlock: BlockJsonSchema,
  posKey: PosKey,
  opts: { initialMetadata: OperationsBuilderInitialMetadata },
): Block {
  const { type } = jsonBlock

  switch (type) {
    case 'paragraph': {
      return createParagraphBlock({
        content: createInlineContentFromJson(jsonBlock.content, opts),
        createdAt: jsonBlock.createdAt
          ? new Date(jsonBlock.createdAt)
          : undefined,
        metadata: jsonBlock.metadata ?? opts.initialMetadata.paragraph,
        posKey,
        updatedAt: jsonBlock.updatedAt
          ? new Date(jsonBlock.updatedAt)
          : undefined,
      })
    }
    case 'quote': {
      return createQuoteBlock({
        content: createInlineContentFromJson(jsonBlock.content, opts),
        createdAt: jsonBlock.createdAt
          ? new Date(jsonBlock.createdAt)
          : undefined,
        metadata: jsonBlock.metadata ?? opts.initialMetadata.quote,
        posKey,
        updatedAt: jsonBlock.updatedAt
          ? new Date(jsonBlock.updatedAt)
          : undefined,
      })
    }
    case 'heading': {
      return createHeadingBlock({
        content: createInlineContentFromJson(jsonBlock.content, opts),
        createdAt: jsonBlock.createdAt
          ? new Date(jsonBlock.createdAt)
          : undefined,
        level: jsonBlock.level,
        metadata: jsonBlock.metadata ?? opts.initialMetadata.heading,
        posKey,
        updatedAt: jsonBlock.updatedAt
          ? new Date(jsonBlock.updatedAt)
          : undefined,
      })
    }
    case 'bullet_list_item': {
      return createBulletListItemBlock({
        content: createInlineContentFromJson(jsonBlock.content, opts),
        createdAt: jsonBlock.createdAt
          ? new Date(jsonBlock.createdAt)
          : undefined,
        metadata: jsonBlock.metadata ?? opts.initialMetadata.bulletedList,
        posKey,
        updatedAt: jsonBlock.updatedAt
          ? new Date(jsonBlock.updatedAt)
          : undefined,
      })
    }
    case 'numbered_list_item': {
      return createNumberedListItemBlock({
        content: createInlineContentFromJson(jsonBlock.content, opts),
        createdAt: jsonBlock.createdAt
          ? new Date(jsonBlock.createdAt)
          : undefined,
        markerNumbering: jsonBlock.markerNumbering,
        metadata: jsonBlock.metadata ?? opts.initialMetadata.numberedList,
        posKey,
        updatedAt: jsonBlock.updatedAt
          ? new Date(jsonBlock.updatedAt)
          : undefined,
        variant: jsonBlock.variant,
      })
    }
    case 'checkbox_list_item': {
      return createCheckboxListItemBlock({
        checked: jsonBlock.checked,
        content: createInlineContentFromJson(jsonBlock.content, opts),
        createdAt: jsonBlock.createdAt
          ? new Date(jsonBlock.createdAt)
          : undefined,
        metadata: jsonBlock.metadata ?? opts.initialMetadata.checkboxList,
        posKey,
        updatedAt: jsonBlock.updatedAt
          ? new Date(jsonBlock.updatedAt)
          : undefined,
      })
    }
    case 'divider': {
      return createDividerBlock({
        createdAt: jsonBlock.createdAt
          ? new Date(jsonBlock.createdAt)
          : undefined,
        metadata: jsonBlock.metadata ?? opts.initialMetadata.divider,
        posKey,
        updatedAt: jsonBlock.updatedAt
          ? new Date(jsonBlock.updatedAt)
          : undefined,
      })
    }
    default: {
      assertNever(type, { hint: 'DocumentJson/createBlockFromJson' })
    }
  }
}
