import { DEFAULT_PLACEHOLDER } from './internals/constants'
import { createInitialEditorContext } from './internals/editor-context'
import type { EditorContext } from './internals/editor-context'
import { TransactionPipeline } from './internals/transaction'

/** Options for constructing a {@link Dactylo} instance. */
export interface DactyloOptions {
  /** Placeholder text for the editor when no content is written. */
  placeholder?: string

  /** Config options to use for the internal components of the editor. */
  config?: {
    /** Configuration for the transaction pipeline */
    pipeline?: {
      /** Max ops queued before auto-flush. Default 512. Use Infinity for large paste. */
      batchMaxSize?: number
    }
  }
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

  /** Transaction pipeline to use for the editor */
  readonly #transactionPipeline: TransactionPipeline

  constructor(options: DactyloOptions) {
    this.placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER
    this.#transactionPipeline = new TransactionPipeline({
      batchMaxSize: options.config?.pipeline?.batchMaxSize,
      /**
       * Initialize the editor context
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
      context: createInitialEditorContext(this.placeholder),
    })
  }

  /** Returns the current editor context snapshot from the transaction pipeline. */
  getEditorContextSnapshot(): EditorContext {
    return { ...this.#transactionPipeline.context }
  }
}
