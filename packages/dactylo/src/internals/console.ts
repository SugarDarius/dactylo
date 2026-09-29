/** CSS applied to the `%cDactylo` badge in styled console output. */
const BADGE =
  'background-color:#171717;border-radius:6px;color:#E5E5E5;padding:3px 7px;font-family:sans-serif;font-weight:600;'

/**
 * Returns a console method that either forwards to the native API or prints
 * with a branded prefix.
 *
 * @param method - Native `console` method to delegate to (`log`, `warn`, or `error`).
 * @returns A function with the same call signature as the chosen console method.
 */
function wrap(
  method: 'log' | 'warn' | 'error',
): (message: string, ...args: readonly unknown[]) => void {
  return typeof window === 'undefined'
    ? console[method]
    : (message, ...args) =>
        console[method]('%cDactylo', BADGE, message, ...args)
}

/** A wrapper around the native `console` methods but with some sugar. */
export interface SugarConsole {
  /** Log a non-fatal diagnostic. */
  warn: (message: string, ...args: readonly unknown[]) => void
  /** Log a failure or unexpected condition. */
  error: (message: string, ...args: readonly unknown[]) => void
}

/**
 * Branded `console.warn` / `console.error` helpers for Dactylo internals.
 *
 * In the browser (non-server), messages are prefixed with a styled **Dactylo**
 * badge. On the server output is forwarded unchanged so logs stay readable in SSR and test runners.
 *
 * In other words, it's a wrapper around the native `console` methods but with some sugar.
 */
function makeConsole() {
  const emittedWarnings = new Set<string>()

  const warn = wrap('warn')
  const error = wrap('error')

  return {
    /** Log a failure or unexpected condition. */
    error,
    /** Log a non-fatal diagnostic. */
    warn,
    /** Emits a warning only once. */
    warnOnce: (message: string, ...args: readonly unknown[]): void => {
      if (emittedWarnings.has(message)) {
        return
      }
      emittedWarnings.add(message)
      warn(message, ...args)
    },
  }
}

export const { error, warn, warnOnce } = makeConsole()
