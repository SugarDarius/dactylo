import { describe, expectTypeOf, test } from 'vitest'

import { Dactylo } from '../../src/dactylo'
import type { HBM, Metadata, PBM, TNM } from '../../src/index'
import { isParagraphBlock } from '../../src/internals/blocks'
import type { ParagraphBlock } from '../../src/internals/blocks'
import { createTextNode, isTextNode } from '../../src/internals/nodes'
import type { TextNode } from '../../src/internals/nodes'

describe('metadata aliases', () => {
  test('default block and node metadata is the open Metadata bag', () => {
    expectTypeOf<ParagraphBlock['metadata']>().toEqualTypeOf<Metadata>()
    expectTypeOf<ParagraphBlock['metadata']>().toEqualTypeOf<PBM>()
    expectTypeOf<TextNode['metadata']>().toEqualTypeOf<Metadata>()
    expectTypeOf<TextNode['metadata']>().toEqualTypeOf<TNM>()
  })

  test('block commands use the per-type metadata aliases', () => {
    const editor = new Dactylo()

    expectTypeOf(editor.blocks.commands.insertParagraph)
      .parameter(0)
      .toExtend<{ pos?: unknown; metadata?: PBM } | undefined>()
    expectTypeOf(editor.blocks.commands.patchParagraph).parameter(1).toExtend<{
      content?: unknown
      metadata?: PBM
    }>()

    expectTypeOf(editor.blocks.commands.insertHeading)
      .parameter(1)
      .toExtend<{ pos?: unknown; metadata?: HBM } | undefined>()
    expectTypeOf(editor.blocks.commands.patchHeading).parameter(1).toExtend<{
      level?: unknown
      content?: unknown
      metadata?: HBM
    }>()

    expectTypeOf(editor.blocks.commands.insertQuote)
      .parameter(0)
      .toExtend<{ pos?: unknown; metadata?: Metadata } | undefined>()
    expectTypeOf(editor.blocks.commands.patchDivider)
      .parameter(1)
      .toExtend<{ metadata?: Metadata }>()
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

  test('invalid metadata is rejected on insertParagraph', () => {
    const editor = new Dactylo()

    editor.blocks.commands.insertParagraph({
      // @ts-expect-error nested objects are not a valid Metadata value
      metadata: { fontSize: { nested: true } },
    })
  })
})
