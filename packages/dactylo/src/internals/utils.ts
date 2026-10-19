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
