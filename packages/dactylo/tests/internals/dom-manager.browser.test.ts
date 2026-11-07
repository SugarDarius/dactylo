// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest'

import type { BlockId } from '../../src/internals/blocks'
import { DOMManager } from '../../src/internals/dom-manager'
import type { NodeId } from '../../src/internals/nodes'
import { createCursor, createRange } from '../../src/internals/selection'
import type { Selection } from '../../src/internals/selection'

const BLOCK_ID = 'bl_0001' as BlockId
const NODE_ID = 'nd_0001' as NodeId

function nextFrame(): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- rAF has no Promise API
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function nextMicrotask(): Promise<void> {
  return Promise.resolve()
}

function mountEditable(): HTMLDivElement {
  const editable = document.createElement('div')
  editable.setAttribute('dactylo-editable', '')
  editable.innerHTML = `
    <div dactylo-blocks>
      <div dactylo-block data-dactylo-block-id="${BLOCK_ID}">
        <div dactylo-block-content data-dactylo-block-content-editable="true">
          <span dactylo-node data-dactylo-node-id="${NODE_ID}" dactylo-text-node>Hello</span>
        </div>
      </div>
    </div>
  `
  document.body.append(editable)
  return editable
}

function textNode(editable: HTMLDivElement): Text {
  const span = editable.querySelector('[dactylo-text-node]')
  const text = span?.firstChild
  if (!(text instanceof Text)) {
    throw new TypeError('Expected a text node in the fixture')
  }
  return text
}

function setDomCaret(editable: HTMLDivElement, offset: number): void {
  const point = textNode(editable)
  const range = document.createRange()
  range.setStart(point, offset)
  range.collapse(true)

  const blockContent = editable.querySelector(
    '[dactylo-block-content]',
  ) as HTMLElement
  blockContent.focus()

  const domSelection = window.getSelection()
  if (!domSelection) {
    throw new Error('Expected window.getSelection()')
  }
  domSelection.removeAllRanges()
  domSelection.addRange(range)
}

function setDomRange(
  editable: HTMLDivElement,
  start: number,
  end: number,
): void {
  const point = textNode(editable)
  const range = document.createRange()
  range.setStart(point, start)
  range.setEnd(point, end)

  const blockContent = editable.querySelector(
    '[dactylo-block-content]',
  ) as HTMLElement
  blockContent.focus()

  const domSelection = window.getSelection()
  if (!domSelection) {
    throw new Error('Expected window.getSelection()')
  }
  domSelection.removeAllRanges()
  domSelection.addRange(range)
}

function modelRange() {
  return createRange(
    { blockId: BLOCK_ID, nodeId: NODE_ID, offset: 1 },
    { blockId: BLOCK_ID, nodeId: NODE_ID, offset: 4 },
  )
}

function caretOffset(): number | null {
  const domSelection = window.getSelection()
  if (!domSelection || !domSelection.isCollapsed) {
    return null
  }
  return domSelection.anchorOffset
}

describe('DOMManager', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  test('paintCaretAt writes the caret on a microtask, before the next frame', async () => {
    const editable = mountEditable()
    const cursor = createCursor({
      blockId: BLOCK_ID,
      nodeId: NODE_ID,
      offset: 5,
    })

    const manager = new DOMManager({
      commitSelection: () => {
        throw new Error('paint must not commit a selection')
      },
      getIMEComposingState: () => false,
      getSelection: () => cursor,
    })
    manager.attach(editable)

    setDomCaret(editable, 0)
    manager.paintCaretAt()

    expect(caretOffset()).toBe(0)

    await nextMicrotask()

    expect(caretOffset()).toBe(5)
  })

  test('paintCaretAt cancel drops a stale paint before it flushes', async () => {
    const editable = mountEditable()
    const cursor = createCursor({
      blockId: BLOCK_ID,
      nodeId: NODE_ID,
      offset: 5,
    })

    const manager = new DOMManager({
      commitSelection: () => {
        throw new Error('paint must not commit a selection')
      },
      getIMEComposingState: () => false,
      getSelection: () => cursor,
    })
    manager.attach(editable)

    setDomCaret(editable, 0)
    const cancel = manager.paintCaretAt()
    cancel()

    await nextMicrotask()

    expect(caretOffset()).toBe(0)
  })

  test('scheduleSync commits the DOM caret on the next animation frame', async () => {
    const editable = mountEditable()
    let selection: Selection | null = createCursor({
      blockId: BLOCK_ID,
      nodeId: NODE_ID,
      offset: 5,
    })
    const committed: Selection[] = []

    const manager = new DOMManager({
      commitSelection: (next) => {
        if (next) {
          committed.push(next)
          selection = next
        }
      },
      getIMEComposingState: () => false,
      getSelection: () => selection,
    })
    manager.attach(editable)

    setDomCaret(editable, 2)
    manager.scheduleSync()

    expect(committed).toEqual([])

    await nextFrame()

    expect(committed).toEqual([
      createCursor({ blockId: BLOCK_ID, nodeId: NODE_ID, offset: 2 }),
    ])
  })

  test('paintCaretAt drops a pending DOM sync', async () => {
    const editable = mountEditable()
    const cursor = createCursor({
      blockId: BLOCK_ID,
      nodeId: NODE_ID,
      offset: 5,
    })
    const committed: Selection[] = []

    const manager = new DOMManager({
      commitSelection: (next) => {
        if (next) {
          committed.push(next)
        }
      },
      getIMEComposingState: () => false,
      getSelection: () => cursor,
    })
    manager.attach(editable)

    setDomCaret(editable, 1)
    manager.scheduleSync()
    manager.paintCaretAt()

    expect(caretOffset()).toBe(1)

    await nextMicrotask()

    expect(caretOffset()).toBe(5)

    await nextFrame()

    expect(committed).toEqual([])
  })

  test('paintRangeAt writes the range on a microtask, before the next frame', async () => {
    const editable = mountEditable()
    const range = createRange(
      { blockId: BLOCK_ID, nodeId: NODE_ID, offset: 1 },
      { blockId: BLOCK_ID, nodeId: NODE_ID, offset: 4 },
    )

    const manager = new DOMManager({
      commitSelection: () => {
        throw new Error('paint must not commit a selection')
      },
      getIMEComposingState: () => false,
      getSelection: () => range,
    })
    manager.attach(editable)

    setDomCaret(editable, 0)
    manager.paintRangeAt()

    expect(window.getSelection()?.isCollapsed).toBe(true)

    await nextMicrotask()

    const domSelection = window.getSelection()
    expect(domSelection?.isCollapsed).toBe(false)
    expect(domSelection?.anchorOffset).toBe(1)
    expect(domSelection?.focusOffset).toBe(4)
  })

  test('getActiveRange returns a clone matching the DOM range', () => {
    const editable = mountEditable()
    const manager = new DOMManager({
      commitSelection: () => {
        throw new Error('getActiveRange must not commit a selection')
      },
      getIMEComposingState: () => false,
      getSelection: () => modelRange(),
    })
    manager.attach(editable)
    setDomRange(editable, 1, 4)

    const range = manager.getActiveRange()
    const live = window.getSelection()?.getRangeAt(0)

    expect(range).not.toBeNull()
    expect(range).not.toBe(live)
    expect(range?.startOffset).toBe(1)
    expect(range?.endOffset).toBe(4)
  })

  test('getActiveRange clone is detached from later window selection changes', () => {
    const editable = mountEditable()
    const manager = new DOMManager({
      commitSelection: () => {
        throw new Error('getActiveRange must not commit a selection')
      },
      getIMEComposingState: () => false,
      getSelection: () => modelRange(),
    })
    manager.attach(editable)
    setDomRange(editable, 1, 4)

    const range = manager.getActiveRange()
    setDomCaret(editable, 0)

    expect(range?.startOffset).toBe(1)
    expect(range?.endOffset).toBe(4)
  })

  test('getActiveRange returns null for a cursor model selection', () => {
    const editable = mountEditable()
    const manager = new DOMManager({
      commitSelection: () => {
        throw new Error('getActiveRange must not commit a selection')
      },
      getIMEComposingState: () => false,
      getSelection: () =>
        createCursor({ blockId: BLOCK_ID, nodeId: NODE_ID, offset: 2 }),
    })
    manager.attach(editable)
    setDomRange(editable, 1, 4)

    expect(manager.getActiveRange()).toBeNull()
  })

  test('getActiveRange returns null when the window selection is outside the editable', () => {
    const editable = mountEditable()
    const outside = document.createElement('div')
    outside.contentEditable = 'true'
    outside.textContent = 'Other'
    document.body.append(outside)

    const manager = new DOMManager({
      commitSelection: () => {
        throw new Error('getActiveRange must not commit a selection')
      },
      getIMEComposingState: () => false,
      getSelection: () => modelRange(),
    })
    manager.attach(editable)

    const outsideText = outside.firstChild
    if (!(outsideText instanceof Text)) {
      throw new TypeError('Expected a text node outside the editable')
    }
    const outsideRange = document.createRange()
    outsideRange.setStart(outsideText, 0)
    outsideRange.setEnd(outsideText, 5)
    const domSelection = window.getSelection()
    if (!domSelection) {
      throw new Error('Expected window.getSelection()')
    }
    domSelection.removeAllRanges()
    domSelection.addRange(outsideRange)

    expect(manager.getActiveRange()).toBeNull()
  })

  test('getActiveRange returns null while IME is composing', () => {
    const editable = mountEditable()
    const manager = new DOMManager({
      commitSelection: () => {
        throw new Error('getActiveRange must not commit a selection')
      },
      getIMEComposingState: () => true,
      getSelection: () => modelRange(),
    })
    manager.attach(editable)
    setDomRange(editable, 1, 4)

    expect(manager.getActiveRange()).toBeNull()
  })

  test('getActiveRange returns null when the editable is not attached', () => {
    const editable = mountEditable()
    const manager = new DOMManager({
      commitSelection: () => {
        throw new Error('getActiveRange must not commit a selection')
      },
      getIMEComposingState: () => false,
      getSelection: () => modelRange(),
    })
    setDomRange(editable, 1, 4)

    expect(manager.getActiveRange()).toBeNull()
  })

  test('getActiveRange returns null when the DOM range is still collapsed', () => {
    const editable = mountEditable()
    const manager = new DOMManager({
      commitSelection: () => {
        throw new Error('getActiveRange must not commit a selection')
      },
      getIMEComposingState: () => false,
      getSelection: () => modelRange(),
    })
    manager.attach(editable)
    setDomCaret(editable, 2)

    expect(manager.getActiveRange()).toBeNull()
  })
})
