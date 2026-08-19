import { DEFAULT_PLACEHOLDER } from './internals/constants'
import { createInitialEmptyDocState } from './internals/document'
import type { DocState } from './internals/document'

/** Options for constructing a {@link Dactylo} instance. */
export interface DactyloProps {
  /** Placeholder text for the editor when no content is written. */
  placeholder?: string
}

export class Dactylo {
  /** Placeholder text for the editor when no content is written. */
  readonly placeholder: string

  /** Current document state */
  #state: DocState

  constructor(options: DactyloProps) {
    this.placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER
    /**
     * Initialize the document state.
     * If no initial content is provided, it creates an empty document
     * with a placeholder.
     *
     * Otherwise initial document state is provider from either:
     *  - a JSON object (validated against the current schema version)
     *  - a markdown string
     *
     * TODO: handle initial content from props
     *  - from JSON
     *  - from markdown string
     */
    this.#state = createInitialEmptyDocState(this.placeholder)
  }
}
