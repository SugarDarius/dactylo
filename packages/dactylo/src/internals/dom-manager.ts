import { error, warnOnceIf } from './console'
import {
  clampNodeOffset,
  findBlockContentEditableFromDOMNode,
  findBlockEditableElement,
  findBlockIdFromDomNode,
  getDOMPointFromTextCursor,
  getTextCursorFromDOMPoint,
  isCaretAt,
  isRangeAt,
  isWindowSelectionInsideEditable,
} from './dom'
import { DactyloError } from './errors'
import {
  areSelectionsEqual,
  createCursor,
  createRange,
  isCursorSelection,
  isRangeSelection,
  isSelectionActive,
} from './selection'
import type { RangeSelection, Selection, TextCursor } from './selection'
import type { CancelCallback } from './types'

export function getSelectionFromEditable(
  editable: HTMLDivElement,
): Selection | null {
  const domSelection = window.getSelection()
  if (!domSelection || domSelection.rangeCount === 0) {
    return null
  }

  if (!isWindowSelectionInsideEditable(editable, domSelection)) {
    return null
  }

  const { anchorNode, anchorOffset, focusNode, focusOffset, isCollapsed } =
    domSelection

  if (!anchorNode || !focusNode) {
    return null
  }

  const anchorBlockId = findBlockIdFromDomNode(anchorNode)
  const focusBlockId = findBlockIdFromDomNode(focusNode)
  if (!anchorBlockId || !focusBlockId) {
    return null
  }

  const anchorContent = findBlockContentEditableFromDOMNode(anchorNode)
  const focusContent = findBlockContentEditableFromDOMNode(focusNode)
  if (!anchorContent || !focusContent) {
    return null
  }

  const anchor = getTextCursorFromDOMPoint(anchorContent, anchorBlockId, {
    node: anchorNode,
    offset: anchorOffset,
  })
  const focus = getTextCursorFromDOMPoint(focusContent, focusBlockId, {
    node: focusNode,
    offset: focusOffset,
  })
  if (!anchor || !focus) {
    return null
  }

  return isCollapsed ? createCursor(anchor) : createRange(anchor, focus)
}

/**
 * Paints a collapsed caret at cursor position in the DOM
 * and focuses the `editable` element.
 */
export function paintCaretAt(editable: HTMLElement, cursor: TextCursor): void {
  const point = getDOMPointFromTextCursor(editable, cursor)
  if (!point) {
    throw DactyloError.from({
      code: 'SELECTION_MANAGER_PAINTING',
      hint: 'DomManager/paintCaretAt',
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
      hint: 'DomManager/paintCaretAt',
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

/**
 * Paints a non-collapsed range in the DOM (anchor/focus order preserved)
 * and focuses the block content surface that holds the focus endpoint.
 */
export function paintRangeAt(
  editable: HTMLDivElement,
  range: RangeSelection,
): void {
  const { anchor, focus } = range

  const anchorBlockContent = findBlockEditableElement(editable, anchor.blockId)
  if (!anchorBlockContent) {
    throw DactyloError.from({
      code: 'SELECTION_MANAGER_PAINTING',
      hint: 'DomManager/paintRangeAt',
      message: `No editable block content found for anchor block id: ${anchor.blockId}`,
      payload: { blockId: anchor.blockId },
    })
  }

  const focusBlockContent = findBlockEditableElement(editable, focus.blockId)
  if (!focusBlockContent) {
    throw DactyloError.from({
      code: 'SELECTION_MANAGER_PAINTING',
      hint: 'DomManager/paintRangeAt',
      message: `No editable block content found for focus block id: ${focus.blockId}`,
      payload: { blockId: focus.blockId },
    })
  }

  const anchorPoint = getDOMPointFromTextCursor(anchorBlockContent, anchor)
  if (!anchorPoint) {
    throw DactyloError.from({
      code: 'SELECTION_MANAGER_PAINTING',
      hint: 'DomManager/paintRangeAt',
      message: `No point from text cursor found for anchor block id: ${anchor.blockId}`,
      payload: { blockId: anchor.blockId },
    })
  }
  const focusPoint = getDOMPointFromTextCursor(focusBlockContent, focus)
  if (!focusPoint) {
    throw DactyloError.from({
      code: 'SELECTION_MANAGER_PAINTING',
      hint: 'DomManager/paintRangeAt',
      message: `No point from text cursor found for focus block id: ${focus.blockId}`,
      payload: { blockId: focus.blockId },
    })
  }

  const clampedAnchor = {
    ...anchorPoint,
    offset: clampNodeOffset(anchorPoint.node, anchorPoint.offset),
  }
  const clampedFocus = {
    ...focusPoint,
    offset: clampNodeOffset(focusPoint.node, focusPoint.offset),
  }

  const domSelection = window.getSelection()
  if (!domSelection) {
    throw DactyloError.from({
      code: 'NO_WINDOW_SELECTION',
      hint: 'DomManager/paintRangeAt',
      message: 'No window selection found',
    })
  }

  /** Skip resetting the selection if the range is already at the position. */
  if (
    document.activeElement === focusBlockContent &&
    isRangeAt(domSelection, clampedAnchor, clampedFocus)
  ) {
    return
  }

  if (document.activeElement !== focusBlockContent) {
    focusBlockContent.focus({ preventScroll: true })
  }

  domSelection.removeAllRanges()
  domSelection.setBaseAndExtent(
    clampedAnchor.node,
    clampedAnchor.offset,
    clampedFocus.node,
    clampedFocus.offset,
  )
}

/** Options for constructing {@link DomManager}. */
export interface DOMManagerOptions {
  /** Whether to enable debug mode. */
  readonly debug?: boolean

  /** Callback to invoke to get the current selection from {@link EditorContext}. */
  readonly getSelection: () => Selection | null

  /** Callback to invoke to commit the selection to {@link EditorContext}. */
  readonly commitSelection: (next: Selection | null) => void

  /** Callback to invoke to get the IME composing state. */
  readonly getIMEComposingState: () => boolean
}

/**
 * Manages the {@link Dactylo} editor's DOM.
 *
 * Two pipelines, never fused:
 * 1. DOM → {@link Selection}: `pointerup` / `selectionchange` coalesced on rAF.
 * 2. {@link Selection} → DOM: paint caret/range/clear on a microtask (after
 *    layout effects, and before the browser paints).
 *    The returned cancel callback drops that write if the layout effect cleans up first.
 *
 * A model paint drops a pending DOM sync. Paint and sync have opposite sources
 * of truth; running both in one frame lets paint overwrite a user gesture and
 * then sync the overwritten caret.
 */
export class DOMManager {
  /** The HTML div `[dactylo-editable]` element. */
  #editable: HTMLDivElement | null = null

  /**
   * Whether the DOM selection is currently being painted.
   * While `true`, DOM → {@link Selection} sync must not run, so a synchronous
   * `selectionchange` from `addRange` does not commit back into {@link EditorContext}.
   */
  #isPainting = false

  /** Coalesced DOM → model sync animation frame id. */
  #syncAfId: number | null = null

  /** Whether DOM → model sync was requested for the next frame. */
  #syncPending = false

  /** Coalesced model → DOM paint kind for the queued microtask. */
  #paintPending: 'none' | 'caret' | 'range' | 'clear' = 'none'

  /** Whether a paint microtask is already queued. */
  #paintMicrotaskQueued = false

  /** Whether to enable debug mode. */
  readonly #debug: boolean

  /** Callback to invoke to get the current selection from {@link EditorContext}. */
  readonly #getSelection: () => Selection | null

  /** Callback to invoke to commit the selection to {@link EditorContext}. */
  readonly #commitSelection: (next: Selection | null) => void

  /** Callback to invoke to get the IME composing state. */
  readonly #getIMEComposingState: () => boolean

  constructor(options: DOMManagerOptions) {
    this.#debug = options.debug ?? false
    this.#getSelection = options.getSelection
    this.#commitSelection = options.commitSelection
    this.#getIMEComposingState = options.getIMEComposingState
  }

  /**
   * Runs a {@link Selection} → DOM operation and handles errors.
   * Flags the manager as painting while running the operation.
   */
  #runPainting(fn: () => void): void {
    this.#isPainting = true
    try {
      fn()
    } catch (err) {
      const wrapped = DactyloError.wrap(err)

      error(wrapped.message, wrapped.stack)

      throw wrapped
    } finally {
      this.#isPainting = false
    }
  }

  /** Cancels a coalesced DOM → model sync if one is scheduled. */
  #cancelScheduledSync(): void {
    if (this.#syncAfId !== null) {
      cancelAnimationFrame(this.#syncAfId)
      this.#syncAfId = null
    }
    this.#syncPending = false
  }

  /** Drops a pending paint of `kind` if it has not flushed yet. */
  #cancelPendingPaint(kind: 'caret' | 'range' | 'clear'): void {
    if (this.#paintPending === kind) {
      this.#paintPending = 'none'
    }
  }

  /** Queues one microtask that flushes the latest pending paint. */
  #schedulePaint(): void {
    if (this.#paintMicrotaskQueued) {
      return
    }

    this.#paintMicrotaskQueued = true

    queueMicrotask(() => {
      this.#paintMicrotaskQueued = false

      const kind = this.#paintPending
      this.#paintPending = 'none'

      if (kind !== 'none') {
        this.#flushPaint(kind)
      }
    })
  }

  /**
   * Writes the model selection into the DOM now.
   * Drops a pending sync so a later rAF cannot read the caret this paint wrote.
   */
  #flushPaint(kind: 'caret' | 'range' | 'clear'): void {
    if (this.#getIMEComposingState()) {
      return
    }

    const editable = this.#editable
    if (!editable) {
      warnOnceIf(
        this.#debug,
        'No editable element found. Attach the orchestrator to the editable element first using `Orchestrator.attach(element)`.',
      )
      return
    }

    switch (kind) {
      case 'caret': {
        const selection = this.#getSelection()
        if (!isCursorSelection(selection)) {
          break
        }

        const cursor = selection.anchor
        const editableContent = findBlockEditableElement(
          editable,
          cursor.blockId,
        )

        if (!editableContent) {
          throw DactyloError.from({
            code: 'SELECTION_MANAGER_PAINTING',
            hint: 'DomManager/#flushPaint/caret',
            message: `No editable block content found for block id: ${cursor.blockId}`,
            payload: {
              blockId: cursor.blockId,
            },
          })
        }

        this.#runPainting(() => {
          paintCaretAt(editableContent, cursor)
        })
        this.#cancelScheduledSync()

        break
      }
      case 'range': {
        const selection = this.#getSelection()
        if (!isRangeSelection(selection)) {
          break
        }

        this.#runPainting(() => {
          paintRangeAt(editable, selection)
        })
        this.#cancelScheduledSync()

        break
      }
      case 'clear': {
        const domSelection = window.getSelection()
        if (!domSelection) {
          break
        }

        this.#runPainting(() => {
          domSelection.removeAllRanges()
        })
        this.#cancelScheduledSync()

        break
      }
      default: {
        break
      }
    }
  }

  /**
   * Reads `window.getSelection()` under the attached `[dactylo-editable]`,
   * maps it to {@link Selection} and updates the {@link EditorContext} with the new selection
   * when it differs.
   */
  #sync(): void {
    /** When the dom manager is painting or the IME composition is active, skip the sync. */
    if (this.#isPainting || this.#getIMEComposingState()) {
      return
    }

    const editable = this.#editable
    if (!editable) {
      warnOnceIf(
        this.#debug,
        'DomManager/#sync: no editable element found. Attach the dom manager to the editable element first using `DomManager.attach(element)`.',
      )
      return
    }

    const nextSelection = getSelectionFromEditable(editable)
    if (
      !isSelectionActive(nextSelection) ||
      areSelectionsEqual(nextSelection, this.#getSelection())
    ) {
      return
    }

    this.#commitSelection(nextSelection)
  }

  /** Schedules one rAF that reads DOM → model. */
  #scheduleSyncFrame(): void {
    if (this.#syncAfId !== null) {
      return
    }

    this.#syncAfId = requestAnimationFrame(() => {
      this.#syncAfId = null

      const sync = this.#syncPending
      this.#syncPending = false

      if (sync) {
        this.#sync()
      }
    })
  }

  /** Attaches the view manager to the editable element. */
  attach(editable: HTMLDivElement): void {
    this.#editable = editable
  }

  /** Detaches the view manager from the editable element. */
  detach(): void {
    this.#paintPending = 'none'
    this.#cancelScheduledSync()
    this.#editable = null
  }

  /**
   * Schedules the DOM → {@link Selection} sync on next animation frame.
   * Coalesces multiple `pointerup` / `selectionchange` events into one read.
   */
  scheduleSync(fromSelectionChange = false): void {
    if (this.#isPainting) {
      return
    }

    const editable = this.#editable
    if (!editable) {
      warnOnceIf(
        this.#debug,
        'DomManager/scheduleSync: no editable element found. Attach the dom manager to the editable element first using `DomManager.attach(element)`.',
      )
      return
    }

    /**
     * When sync is scheduled from a `selectionchange` event,
     * we need to cancel it if:
     *  - There is no anchor node in the current window selection.
     *  - The anchor node is not inside the editable `<div />` element.
     */
    if (fromSelectionChange) {
      const domSelection = window.getSelection()
      if (
        !domSelection ||
        !domSelection.anchorNode ||
        !editable.contains(domSelection.anchorNode)
      ) {
        return
      }
    }

    this.#syncPending = true
    this.#scheduleSyncFrame()
  }

  /** Paints a collapsed caret at the position of the text cursor in the DOM. */
  paintCaretAt(): CancelCallback {
    this.#paintPending = 'caret'
    this.#schedulePaint()

    return () => {
      this.#cancelPendingPaint('caret')
    }
  }

  /** Paints a range at anchor/focus in the DOM. */
  paintRangeAt(): CancelCallback {
    this.#paintPending = 'range'
    this.#schedulePaint()

    return () => {
      this.#cancelPendingPaint('range')
    }
  }

  /** Clears the selection in the DOM. */
  clearSelection(): CancelCallback {
    this.#paintPending = 'clear'
    this.#schedulePaint()

    return () => {
      this.#cancelPendingPaint('clear')
    }
  }

  /**
   * Returns a cloned DOM `Range` for the current non-collapsed window selection
   * inside the attached editable, or `null`.
   *
   * The clone is a snapshot: later selection changes do not mutate it.
   *
   * A major use-case to call this method is for rendering floating UI elements
   * like contextual menus, floating tooltips with libraries like `@floating-ui/react`
   * in the editable element when we can use `range.getBoundingClientRect()` as a virtual element.
   */
  getActiveRange(): Range | null {
    if (this.#isPainting || this.#getIMEComposingState()) {
      return null
    }

    const editable = this.#editable
    if (!editable) {
      return null
    }

    const selection = this.#getSelection()
    if (!isRangeSelection(selection)) {
      return null
    }

    const domSelection = window.getSelection()
    if (
      !domSelection ||
      domSelection.rangeCount === 0 ||
      !isWindowSelectionInsideEditable(editable, domSelection)
    ) {
      return null
    }

    const range = domSelection.getRangeAt(0)
    if (range.collapsed) {
      return null
    }

    return range.cloneRange()
  }
}
