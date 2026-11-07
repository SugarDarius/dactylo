import { describe, expect, test } from 'vitest'

import { sanitizeText } from '../../src/internals/sanitize-text'

describe('sanitizeText', () => {
  test('leaves ordinary text and emoji sequences unchanged', () => {
    expect(sanitizeText('')).toBe('')
    expect(sanitizeText('Hello, world.')).toBe('Hello, world.')
    expect(sanitizeText('👍')).toBe('👍')
    expect(sanitizeText('👩‍💻')).toBe('👩‍💻')
  })

  test('keeps Arabic letters and ZWNJ', () => {
    expect(sanitizeText('مرحبا')).toBe('مرحبا')
    expect(sanitizeText('می\u200Cشود')).toBe('می‌شود')
  })

  test('strips NUL, BOM, disallowed C0 controls, and bidi isolates', () => {
    expect(sanitizeText('a\u0000b')).toBe('ab')
    expect(sanitizeText('\uFEFFhi\uFEFF')).toBe('hi')
    expect(sanitizeText('a\u0001b\u007Fc')).toBe('abc')
    expect(sanitizeText('a\u202Eb')).toBe('ab')
  })

  test('strips C1 controls, line/paragraph separators, ZWSP, and unicode tags', () => {
    expect(sanitizeText('a\u0085b\u009Fc')).toBe('abc')
    expect(sanitizeText('a\u2028b\u2029c')).toBe('abc')
    expect(sanitizeText('a\u200Bb')).toBe('ab')
    expect(sanitizeText(`a\u{E0001}b\u{E0020}c\u{E007F}d`)).toBe('abcd')
  })

  test('keeps TAB, LF, and CR', () => {
    expect(sanitizeText('a\tb\nc\rd')).toBe('a\tb\nc\rd')
  })

  test('normalizes to NFC', () => {
    expect(sanitizeText('e\u0301')).toBe('é')
  })
})
