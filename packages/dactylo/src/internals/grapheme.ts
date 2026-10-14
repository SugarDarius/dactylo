/** Clamps the offset to the length of the text. */
export function clampTextOffset(text: string, offset: number): number {
  return Math.max(0, Math.min(offset, text.length))
}

/** A range of a grapheme cluster in a text. */
export interface GraphemeRange {
  /** The start index of the grapheme cluster. */
  readonly start: number
  /** The end index of the grapheme cluster. */
  readonly end: number
}

/** Options for constructing a {@link GraphemeOffsetCaret} instance. */
export interface GraphemeOffsetCaretOptions {
  /** The locales to use for the segmenter. */
  readonly locales?: Intl.LocalesArgument
}

export class GraphemeOffsetCaret {
  /** The segmenter for grapheme clusters. */
  #segmenter: Intl.Segmenter

  constructor(opts: GraphemeOffsetCaretOptions) {
    this.#segmenter = new Intl.Segmenter(opts.locales, {
      granularity: 'grapheme',
    })
  }

  /**
   * Iterates grapheme clusters as UTF-16 [start, end) ranges.
   * @yields {GraphemeRange} The range of the grapheme cluster.
   */
  *#iterRanges(text: string): Generator<GraphemeRange> {
    for (const part of this.#segmenter.segment(text)) {
      const start = part.index
      const end = start + part.segment.length
      yield { end, start }
    }
  }

  /** UTF-16 index of the grapheme containing `index` (clamps into string). */
  #getRangeContaining(text: string, index: number): GraphemeRange {
    if (text.length <= 0) {
      return { end: 0, start: 0 }
    }

    const clamped = Math.max(0, Math.min(index, text.length - 1))

    for (const { start, end } of this.#iterRanges(text)) {
      if (clamped >= start && clamped < end) {
        return { end, start }
      }
    }

    return { end: text.length, start: text.length }
  }

  /** Computes all grapheme boundary offsets: 0, …, text.length. */
  #getBounds(text: string): readonly number[] {
    const bounds: number[] = [0]

    for (const { end } of this.#iterRanges(text)) {
      if (bounds[bounds.length - 1] !== end) {
        bounds.push(end)
      }
    }

    if (bounds[bounds.length - 1] !== text.length) {
      bounds.push(text.length)
    }

    return bounds
  }

  /**
   * Snaps to the end of the grapheme cluster at the given offset.
   * Only if the caret sits inside it.
   */
  snapOffsetToBoundary(text: string, offset: number): number {
    const clamped = clampTextOffset(text, offset)
    if (clamped === 0 || clamped === text.length) {
      return clamped
    }

    for (const { start, end } of this.#iterRanges(text)) {
      if (clamped > start && clamped < end) {
        return end
      }

      if (clamped === start || clamped === end) {
        return clamped
      }
    }

    return clamped
  }

  /**
   * Computes the previous grapheme offset caret in a text.
   * One ← press: previous caret position.
   */
  getPrevOffset(text: string, offset: number): number {
    const snapped = this.snapOffsetToBoundary(text, offset)
    if (snapped === 0) {
      return 0
    }

    const bounds = this.#getBounds(text)

    for (const bound of bounds.toReversed()) {
      if (bound < snapped) {
        return bound
      }
    }

    return 0
  }

  /**
   * Computes the next grapheme offset caret in a text.
   * One → press: next caret position.
   */
  getNextOffset(text: string, offset: number): number {
    const snapped = this.snapOffsetToBoundary(text, offset)
    if (snapped === text.length) {
      return text.length
    }

    const bounds = this.#getBounds(text)

    for (const bound of bounds) {
      if (bound > snapped) {
        return bound
      }
    }

    return text.length
  }

  /** Deletes the grapheme immediately before the caret. */
  getDeleteRange(
    text: string,
    offset: number,
  ): { start: number; length: number } {
    const snapped = this.snapOffsetToBoundary(text, offset)
    if (snapped === 0) {
      return { length: 0, start: 0 }
    }

    const { start, end } = this.#getRangeContaining(text, snapped - 1)
    return { length: end - start, start }
  }
}
