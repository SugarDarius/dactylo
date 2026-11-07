import { describe, expect, test } from 'vitest'

import {
  isHrefWithBlockedScheme,
  isRelativeUrl,
  sanitizeLinkHref,
} from '../../src/internals/sanitize-link'

describe('sanitizeLinkHref', () => {
  test('returns empty for blank or control-only input', () => {
    expect(sanitizeLinkHref('')).toBe('')
    expect(sanitizeLinkHref('   ')).toBe('')
    expect(sanitizeLinkHref('\u0000')).toBe('')
  })

  test('keeps allowlisted absolute URLs and strips http(s) credentials', () => {
    expect(sanitizeLinkHref('https://liveblocks.io')).toBe(
      'https://liveblocks.io/',
    )
    expect(sanitizeLinkHref('http://example.com/path')).toBe(
      'http://example.com/path',
    )
    expect(sanitizeLinkHref('mailto:user@example.com')).toBe(
      'mailto:user@example.com',
    )
    expect(sanitizeLinkHref('tel:+15555550100')).toBe('tel:+15555550100')
    expect(sanitizeLinkHref('https://user:pass@example.com/secret')).toBe(
      'https://example.com/secret',
    )
    expect(sanitizeLinkHref('https://example.com@evil.com')).toBe(
      'https://evil.com/',
    )
  })

  test('prefixes https for scheme-less www and bare domains', () => {
    expect(sanitizeLinkHref('www.google.com')).toBe('https://www.google.com/')
    expect(sanitizeLinkHref('google.com')).toBe('https://google.com/')
    expect(sanitizeLinkHref('  google.com/search?q=dactylo  ')).toBe(
      'https://google.com/search?q=dactylo',
    )
  })

  test('rejects blocked schemes, relatives, and un-parsable values', () => {
    // oxlint-disable-next-line no-script-url
    expect(sanitizeLinkHref('javascript:alert(1)')).toBe('')
    expect(sanitizeLinkHref('data:text/html,hi')).toBe('')
    expect(sanitizeLinkHref('vbscript:msgbox(1)')).toBe('')
    expect(sanitizeLinkHref('file:///etc/passwd')).toBe('')
    expect(sanitizeLinkHref('/relative')).toBe('')
    expect(sanitizeLinkHref('#hash')).toBe('')
    expect(sanitizeLinkHref('./next')).toBe('')
    expect(sanitizeLinkHref('../up')).toBe('')
    expect(sanitizeLinkHref('//evil.com')).toBe('')
    expect(sanitizeLinkHref('ftp://example.com')).toBe('')
    expect(sanitizeLinkHref('blob:https://example.com/abc')).toBe('')
    expect(sanitizeLinkHref('view-source:https://example.com')).toBe('')
    expect(sanitizeLinkHref('https://')).toBe('')
    expect(sanitizeLinkHref('https://javascript:alert(1)')).toBe('')
  })

  test('rejects obfuscated executable schemes', () => {
    // oxlint-disable-next-line no-script-url
    expect(sanitizeLinkHref('java\nscript:alert(1)')).toBe('')
    expect(sanitizeLinkHref('javascript\t:alert(1)')).toBe('')
    expect(sanitizeLinkHref('JAVA SCRIPT:alert(1)')).toBe('')
    expect(sanitizeLinkHref('\\javascript:alert(1)')).toBe('')
  })

  test('does not keep bidi or ZWSP in a stored href', () => {
    const withZwsp = sanitizeLinkHref('https://exa\u200Bmple.com')
    expect(withZwsp).toBe('https://example.com/')
    expect(withZwsp).not.toContain('\u200B')

    const withBidi = sanitizeLinkHref('https://example.com/\u202Epath')
    expect(withBidi).toBe('https://example.com/path')
    expect(withBidi).not.toContain('\u202E')
  })
})

describe('isHrefWithBlockedScheme', () => {
  test('detects executable schemes after collapsing whitespace and slashes', () => {
    // oxlint-disable-next-line no-script-url
    expect(isHrefWithBlockedScheme('javascript:alert(1)')).toBe(true)
    expect(isHrefWithBlockedScheme('JAVA\nSCRIPT:alert(1)')).toBe(true)
    expect(isHrefWithBlockedScheme('https://example.com')).toBe(false)
  })
})

describe('isRelativeUrl', () => {
  test('detects slash, hash, and dot-relative hrefs', () => {
    expect(isRelativeUrl('/path')).toBe(true)
    expect(isRelativeUrl('#top')).toBe(true)
    expect(isRelativeUrl('./a')).toBe(true)
    expect(isRelativeUrl('../a')).toBe(true)
    expect(isRelativeUrl('//evil.com')).toBe(true)
    expect(isRelativeUrl('google.com')).toBe(false)
  })
})
