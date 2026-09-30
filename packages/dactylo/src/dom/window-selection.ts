import type { DOMPoint } from './point'

/**
 * Whether the live caret is already the collapsed point `point`.
 * Skipping that case keeps a render from resetting the selection while typing.
 */
export function isCaretAt(selection: Selection, point: DOMPoint): boolean {
  return (
    selection.isCollapsed &&
    selection.anchorNode === point.node &&
    selection.anchorOffset === point.offset
  )
}
