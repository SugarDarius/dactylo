import {
  PLAIN_TEXT_LINES_SPLIT_PATTERN,
  PLAIN_TEXT_LINK_PATTERN,
  MARKDOWN_LINK_PATTERN,
} from './constants'

/** Splits a plain text into lines. */
export function splitPlainText(plain: string): string[] {
  return plain.split(PLAIN_TEXT_LINES_SPLIT_PATTERN)
}

/** Checks whether a plain text is a link. */
export function isPlainTextLink(plain: string): boolean {
  return PLAIN_TEXT_LINK_PATTERN.test(plain)
}

/** Checks whether a plain text is a markdown link. */
export function isMarkdownLink(plain: string): boolean {
  return MARKDOWN_LINK_PATTERN.test(plain)
}

/** Checks whether a plain text has links. */
export function plainTextHasLinks(plain: string): boolean {
  return isPlainTextLink(plain) || isMarkdownLink(plain)
}
