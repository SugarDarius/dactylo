import { DactyloError } from '../internals/errors'
import type { TextCursor } from '../internals/selection'
import { clampNodeOffset } from './nodes'
import { getDOMPointFromTextCursor, isCaretAt } from './point'

/**
 * Paints a collapsed caret at cursor position in the DOM
 * and focuses the `editable` element.
 */
export function paintCursorCaretAtPositionInDOM(
  editable: HTMLDivElement,
  cursor: TextCursor,
): void {
  const point = getDOMPointFromTextCursor(editable, cursor)
  if (!point) {
    throw DactyloError.from({
      code: 'DOM_ORCHESTRATOR_PAINTING',
      hint: 'dom/#paintCursorCaretAtPositionInDOM',
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
