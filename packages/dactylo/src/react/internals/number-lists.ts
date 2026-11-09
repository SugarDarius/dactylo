import { isNumberedListItemBlock } from '../../internals/blocks'
import type {
  Block,
  BlockId,
  NumberedListItemBlock,
} from '../../internals/blocks'
import { ROMAN_TABLE } from '../../internals/constants'

/** 1 → `i`, 4 → `iv`, 9 → `ix`. */
export function toRomanIndex(n: number): string {
  let value = n
  let result = ''
  for (const [amount, glyph] of ROMAN_TABLE) {
    while (value >= amount) {
      result += glyph
      value -= amount
    }
  }
  return result
}

/** 1 → `a`, 26 → `z`, 27 → `aa`. */
export function toAlphaIndex(n: number): string {
  let value = n
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(97 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

/**
 * Formats the marker index for a numbered list item
 * based on the variant set in the block.
 */
export function formatMarkerIndex(
  index: number,
  variant: NumberedListItemBlock['variant'],
): string {
  switch (variant) {
    case 'alpha': {
      return `${toAlphaIndex(index)}.`
    }
    case 'roman': {
      return `${toRomanIndex(index)}.`
    }
    default: {
      return `${index}.`
    }
  }
}

export function computeMarkerIndexes(
  order: readonly BlockId[],
  blocks: ReadonlyMap<BlockId, Block>,
): Map<BlockId, string> {
  const indexes = new Map<BlockId, string>()

  let run = 0
  let variant: NumberedListItemBlock['variant'] | null = null

  for (const blockId of order) {
    const block = blocks.get(blockId)
    if (block === undefined || !isNumberedListItemBlock(block)) {
      run = 0
      variant = null

      continue
    }

    if (block.variant !== variant) {
      run = 0
      const { variant: bVariant } = block
      variant = bVariant
    }

    run += 1
    indexes.set(block.id, formatMarkerIndex(run, variant))
  }

  return indexes
}
