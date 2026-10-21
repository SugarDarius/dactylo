import {
  PLAIN_TEXT_LINES_SPLIT_PATTERN,
  PLAIN_TEXT_LINK_PATTERN,
  MARKDOWN_LINK_PATTERN,
} from './constants'
import type { Marks } from './marks'
import { coalesceInlineNodes, createLinkNode, createTextNode } from './nodes'
import type { InlineNode } from './nodes'
import type { Relax } from './types'
import { normalizeUrl } from './utils'

// @todo: handle Dactylo mentions.

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

/** A text segment from a plain text line. */
export interface PlainTextTextSegment {
  readonly kind: 'text'

  /** Text content of the segment. */
  readonly text: string
}

/** A link segment from a plain text line. */
export interface PlainTextLinkSegment {
  readonly kind: 'link'

  /** Text content of the segment. */
  readonly text: string

  /** Href of the link. */
  readonly href: string

  /** Title of the link. */
  readonly title: string
}

/** Discriminated union of plain text line segments supported by {@link Dactylo}. */
export type PlainTextSegment = Relax<
  PlainTextTextSegment | PlainTextLinkSegment
>

/** A match of a plain text link. */
export interface PlainTextLinkMatch {
  /** The start index of the match. */
  readonly start: number

  /** The end index of the match. */
  readonly end: number

  /** The link segment that was matched. */
  readonly segment: PlainTextLinkSegment
}

/** Collects all non-overlapping link spans in a plain text line in document order. */
export function collectPlainTextLinks(line: string): PlainTextLinkMatch[] {
  const matches: PlainTextLinkMatch[] = []

  /** Markdown link matches. */
  for (const match of line.matchAll(
    new RegExp(MARKDOWN_LINK_PATTERN.source, 'gui'),
  )) {
    const start = match.index
    const [full] = match

    const text = match.groups?.text ?? full
    const url = match.groups?.url ?? ''
    const title = match.groups?.title ?? full

    /** We don't want to collect matches without a URL. */
    if (!url) {
      continue
    }

    const normalized = normalizeUrl(url)
    matches.push({
      end: start + full.length,
      segment: {
        href: normalized,
        kind: 'link',
        text,
        title,
      },
      start,
    })
  }

  /** Plain text link matches. */
  for (const match of line.matchAll(
    new RegExp(PLAIN_TEXT_LINK_PATTERN.source, 'gui'),
  )) {
    const start = match.index
    const [full] = match

    const end = start + full.length
    /** We don't want to collect matches with already matched links. */
    const overlapsMd = matches.some((x) => start < x.end && end > x.start)
    if (overlapsMd) {
      continue
    }

    const normalized = normalizeUrl(full)
    matches.push({
      end,
      segment: {
        href: normalized,
        kind: 'link',
        text: full,
        title: full,
      },
      start,
    })
  }

  return matches.toSorted((a, b) => a.start - b.start)
}

/** Parses a plain text line into segments. */
export function parsePlainTextLineSegments(line: string): PlainTextSegment[] {
  const segments: PlainTextSegment[] = []

  const collected = collectPlainTextLinks(line)
  let cursor = 0

  for (const match of collected) {
    if (match.start > cursor) {
      segments.push({
        kind: 'text',
        text: line.slice(cursor, match.start),
      })
    }

    segments.push(match.segment)
    cursor = match.end
  }

  if (cursor < line.length) {
    segments.push({
      kind: 'text',
      text: line.slice(cursor),
    })
  }

  return segments
}

/**
 * Transform a plain plain text into inline nodes that can be editable.
 * Handles coalescing of consecutive text nodes.
 */
export function plainTextToEditableTextNodes(
  line: string,
  marks: Marks,
): InlineNode[] {
  const nodes: InlineNode[] = []
  const segments = parsePlainTextLineSegments(line)

  for (const segment of segments) {
    if (segment.kind === 'text') {
      if (segment.text.length <= 0) {
        continue
      }

      nodes.push(createTextNode({ marks, text: segment.text }))
    } else if (segment.kind === 'link') {
      nodes.push(
        createLinkNode({
          marks,
          text: segment.text,
          url: { href: segment.href, title: segment.title },
        }),
      )
    }
  }

  return coalesceInlineNodes(nodes)
}
