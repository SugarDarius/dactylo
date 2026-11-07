/**
 * Time `run` in milliseconds. Optional `warmup` is executed first and not counted.
 */
export function timeMs(run: () => void, warmup?: () => void): number {
  warmup?.()
  const start = performance.now()
  run()
  return performance.now() - start
}

/** UTF-16 payload size of a JS string (2 bytes per code unit). */
export function utf16Bytes(text: string): number {
  return text.length * 2
}

/** UTF-8 byte length of `JSON.stringify(value)`. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
