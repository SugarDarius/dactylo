/** Whether the platform modifier is held (Cmd on macOS, Ctrl elsewhere). */
export function isModKey(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey
}

/** Discriminated union for common platform keyboard shortcuts. */
export type PlatformShortcut =
  | 'undo'
  | 'redo'
  | 'copy'
  | 'paste'
  | 'cut'
  | 'select-all'
  | 'escape'

/**
 * Detects a platform shortcut from a key event
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
 * | Escape     | `Escape` | `escape`                     |
 *
 * Mod = `metaKey || ctrlKey`.
 * Letter chords use `event.code`(`KeyZ`, `KeyC`, …) so shortcuts stay on physical keys across layouts;
 *
 * Alt chords are ignored for now in v1 to avoid AltGr conflicts on European layouts.
 *
 * Returns `null` when the event is not a handled shortcut (normal typing, Enter, etc.).
 */
export function detectPlatformShortcut(
  event: KeyboardEvent,
): PlatformShortcut | null {
  if (event.altKey) {
    return null
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
    return 'escape'
  }

  return null
}
