/**
 * For efficiency reasons, as blocks operations must support:
 * 1. Insertion between any tow blocks without re-indexing the whole document
 * 2. Moving blocks (cut, paste, drag-and-drop) with minimal work
 * 3. CRDT merge where concurrent insets at the "<same>" position resolve deterministically
 *
 * Array indices are not enough and fail all three constraints: inserting at position `k`
 * is an O(n) complexity for re-indexing and is unstable in concurrent edits.
 *
 * Dactylo adopts the same fractional indexing system used by Liveblocks 🚀.
 * 👉🏻 Blog post: https://liveblocks.io/blog/how-crdts-and-sync-engines-keep-realtime-lists-ordered-with-fractional-indexing#a-new-character-set
 *
 * Each blocks in the document carries a `PosKey`, a variable-length string encoding a
 * fractional position in base96. Sort order is native lexicographic string comparison (keyA < keyB).
 *
 * Base96 is a numeral system made up of the 95 printable ASCII characters,
 * starting at the space character ` ` and ending at tilde `~`.
 *
 * ```text
 * !"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~
 * ^                                                                                             ^
 * lowest digit (0)                                                                           highest digit (94)
 * ```
 *
 * Conceptually each key encodes a fractional number `0 < n < 1` in base96 (like `"31007"` → `0.31007`):
 * | Digit | Char          | Decimal analogy                    |
 * |-------|---------------|------------------------------------|
 * | 0     | `' '` (space) | zero digit — not a valid key alone |
 * | 1     | `'!'`         | `.1` — first canonical position    |
 * | 2     | `'"'`         | `.2` — second canonical position   |
 * | …     | …             | … — …                              |
 * | 94    | `'~'`         | `.94` — highest                    |
 *
 * Every valid `PostKey` must satisfy these three constraints:
 *  1. Non-empty: an empty string is invalid
 *  2. All chars in the alphabet: code points to `32-126` inclusive
 *  3. No trailing zeros: last character must not be `' '`(digit 0), `'hello '` is invalid; strip trailing spaces.
 */
import { DactyloError } from './errors'
import type { Brand } from './types'

/**
 * base96 fractional position string.
 */
export type PosKey = Brand<string, 'PosKey'>

/** ASCII code of the lowest alphabet char -- digit 0 (e.g. ' ') */
export const MIN_CODE = 32
/** ASCII code of the highest alphabet char --digit 94 (e.g. '~') */
export const MAX_CODE = 126

/** Number of valid digits in the alphabet (95) */
export const NUM_DIGITS = MAX_CODE - MIN_CODE + 1

/** Last character >= this */
export const MIN_NON_ZERO_CODE = MIN_CODE + 1

/**
 * Returns the `PosKey`` value for the nth digit in the alphabet.
 * Value must be between 0 and 94.
 */
export function nthDigit(n: number): PosKey {
  const code = MIN_CODE + (n < 0 ? NUM_DIGITS + n : 0)
  if (code < MIN_CODE || code > MAX_CODE) {
    throw DactyloError.from({
      code: 'FRACTIONAL_POSITION',
      message: `Invalid digit index: ${n}`,
    })
  }
  return String.fromCharCode(code) as PosKey
}

/** Lowest digit: `' '` (space)  used for padding inside `between()`, never as final character */
export const ZERO = nthDigit(0)

/** First valid canonical position — equivalent to decimal 0.1  */
export const ONE = nthDigit(1)

/** `' ~'` */
export const ZERO_NINE = ZERO + nthDigit(-1)

/**
 * Canonical position strictly before `pos`.
 *
 * Decimal analogies (from Liveblocks comments):
 *   before(.1)   → .09  → in base96: adjusts first non-zero digit
 *   before(.11)  → .1
 *   before(.9)   → .8
 *   before(.99)  → .9
 */
export function before(pos: PosKey): PosKey {
  const lastIndex = pos.length - 1

  for (let i = 0; i <= lastIndex; i += 1) {
    const code = pos.charCodeAt(i)

    // Skip leading zero digits (spaces)
    if (code <= MIN_CODE) {
      continue
    }

    // i = first non-zero digit
    if (i === lastIndex) {
      // Last digit only
      if (code === MIN_CODE + 1) {
        // Edge: digit is 1 — replace with ZERO_NINE pattern (' ~')
        return (pos.slice(0, i) + ZERO_NINE) as PosKey
      }
      // Decrement last digit
      return (pos.slice(0, i) + String.fromCodePoint(code - 1)) as PosKey
    }
    // Not last digit — chop remainder (shorter prefix is always before)
    return pos.slice(0, i + 1) as PosKey
  }

  // Input was all zeroes (invalid) — return canonical first
  return ONE
}

/**
 * Given any position value, computes the canonical position "after" it.
 *
 * Uses "viewport-based allocation" (V=2+3) to bound position length growth
 * when repeatedly inserting blocks. Instead of always incrementing the last digit
 * (which leads to O(n/94) length growth), we treat positions as fixed-width
 * numbers within a "viewport" of V digits.
 *
 * This keeps position lengths dramatically smaller for typical usage while
 * remaining backward compatible with all existing position strings.
 *
 * Viewport-based tail allocation: V=2 → V=5 → V=8 → V=11 → ...
 *
 * Examples (conceptually in decimal):
 *   after(.1)  // .11 (within V=2 viewport)
 *   after(.11) // .12
 *   after(.99) // .99001 (overflow V=2, extend to V=5)
 *
 */
export const VIEWPORT_START = 2
export const VIEWPORT_STEP = 3

/**
 * Increment within fixed viewport width. Returns null on overflow (all digits max).
 * Pads shorter positions with zero digits on the right, increments with carry,
 * strips trailing zeros from result.
 */
export function incrementWithinViewport(
  pos: PosKey,
  viewport: number,
): PosKey | null {
  const digits: number[] = []

  for (let i = 0; i < viewport; i += 1) {
    if (i < pos.length) {
      digits.push(pos.charCodeAt(i) - MIN_CODE)
    } else {
      // pad with zero digits
      digits.push(0)
    }
  }

  // Increment right-to-left with carry
  let carry = 1
  for (let i = viewport - 1; i >= 0 && carry; i -= 1) {
    // @ts-expect-error: digits is guaranteed to be an array of numbers
    const sum = digits[i] + carry
    if (sum >= NUM_DIGITS) {
      digits[i] = 0
      carry = 1
    } else {
      digits[i] = sum
      carry = 0
    }
  }

  // viewport overflow
  if (carry) {
    return null
  }

  let result = ''
  for (const d of digits) {
    result += String.fromCharCode(d + MIN_CODE)
  }

  // Strip trailing zero digits
  while (
    result.length > 1 &&
    result.charCodeAt(result.length - 1) === MIN_CODE
  ) {
    result = result.slice(0, -1)
  }

  return result as PosKey
}

/**
 * Canonical position strictly after `pos`.
 *
 * Decimal analogies:
 *   after(.1)  → .11   (within V=2 viewport)
 *   after(.11) → .12
 *   after(.99) → .99001 (overflow V=2, extend to V=5)
 */
export function after(pos: PosKey): PosKey {
  // Invalid chars in input — append ONE to guarantee result > pos
  for (let i = 0; i < pos.length; i += 1) {
    const code = pos.charCodeAt(i)
    if (code < MIN_CODE || code > MAX_CODE) {
      return (pos + ONE) as PosKey
    }
  }

  // Strip trailing zero digits (canonical form)
  while (pos.length > 1 && pos.charCodeAt(pos.length - 1) === MIN_CODE) {
    // oxlint-disable-next-line no-param-reassign
    pos = pos.slice(0, -1) as PosKey
  }

  if (pos.length === 0 || pos === ZERO) {
    return ONE
  }

  // Viewport: V=2, then 5, 8, 11, …
  let viewport = VIEWPORT_START
  if (pos.length > VIEWPORT_START) {
    viewport =
      VIEWPORT_START +
      Math.ceil((pos.length - VIEWPORT_START) / VIEWPORT_STEP) * VIEWPORT_STEP
  }

  const result = incrementWithinViewport(pos, viewport)
  if (result !== null) {
    return result
  }

  // Overflow current viewport — extend and retry
  viewport += VIEWPORT_STEP
  const extended = incrementWithinViewport(pos, viewport)
  if (extended !== null) {
    return extended
  }

  // Rare fallback
  return (pos + ONE) as PosKey
}

/** Prefix of pos padded to length n with zero digits */
export function takeN(pos: string, n: number): string {
  return n < pos.length ? pos.slice(0, n) : pos + ZERO.repeat(n - pos.length)
}

/** Guaranteed lo < hi — recursive for adjacent digits */
export function $between(lo: PosKey, hi: PosKey | ''): PosKey {
  let index = 0

  const loLength = lo.length
  const hiLength = hi.length

  while (true) {
    const loCode = index < loLength ? lo.charCodeAt(index) : MIN_CODE
    const hiCode = index < hiLength ? hi.charCodeAt(index) : MAX_CODE

    if (loCode === hiCode) {
      index += 1
      continue
    }

    if (hiCode - loCode === 1) {
      // Adjacent digits — resolve in next position (recursive)
      const size = index + 1
      let prefix = lo.slice(0, size)

      if (prefix.length < size) {
        prefix += ZERO.repeat(size - prefix.length)
      }

      const suffix = lo.slice(size) as PosKey
      return (prefix + $between(suffix, '')) as PosKey
    }

    // Gap >= 2 - take midpoint digit and finish
    return (takeN(lo, index) +
      String.fromCharCode((hiCode + loCode) >> 1)) as PosKey
  }
}

/** Returns key strictly between lo and hi (lo < result < hi) */
export function between(lo: PosKey, hi: PosKey): PosKey {
  if (lo < hi) {
    return $between(lo, hi)
  }
  if (lo > hi) {
    return $between(hi, lo)
  }
  throw DactyloError.from({
    code: 'FRACTIONAL_POSITION',
    message: 'Cannot compute value between two equal positions',
    payload: {
      bounds: {
        lower: lo,
        upper: hi,
      },
    },
  })
}

/**
 * Unified key generator
 *
 * @param lo  Lower bound (generate key AFTER this)
 * @param hi  Upper bound (generate key BEFORE this)
 *
 * makePosition()       → ONE ('!')     first block in empty doc
 * makePosition(lo)     → after(lo)     append after last block
 * makePosition(undefined, hi) → before(hi)  prepend before first block
 * makePosition(lo, hi) → between(lo, hi)  insert between two blocks
 */
export function makePosition(lo?: PosKey, hi?: PosKey): PosKey {
  if (lo !== undefined && hi !== undefined) {
    return between(lo, hi)
  }
  if (lo !== undefined) {
    return after(lo)
  }
  if (hi !== undefined) {
    return before(hi)
  }
  return ONE
}

/**
 * Alias for making the initial position:
 * first block in an empty document
 */
export function makeInitialPosition(): PosKey {
  // returns ONE = '!'
  return makePosition()
}

/** Checks whether a given string is a valid `PosKey` value. */
export function isPosKey(str: string): str is PosKey {
  if (str.length === 0) {
    return false
  }

  // Last char must not be zero digit (no trailing spaces)
  const lastIdx = str.length - 1
  const last = str.charCodeAt(lastIdx)
  if (last < MIN_NON_ZERO_CODE || last > MAX_CODE) {
    return false
  }

  // All chars must be in the alphabet
  for (let i = 0; i < lastIdx; i += 1) {
    const code = str.charCodeAt(i)
    if (code < MIN_CODE || code > MAX_CODE) {
      return false
    }
  }

  return true
}

/** Clamp invalid input to nearest valid key */
export function asPosKey(str: string): PosKey {
  if (isPosKey(str)) {
    return str
  }

  const codes: number[] = []
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i)
    codes.push(code < MIN_CODE ? MIN_CODE : code > MAX_CODE ? MAX_CODE : code)
  }

  while (codes.length > 0 && codes[codes.length - 1] === MIN_CODE) {
    codes.length -= 1
  }

  return codes.length > 0 ? (String.fromCodePoint(...codes) as PosKey) : ONE
}
