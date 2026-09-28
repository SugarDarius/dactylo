import type { TextCursor } from '../internals/selection'

/** Sync the cursor position in the DOM with the editor selection. */
export function syncTextCursorPositionInDOM(
  editable: HTMLDivElement,
  cursor: TextCursor,
): void {
  // @todo: find another algorithm rater than this basic
  const range = document.createRange()
  const selection = window.getSelection()

  if (!selection) {
    console.error('Selection not found')
    return
  }

  const firstNode = editable.firstChild
  console.log('firstNode', firstNode)
  console.log('firstNode.nodeType', firstNode?.nodeType)
  if (firstNode?.nodeType === Node.TEXT_NODE) {
    const length = firstNode.textContent?.length ?? 0
    range.setStart(firstNode, Math.min(length, cursor.offset))
    range.setEnd(firstNode, Math.min(length, cursor.offset))
  } else {
    // @todo handle non-text nodes
    console.error('Non-text node found')
  }

  selection.removeAllRanges()
  selection.addRange(range)

  // @todo: check is the content is really editable
  // @todo: make range and apply cursor
}
