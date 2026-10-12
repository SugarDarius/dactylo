import { error, warnOnceIf } from './console'
import {
  clampNodeOffset,
  findBlockEditableElement,
  getDOMPointFromTextCursor,
  isCaretAt,
} from './dom'
import { DactyloError } from './errors'
import { isCursorSelection } from './selection'
import type { Selection, TextCursor } from './selection'
import type { CancelCallback } from './types'

/**
 * Paints a collapsed caret at cursor position in the DOM
 * and focuses the `editable` element.
 */
export function paintCaretAt(
  editable: HTMLDivElement,
  cursor: TextCursor,
): void {
  const point = getDOMPointFromTextCursor(editable, cursor)
  if (!point) {
    throw DactyloError.from({
      code: 'SELECTION_MANAGER_PAINTING',
      hint: 'SelectionManager/paintCaretAt',
      message: 'No point from text cursor found',
      payload: {
        cursor,
        editable,
      },
    })
  }
  const clamped = {
    ...point,
    offset: clampNodeOffset(point.node, point.offset),
  }

  const domSelection = window.getSelection()
  if (!domSelection) {
    throw DactyloError.from({
      code: 'NO_WINDOW_SELECTION',
      hint: 'dom/#paintCursorCaretAtPositionInDOM',
      message: 'No window selection found',
    })
  }

  /** Skip resetting the selection if the caret is already at the position. */
  if (document.activeElement === editable && isCaretAt(domSelection, clamped)) {
    return
  }

  const range = document.createRange()
  range.setStart(clamped.node, clamped.offset)
  range.collapse(true)

  /** Focus the editable if it is not already focused. */
  if (document.activeElement !== editable) {
    editable.focus({ preventScroll: true })
  }

  domSelection.removeAllRanges()
  domSelection.addRange(range)
}

/** Options for constructing {@link DomManager}. */
export interface DomManagerOptions {
  /** Whether to enable debug mode. */
  readonly debug?: boolean

  /** Callback to invoke to get the current selection from {@link EditorContext}. */
  readonly getSelection: () => Selection | null
}

/**
 * Manages the {@link Dactylo} editor's DOM.
 * 1. Sync native browser selection events:
 *  👉🏻 DOM → {@link Selection}: `pointerup` on the editable element + `selectionchange` events.
 * 2. Paint caret
 *  👉🏻 {@link Selection} → DOM: paints a collapsed cursor caret in the current editable block.
 */
export class DomManager {
  /** The HTML div `[dactylo-editable]` element. */
  #editable: HTMLDivElement | null = null

  /**
   * Whether the DOM selection is currently being painted.
   * While `true`, DOM → {@link Selection} sync must not run.
   * So programmatic `addRange` calls does not commit back into {@link EditorContext}
   */
  #isPainting = false

  /** Pending sync animation frame id. */
  #syncAfId: number | null = null

  /** Whether to enable debug mode. */
  readonly #debug: boolean

  /** Callback to invoke to get the current selection from {@link EditorContext}. */
  readonly #getSelection: () => Selection | null

  constructor(options: DomManagerOptions) {
    this.#debug = options.debug ?? false
    this.#getSelection = options.getSelection
  }

  /** Attaches the view manager to the editable element. */
  attach(editable: HTMLDivElement): void {
    this.#editable = editable
  }

  /** Detaches the view manager from the editable element. */
  detach(): void {
    this.#editable = null
  }

  /**
   * Runs a {@link Selection} → DOM operation and handles errors.
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

  /**
   * Reads `window.getSelection()` under the attached `[dactylo-editable]`,
   * maps it to {@link Selection} and updates the {@link EditorContext} with the new selection
   * when it differs.
   */
  #sync(): void {
    /** When the dom manager is painting, skip the sync. */
    if (this.#isPainting) {
      return
    }

    const editable = this.#editable
    if (!editable) {
      warnOnceIf(
        this.#debug,
        'DomManager/#sync: no editable element found. Attach the dom manager to the editable element first using `DomManager.attach(element)`.',
      )
      // return
    }
  }

  /**
   * Schedules the DOM → {@link Selection} sync on next animation frame.
   * Coalesces multiple `pointerup` / `selectionchange` events into one read.
   */
  scheduleSync(): void {
    /** When a sync is already scheduled, skip the schedule. */
    if (this.#syncAfId !== null) {
      return
    }
    this.#syncAfId = requestAnimationFrame(() => {
      this.#syncAfId = null
      this.#sync()
    })
  }

  /** Paints a collapsed caret at the position of the text cursor in the DOM. */
  paintCaretAt(): CancelCallback {
    /** Runs the painting operation before the next browser re-paint. */
    const id = requestAnimationFrame(() => {
      const editable = this.#editable
      if (!editable) {
        warnOnceIf(
          this.#debug,
          'No editable element found. Attach the orchestrator to the editable element first using `Orchestrator.attach(element)`.',
        )
        return
      }

      const selection = this.#getSelection()
      if (!isCursorSelection(selection)) {
        return
      }
      const cursor = selection.anchor

      const editableContent = findBlockEditableElement(editable, cursor.blockId)
      if (!editableContent) {
        throw DactyloError.from({
          code: 'SELECTION_MANAGER_PAINTING',
          hint: 'DomManager/#paintCaretAt',
          message: `No editable block content found for block id: ${cursor.blockId}`,
          payload: {
            blockId: cursor.blockId,
          },
        })
      }

      this.#runPainting(() => {
        paintCaretAt(editableContent, cursor)
      })
    })

    return () => cancelAnimationFrame(id)
  }
}
