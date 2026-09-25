'use client'

import { useMemo, useLayoutEffect, useEffect, useRef, useCallback } from 'react'

/** Prevents warning on SSR by falling back to `useEffect` when DOM isn't available. */
export const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Creates a stable reference to a given value.
 * It enforces to return always the same value reference at each lifecycle updates after mount.
 */
export function useStableValue<V>(value: V): V {
  // oxlint-disable-next-line react/memo-dependencies react-hooks/exhaustive-deps
  return useMemo(() => value, [])
}

/**
 * Creates a stable reference to a given callback.
 * It enforces to return always the same callback reference at each lifecycle updates after mount.
 */
export function useStableCallback<A extends unknown[], C>(
  callback: (...args: A) => C,
): (...args: A) => C {
  const callbackRef = useRef(callback)

  useIsomorphicLayoutEffect(() => {
    callbackRef.current = callback
  })

  return useCallback((...args: A): C => callbackRef.current(...args), [])
}

/** Represents a possible ref. */
export type PossibleRef<T> = React.Ref<T> | undefined

/** Sets a given ref to a given value. */
export function setRef<T>(ref: PossibleRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    return ref(value)
  } else if (ref !== null && ref !== undefined) {
    ref.current = value
  }
}

/** Composes multiple refs together. Accepts callback refs and RefObject(s).  */
function composeRefs<T>(...refs: PossibleRef<T>[]): React.RefCallback<T> {
  return (node: T | null) => {
    const cleanups: ((() => void) | undefined)[] = []

    for (const ref of refs) {
      const cleanup = setRef(ref, node)
      if (typeof cleanup === 'function') {
        cleanups.push(cleanup)
      }
    }

    return cleanups.length > 0
      ? () => {
          for (const cleanup of cleanups) {
            cleanup?.()
          }
        }
      : undefined
  }
}

/** Combines and returns a callback that composes multiple refs together. */
export function useComposableRefs<T>(
  ...refs: PossibleRef<T>[]
): React.RefCallback<T> {
  // oxlint-disable-next-line react/memo-dependencies react-hooks/exhaustive-deps react/use-memo
  return useCallback(composeRefs(...refs), refs)
}
