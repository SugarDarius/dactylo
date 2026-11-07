import { afterEach, describe, expect, test, vi } from 'vitest'

import { generateBlockId } from '../../src/internals/blocks'
import { generateNodeId } from '../../src/internals/nodes'
import { generateRandomId, URL_ALPHABET } from '../../src/internals/random-id'

const URL_SAFE_PATTERN = /^[A-Za-z0-9_-]+$/u
const GET_RANDOM_MAX_BYTES = 65_536

afterEach(() => {
  vi.restoreAllMocks()
})

describe('generateRandomId', () => {
  test('returns a 21-character URL-safe id from the nanoid alphabet', () => {
    const id = generateRandomId(21)

    expect(id).toHaveLength(21)
    expect(id).toMatch(URL_SAFE_PATTERN)
    for (const char of id) {
      expect(URL_ALPHABET).toContain(char)
    }
  })

  test('maps random bytes onto the alphabet with & 63', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      if (!(array instanceof Uint8Array)) {
        throw new TypeError('expected Uint8Array')
      }

      array[0] = 0
      array[1] = 63
      array[2] = 64
      array[3] = 255
      return array
    })

    // 0→'5', 63→'9', 64&63→'5', 255&63→'9'
    expect(generateRandomId(4)).toBe('5959')
  })

  test('produces unique ids', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i += 1) {
      ids.add(generateRandomId(21))
    }

    expect(ids.size).toBe(1000)
  })

  test('returns an empty string for length 0', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues')

    expect(generateRandomId(0)).toBe('')
    expect(spy).not.toHaveBeenCalled()
  })

  test('rejects invalid lengths', () => {
    expect(() => generateRandomId(-1)).toThrow(RangeError)
    expect(() => generateRandomId(1.5)).toThrow(RangeError)
    expect(() => generateRandomId(Number.NaN)).toThrow(RangeError)
    expect(() => generateRandomId(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  test('fills in chunks of at most 65536 bytes', () => {
    const fill = crypto.getRandomValues.bind(crypto)
    const spy = vi
      .spyOn(crypto, 'getRandomValues')
      .mockImplementation((array) => {
        expect(array.byteLength).toBeLessThanOrEqual(GET_RANDOM_MAX_BYTES)
        return fill(array)
      })

    const length = GET_RANDOM_MAX_BYTES + 100
    const id = generateRandomId(length)

    expect(id).toHaveLength(length)
    expect(id).toMatch(URL_SAFE_PATTERN)

    const filledBytes = spy.mock.calls.reduce(
      (sum, [buffer]) => sum + (buffer?.byteLength ?? 0),
      0,
    )

    expect(filledBytes).toBe(length)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('generateBlockId', () => {
  test('returns a 24-character URL-safe block id', () => {
    expect(generateBlockId()).toMatch(/^bl_[A-Za-z0-9_-]{21}$/u)
  })
})

describe('generateNodeId', () => {
  test('returns a 24-character URL-safe node id', () => {
    expect(generateNodeId()).toMatch(/^nd_[A-Za-z0-9_-]{21}$/u)
  })
})
