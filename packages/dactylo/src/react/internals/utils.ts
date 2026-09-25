/** Merges multiple refs into a single ref. */
export function mergeRefs<T extends HTMLDivElement>(
  ...refs: (React.MutableRefObject<T> | React.LegacyRef<T> | undefined)[]
) {
  return (node: T) => {
    for (const ref of refs) {
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ;(ref as React.MutableRefObject<T | null>).current = node
      }
    }
  }
}
