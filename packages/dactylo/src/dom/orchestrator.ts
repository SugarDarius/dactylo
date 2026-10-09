import { error, warnOnceIf } from '../internals/console'
import { DactyloError } from '../internals/errors'
import type { TextCursor } from '../internals/selection'
import type { CancelCallback } from '../internals/types'
import { findBlockEditableElement } from './blocks'
import { paintCursorCaretAtPositionInDOM } from './cursor'

/** Options for configuring {@link Orchestrator}. */
export interface OrchestratorOptions {
  /** Whether to enable debug mode. */
  readonly debug?: boolean
}

/**
 * Orchestrates the DOM selection for the Dactylo editor.
 *  - DOM → model: `pointerup` on the editable element + `selectionchange` events.
 *  - Model → DOM: paths a collapsed cursor caret in the current editable block.
 */
export class Orchestrator {
  /** The HTML div `[dactylo-editable]` element. */
  #editable: HTMLDivElement | null = null

  /**
   * Whether the DOM selection is currently being painted.
   * While `true`, DOM → model sync must not run.
   * So programmatic `addRange` calls does not commit back into {@link EditorContext}
   */
  #isPainting = false

  /** Whether to enable debug mode. */
  readonly #debug: boolean

  constructor(options: OrchestratorOptions = {}) {
    this.#debug = options.debug ?? false
  }

  /** Attaches the DOM selection orchestrator to the editable element. */
  attach(editable: HTMLDivElement): void {
    this.#editable = editable
  }

  /** Detaches the DOM selection orchestrator from the editable element. */
  detach(): void {
    this.#editable = null
  }

  /**
   * Runs an orchestration operation before the next browser re-paint.
   * Returns the cancellation callback.
   */
  #runWithRaf(fn: () => void): CancelCallback {
    const id = requestAnimationFrame(() => {
      fn()
    })

    return () => cancelAnimationFrame(id)
  }

  /**
   * Runs a Model → DOM operation and handles errors.
   * Flags the orchestrator as painting while running the operation.
   */
  #runPainting(fn: () => void): void {
    this.#isPainting = true
    try {
      return fn()
    } catch (err) {
      const wrapped = DactyloError.wrap(err)

      error(wrapped.message, wrapped.stack)

      throw wrapped
    } finally {
      this.#isPainting = false
    }
  }

  /** Whether the DOM → model sync should be skipped. */
  shouldSkipSync(): boolean {
    return this.#isPainting
  }

  /** Paints a collapsed caret at the position of the text cursor in the DOM. */
  paintTextCursor(cursor: TextCursor): CancelCallback {
    const editable = this.#editable
    return this.#runWithRaf(() => {
      this.#runPainting(() => {
        if (!editable) {
          warnOnceIf(
            this.#debug,
            'No editable element found. Attach the orchestrator to the editable element first using `Orchestrator.attach(element)`.',
          )
          return
        }

        const editableContent = findBlockEditableElement(
          editable,
          cursor.blockId,
        )
        if (!editableContent) {
          throw DactyloError.from({
            code: 'DOM_ORCHESTRATOR_PAINTING',
            hint: 'Orchestrator/#paintTextCursor',
            message: `No editable block content found for block id: ${cursor.blockId}`,
            payload: {
              blockId: cursor.blockId,
            },
          })
        }

        paintCursorCaretAtPositionInDOM(editableContent, cursor)
      })
    })
  }
}
