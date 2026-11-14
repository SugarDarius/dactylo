import type { BlockId } from './blocks'
import { warnOnceIf } from './console'
import type { NodeId } from './nodes'

/** Pointer at the inline character that opened the current buffer. */
export interface InlineBufferPointer {
  /** {@link BlockId} containing the {@link TextNode} where the inline character is being typed. */
  readonly blockId: BlockId

  /** {@link NodeId} where the inline character is being typed. */
  readonly nodeId: NodeId

  /** Offset inside the {@link TextNode} where the inline character is located. */
  readonly triggerOffset: number
}

export interface InlineBufferOptions {
  /** Name of the inline buffer. */
  readonly name?: string

  /** Whether to enable debug mode. */
  readonly debug: boolean

  /** Whether to enable inline buffering. */
  readonly enabled: boolean
}

/**
 * Holds the in-progress query after a typed inline opener (ex. `@` mention, `/` command trigger, …).
 *
 * Purpose:
 * When the user types an opener at a safe caret (start of a {@link TextNode},
 * or immediately after whitespace), this buffer records that caret as an
 * {@link InlineBufferPointer} and then accumulates the characters typed after
 * the opener. {@link MentionBuffer} and {@link CommandTriggerBuffer}
 * share this lifecycle so mentions and slash commands stay mutually exclusive.
 *
 * Rationale:
 * The opener is still inserted into the document as ordinary text. “The user
 * is composing a mention” is not a document fact — it is ephemeral UX state.
 * Re-scanning the node on every keystroke would treat incidental `@` / `/`
 * (emails, paths) as queries, and would ignore the open-position invariant.
 * Keeping the query here lets a picker read `bufferedText` without parsing the
 * AST, and `abort` / `release` can drop the pointer without mutating the document.
 */
export class InlineBuffer {
  /** Name of the inline buffer. */
  readonly #name: string

  /** Whether to enable debug mode. */
  readonly #debug: boolean

  /** Whether to enable inline buffering. */
  readonly #enabled: boolean

  /** Pointer at the inline character that opened the current buffer. */
  #pointer: InlineBufferPointer | null

  /** Text that's being typed into the inline buffer. */
  #bufferedText: string | null

  constructor(options: InlineBufferOptions) {
    this.#name = options.name ?? 'InlineBuffer'
    this.#debug = options.debug
    this.#enabled = options.enabled

    this.#pointer = null
    this.#bufferedText = null
  }

  /** Whether a inline is currently being buffered. */
  get isBuffering(): boolean {
    return this.#enabled && this.#pointer !== null
  }

  /** Returns the text that's being typed into the inline buffer. */
  get bufferedText(): string | null {
    if (!this.#enabled || this.#pointer === null) {
      warnOnceIf(
        this.#debug,
        `\`${this.#name}.bufferedText()\` called but no inline is being buffered`,
      )
      return null
    }

    return this.#bufferedText
  }

  /** Opens a pointer at the caret's inline start. */
  start(input: {
    blockId: BlockId
    nodeId: NodeId
    triggerOffset: number
  }): boolean {
    if (!this.#enabled || this.#pointer !== null) {
      warnOnceIf(
        this.#debug,
        `\`${this.#name}.start()\` called but inline buffering is not enabled or a inline is already being buffered`,
      )
      return false
    }

    this.#pointer = { ...input }
    this.#bufferedText = ''

    return true
  }

  /** Returns the current inline buffer pointer and buffered text. */
  get(): [InlineBufferPointer | null, string | null] {
    if (
      !this.#enabled ||
      this.#pointer === null ||
      this.#bufferedText === null
    ) {
      warnOnceIf(
        this.#debug,
        `\`${this.#name}.get()\` called but inline buffering is not enabled or not being buffered`,
      )
      return [null, null]
    }

    return [this.#pointer, this.#bufferedText]
  }

  /** Appends text to the current inline buffer. */
  append(text: string): boolean {
    if (!this.#enabled || this.#pointer === null) {
      warnOnceIf(
        this.#debug,
        `\`${this.#name}.appendBufferedText()\` called but no inline is being buffered`,
      )
      return false
    }

    this.#bufferedText += text

    return true
  }

  /** Aborts the current inline buffering. */
  abort(): boolean {
    if (!this.#enabled || this.#pointer === null) {
      warnOnceIf(
        this.#debug,
        `\`${this.#name}.abort()\` called but no inline is being buffered`,
      )
      return false
    }

    this.#pointer = null
    this.#bufferedText = null

    return true
  }

  /** Releases the current inline buffer. */
  release(): boolean {
    this.#pointer = null
    this.#bufferedText = null

    return true
  }
}
