/**
 * Utility function to assert that a value is never
 * that can be used in a switch statement with TypeScript.
 */
export function assertNever(value: never, msg?: string): never {
  let message = `Unexpected value: ${JSON.stringify(value)}`
  if (msg) {
    message += `\n${msg}`
  }
  throw new Error(message)
}
