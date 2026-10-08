import {
  DEFAULT_FAST_IKI_MS,
  DEFAULT_EMA_ALPHA,
  DEFAULT_MAX_CHAR_WHEN_FAST,
  DEFAULT_TYPING_BURST_PAUSE_MS,
  DEFAULT_SLOW_IKI_MS,
  DEFAULT_MAX_CHAR_WHEN_SLOW,
} from './constants'
import { clamp, lerp } from './utils'

/** Options for constructing a {@link TypingBurstController} instance. */
export interface TypingBurstOptions {
  /** Maximum gap between typing events to consider them part of the same burst. */
  pauseMs?: number

  /** Exponential Moving Average (EMA) for latest inter-key interval (0-1)/ */
  emaAlpha?: number

  /** User inter-key internal (IKI) between commits at or below this (fast).  */
  fastIkiMs?: number

  /** User inter-key internal (IKI) between commits above this (slow). */
  slowIkiMs?: number

  /** Maximum number of characters to type when in fast mode. */
  maxCharWhenFast?: number

  /** Maximum number of characters to type when in slow mode. */
  maxCharWhenSlow?: number
}

/**
 * Adaptive typing burst policy: pause threshold + EMA inter-key interval
 * → speed-dependent max coalesce length (undo grouping).
 */
export class TypingBurstController {
  /** Maximum gap between typing events to consider them part of the same burst. */
  #pauseMs: number

  /** Exponential Moving Average (EMA) for latest inter-key interval (0-1). */
  #emaAlpha: number

  /** User inter-key internal (IKI) between commits at or below this (fast). */
  #fastIkiMs: number

  /** User inter-key internal (IKI) between commits above this (slow). */
  #slowIkiMs: number

  /** Maximum number of characters to type when in fast mode. */
  #maxCharWhenFast: number

  /** Maximum number of characters to type when in slow mode. */
  #maxCharWhenSlow: number

  /** Smoothed ms between commits; `null` until second keystroke in a burst.*/
  #emaIkiMs: number | null

  constructor(options: TypingBurstOptions = {}) {
    this.#pauseMs = options.pauseMs ?? DEFAULT_TYPING_BURST_PAUSE_MS
    this.#emaAlpha = options.emaAlpha ?? DEFAULT_EMA_ALPHA
    this.#fastIkiMs = options.fastIkiMs ?? DEFAULT_FAST_IKI_MS
    this.#slowIkiMs = options.slowIkiMs ?? DEFAULT_SLOW_IKI_MS
    this.#maxCharWhenFast =
      options.maxCharWhenFast ?? DEFAULT_MAX_CHAR_WHEN_FAST
    this.#maxCharWhenSlow =
      options.maxCharWhenSlow ?? DEFAULT_MAX_CHAR_WHEN_SLOW

    this.#emaIkiMs = null
  }

  /** Current smoothed IKI (read-only for tests). */
  get emaIkiMs(): number | null {
    return this.#emaIkiMs
  }

  /** Drop speed estimate (new undo group, non-typing action, spatial break, …) */
  reset(): void {
    this.#emaIkiMs = null
  }

  /** Compute the speed factor based on the current IKI. */
  #computeSpeedFactor(ikiMs: number): number {
    const span = this.#slowIkiMs - this.#fastIkiMs
    if (span <= 0) {
      return ikiMs <= this.#fastIkiMs ? 1 : 0
    }

    const t = (this.#slowIkiMs - ikiMs) / span
    return clamp(t, 0, 1)
  }

  /** Compute the maximum number of characters allowed based on the current speed. */
  #computeMaxChars(): number {
    if (this.#emaIkiMs === null) {
      return this.#maxCharWhenSlow
    }

    const factor = this.#computeSpeedFactor(this.#emaIkiMs)
    const interpolated = Math.round(
      lerp(this.#maxCharWhenSlow, this.#maxCharWhenFast, factor),
    )

    return clamp(interpolated, this.#maxCharWhenSlow, this.#maxCharWhenFast)
  }

  /**
   * Decide to whether to coalesce the incoming keystroke with the previous history entry.
   * Updates internal EMA state when the burst continues (not on pause break).
   */
  shouldContinue(opts: {
    /** Timestamp of the last history commit in this burst (`HistoryEntry.timestamp`). */
    lastEventMs: number
    /** Timestamp of the incoming keystroke commit. */
    nowMs: number
    /** Length of text already in the undo entry being extended. */
    accumulatedChars: number
    /** Length of the incoming insert (usually `1`). */
    incomingChars: number
  }): boolean {
    const gap = opts.nowMs - opts.lastEventMs

    if (gap > this.#pauseMs) {
      this.reset()
      return false
    }

    this.#emaIkiMs =
      this.#emaIkiMs === null
        ? gap
        : this.#emaAlpha * gap + (1 - this.#emaAlpha) * this.#emaIkiMs

    const maxChars = this.#computeMaxChars()
    const nextLen = opts.accumulatedChars + opts.incomingChars
    const continueBurst = nextLen <= maxChars

    /** Cap hit: next push starts a fresh group; don't carry old speed into it. */
    if (!continueBurst) {
      this.reset()
    }

    return continueBurst
  }
}
