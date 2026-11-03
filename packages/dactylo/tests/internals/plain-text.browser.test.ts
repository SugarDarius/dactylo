import { describe, expect, test } from 'vitest'

import { collectPlainTextLinks } from '../../src/internals/plain-text'

describe('collectPlainTextLinks', () => {
  test('includeMarkdown false skips [text](url) and still collects bare URLs', () => {
    const markdown = '[Liveblocks](https://liveblocks.io)'
    const bare = 'https://example.com'

    expect(collectPlainTextLinks(markdown)).toMatchObject([
      {
        end: markdown.length,
        segment: { kind: 'link', text: 'Liveblocks' },
        start: 0,
      },
    ])

    expect(collectPlainTextLinks(markdown, false)[0]?.segment.text).not.toBe(
      'Liveblocks',
    )

    expect(collectPlainTextLinks(bare, false)).toMatchObject([
      {
        end: bare.length,
        segment: { kind: 'link', text: bare },
        start: 0,
      },
    ])
  })

  test('collects scheme-less www and bare domains without matching emails', () => {
    expect(collectPlainTextLinks('www.google.com', false)).toMatchObject([
      {
        end: 'www.google.com'.length,
        segment: { text: 'www.google.com' },
        start: 0,
      },
    ])
    expect(collectPlainTextLinks('google.com', false)).toMatchObject([
      {
        end: 'google.com'.length,
        segment: { text: 'google.com' },
        start: 0,
      },
    ])
    expect(collectPlainTextLinks('user@example.com', false)).toEqual([])
  })
})
