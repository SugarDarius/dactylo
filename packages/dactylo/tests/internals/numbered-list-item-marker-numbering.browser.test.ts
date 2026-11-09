import { describe, expect, expectTypeOf, test } from 'vitest'

import type { DactyloBlocksCommands } from '../../src/dactylo'
import { isNumberedListItemBlock } from '../../src/internals/blocks'
import type { NumberedListItemBlock } from '../../src/internals/blocks'
import {
  deleteBackward,
  firstInlineBlock,
  focus,
  hardBreak,
  makePipeline,
  nthInlineBlock,
  setCursor,
  snapshot,
  startOfBlock,
  typeText,
} from '../utils/pipeline'

function requireNumbered(
  block: ReturnType<typeof firstInlineBlock>,
): NumberedListItemBlock {
  if (!isNumberedListItemBlock(block)) {
    throw new Error(`Expected numbered list item, got ${block.__type}`)
  }
  return block
}

function markers(pipeline: ReturnType<typeof makePipeline>): string[] {
  return pipeline.context.state.blockOrderById.map((id) => {
    const block = pipeline.context.state.blocks.get(id)
    return block && isNumberedListItemBlock(block) ? block.markerNumbering : ''
  })
}

function replaceDocWithNumbered(
  variant: NumberedListItemBlock['variant'] = 'default',
) {
  const pipeline = makePipeline({ markdown: false })
  focus(pipeline)
  const leftoverId = firstInlineBlock(pipeline.context).id
  pipeline.insertNumberedListItemBlock(
    { pos: { type: 'start' }, variant },
    'user',
  )
  pipeline.deleteBlock(leftoverId, 'user')
  focus(pipeline)
  return pipeline
}

describe('numbered list markerNumbering', () => {
  test('insert assigns 1. then 2. and shifts a middle insert', () => {
    const pipeline = replaceDocWithNumbered()
    expect(
      requireNumbered(firstInlineBlock(pipeline.context)).markerNumbering,
    ).toBe('1.')

    pipeline.insertNumberedListItemBlock(
      {
        pos: { blockId: firstInlineBlock(pipeline.context).id, type: 'after' },
      },
      'user',
    )
    expect(markers(pipeline)).toEqual(['1.', '2.'])

    pipeline.insertNumberedListItemBlock(
      {
        pos: { blockId: nthInlineBlock(pipeline.context, 0).id, type: 'after' },
      },
      'user',
    )
    expect(markers(pipeline)).toEqual(['1.', '2.', '3.'])
  })

  test('duplicate assigns the next marker and reindexes the suffix', () => {
    const pipeline = replaceDocWithNumbered()
    typeText(pipeline, 'A')
    hardBreak(pipeline)
    typeText(pipeline, 'B')

    pipeline.duplicateBlock(nthInlineBlock(pipeline.context, 0).id, 'user')
    expect(markers(pipeline)).toEqual(['1.', '2.', '3.'])
  })

  test('insert uses variant defaults a. and i.', () => {
    expect(
      requireNumbered(firstInlineBlock(replaceDocWithNumbered('alpha').context))
        .markerNumbering,
    ).toBe('a.')
    expect(
      requireNumbered(firstInlineBlock(replaceDocWithNumbered('roman').context))
        .markerNumbering,
    ).toBe('i.')
  })

  test('Enter at the end of 1. inserts 2.', () => {
    const pipeline = replaceDocWithNumbered()
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    expect(markers(pipeline)).toEqual(['1.', '2.'])
  })

  test('Enter in the middle of a two-item list yields 1. 2. 3.', () => {
    const pipeline = replaceDocWithNumbered()
    typeText(pipeline, 'Hello')
    hardBreak(pipeline)
    typeText(pipeline, 'World')
    setCursor(pipeline, {
      ...startOfBlock(nthInlineBlock(pipeline.context, 0)),
      offset: 2,
    })
    hardBreak(pipeline)

    expect(markers(pipeline)).toEqual(['1.', '2.', '3.'])
  })

  test('Enter on an empty middle item leaves the following run consecutive', () => {
    const pipeline = replaceDocWithNumbered()
    typeText(pipeline, 'A')
    hardBreak(pipeline)
    typeText(pipeline, 'B')
    hardBreak(pipeline)
    typeText(pipeline, 'C')
    setCursor(pipeline, {
      ...startOfBlock(nthInlineBlock(pipeline.context, 1)),
      offset: 1,
    })
    deleteBackward(pipeline)
    hardBreak(pipeline)

    expect(nthInlineBlock(pipeline.context, 1).__type).toBe('paragraph')
    expect(markers(pipeline)).toEqual(['1.', '', '2.'])
  })

  test('delete middle item of 1. 2. 3. compactifies to 1. 2.', () => {
    const pipeline = replaceDocWithNumbered()
    typeText(pipeline, 'A')
    hardBreak(pipeline)
    typeText(pipeline, 'B')
    hardBreak(pipeline)
    typeText(pipeline, 'C')

    pipeline.deleteBlock(nthInlineBlock(pipeline.context, 1).id, 'user')
    expect(markers(pipeline)).toEqual(['1.', '2.'])
  })

  test('deleting a 2.-started first item leaves the next item as the start', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '2.')
    typeText(pipeline, ' ')
    typeText(pipeline, 'A')
    hardBreak(pipeline)
    typeText(pipeline, 'B')
    expect(markers(pipeline)).toEqual(['2.', '3.'])

    pipeline.deleteBlock(nthInlineBlock(pipeline.context, 0).id, 'user')
    expect(markers(pipeline)).toEqual(['3.'])
  })

  test('patch variant reformats the ordinal and restarts the old-variant suffix', () => {
    const pipeline = replaceDocWithNumbered()
    typeText(pipeline, 'A')
    hardBreak(pipeline)
    typeText(pipeline, 'B')
    hardBreak(pipeline)
    typeText(pipeline, 'C')

    pipeline.patchNumberedListItemBlock(
      nthInlineBlock(pipeline.context, 1).id,
      { variant: 'roman' },
      'user',
    )

    expect(requireNumbered(nthInlineBlock(pipeline.context, 0))).toMatchObject({
      markerNumbering: '1.',
      variant: 'default',
    })
    expect(requireNumbered(nthInlineBlock(pipeline.context, 1))).toMatchObject({
      markerNumbering: 'ii.',
      variant: 'roman',
    })
    expect(requireNumbered(nthInlineBlock(pipeline.context, 2))).toMatchObject({
      markerNumbering: '1.',
      variant: 'default',
    })
  })

  test('insert and patch commands do not accept markerNumbering', () => {
    type InsertOpts = NonNullable<
      Parameters<DactyloBlocksCommands['insertNumberedListItem']>[0]
    >
    type PatchOpts = Parameters<
      DactyloBlocksCommands['patchNumberedListItem']
    >[1]

    expectTypeOf<InsertOpts>().not.toHaveProperty('markerNumbering')
    expectTypeOf<PatchOpts>().not.toHaveProperty('markerNumbering')
  })
})

describe('numbered list markdown shortcut', () => {
  test('2. space creates a default item that displays 2.', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, '2.')
    typeText(pipeline, ' ')

    const block = requireNumbered(firstInlineBlock(pipeline.context))
    expect(block.markerNumbering).toBe('2.')
    expect(block.variant).toBe('default')

    const converted = snapshot(pipeline.context)
    pipeline.undo()
    expect(firstInlineBlock(pipeline.context).__type).toBe('paragraph')
    pipeline.redo()
    expect(snapshot(pipeline.context)).toEqual(converted)
  })

  test('a. space creates an alpha item that displays a.', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, 'a.')
    typeText(pipeline, ' ')

    const block = requireNumbered(firstInlineBlock(pipeline.context))
    expect(block.markerNumbering).toBe('a.')
    expect(block.variant).toBe('alpha')
  })

  test('ii. space creates a roman item that displays ii.', () => {
    const pipeline = makePipeline({ markdown: true })
    focus(pipeline)
    typeText(pipeline, 'ii.')
    typeText(pipeline, ' ')

    const block = requireNumbered(firstInlineBlock(pipeline.context))
    expect(block.markerNumbering).toBe('ii.')
    expect(block.variant).toBe('roman')
  })
})
