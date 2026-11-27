import { describe, expectTypeOf, test } from 'vitest'

import { Dactylo } from '../../src/dactylo'
import type { DactyloOptions } from '../../src/dactylo'
import type {
  BBM,
  CBM,
  HBM,
  InlineNodeJsonInput,
  InsertBlockSpec,
  Metadata,
  NBM,
  PatchBlockSpec,
  PatchMetadataPolicy,
  PBM,
  TNM,
} from '../../src/index'
import { isParagraphBlock } from '../../src/internals/blocks'
import type { BlockId, ParagraphBlock } from '../../src/internals/blocks'
import { createTextNode, isTextNode } from '../../src/internals/nodes'
import type { TextNode } from '../../src/internals/nodes'
import type { WithUnless } from '../../src/internals/types'

describe('metadata aliases', () => {
  test('default block and node metadata is the open Metadata bag', () => {
    expectTypeOf<ParagraphBlock['metadata']>().toEqualTypeOf<Metadata>()
    expectTypeOf<ParagraphBlock['metadata']>().toEqualTypeOf<PBM>()
    expectTypeOf<TextNode['metadata']>().toEqualTypeOf<Metadata>()
    expectTypeOf<TextNode['metadata']>().toEqualTypeOf<TNM>()
  })

  test('block commands use the per-type metadata aliases', () => {
    const editor = new Dactylo()

    expectTypeOf(editor.blocks.commands.insert)
      .parameter(0)
      .toExtend<{ spec: InsertBlockSpec; pos?: unknown }>()
    expectTypeOf(
      editor.blocks.commands.insert,
    ).returns.toEqualTypeOf<BlockId | null>()
    expectTypeOf<Extract<InsertBlockSpec, { type: 'paragraph' }>>().toExtend<{
      type: 'paragraph'
      content?: InlineNodeJsonInput[]
      metadata?: PBM
    }>()
    expectTypeOf(editor.blocks.commands.patch)
      .parameter(0)
      .toExtend<{ spec: PatchBlockSpec; blockId: unknown }>()
    expectTypeOf(editor.blocks.commands.patch).returns.toEqualTypeOf<boolean>()
    expectTypeOf<Extract<PatchBlockSpec, { type: 'paragraph' }>>().toExtend<{
      type: 'paragraph'
      content?: InlineNodeJsonInput[]
      metadata?: { value: PBM; policy?: PatchMetadataPolicy }
    }>()
    expectTypeOf(editor.blocks.commands.delete).returns.toEqualTypeOf<boolean>()
    expectTypeOf(
      editor.blocks.commands.duplicate,
    ).returns.toEqualTypeOf<boolean>()
    expectTypeOf(editor.blocks.commands.move).returns.toEqualTypeOf<boolean>()
    expectTypeOf(editor.blocks.commands.mutate)
      .parameter(1)
      .extract<{ kind: 'to_paragraph' }>()
      .toExtend<{ kind: 'to_paragraph'; metadata?: PBM }>()
    expectTypeOf(editor.blocks.commands.mutate)
      .parameter(1)
      .extract<{ kind: 'to_heading' }>()
      .toExtend<{ kind: 'to_heading'; level: unknown; metadata?: HBM }>()
    expectTypeOf(editor.blocks.commands.mutate).returns.toEqualTypeOf<boolean>()
    expectTypeOf(
      editor.nodes.commands.insertText,
    ).returns.toEqualTypeOf<boolean>()
    expectTypeOf(
      editor.nodes.commands.insertTextAt,
    ).returns.toEqualTypeOf<boolean>()

    expectTypeOf<Extract<InsertBlockSpec, { type: 'heading' }>>().toExtend<{
      type: 'heading'
      level: unknown
      metadata?: HBM
    }>()
    expectTypeOf<Extract<PatchBlockSpec, { type: 'heading' }>>().toExtend<{
      type: 'heading'
      level?: unknown
      content?: InlineNodeJsonInput[]
      metadata?: { value: HBM; policy?: PatchMetadataPolicy }
    }>()

    expectTypeOf<Extract<InsertBlockSpec, { type: 'quote' }>>().toExtend<{
      type: 'quote'
      metadata?: Metadata
    }>()
    expectTypeOf<
      Extract<InsertBlockSpec, { type: 'bullet_list_item' }>
    >().toExtend<{ type: 'bullet_list_item' }>()
    expectTypeOf<
      Extract<InsertBlockSpec, { type: 'numbered_list_item' }>
    >().toExtend<{ type: 'numbered_list_item' }>()
    expectTypeOf<
      Extract<InsertBlockSpec, { type: 'checkbox_list_item' }>
    >().toExtend<{ type: 'checkbox_list_item' }>()
    expectTypeOf<Extract<InsertBlockSpec, { type: 'divider' }>>().toExtend<{
      type: 'divider'
      metadata?: Metadata
    }>()
    expectTypeOf<Extract<PatchBlockSpec, { type: 'quote' }>>().toExtend<{
      type: 'quote'
      metadata?: { value: Metadata; policy?: PatchMetadataPolicy }
    }>()
    expectTypeOf<
      Extract<PatchBlockSpec, { type: 'bullet_list_item' }>
    >().toExtend<{
      type: 'bullet_list_item'
      metadata?: { value: BBM; policy?: PatchMetadataPolicy }
    }>()
    expectTypeOf<
      Extract<PatchBlockSpec, { type: 'numbered_list_item' }>
    >().toExtend<{
      type: 'numbered_list_item'
      metadata?: { value: NBM; policy?: PatchMetadataPolicy }
    }>()
    expectTypeOf<
      Extract<PatchBlockSpec, { type: 'checkbox_list_item' }>
    >().toExtend<{
      type: 'checkbox_list_item'
      metadata?: { value: CBM; policy?: PatchMetadataPolicy }
    }>()
    expectTypeOf<Extract<PatchBlockSpec, { type: 'divider' }>>().toExtend<{
      type: 'divider'
      metadata?: { value: Metadata; policy?: PatchMetadataPolicy }
    }>()
  })

  test('getContext plus isParagraphBlock uses PBM', () => {
    const editor = new Dactylo()
    const block = editor.getContext().state.blocks.values().next().value

    if (block && isParagraphBlock(block)) {
      expectTypeOf(block.metadata).toEqualTypeOf<PBM>()
    }
  })

  test('createTextNode plus isTextNode uses TNM', () => {
    const node = createTextNode({ text: 'hi' })

    expectTypeOf(node.metadata).toEqualTypeOf<TNM>()

    if (isTextNode(node)) {
      expectTypeOf(node.metadata).toEqualTypeOf<TNM>()
    }
  })

  test('invalid metadata is rejected on insert', () => {
    const editor = new Dactylo()

    editor.blocks.commands.insert({
      spec: {
        // @ts-expect-error nested objects are not a valid Metadata value
        metadata: { fontSize: { nested: true } },
        type: 'paragraph',
      },
    })
  })

  test('patch metadata is { value, policy? }, not the bag', () => {
    const editor = new Dactylo()
    const [blockId] = editor.getContext().state.blockOrderById
    if (!blockId) {
      throw new Error('Expected the initial paragraph')
    }

    editor.blocks.commands.patch({
      blockId,
      spec: {
        metadata: { policy: 'merge', value: { source: 'import' } },
        type: 'paragraph',
      },
    })
    editor.blocks.commands.patch({
      blockId,
      spec: {
        // @ts-expect-error patch metadata is { value, policy? }, not the bag
        metadata: { source: 'import' },
        type: 'paragraph',
      },
    })
  })
})

describe('WithUnless', () => {
  test('keeps the outer key optional when metadata accepts {}', () => {
    type Opts = WithUnless<
      'paragraph',
      { readonly placeholder?: string },
      'initialMetadata',
      { fontSize?: number }
    >

    expectTypeOf({}).toExtend<Opts>()
    expectTypeOf({
      paragraph: { placeholder: 'Notes…' },
    }).toExtend<Opts>()
    expectTypeOf({
      paragraph: { initialMetadata: { fontSize: 16 } },
    }).toExtend<Opts>()
  })

  test('requires the outer key and extra key when metadata has required fields', () => {
    type Opts = WithUnless<
      'paragraph',
      { readonly placeholder?: string },
      'initialMetadata',
      { fontSize: number }
    >

    expectTypeOf({
      paragraph: { initialMetadata: { fontSize: 16 } },
    }).toExtend<Opts>()
    expectTypeOf({}).not.toExtend<Opts>()
    expectTypeOf({
      paragraph: { placeholder: 'Notes…' },
    }).not.toExtend<Opts>()
  })

  test('DactyloOptions does not require initialMetadata for the default bag', () => {
    expectTypeOf({}).toExtend<DactyloOptions>()
    expectTypeOf({
      paragraph: { placeholder: 'Notes…' },
    }).toExtend<DactyloOptions>()
    expectTypeOf({
      paragraph: { initialMetadata: { source: 'import' } },
    }).toExtend<DactyloOptions>()
  })

  test('DactyloOptions accepts optional initialContent as JSON or markdown', () => {
    expectTypeOf({ initialContent: '# Hello' }).toExtend<DactyloOptions>()
    expectTypeOf({
      initialContent: { blocks: [] },
    }).toExtend<DactyloOptions>()
  })
})
