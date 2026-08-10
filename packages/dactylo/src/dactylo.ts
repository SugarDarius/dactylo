import { DEFAULT_PLACEHOLDER } from './constants'

/** Options for constructing a {@link Dactylo} instance. */
export interface DactyloProps {
  /** Placeholder text for the editor when no content is written. */
  placeholder?: string
}

// oxlint-disable-next-line typescript/no-extraneous-class
export class Dactylo {
  /** Placeholder text for the editor when no content is written. */
  readonly #placeholder: string

  constructor(options: DactyloProps) {
    this.#placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER
  }

  /** Get the placeholder text for the editor. */
  get placeholder() {
    return this.#placeholder
  }
}
