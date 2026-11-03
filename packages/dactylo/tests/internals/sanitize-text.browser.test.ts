import { describe, expect, test } from 'vitest'

import { sanitizeText } from '../../src/internals/sanitize-text'

describe('sanitizeText', () => {
  test('leaves ordinary text and emoji sequences unchanged', () => {
    expect(sanitizeText('')).toBe('')
    expect(sanitizeText('Hello, world.')).toBe('Hello, world.')
    expect(sanitizeText('👍')).toBe('👍')
    expect(sanitizeText('👩‍💻')).toBe('👩‍💻')
  })

  test('strips NUL, BOM, disallowed C0 controls, and bidi isolates', () => {
    expect(sanitizeText('a\u0000b')).toBe('ab')
    expect(sanitizeText('\uFEFFhi\uFEFF')).toBe('hi')
    expect(sanitizeText('a\u0001b\u007Fc')).toBe('abc')
    expect(sanitizeText('a\u202Eb')).toBe('ab')
  })

  test('keeps TAB, LF, and CR', () => {
    expect(sanitizeText('a\tb\nc\rd')).toBe('a\tb\nc\rd')
  })

  test('normalizes to NFC', () => {
    expect(sanitizeText('e\u0301')).toBe('é')
  })
})
