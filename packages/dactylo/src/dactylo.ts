import { DEFAULT_PLACEHOLDER } from './internals/constants'
import { createInitialEmptyDocumentState } from './internals/document'
import type { DocumentState } from './internals/document'

/** Options for constructing a {@link Dactylo} instance. */
export interface DactyloProps {
  /** Placeholder text for the editor when no content is written. */
  placeholder?: string
}

/**
 * `DactyloContext` answers the question: what is the full editing context right now?
 *
 * It's the single immutable snapshot that the transaction pipeline reads and produces
 * on every mutation.
 * 
 * What lives where:
 * ┌────────────────────────────────────────────────────────────────---─┐
 * │                        DactyloContext                              │
 * |  ┌─────────────────────---┐  ┌──────────────────────────────────┐  │
 * |  │  state: DocumentState  │  │ selection: Selection | null      │  │
 * |  │  (the written content) │  │ (where the user is editing)      │  │
 * |  └─────────────────────---┘  └──────────────────────────────────┘  │
 * |  ┌─────────────────────────────────────────────────────────────-┐  │
 * |  │    isPlaceholder: boolean (ephemeral empty-doc semantics)    │  │
 * |  └─────────────────────────────────────────────────────────────-┘  │
 * └─────────────────────────────────────────────────────────────────---┘
         │                              │
         ▼                              ▼
    toMarkdown(), exports          caret render, handleKeyDown(),
    AI reads blocks                 copy/paste, onSelectionChanged
 */
export interface DactyloContext {
  /**
   * Current document state ala the manuscript
   * 👉🏻 What is written
   */
  readonly state: DocumentState

  // @todo: add selection state

  /**
   * Whether the document is a placeholder (empty)
   * 👉🏻 Session flag: `true` while the empty-document is showing
   * and the user has not typed real content yet.
   */
  readonly isPlaceholder: boolean
}

/** Creates the initial context for an empty editor with a placeholder */
export function createInitialDactyloContext(
  placeholder: string,
): DactyloContext {
  return {
    isPlaceholder: true,
    state: createInitialEmptyDocumentState(placeholder),
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
 *                                       Reject + error
 */
export class Dactylo {
  /** Placeholder text for the editor when no content is written. */
  readonly placeholder: string

  /** Current editor context */
  #context: DactyloContext

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
    this.#context = createInitialDactyloContext(this.placeholder)
  }
}
