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
