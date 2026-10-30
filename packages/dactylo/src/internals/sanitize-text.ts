/** Pattern for the NUL character. */
// oxlint-disable-next-line no-control-regex
export const NUL_PATTERN = /\u0000/gu

/** Pattern for the BOM character. */
export const BOM_PATTERN = /\uFEFF/gu

/** C0 controls except TAB, LF, CR (allowed in plain text). */
export const DISALLOWED_CONTROL_PATTERN =
  // oxlint-disable-next-line no-control-regex require-unicode-regexp
  /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** Bidirectional control characters. */
export const BIDI_CONTROL_PATTERN =
  // oxlint-disable-next-line no-control-regex require-unicode-regexp
  /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu

/**
 * Sanitizes a user-provided (or ai-agent-provider) plain text input before it enters the document model.
 *
 * It doesn't do HTML escaping, instead it removes characters that break the model, storage,
 * or UX, and normalizes Unicode:
 *  - Removes the NUL (U+0000) character that breaks JS strings, DOM sync, and storage.
 *  - Removes the BOM (U+FEFF) character anywhere in the text.
 *  - Removes C0 controls except TAB, LF, CR (allowed in plain text).
 *  - Matches bidirectional control characters and isolates (not normal Arabic/Hebrew letters).
 *    @see https://unicode.org/reports/tr9/#Explicit_Directional_Embeddings
 *
 * Applies an NFC normalization to the text for consistent storage and comparison.
 * Surrogate pairs and ZWJ sequences (emoji) are preserved.
 */
export function sanitizeText(text: string): string {
  let final = text

  final = final.replaceAll(NUL_PATTERN, '')
  final = final.replaceAll(BOM_PATTERN, '')

  final = final.replaceAll(DISALLOWED_CONTROL_PATTERN, '')
  final = final.replaceAll(BIDI_CONTROL_PATTERN, '')
  final = final.normalize('NFC')

  return final
}
