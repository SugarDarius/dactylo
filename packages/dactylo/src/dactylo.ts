import { DEFAULT_PLACEHOLDER } from './internals/constants'

/** Options for constructing a {@link Dactylo} instance. */
export interface DactyloProps {
  /** Placeholder text for the editor when no content is written. */
  placeholder?: string
}

export class Dactylo {
  /** Placeholder text for the editor when no content is written. */
  readonly placeholder: string

  constructor(options: DactyloProps) {
    this.placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER
  }
}
