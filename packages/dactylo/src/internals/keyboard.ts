/** Whether the platform modifier is held (Cmd on macOS, Ctrl elsewhere). */
export function isModKey(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey
}
