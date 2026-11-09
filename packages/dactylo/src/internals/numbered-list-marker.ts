import { isNumberedListItemBlock } from './blocks'
import type { Block, NumberedListItemBlock } from './blocks'
import { ROMAN_TABLE } from './constants'

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

/** Parses a lowercase alphabetic label (`a` → `1`, `aa` → `27`). */
export function parseAlphaIndex(token: string): number | null {
  if (!/^[a-z]+$/u.test(token)) {
    return null
  }

  let n = 0
  for (const ch of token) {
    n = n * 26 + (ch.charCodeAt(0) - 96)
  }
  return n > 0 ? n : null
}

/** Parses a lowercase roman numeral (`i` → `1`, `iv` → `4`). */
export function parseRomanIndex(token: string): number | null {
  let i = 0
  let n = 0
  for (const [amount, glyph] of ROMAN_TABLE) {
    while (token.startsWith(glyph, i)) {
      n += amount
      i += glyph.length
    }
  }
  if (i !== token.length || n === 0) {
    return null
  }
  return n
}

/**
 * Turns a 1-based position in a numbered-list run into the marker glyph
 * for a {@link NumberedListItemBlock} variant.
 *
 * `default` → `1.` · `alpha` → `a.` · `roman` → `i.`
 */
export function formatMarkerNumbering(
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

/** Gets the default first-item marker numbering for a variant (`1.` / `a.` / `i.`). */
export function getDefaultMarkerNumbering(
  variant: NumberedListItemBlock['variant'],
): string {
  return formatMarkerNumbering(1, variant)
}

/**
 * Reads the 1-based ordinal from a stored marker numbering (`2.` → `2`).
 * Returns `null` when the glyph does not match `variant`.
 */
export function parseMarkerNumbering(
  markerNumbering: string,
  variant: NumberedListItemBlock['variant'],
): number | null {
  const token = markerNumbering.endsWith('.')
    ? markerNumbering.slice(0, -1)
    : markerNumbering
  if (token.length === 0) {
    return null
  }

  switch (variant) {
    case 'alpha': {
      return parseAlphaIndex(token)
    }
    case 'roman': {
      return parseRomanIndex(token)
    }
    default: {
      if (!/^\d+$/u.test(token)) {
        return null
      }
      const n = Number(token)
      return n > 0 ? n : null
    }
  }
}

/** Next glyph in the same variant (`2.` → `3.`, `iv.` → `v.`). */
export function getMarkerNumbering(
  markerNumbering: string,
  variant: NumberedListItemBlock['variant'],
): string {
  const n = parseMarkerNumbering(markerNumbering, variant) ?? 0
  return formatMarkerNumbering(n + 1, variant)
}

/**
 * Marker for a new item after `prev`.
 * Increments when `prev` is a numbered item of the same variant; otherwise `1.` / `a.` / `i.`.
 */
export function markerNumberingAfterNeighbor(
  prev: Block | null | undefined,
  variant: NumberedListItemBlock['variant'],
): string {
  if (prev && isNumberedListItemBlock(prev) && prev.variant === variant) {
    return getMarkerNumbering(prev.markerNumbering, variant)
  }
  return getDefaultMarkerNumbering(variant)
}
