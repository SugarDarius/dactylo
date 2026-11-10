import { isPlainObject } from './utils'

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
