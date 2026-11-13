import { InlineBuffer } from './inline-buffer'

/** Options for constructing a {@link CommandTriggerBuffer}. */
export interface CommandTriggerBufferOptions {
  /** Whether to enable debug mode. */
  readonly debug: boolean

  /** Whether to enable command trigger buffering. */
  readonly enabled: boolean
}

export class CommandTriggerBuffer extends InlineBuffer {
  constructor(options: CommandTriggerBufferOptions) {
    super({ ...options, name: 'CommandTriggerBuffer' })
  }
}
