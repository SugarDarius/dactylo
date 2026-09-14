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
 * Using under-the-hood the physical key to ensure we always are layout-independent
 * to correctly detect those shortcuts.
 *
 * | Shortcut   | Chord    | `PlatformKeyboardShortcut`   |
 * | ---------- | -------- | ---------------------------- |
 * | Undo       | `Mod+Z`  | `undo`                       |
 * | Redo       | `Mod+Y`  | `redo`                       |
 * | Copy       | `Mod+C`  | `copy`                       |
 * | Paste      | `Mod+V`  | `paste`                      |
 * | Cut        | `Mod+X`  | `cut`                        |
 * | Select all | `Mode+A` | `select-all`                 |
 * | Deselect   | `Escape` | `deselect`                   |
 *
 * Mod = `metaKey || ctrlKey`.
 * Letter chords use `event.code`(`KeyZ`, `KeyC`, …) so shortcuts stay on physical keys across layouts;
 *
 * Alt chords are ignored for now in v1 to avoid AltGr conflicts on European layouts.
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
      case 'KeyY': {
        return event.shiftKey ? null : 'redo'
      }
      case 'KeyC': {
        return 'copy'
      }
      case 'KeyV': {
        return 'paste'
      }
      case 'KeyX': {
        return 'cut'
      }
      case 'KeyA': {
        return 'select-all'
      }
      default: {
        return null
      }
    }
  } else if (event.key === 'Escape') {
    return 'deselect'
  }

  return null
}
