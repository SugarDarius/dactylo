import { DEFAULT_PLACEHOLDER } from './internals/constants'
import { createInitialEmptyDocumentState } from './internals/document'
import type { DocumentState } from './internals/document'

/** Options for constructing a {@link Dactylo} instance. */
export interface DactyloProps {
  /** Placeholder text for the editor when no content is written. */
  placeholder?: string
}

/**
 * Dactylo is a block-based rich-text markdown editor whose runtime model is a structured document (blocks + inline nodes),
 * not a plain text buffer with regex parsing on every keystroke.
 *
 * Users edit through familiar markdown behaviors (`# ` for headings, `**bold**`, etc.)
 * while the engine maintains a typed AST-like structure optimized for mutation, history, and future collaboration.
 *
 * The core spine of Dactylo is a transactional pipeline as it provides:
 *  1. Atomic batches
 *  2. Predictable and reversible mutations and optimistic local updates
 *  3. Side effects: history, listeners, ...
 *  4. Uniform input paths: keyboard, Ai edits, imports, all produce transactions
 *
 * Pipeline stages:
 * ┌─────────────┐   ┌──────────────┐   ┌───────────┐   ┌────────────┐   ┌──────────-┐
 * │   Source    │ → │ Build Tx     │ → │ Validate  │ → │ Apply      │ → │ Commit    │
 * │ (input/AI)  │   │ (ops batch)  │   │ (schema)  │   │ (pure)     │   │ (effects) │
 * └─────────────┘   └──────────────┘   └───────────┘   └────────────┘   └──────────-┘
 *                                          ↓ fail
 *                                       Reject + error
 */
export class Dactylo {
  /** Placeholder text for the editor when no content is written. */
  readonly placeholder: string

  /** Current document state */
  #state: DocumentState

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
    this.#state = createInitialEmptyDocumentState(this.placeholder)
  }
}
