/**
 * Converts a dataset attribute name to a JavaScript property name.
 * @example
 * ```ts
 * toDatasetProperty('data-foo-bar') // 'fooBar'
 * ```
 */
export function toDatasetProperty(attr: string): string {
  return (
    attr
      .replace(/^data-/u, '')
      // oxlint-disable-next-line prefer-named-capture-group
      .replaceAll(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase())
  )
}
