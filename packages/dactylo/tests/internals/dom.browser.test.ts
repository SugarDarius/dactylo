import { describe, expect, test } from 'vitest'

import {
  DOM_SPACE_UNICODE_CODEPOINT,
  DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT,
} from '../../src/internals/constants'
import {
  modelLengthFromPaintedDOMText,
  paintTextForDOM,
} from '../../src/internals/dom'

describe('paintTextForDOM', () => {
  test('empty text paints a ZWSP caret target', () => {
    expect(paintTextForDOM('')).toBe(DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT)
    expect(modelLengthFromPaintedDOMText(paintTextForDOM(''))).toBe(0)
  })

  test('plain text is unchanged', () => {
    expect(paintTextForDOM('Hello')).toBe('Hello')
  })

  test('inner spaces stay as regular spaces', () => {
    expect(paintTextForDOM('Hello code')).toBe('Hello code')
  })

  test('a trailing space becomes NBSP without a ZWSP sentinel', () => {
    expect(paintTextForDOM('Hello ')).toBe(
      `Hello${DOM_SPACE_UNICODE_CODEPOINT}`,
    )
    expect(paintTextForDOM('Hello ')).not.toContain(
      DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT,
    )
    expect(modelLengthFromPaintedDOMText(paintTextForDOM('Hello '))).toBe(6)
  })

  test('a leading space becomes NBSP without a ZWSP sentinel', () => {
    expect(paintTextForDOM(' code')).toBe(`${DOM_SPACE_UNICODE_CODEPOINT}code`)
    expect(paintTextForDOM(' code')).not.toContain(
      DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT,
    )
  })

  test('consecutive spaces become NBSP without a ZWSP sentinel', () => {
    expect(paintTextForDOM('a  b')).toBe(
      `a${DOM_SPACE_UNICODE_CODEPOINT}${DOM_SPACE_UNICODE_CODEPOINT}b`,
    )
    expect(paintTextForDOM('a  b')).not.toContain(
      DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT,
    )
  })
})
