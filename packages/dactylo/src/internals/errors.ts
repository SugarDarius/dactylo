/**
 * String-based check avoiding `instanceof` to fail across different bundles
 * due to duplicate class identities.
 */
export function isDactyloError(err: unknown): err is DactyloError {
  return err instanceof Error && err.name === 'DactyloError'
}

/**
 * Stable error categories for {@link DactyloError}.
 */
export type DactyloErrorCode =
  /** Unexpected failure; default when {@link DactyloError.wrap} receives a non-`DactyloError`. */
  | 'UNKNOWN'
  /** Unexpected fractional position error when computing a position key */
  | 'FRACTIONAL_POSITION'

/**
 * Typed error for Dactylo operations.
 *
 * Thrown by {@link Dactylo} and its methods for reporting failures
 * coming from underlying actions or unexpected errors.
 */
export class DactyloError extends Error {
  /** Category of the failure; see {@link DactyloErrorCode}. */
  readonly code: DactyloErrorCode

  /** `true` when the failure is deterministic and final (not retryable) */
  readonly permanent: boolean

  /**
   * Underlying error when this instance wraps a foreign failure.
   *
   * Preserved for debugging and monitoring. Prefer logging `cause` directly
   * rather than `JSON.stringify` on the whole error.
   */
  override readonly cause?: unknown

  constructor(opts: {
    code: DactyloErrorCode
    message: string
    permanent?: boolean
    cause?: unknown
  }) {
    super(opts.message)

    this.code = opts.code
    this.permanent = opts.permanent ?? false
    this.cause = opts.cause ?? undefined

    this.name = 'DactyloError'
  }

  /**
   * Build an {@link DactyloError} with optional hint and payload appended to the message.
   *
   * Used for failures where the message is constructed
   * deliberately (configuration errors, action errors, erc.).
   *
   * @example
   * ```ts
   * import { DactyloError } from '@sugardarius/dactylo'
   *
   * throw DactyloError.from('UNKNOWN', 'missing required credentials', {
   *   hint: 'actions/add-block',
   * })
   * ```
   */
  static from(opts: {
    code: DactyloErrorCode
    message: string
    cause?: unknown
    permanent?: boolean
    /** Short hint for the source of the error. */
    hint?: string
    /** Additional structured data for the error. */
    payload?: Record<string, unknown>
  }): DactyloError {
    let msg = `\n${opts.message}`

    if (opts.hint) {
      msg += `\nHint: ${opts.hint}`
    }

    if (opts.payload) {
      msg += `\nPayload: ${JSON.stringify(opts.payload)}`
    }

    return new DactyloError({
      cause: opts.cause,
      code: opts.code,
      message: msg,
      permanent: opts.permanent,
    })
  }

  /**
   * Normalize an unknown thrown value into an {@link DactyloError}.
   *
   * Returns the input unchanged when it is already an `DactyloError`. Otherwise
   * wraps it with {@link cause} set to the original value.
   *
   * @example
   * ```ts
   * import { DactyloError } from '@sugardarius/dactylo'
   *
   * try {
   *   await dactylo.addBlock(block)
   * } catch (error) {
   *   throw DactyloError.wrap(error)
   * }
   * ```
   */
  static wrap(err: unknown): DactyloError {
    if (isDactyloError(err)) {
      return err
    }

    return new DactyloError({
      cause: err,
      code: 'UNKNOWN',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
