import type { BlockId } from './blocks'
import { warnOnceIf } from './console'
import type { NodeId } from './nodes'

/** Pointer at the mention character that opened the current buffer. */
export interface MentionPointer {
  /** {@link BlockId} containing the {@link TextNode} where the mention is being typed. */
  readonly blockId: BlockId

  /** {@link NodeId} where the mention is being typed. */
  readonly nodeId: NodeId

  /** Offset inside the {@link TextNode} where the mention character is located. */
  readonly triggerOffset: number
}

/** Options for constructing a {@link MentionBuffer}. */
export interface MentionBufferOptions {
  /** Whether to enable debug mode. */
  readonly debug: boolean

  /** Whether to enable mention buffering. */
  readonly enabled: boolean
}

export class MentionBuffer {
  /** Whether to enable debug mode. */
  readonly #debug: boolean

  /** Whether to enable mention buffering. */
  readonly #enabled: boolean

  /** Pointer at the mention character that opened the current buffer. */
  #pointer: MentionPointer | null

  /** Text that's being typed into the mention buffer. */
  #bufferedText: string | null

  constructor(options: MentionBufferOptions) {
    this.#debug = options.debug
    this.#enabled = options.enabled

    this.#pointer = null
    this.#bufferedText = null
  }

  /** Whether a mention is currently being buffered. */
  get isBuffering(): boolean {
    return this.#enabled && this.#pointer !== null
  }

  /** Returns the text that's being typed into the mention buffer. */
  get typedText(): string | null {
    if (!this.#enabled || this.#pointer === null) {
      warnOnceIf(
        this.#debug,
        '`MentionBuffer.typedText()` called but no mention is being buffered',
      )
      return null
    }

    return this.#bufferedText
  }

  /** Opens a pointer at the caret's mention start. */
  start(input: {
    blockId: BlockId
    nodeId: NodeId
    triggerOffset: number
  }): boolean {
    if (!this.#enabled || this.#pointer !== null) {
      warnOnceIf(
        this.#debug,
        '`MentionBuffer.start()` called but mention buffering is not enabled or a mention is already being buffered',
      )
      return false
    }

    this.#pointer = { ...input }
    this.#bufferedText = ''

    return true
  }

  /** Appends text to the current mention buffer. */
  appendTypedText(text: string): boolean {
    if (!this.#enabled || this.#pointer === null) {
      warnOnceIf(
        this.#debug,
        '`MentionBuffer.appendBufferedText()` called but no mention is being buffered',
      )
      return false
    }

    this.#bufferedText += text

    return true
  }

  /** Aborts the current mention buffering. */
  abort(): boolean {
    if (!this.#enabled || this.#pointer === null) {
      warnOnceIf(
        this.#debug,
        '`MentionBuffer.abort()` called but no mention is being buffered',
      )
      return false
    }

    this.#pointer = null
    return true
  }
}
