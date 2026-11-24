import {
  createBulletListItemBlock,
  createCheckboxListItemBlock,
  createDividerBlock,
  createHeadingBlock,
  createNumberedListItemBlock,
  createParagraphBlock,
  createQuoteBlock,
} from './blocks'
import type {
  Block,
  BulletListItemBlock,
  CheckboxListItemBlock,
  DividerBlock,
  HeadingBlock,
  NumberedListItemBlock,
  ParagraphBlock,
  QuoteBlock,
} from './blocks'
import type {
  ToContentJsonInput,
  ToJsonInput,
  ToMarksJsonInput,
} from './document-json-schema'
import { DactyloError } from './errors'
import { createBaseMarks } from './marks'
import type { Marks } from './marks'
import {
  createLineBreakNode,
  createLinkNode,
  createMentionNode,
  createTextNode,
} from './nodes'
import type {
  InlineNode,
  LineBreakNode,
  LinkNode,
  MentionNode,
  TextNode,
} from './nodes'
import type { OperationsBuilderInitialMetadata } from './operations-builder'
import type { PosKey } from './position'
import type { JsonObject } from './types'
import { assertNever, isJsonObject, isJsonValue, isPlainObject } from './utils'

/** JSON input schema for {@link TextNode}. */
export type TextNodeJsonInput = ToMarksJsonInput<ToJsonInput<TextNode>>

/** JSON input schema for {@link LinkNode}. */
export type LinkNodeJsonInput = ToMarksJsonInput<ToJsonInput<LinkNode>>

/** JSON input schema for {@link MentionNode}. */
export type MentionNodeJsonInput = ToJsonInput<MentionNode>

/** JSON input schema for {@link LineBreakNode}. */
export type LineBreakNodeJsonInput = ToJsonInput<LineBreakNode>

/** JSON input schema for {@link InlineNode}. */
export type InlineNodeJsonInput =
  | TextNodeJsonInput
  | LinkNodeJsonInput
  | MentionNodeJsonInput
  | LineBreakNodeJsonInput

/** JSON input schema for {@link HeadingBlock}. */
export type HeadingBlockJsonInput = ToContentJsonInput<
  ToJsonInput<HeadingBlock>,
  InlineNodeJsonInput
>

/** JSON input schema for {@link ParagraphBlock}. */
export type ParagraphBlockJsonInput = ToContentJsonInput<
  ToJsonInput<ParagraphBlock>,
  InlineNodeJsonInput
>

/** JSON input schema for {@link QuoteBlock}. */
export type QuoteBlockJsonInput = ToContentJsonInput<
  ToJsonInput<QuoteBlock>,
  InlineNodeJsonInput
>

/** JSON input schema for {@link BulletListItemBlock}. */
export type BulletListItemBlockJsonInput = ToContentJsonInput<
  ToJsonInput<BulletListItemBlock>,
  InlineNodeJsonInput
>

/** JSON input schema for {@link NumberedListItemBlock}. */
export type NumberedListItemBlockJsonInput = ToContentJsonInput<
  ToJsonInput<NumberedListItemBlock>,
  InlineNodeJsonInput
>

/** JSON input schema for {@link CheckboxListItemBlock}. */
export type CheckboxListItemBlockJsonInput = ToContentJsonInput<
  ToJsonInput<CheckboxListItemBlock>,
  InlineNodeJsonInput
>

/** JSON input schema for {@link DividerBlock}. */
export type DividerBlockJsonInput = ToJsonInput<DividerBlock>

/** JSON input schema for {@link Block}. */
export type BlockJsonInput =
  | HeadingBlockJsonInput
  | ParagraphBlockJsonInput
  | QuoteBlockJsonInput
  | BulletListItemBlockJsonInput
  | NumberedListItemBlockJsonInput
  | CheckboxListItemBlockJsonInput
  | DividerBlockJsonInput

/**
 * `DocumentJsonInput` is the JSON schema provided to {@link Dactylo} as initial content
 * when the document already exists somewhere as data.
 *
 * It's the inbound contract for `new Dactylo({ initialContent })`:
 *  a JSON-serializable tree of blocks that the editor can turn into a live
 *  {@link DocumentState}. You describe the content. Dactylo fills in the rest.
 *
 * It's not {@link DocumentState}. That type lives in RAM — `Map`s, branded
 * IDs (`bl_…`), `Date` objects, fractional `posKey`s. You cannot put those
 * on the wire, and you should not mint them yourself.
 *
 *
 * ```md
 * JSON from a DB / API / file
 *        │
 *        ▼
 * DocumentJsonInput   ← this type
 *   { blocks: [ { type, content, … } ] }
 *        │
 *        ▼
 * validateDocumentJsonInput()     ← shape check, throws on bad JSON
 *        │
 *        ▼
 * buildInitialDocumentOps()
 *   createBlockFromJsonInput()    ← mints id, posKey, Date
 *   insert_block, insert_block, …
 *        │
 *        ▼
 * DocumentState / EditorContext   ← the in-memory source of truth
 * ```
 *
 * What you write vs what Dactylo owns:
 *
 * | Field              | In this JSON                         | After import into {@link DocumentState}      |
 * |--------------------|--------------------------------------|----------------------------------------------|
 * | Block / node `id`  | omitted — you never send it          | minted (`bl_…`, `nd_…`)                      |
 * | `posKey`           | omitted                              | minted (fractional index for sort order)     |
 * | `type`             | `"paragraph"`, `"text"`, …           | becomes `__type` on the live object          |
 * | `createdAt`        | optional ISO string                  | a `Date` (now, if you omitted it)            |
 * | `blocks`           | a plain array, top to bottom         | a `Map` + `blockOrderById`                   |
 *
 * Why does it exist?
 * 👉🏻 Without `DocumentJsonInput`, seeding the editor from structured data would mean one of two bad options:
 *
 * | You have…               | Why it fails as `initialContent`              | How this type solves it                  |
 * |-------------------------|-----------------------------------------------|------------------------------------------|
 * | A {@link DocumentState} | `Map`, `Date`, branded ids aren't JSON        | Plain objects + ISO strings              |
 * | Ad-hoc JSON             | No schema, silent shape bugs at runtime       | {@link validateDocumentJsonInput} throws |
 *
 * Empty `blocks` is allowed: Dactylo then starts from a single empty
 * paragraph, same as omitting `initialContent`. Extra keys are ignored.
 *
 *
 * Nested blocks (`parentId`) are not supported yet.
 *
 * @example
 * ```ts
 * new Dactylo({
 *   initialContent: {
 *     blocks: [
 *       {
 *         type: 'heading',
 *         level: 1,
 *         content: [{ type: 'text', text: 'Hello' }],
 *       },
 *       {
 *         type: 'paragraph',
 *         content: [
 *           { type: 'text', text: 'World', marks: { bold: true } },
 *         ],
 *       },
 *     ],
 *   },
 * })
 * ```
 */
export interface DocumentJsonInput {
  /** Blocks in the document, top to bottom. */
  readonly blocks: readonly BlockJsonInput[]
}

/** Throws a {@link DactyloError} when document JSON input schema validation fails. */
export function documentJsonInputError(
  message: string,
  payload?: Record<string, unknown>,
): never {
  throw DactyloError.from({
    code: 'DESERIALIZE_DOCUMENT_JSON_INPUT',
    message,
    payload,
  })
}

/** Throws if `value` is not a string. */
export function expectString(
  value: unknown,
  label: string,
  payload: Record<string, unknown>,
): asserts value is string {
  if (typeof value !== 'string') {
    documentJsonInputError(`${label} must be a string.`, payload)
  }
}

/** Throws if `value` is not a boolean. */
export function expectBoolean(
  value: unknown,
  label: string,
  payload: Record<string, unknown>,
): asserts value is boolean {
  if (typeof value !== 'boolean') {
    documentJsonInputError(`${label} must be a boolean.`, payload)
  }
}

/** Throws if `value` is neither a string nor `null`. */
export function expectStringOrNull(
  value: unknown,
  label: string,
  payload: Record<string, unknown>,
): asserts value is string | null {
  if (value !== null && typeof value !== 'string') {
    documentJsonInputError(`${label} must be a string or null.`, payload)
  }
}

/** Throws if `value` is not a {@link JsonObject}. */
export function expectJsonObject(
  value: unknown,
  label: string,
  payload: Record<string, unknown>,
): asserts value is JsonObject {
  if (!isJsonObject(value)) {
    documentJsonInputError(`${label} must be a JSON object.`, payload)
  }
}

/** Whether the value is a heading level (`1`–`6`). */
export function isHeadingLevel(value: unknown): value is 1 | 2 | 3 | 4 | 5 | 6 {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 6
  )
}

/** Whether the value is a numbered list marker variant (`default`, `alpha`, `roman`). */
export function isNumberedListVariant(
  value: unknown,
): value is NumberedListItemBlockJsonInput['variant'] {
  return value === 'default' || value === 'alpha' || value === 'roman'
}

/** Whether the value is a known inline node `type`. */
export function isInlineNodeType(
  value: unknown,
): value is InlineNodeJsonInput['type'] {
  return (
    value === 'text' ||
    value === 'link' ||
    value === 'mention' ||
    value === 'line_break'
  )
}

/** Whether the value is a known block `type`. */
export function isBlockType(value: unknown): value is BlockJsonInput['type'] {
  return (
    value === 'heading' ||
    value === 'paragraph' ||
    value === 'quote' ||
    value === 'bullet_list_item' ||
    value === 'numbered_list_item' ||
    value === 'checkbox_list_item' ||
    value === 'divider'
  )
}

/** Throws if `value` is not a valid {@link MarksJsonInput}. */
export function validateMarks(
  value: unknown,
  payload: Record<string, unknown>,
): asserts value is Partial<Marks> {
  if (!isPlainObject(value)) {
    documentJsonInputError('Marks must be a plain object.', payload)
  }

  if (value.bold !== undefined) {
    expectBoolean(value.bold, 'marks.bold', payload)
  }
  if (value.code !== undefined) {
    expectBoolean(value.code, 'marks.code', payload)
  }
  if (value.italic !== undefined) {
    expectBoolean(value.italic, 'marks.italic', payload)
  }
  if (value.strikethrough !== undefined) {
    expectBoolean(value.strikethrough, 'marks.strikethrough', payload)
  }
  if (value.underline !== undefined) {
    expectBoolean(value.underline, 'marks.underline', payload)
  }
}

/** Checks the shared `createdAt`, `updatedAt`, and `metadata` fields on a node. */
export function validateINodeFields(
  value: Record<string, unknown>,
  payload: Record<string, unknown>,
): void {
  if (value.createdAt !== undefined) {
    expectString(value.createdAt, 'createdAt', payload)
  }
  if (value.updatedAt !== undefined) {
    expectStringOrNull(value.updatedAt, 'updatedAt', payload)
  }
  if (value.metadata !== undefined) {
    expectJsonObject(value.metadata, 'metadata', payload)
  }
}

/** Checks the shared block fields, including `parentId`. */
export function validateIBlockFields(
  value: Record<string, unknown>,
  payload: Record<string, unknown>,
): void {
  if (value.parentId !== undefined) {
    expectStringOrNull(value.parentId, 'parentId', payload)
  }
  validateINodeFields(value, payload)
}

/** Throws if `value` is not a valid {@link InlineNodeJsonInput}. */
export function validateInlineNode(
  value: unknown,
): asserts value is InlineNodeJsonInput {
  if (!isPlainObject(value)) {
    documentJsonInputError('Inline node must be a plain object.', {
      node: value,
    })
  }

  const payload = { node: value }
  validateINodeFields(value, payload)

  const { type } = value
  if (!isInlineNodeType(type)) {
    documentJsonInputError('Unknown inline node type.', payload)
  }

  switch (type) {
    case 'text': {
      expectString(value.text, 'text', payload)
      if (value.marks !== undefined) {
        validateMarks(value.marks, payload)
      }
      break
    }
    case 'link': {
      expectString(value.text, 'text', payload)
      if (value.marks !== undefined) {
        validateMarks(value.marks, payload)
      }
      if (!isPlainObject(value.url)) {
        documentJsonInputError('Link url must be a plain object.', payload)
      }
      expectString(value.url.href, 'url.href', payload)
      expectString(value.url.title, 'url.title', payload)
      break
    }
    case 'mention': {
      if (!isPlainObject(value.entity)) {
        documentJsonInputError(
          'Mention entity must be a plain object.',
          payload,
        )
      }
      expectString(value.entity.id, 'entity.id', payload)
      if (!isJsonValue(value.entity.data)) {
        documentJsonInputError('entity.data must be a JSON value.', payload)
      }
      break
    }
    case 'line_break': {
      break
    }
    default: {
      assertNever(type, { hint: 'DocumentJsonSchema/validateInlineNode' })
    }
  }
}

/** Throws if `value` is not an array of inline nodes. */
export function validateInlineContent(
  value: unknown,
  payload: Record<string, unknown>,
): asserts value is readonly InlineNodeJsonInput[] {
  if (!Array.isArray(value)) {
    documentJsonInputError(
      'Block content must be an array of inline nodes.',
      payload,
    )
  }

  for (const node of value) {
    validateInlineNode(node)
  }
}

/** Throws if `value` is not a valid {@link BlockJsonInput}. */
export function validateBlock(value: unknown): asserts value is BlockJsonInput {
  if (!isPlainObject(value)) {
    documentJsonInputError('Block must be a plain object.', {
      block: value,
    })
  }

  const payload = { block: value }
  validateIBlockFields(value, payload)

  const { type } = value
  if (!isBlockType(type)) {
    documentJsonInputError('Unknown block type.', payload)
  }

  switch (type) {
    case 'heading': {
      if (!isHeadingLevel(value.level)) {
        documentJsonInputError(
          'Heading level must be an integer between 1 and 6.',
          payload,
        )
      }
      validateInlineContent(value.content, payload)
      break
    }
    case 'paragraph':
    case 'quote':
    case 'bullet_list_item': {
      validateInlineContent(value.content, payload)
      break
    }
    case 'numbered_list_item': {
      if (!isNumberedListVariant(value.variant)) {
        documentJsonInputError(
          'Numbered list variant must be default, alpha, or roman.',
          payload,
        )
      }
      expectString(value.markerNumbering, 'markerNumbering', payload)
      validateInlineContent(value.content, payload)
      break
    }
    case 'checkbox_list_item': {
      expectBoolean(value.checked, 'checked', payload)
      validateInlineContent(value.content, payload)
      break
    }
    case 'divider': {
      break
    }
    default: {
      assertNever(type, { hint: 'DocumentJsonSchema/validateBlock' })
    }
  }
}

/**
 * Walks an unknown JSON payload and checks it matches {@link DocumentJsonInput}.
 *
 * Empty `blocks` is fine. Extra keys are ignored.
 * Optional fields (`createdAt`, `updatedAt`, `metadata`, `marks`) may be omitted.
 * Throws a {@link DactyloError} when the shape is wrong.
 */
export function validateDocumentJsonInput(
  json: unknown,
): asserts json is DocumentJsonInput {
  if (!isPlainObject(json) || !Array.isArray(json.blocks)) {
    documentJsonInputError(
      'Document JSON input schema input must contain an array of blocks.',
      {
        json,
      },
    )
  }

  for (const block of json.blocks) {
    validateBlock(block)
  }
}

/** Builds a {@link InlineNode} from JSON. */
export function createInlineNodeFromJsonInput(
  jsonNode: InlineNodeJsonInput,
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
export function createInlineContentFromJsonInput(
  content: readonly InlineNodeJsonInput[],
  opts: { initialMetadata: OperationsBuilderInitialMetadata },
): InlineNode[] {
  if (content.length <= 0) {
    return [createTextNode({ metadata: opts.initialMetadata.text, text: '' })]
  }

  const nodes: InlineNode[] = []
  for (const json of content) {
    nodes.push(createInlineNodeFromJsonInput(json, opts))
  }

  return nodes
}

/**
 * Builds a {@link Block} from JSON at the given {@link PosKey}.
 * Nested blocks are not supported yet.
 */
export function createBlockFromJsonInput(
  jsonBlock: BlockJsonInput,
  posKey: PosKey,
  opts: { initialMetadata: OperationsBuilderInitialMetadata },
): Block {
  const { type } = jsonBlock

  switch (type) {
    case 'paragraph': {
      return createParagraphBlock({
        content: createInlineContentFromJsonInput(jsonBlock.content, opts),
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
        content: createInlineContentFromJsonInput(jsonBlock.content, opts),
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
        content: createInlineContentFromJsonInput(jsonBlock.content, opts),
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
        content: createInlineContentFromJsonInput(jsonBlock.content, opts),
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
        content: createInlineContentFromJsonInput(jsonBlock.content, opts),
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
        content: createInlineContentFromJsonInput(jsonBlock.content, opts),
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
