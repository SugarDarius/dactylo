/** URL-safe alphabet (64 chars). */
export const URL_ALPHABET =
  '57X6y3wQZNzYjJB2L_10pxbackgroundhimselfUTF-8DEMOGRAPHICSVqvt4KW9'

/** Web Crypto quota per `crypto.getRandomValues` call. */
export const GET_RANDOM_MAX_BYTES = 65_536

/**
 * Fills the given `bytes` array with random values.
 *
 * Random bytes are filled in chunks of at most 65536 so a large `length`
 * never hits the `crypto.getRandomValues` quota.
 */
export function fillRandom(bytes: Uint8Array): void {
  let offset = 0
  while (offset < bytes.length) {
    const chunkSize = Math.min(GET_RANDOM_MAX_BYTES, bytes.length - offset)
    const chunk = new Uint8Array(chunkSize)

    crypto.getRandomValues(chunk)

    bytes.set(chunk, offset)
    offset += chunkSize
  }
}

/**
 * Generates a URL-safe random ID of `length` characters.
 *
 * Random bytes are filled in chunks of at most 65536 so a large `length`
 * never hits the `crypto.getRandomValues` quota.
 *
 * Adapted from `nanoid` (MIT), Andrey Sitnik.
 * → https://github.com/ai/nanoid
 */
export function generateRandomId(length: number): string {
  if (!(Number.isInteger(length) && length >= 0)) {
    throw new RangeError(
      `ID length must be a non-negative integer, received ${length}`,
    )
  }

  if (length === 0) {
    return ''
  }

  const bytes = new Uint8Array(length)
  fillRandom(bytes)

  let id = ''
  for (const byte of bytes) {
    id += URL_ALPHABET.charAt(byte & 63)
  }

  return id
}
