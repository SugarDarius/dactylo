import { DEFAULT_PLACEHOLDER } from './internals/constants'
import { createInitialEditorContext } from './internals/editor-context'
import type {
  EditorContext,
  EditorContextListener,
} from './internals/editor-context'
import { TransactionPipeline } from './internals/transaction'
import type { Unsubscriber } from './internals/types'

/** API to interact with the history of the editor. */
export interface DactyloHistoryApi {
  /** Whether at least one undo entry is available. */
  readonly canUndo: () => boolean

  /** Whether at least one redo entry is available. */
  readonly canRedo: () => boolean

  /** Applies the newest undo entry via the pipeline. */
  readonly undo: () => void

  /** Re-applies the newest redo entry via the pipeline. */
  readonly redo: () => void
}

/** Config options to use for the internal components and delegates of the editor. */
export interface DactyloConfig {
  /** Configuration for the transaction pipeline */
  pipeline?: {
    /** Max ops queued before auto-flush. Default 512. Use Infinity for large paste. */
    batchMaxSize?: number

    /** Max undo entries retained. */
    historyMaxDepth?: number
  }
}

/** Options for constructing a {@link Dactylo} instance. */
export interface DactyloOptions {
  /** Placeholder text for the editor when no content is written. */
  placeholder?: string

  /** Config options to use for the internal components and delegates of the editor. */
  config?: DactyloConfig
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
  readonly #placeholder: string

  /** Transaction pipeline to use for the editor */
  readonly #transactionPipeline: TransactionPipeline

  constructor(options: DactyloOptions) {
    this.#placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER
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
      context: createInitialEditorContext(this.#placeholder),
      historyMaxDepth: options.config?.pipeline?.historyMaxDepth,
    })
  }

  /**
   * Returns the API to interact with the history of the editor.
   *
   * @example
   * ```ts
   * const canUndo = editor.history.canUndo()
   * if (canUndo) {
   *  editor.history.undo()
   * }
   * ```
   */
  get history(): DactyloHistoryApi {
    return {
      canRedo: () => this.#transactionPipeline.canRedo(),
      canUndo: () => this.#transactionPipeline.canUndo(),
      redo: () => this.#transactionPipeline.redo(),
      undo: () => this.#transactionPipeline.undo(),
    }
  }

  /**
   * Returns the current editor context snapshot from the transaction pipeline.
   *
   * @example
   * ```ts
   * const context = editor.getEditorContextSnapshot()
   * console.log(context.state.blocks)
   * ```
   */
  getEditorContextSnapshot(): EditorContext {
    return { ...this.#transactionPipeline.context }
  }

  /**
   * Subscribes to the editor context and invokes the listener after each context update.
   * Returns a function to unsubscribe from the listener.
   *
   * @example
   * ```ts
   * editor.subscribe((context) => {
   *  render(context.state.blocks)
   * })
   * ```
   */
  subscribe(listener: EditorContextListener): Unsubscriber {
    return this.#transactionPipeline.addSubscriber(listener)
  }
}
