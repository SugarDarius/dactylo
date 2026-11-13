import { InlineBuffer } from './inline-buffer'

/** Options for constructing a {@link InlineCommandTriggerBuffer}. */
export interface InlineCommandTriggerBufferOptions {
  /** Whether to enable debug mode. */
  readonly debug: boolean

  /** Whether to enable inline command trigger buffering. */
  readonly enabled: boolean
}

export class InlineCommandTriggerBuffer extends InlineBuffer {
  constructor(options: InlineCommandTriggerBufferOptions) {
    super({ ...options, name: 'InlineCommandTriggerBuffer' })
  }
}
