import { PLAIN_TEXT_LINK_PATTERN } from './constants'

/**
 * Utility function to assert that a value is never
 * that can be used in a switch statement with TypeScript.
 */
export function assertNever(value: never, opts: { hint?: string } = {}): never {
  let message = `\nUnexpected value: ${JSON.stringify(value)}`
  if (opts.hint) {
    message += `\nHint: ${opts.hint}`
  }

  throw new Error(message)
}

/** A no-op function. */
// oxlint-disable-next-line no-empty-function
export function noop(): void {}

/** A function that returns a false value. */
export function negate(): false {
  return false
}

/** Clamps `value` to the range `[min, max]` (inclusive). */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/** Linearly interpolates between `a` and `b` by `t` (0-1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Checks whether DOM is available. */
export function canUseDOM(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof document !== 'undefined' &&
    document.createElement !== undefined
  )
}

/** Clones a regular expression. */
export function cloneRegExp(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags)
}

/** Normalizes a URL to a full URL. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (PLAIN_TEXT_LINK_PATTERN.test(trimmed)) {
    return trimmed
  }

  return `https://${trimmed}`
}

/**
 * Checks whether a value is a plain object.
 * Implementation taken from the amazing `decoders` lib.
 * 👉🏻 https://github.com/nvie/decoders/blob/7d17576a1dcf378e14fb7d3de429bd7d44a313cb/src/lib/utils.ts#L66
 */
export function isPlainObject(blob: unknown): blob is Record<string, unknown> {
  return (
    blob !== null &&
    typeof blob === 'object' &&
    Object.prototype.toString.call(blob) === '[object Object]'
  )
}

/** Shallowly compare two arrays. */
export function shallowArray(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) {
      return false
    }
  }

  return true
}

/** Shallowly compare two objects. */
export function shallowObject(a: unknown, b: unknown): boolean {
  if (!isPlainObject(a) || !isPlainObject(b)) {
    return false
  }

  const keysA = Object.keys(a)
  const keysB = Object.keys(b)

  if (keysA.length !== keysB.length) {
    return false
  }

  return keysA.every(
    (key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]),
  )
}

/** Shallowly compare two arbitrary values.*/
export function shallow(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true
  }

  const isArrayA = Array.isArray(a)
  const isArrayB = Array.isArray(b)

  if (isArrayA || isArrayB) {
    if (!isArrayA || !isArrayB) {
      return false
    }

    return shallowArray(a, b)
  }

  return shallowObject(a, b)
}
