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

  /** Appends text to the current inline buffer. */
  appendTypedText(text: string): boolean {
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
