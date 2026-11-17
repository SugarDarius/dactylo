import type { BlockId } from './blocks'
import { warnOnceIf } from './console'
import { EventSource } from './event-source'
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

/** Event emitted when the state of the {@link InlineBuffer} changes. */
export interface InlineBufferEvent<K extends string> {
  /** Kind of event that was emitted. */
  readonly kind: K

  /** State of the inline buffer. */
  readonly state: 'started' | 'buffering' | 'aborted' | 'released'

  /** Pointer at the inline character that opened the current buffer. */
  readonly pointer: InlineBufferPointer | null

  /** Text that's being typed into the inline buffer. */
  readonly bufferedText: string | null
}

export interface InlineBufferOptions<K extends string> {
  /** Name of the inline buffer. */
  readonly name?: string

  /** Kind of event that will be emitted. */
  readonly eventKind: K

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
 * {@link InlineBufferPointer}. After each document commit the pipeline syncs
 * `bufferedText` from the text between the opener and the caret, or aborts
 * when the opener is gone or the selection is a range. {@link MentionBuffer}
 * and {@link CommandTriggerBuffer} share this lifecycle so mentions and slash
 * commands stay mutually exclusive.
 *
 * Rationale:
 * The opener is still inserted into the document as ordinary text. “The user
 * is composing a mention” is not a document fact — it is ephemeral UX state.
 * Re-scanning the node on every keystroke would treat incidental `@` / `/`
 * (emails, paths) as queries, and would ignore the open-position invariant.
 * Keeping the query here lets a picker read `bufferedText` without parsing the
 * AST, and `abort` / `release` can drop the pointer without mutating the document.
 */
export class InlineBuffer<K extends string> extends EventSource<
  InlineBufferEvent<K>
> {
  /** Name of the inline buffer. */
  readonly #name: string

  /** Kind of event that will be emitted. */
  readonly #kind: K

  /** Whether to enable debug mode. */
  readonly #debug: boolean

  /** Whether to enable inline buffering. */
  readonly #enabled: boolean

  /** Pointer at the inline character that opened the current buffer. */
  #pointer: InlineBufferPointer | null

  /** Text that's being typed into the inline buffer. */
  #bufferedText: string | null

  constructor(options: InlineBufferOptions<K>) {
    super()

    this.#name = options.name ?? 'InlineBuffer'
    this.#kind = options.eventKind

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
    return this.#bufferedText
  }

  /** Returns the current inline buffer pointer. */
  get pointer(): InlineBufferPointer | null {
    return this.#pointer
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

    this.notify({
      bufferedText: this.#bufferedText,
      kind: this.#kind,
      pointer: this.#pointer,
      state: 'started',
    })

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

  /** Updates the buffered text of the current inline buffer. */
  updateBufferedText(text: string): boolean {
    if (!this.#enabled || this.#pointer === null) {
      warnOnceIf(
        this.#debug,
        `\`${this.#name}.updateBufferedText()\` called but no inline is being buffered`,
      )
      return false
    }

    if (this.#bufferedText === text) {
      return true
    }

    this.#bufferedText = text

    this.notify({
      bufferedText: this.#bufferedText,
      kind: this.#kind,
      pointer: this.#pointer,
      state: 'buffering',
    })

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

    this.notify({
      bufferedText: this.#bufferedText,
      kind: this.#kind,
      pointer: this.#pointer,
      state: 'aborted',
    })

    return true
  }

  /** Releases the current inline buffer. */
  release(): boolean {
    this.#pointer = null
    this.#bufferedText = null

    this.notify({
      bufferedText: this.#bufferedText,
      kind: this.#kind,
      pointer: this.#pointer,
      state: 'released',
    })

    return true
  }
}
