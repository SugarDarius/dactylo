import { InlineBuffer } from './inline-buffer'

/** Options for constructing a {@link MentionBuffer}. */
export interface MentionBufferOptions {
  /** Whether to enable debug mode. */
  readonly debug: boolean

  /** Whether to enable mention buffering. */
  readonly enabled: boolean
}

export class MentionBuffer extends InlineBuffer {
  constructor(options: MentionBufferOptions) {
    super({ ...options, name: 'MentionBuffer' })
  }
}
