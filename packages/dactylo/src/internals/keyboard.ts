/** Whether the platform modifier is held (Cmd on macOS, Ctrl elsewhere). */
export function isModKey(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey
}

/** Discriminated union for common platform keyboard shortcuts. */
export type PlatformKeyboardShortcut =
  | 'undo'
  | 'redo'
  | 'copy'
  | 'paste'
  | 'cut'
  | 'select-all'
  | 'deselect'

/**
 * Detects a  platform shortcut from a key event
 * Using under-the-hood the physical key to ensure we always are
 * layout-independent to correctly detect those shortcuts.
 *
 * Returns `null` when the event is not a handled shortcut (normal typing, Enter, etc.).
 */
export function detectPlatformKeyboardShortcut(
  event: KeyboardEvent,
): PlatformKeyboardShortcut | null {
  if (event.altKey) {
    return null
  }

  if (event.key === 'Escape' && !isModKey(event)) {
    return 'deselect'
  }

  if (isModKey(event)) {
    const keyCode = event.code
    switch (keyCode) {
      case 'KeyZ': {
        return event.shiftKey ? 'redo' : 'undo'
      }
      default: {
        return null
      }
    }
  }

  return null
}
