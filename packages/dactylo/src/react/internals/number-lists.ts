import { isNumberedListItemBlock } from '../../internals/blocks'
import type {
  Block,
  BlockId,
  NumberedListItemBlock,
} from '../../internals/blocks'
import { ROMAN_TABLE } from '../../internals/constants'

/** Converts a 1-based index to a lowercase roman numeral (`1` → `i`, `4` → `iv`). */
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

/** Converts a 1-based index to a lowercase alphabetic label (`1` → `a`, `27` → `aa`). */
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
 * Turns a 1-based position in a numbered-list run into the marker glyph
 * for a {@link NumberedListItemBlock} variant.
 *
 * `default` → `1.` · `alpha` → `a.` · `roman` → `i.`
 *
 * The index is the item's place in its run, not its index in the document.
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

/**
 * Builds the marker glyph for every {@link NumberedListItemBlock} in document order.
 *
 * A run is consecutive numbered list items that share the same `variant`.
 * The counter resets when the next block is missing, is not a numbered list
 * item, or uses a different variant.
 *
 * @example
 * ```txt
 * default, default, roman, paragraph, default
 * 1.       2.       i.                 1.
 * ```
 *
 * Markers are derived from `order` — they are not stored on the block.
 */
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
