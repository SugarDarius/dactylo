/**
 * JSON → runtime nodes and blocks.
 *
 * The schema is a content dump, not an identity snapshot: no IDs, and nested
 * `parentId` is not wired up yet. These helpers mint new identities and always
 * parent at the root. Callers (document init) own `posKey`.
 */

import type {
  BBM,
  CBM,
  DBM,
  HBM,
  LBNM,
  LNM,
  MNED,
  MNM,
  NBM,
  PBM,
  QBM,
  TNM,
} from './augmentation'
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
import {
  createLineBreakNode,
  createLinkNode,
  createMentionNode,
  createTextNode,
} from './nodes'
import type { InlineNode } from './nodes'
import type { PosKey } from './position'
import { assertNever } from './utils'

/** Builds a {@link InlineNode} from JSON. */
export function createInlineNodeFromJson(
  jsonNode: InlineNodeJsonSchema,
): InlineNode {
  const { type } = jsonNode
  switch (type) {
    case 'text': {
      return createTextNode({
        marks: jsonNode.marks,
        metadata: jsonNode.metadata as TNM,
        text: jsonNode.text,
      })
    }
    case 'link': {
      return createLinkNode({
        marks: jsonNode.marks,
        metadata: jsonNode.metadata as LNM,
        text: jsonNode.text,
        url: jsonNode.url,
      })
    }
    case 'mention': {
      return createMentionNode({
        entity: {
          data: jsonNode.entity.data as MNED,
          id: jsonNode.entity.id,
        },
        metadata: jsonNode.metadata as MNM,
      })
    }
    case 'line_break': {
      return createLineBreakNode({
        metadata: jsonNode.metadata as LBNM,
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
  textMetadata: TNM,
): InlineNode[] {
  if (content.length === 0) {
    return [createTextNode({ metadata: textMetadata, text: '' })]
  }

  const nodes: InlineNode[] = []
  for (const json of content) {
    nodes.push(createInlineNodeFromJson(json))
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
  opts: { textMetadata: TNM },
): Block {
  const { type } = jsonBlock

  switch (type) {
    case 'paragraph': {
      return createParagraphBlock({
        content: createInlineContentFromJson(
          jsonBlock.content,
          opts.textMetadata,
        ),
        metadata: jsonBlock.metadata as PBM,
        posKey,
      })
    }
    case 'quote': {
      return createQuoteBlock({
        content: createInlineContentFromJson(
          jsonBlock.content,
          opts.textMetadata,
        ),
        metadata: jsonBlock.metadata as QBM,
        posKey,
      })
    }
    case 'heading': {
      return createHeadingBlock({
        content: createInlineContentFromJson(
          jsonBlock.content,
          opts.textMetadata,
        ),
        level: jsonBlock.level,
        metadata: jsonBlock.metadata as HBM,
        posKey,
      })
    }
    case 'bullet_list_item': {
      return createBulletListItemBlock({
        content: createInlineContentFromJson(
          jsonBlock.content,
          opts.textMetadata,
        ),
        metadata: jsonBlock.metadata as BBM,
        posKey,
      })
    }
    case 'numbered_list_item': {
      return createNumberedListItemBlock({
        content: createInlineContentFromJson(
          jsonBlock.content,
          opts.textMetadata,
        ),
        markerNumbering: jsonBlock.markerNumbering,
        metadata: jsonBlock.metadata as NBM,
        posKey,
        variant: jsonBlock.variant,
      })
    }
    case 'checkbox_list_item': {
      return createCheckboxListItemBlock({
        checked: jsonBlock.checked,
        content: createInlineContentFromJson(
          jsonBlock.content,
          opts.textMetadata,
        ),
        metadata: jsonBlock.metadata as CBM,
        posKey,
      })
    }
    case 'divider': {
      return createDividerBlock({
        metadata: jsonBlock.metadata as DBM,
        posKey,
      })
    }
    default: {
      assertNever(type, { hint: 'DocumentJson/createBlockFromJson' })
    }
  }
}
