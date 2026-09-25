'use client'

import {
  useMemo,
  useLayoutEffect,
  useEffect,
  useRef,
  useCallback,
  useState,
} from 'react'

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

/** Determines whether the component is mounted. */
export function useIsMounted(): boolean {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setMounted(true)
  }, [])

  return mounted
}
