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
import { DactyloError } from './errors'
import type { Marks } from './marks'
import type { JsonObject, Metadata } from './types'
import { assertNever, isJsonObject, isJsonValue, isPlainObject } from './utils'

/** JSON schema for {@link Marks}. */
export type MarksJsonSchema = Partial<Marks>

/** JSON schema for {@link INode}. */
export interface INodeJsonSchema<M extends Metadata = Metadata> {
  /** Date as string in ISO format When the node was created.  */
  readonly createdAt?: string

  /** Date as string in ISO format When the node was last updated. */
  readonly updatedAt?: string | null

  /** Custom metadata defined by developers. */
  readonly metadata?: M
}

/** JSON schema for {@link TextNode}. */
export interface TextNodeJsonSchema extends INodeJsonSchema<TNM> {
  readonly type: 'text'

  /** Text content of the node. */
  readonly text: string

  /** Marks decorating the text content */
  readonly marks?: MarksJsonSchema
}

/** JSON schema for {@link LinkNode}. */
export interface LinkNodeJsonSchema extends INodeJsonSchema<LNM> {
  readonly type: 'link'

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
  readonly marks?: MarksJsonSchema
}

/** JSON schema for {@link MentionNode}. */
export interface MentionNodeJsonSchema extends INodeJsonSchema<MNM> {
  readonly type: 'mention'

  /** Entity related to the mention. */
  readonly entity: {
    /** Id referencing the mention's entity in the code. */
    readonly id: string

    /** Developer-provided additional JSON structured data to store with the mention's entity. */
    readonly data: MNED
  }
}

/** JSON schema for {@link LineBreakNode}. */
export interface LineBreakNodeJsonSchema extends INodeJsonSchema<LBNM> {
  readonly type: 'line_break'
}

/** JSON schema for {@link InlineNode}. */
export type InlineNodeJsonSchema =
  | TextNodeJsonSchema
  | LinkNodeJsonSchema
  | MentionNodeJsonSchema
  | LineBreakNodeJsonSchema

/** JSON schema for {@link IBlock}. */
export interface IBlockJsonSchema<M extends Metadata = Metadata> {
  /** Parent block identifier with nested blocks like list or quotes. */
  readonly parentId?: string | null

  /** Date as string in ISO format When the block was created.  */
  readonly createdAt?: string

  /** Date as string in ISO format When the block was last updated. */
  readonly updatedAt?: string | null

  /** Custom metadata defined by developers. */
  readonly metadata?: M
}

/** JSON schema for {@link IBlockWithInlineContext}. */
export interface IBlockWithInlineContextJsonSchema<
  M extends Metadata = Metadata,
> extends IBlockJsonSchema<M> {
  /** Inline content tree for the block. */
  readonly content: readonly InlineNodeJsonSchema[]
}

/** JSON schema for {@link HeadingBlock}. */
export interface HeadingBlockJsonSchema extends IBlockWithInlineContextJsonSchema<HBM> {
  readonly type: 'heading'

  /** Level of the heading. */
  readonly level: 1 | 2 | 3 | 4 | 5 | 6
}

/** JSON schema for {@link ParagraphBlock}. */
export interface ParagraphBlockJsonSchema extends IBlockWithInlineContextJsonSchema<PBM> {
  readonly type: 'paragraph'
}

/** JSON schema for {@link QuoteBlock}. */
export interface QuoteBlockJsonSchema extends IBlockWithInlineContextJsonSchema<QBM> {
  readonly type: 'quote'
}

/** JSON schema for {@link BulletListItemBlock}. */
export interface BulletListItemBlockJsonSchema extends IBlockWithInlineContextJsonSchema<BBM> {
  readonly type: 'bullet_list_item'
}

/** JSON schema for {@link NumberedListItemBlock}. */
export interface NumberedListItemBlockJsonSchema extends IBlockWithInlineContextJsonSchema<NBM> {
  readonly type: 'numbered_list_item'

  /** Variant to use in order to display item marker. */
  readonly variant: 'default' | 'alpha' | 'roman'

  /** Marker numbering for this item (`1.`, `a.`, `ii.`). */
  readonly markerNumbering: string
}

/** JSON schema for {@link CheckboxListItemBlock}. */
export interface CheckboxListItemBlockJsonSchema extends IBlockWithInlineContextJsonSchema<CBM> {
  readonly type: 'checkbox_list_item'

  /** Whether the item is checked. */
  readonly checked: boolean
}

/** JSON schema for {@link DividerBlock}. */
export interface DividerBlockJsonSchema extends IBlockJsonSchema<DBM> {
  readonly type: 'divider'
}

/** JSON schema for {@link Block}. */
export type BlockJsonSchema =
  | HeadingBlockJsonSchema
  | ParagraphBlockJsonSchema
  | QuoteBlockJsonSchema
  | BulletListItemBlockJsonSchema
  | NumberedListItemBlockJsonSchema
  | CheckboxListItemBlockJsonSchema
  | DividerBlockJsonSchema

/** Document JSON schema. */
export interface DocumentJsonSchema {
  /** Blocks in the document. */
  readonly blocks: readonly BlockJsonSchema[]
}

/** Throws a {@link DactyloError} when document JSON schema validation fails. */
export function documentJsonSchemaError(
  message: string,
  payload?: Record<string, unknown>,
): never {
  throw DactyloError.from({
    code: 'DESERIALIZE_DOCUMENT_JSON_SCHEMA',
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
    documentJsonSchemaError(`${label} must be a string.`, payload)
  }
}

/** Throws if `value` is not a boolean. */
export function expectBoolean(
  value: unknown,
  label: string,
  payload: Record<string, unknown>,
): asserts value is boolean {
  if (typeof value !== 'boolean') {
    documentJsonSchemaError(`${label} must be a boolean.`, payload)
  }
}

/** Throws if `value` is neither a string nor `null`. */
export function expectStringOrNull(
  value: unknown,
  label: string,
  payload: Record<string, unknown>,
): asserts value is string | null {
  if (value !== null && typeof value !== 'string') {
    documentJsonSchemaError(`${label} must be a string or null.`, payload)
  }
}

/** Throws if `value` is not a {@link JsonObject}. */
export function expectJsonObject(
  value: unknown,
  label: string,
  payload: Record<string, unknown>,
): asserts value is JsonObject {
  if (!isJsonObject(value)) {
    documentJsonSchemaError(`${label} must be a JSON object.`, payload)
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
): value is NumberedListItemBlockJsonSchema['variant'] {
  return value === 'default' || value === 'alpha' || value === 'roman'
}

/** Whether the value is a known inline node `type`. */
export function isInlineNodeType(
  value: unknown,
): value is InlineNodeJsonSchema['type'] {
  return (
    value === 'text' ||
    value === 'link' ||
    value === 'mention' ||
    value === 'line_break'
  )
}

/** Whether the value is a known block `type`. */
export function isBlockType(value: unknown): value is BlockJsonSchema['type'] {
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

/** Throws if `value` is not a valid {@link MarksJsonSchema}. */
export function validateMarks(
  value: unknown,
  payload: Record<string, unknown>,
): asserts value is MarksJsonSchema {
  if (!isPlainObject(value)) {
    documentJsonSchemaError('Marks must be a plain object.', payload)
  }

  expectBoolean(value.bold, 'marks.bold', payload)
  expectBoolean(value.code, 'marks.code', payload)
  expectBoolean(value.italic, 'marks.italic', payload)
  expectBoolean(value.strikethrough, 'marks.strikethrough', payload)
  expectBoolean(value.underline, 'marks.underline', payload)
}

/** Checks the shared `createdAt`, `updatedAt`, and `metadata` fields on a node. */
export function validateINodeFields(
  value: Record<string, unknown>,
  payload: Record<string, unknown>,
): void {
  expectString(value.createdAt, 'createdAt', payload)
  expectStringOrNull(value.updatedAt, 'updatedAt', payload)
  expectJsonObject(value.metadata, 'metadata', payload)
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

/** Throws if `value` is not a valid {@link InlineNodeJsonSchema}. */
export function validateInlineNode(
  value: unknown,
): asserts value is InlineNodeJsonSchema {
  if (!isPlainObject(value)) {
    documentJsonSchemaError('Inline node must be a plain object.', {
      node: value,
    })
  }

  const payload = { node: value }
  validateINodeFields(value, payload)

  const { type } = value
  if (!isInlineNodeType(type)) {
    documentJsonSchemaError('Unknown inline node type.', payload)
  }

  switch (type) {
    case 'text': {
      expectString(value.text, 'text', payload)
      validateMarks(value.marks, payload)
      break
    }
    case 'link': {
      expectString(value.text, 'text', payload)
      validateMarks(value.marks, payload)
      if (!isPlainObject(value.url)) {
        documentJsonSchemaError('Link url must be a plain object.', payload)
      }
      expectString(value.url.href, 'url.href', payload)
      expectString(value.url.title, 'url.title', payload)
      break
    }
    case 'mention': {
      if (!isPlainObject(value.entity)) {
        documentJsonSchemaError(
          'Mention entity must be a plain object.',
          payload,
        )
      }
      expectString(value.entity.id, 'entity.id', payload)
      if (!isJsonValue(value.entity.data)) {
        documentJsonSchemaError('entity.data must be a JSON value.', payload)
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
): asserts value is readonly InlineNodeJsonSchema[] {
  if (!Array.isArray(value)) {
    documentJsonSchemaError(
      'Block content must be an array of inline nodes.',
      payload,
    )
  }

  for (const node of value) {
    validateInlineNode(node)
  }
}

/** Throws if `value` is not a valid {@link BlockJsonSchema}. */
export function validateBlock(
  value: unknown,
): asserts value is BlockJsonSchema {
  if (!isPlainObject(value)) {
    documentJsonSchemaError('Block must be a plain object.', { block: value })
  }

  const payload = { block: value }
  validateIBlockFields(value, payload)

  const { type } = value
  if (!isBlockType(type)) {
    documentJsonSchemaError('Unknown block type.', payload)
  }

  switch (type) {
    case 'heading': {
      if (!isHeadingLevel(value.level)) {
        documentJsonSchemaError(
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
        documentJsonSchemaError(
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
 * Walks an unknown JSON payload and checks it matches {@link DocumentJsonSchema}.
 *
 * Empty `blocks` is fine. Extra keys are ignored.
 * Throws a {@link DactyloError} when the shape is wrong.
 */
export function validateDocumentJsonSchema(
  json: unknown,
): asserts json is DocumentJsonSchema {
  if (!isPlainObject(json) || !Array.isArray(json.blocks)) {
    documentJsonSchemaError(
      'Document JSON schema must contain an array of blocks.',
      {
        json,
      },
    )
  }

  for (const block of json.blocks) {
    validateBlock(block)
  }
}
