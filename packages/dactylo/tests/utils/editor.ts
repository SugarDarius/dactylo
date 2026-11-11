import { Dactylo } from '../../src/dactylo'
import type { DactyloOptions } from '../../src/dactylo'

/** Builds a {@link Dactylo} instance for public-API tests. */
export function makeEditor(options: DactyloOptions = {}): Dactylo {
  return new Dactylo(options)
}

/**
 * Editor with markdown and autolink off so typed characters stay literal.
 * Tests that need a shortcut or link conversion should use {@link makeEditor}.
 */
export function makeTypingEditor(options: DactyloOptions = {}): Dactylo {
  return makeEditor(options)
}

function inputEvent(
  inputType: string,
  data?: string,
  dataTransfer: DataTransfer | null = null,
): InputEvent {
  return {
    data: data ?? null,
    dataTransfer,
    inputType,
    preventDefault: () => {
      /* InputEvent stub */
    },
    stopPropagation: () => {
      /* InputEvent stub */
    },
  } as InputEvent
}

/** Sends a raw `beforeinput` intent through the composer. */
export function sendInput(
  editor: Dactylo,
  inputType: string,
  data?: string,
  dataTransfer: DataTransfer | null = null,
): boolean {
  return editor.composer.commands.sendInput(
    inputEvent(inputType, data, dataTransfer),
  )
}

/** Types `text` as a single `insertText` transaction. */
export function typeText(editor: Dactylo, text: string): void {
  const handled = sendInput(editor, 'insertText', text)
  if (!handled) {
    throw new Error(`insertText was not handled: ${text}`)
  }
}

/** Enter → hard break. */
export function hardBreak(editor: Dactylo): void {
  const handled = sendInput(editor, 'insertParagraph')
  if (!handled) {
    throw new Error('insertParagraph was not handled')
  }
}

/** Shift+Enter → soft break. */
export function softBreak(editor: Dactylo): void {
  const handled = sendInput(editor, 'insertLineBreak')
  if (!handled) {
    throw new Error('insertLineBreak was not handled')
  }
}

/** Backspace / delete content backward. */
export function deleteBackward(editor: Dactylo): void {
  const handled = sendInput(editor, 'deleteContentBackward')
  if (!handled) {
    throw new Error('deleteContentBackward was not handled')
  }
}

/** Backspace that may be a no-op (e.g. at the start of the document). */
export function tryDeleteBackward(editor: Dactylo): boolean {
  return sendInput(editor, 'deleteContentBackward')
}

/** Pastes plain text. */
export function pastePlainText(editor: Dactylo, text: string): void {
  const dataTransfer = {
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    types: ['text/plain'],
  } as unknown as DataTransfer

  const handled = sendInput(editor, 'insertFromPaste', undefined, dataTransfer)
  if (!handled) {
    throw new Error('insertFromPaste was not handled')
  }
}

/** Platform-shortcut keydown using physical `event.code`. */
export function pressShortcut(
  editor: Dactylo,
  code: string,
  mods: {
    ctrl?: boolean
    meta?: boolean
    shift?: boolean
  } = {},
): boolean {
  return editor.composer.commands.sendKeydown({
    altKey: false,
    code,
    ctrlKey: mods.ctrl ?? false,
    key: code === 'Escape' ? 'Escape' : code,
    metaKey: mods.meta ?? false,
    preventDefault: () => {
      /* KeyboardEvent stub */
    },
    shiftKey: mods.shift ?? false,
    stopPropagation: () => {
      /* KeyboardEvent stub */
    },
  } as KeyboardEvent)
}
