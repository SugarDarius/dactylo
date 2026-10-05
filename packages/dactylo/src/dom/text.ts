import {
  DOM_SPACE_UNICODE_CODEPOINT,
  DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT,
} from '../internals/constants'

/** Paints model text into DOM characters.*/
export function paintTextForDOM(text: string): string {
  let rendered = ''

  if (text.length === 0) {
    rendered += DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT
    return rendered
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    // oxlint-disable-next-line unicorn/prefer-ternary
    const isSpace =
      char === ' ' &&
      (i === 0 ||
        text.length - 1 === i ||
        text[i - 1] === ' ' ||
        text[i + 1] === ' ')
    rendered += isSpace ? DOM_SPACE_UNICODE_CODEPOINT : char
  }

  if (
    rendered.endsWith(DOM_SPACE_UNICODE_CODEPOINT) ||
    rendered.endsWith(' ')
  ) {
    rendered += DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT
  }

  return rendered
}
