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
})
