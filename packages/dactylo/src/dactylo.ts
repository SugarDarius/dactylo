import { DEFAULT_PLACEHOLDER } from './internals/constants'
import {
  createInitialEditorContext,
  type EditorContext,
} from './internals/editor-context'

/** Options for constructing a {@link Dactylo} instance. */
export interface DactyloOptions {
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
 *                              Reject (state unchanged) + error
 *
 * @example
 * ```ts
 * import { Dactylo } from '@sugardarius/dactylo'
 *
 * const editor = new Dactylo({
 *  placeholder: 'Write something...',
 * })
 * ```
 */
export class Dactylo {
  /** Placeholder text for the editor when no content is written. */
  readonly placeholder: string

  /** Current editor context */
  #context: EditorContext

  constructor(options: DactyloOptions) {
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
    this.#context = createInitialEditorContext(this.placeholder)
  }

  /** Returns the current editor context snapshot. */
  getContextSnapshot(): EditorContext {
    return { ...this.#context }
  }
}
