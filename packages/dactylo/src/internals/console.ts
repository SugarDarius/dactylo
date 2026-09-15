/**
 * Branded `console.warn` / `console.error` helpers for Dactylo internals.
 *
 * In the browser (non-test), messages are prefixed with a styled **Dactylo**
 * badge. On the server or under `NODE_ENV=test`, output is forwarded unchanged
 * so logs stay readable in SSR and test runners.
 */
/** CSS applied to the `%cDactylo` badge in styled console output. */
export const BADGE =
  'background-color:#171717;border-radius:6px;color:#E5E5E5;padding:3px 7px;font-family:sans-serif;font-weight:600;'

/**
 * Returns a console method that either forwards to the native API or prints
 * with a branded prefix.
 *
 * @param method - Native `console` method to delegate to (`log`, `warn`, or `error`).
 * @returns A function with the same call signature as the chosen console method.
 */
export function wrap(
  method: 'log' | 'warn' | 'error',
): (message: string, ...args: readonly unknown[]) => void {
  return typeof window === 'undefined' || process.env.NODE_ENV === 'test'
    ? console[method]
    : (message, ...args) =>
        console[method]('%cDactylo', BADGE, message, ...args)
}

/** Log a non-fatal diagnostic. */
export const warn = wrap('warn')
/** Log a failure or unexpected condition. */
export const error = wrap('error')
