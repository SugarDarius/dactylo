'use client'

import {
  useMemo,
  useLayoutEffect,
  useEffect,
  useRef,
  useCallback,
  useState,
  useSyncExternalStore,
  useDebugValue,
} from 'react'

import { canUseDOM } from '../../internals/utils'

/** Prevents warning on SSR by falling back to `useEffect` when DOM isn't available. */
export const useIsomorphicLayoutEffect = canUseDOM()
  ? useLayoutEffect
  : useEffect

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

/**
 * The following code belongs to:
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Source: https://github.com/react/react/blob/main/packages/use-sync-external-store/src/useSyncExternalStoreWithSelector.js
 */
// oxlint-disable-next-line typescript/no-explicit-any
export function is(x: any, y: any) {
  // oxlint-disable-next-line no-self-compare
  return (x === y && (x !== 0 || 1 / x === 1 / y)) || (x !== x && y !== y)
}
export const isObject = typeof Object.is === 'function' ? Object.is : is

export type Inst<Selection> =
  | {
      hasValue: true
      value: Selection
    }
  | {
      hasValue: false
      value: null
    }

/** Same as `useSyncExternalStore` but with a selector and isEqual function. */
export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (callback: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: void | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  /** Use this to track he rendered snapshot. */
  const instRef = useRef<Inst<Selection> | null>(null)
  let inst: Inst<Selection>
  if (instRef.current === null) {
    inst = {
      hasValue: false,
      value: null,
    }
    instRef.current = inst
  } else {
    // oxlint-disable-next-line react/refs
    inst = instRef.current
  }

  const [getSelection, getServerSelection] = useMemo(() => {
    /**
     * Track the memoized state using closure variables that are local to this
     * memoized instance of a getSnapshot function. Intentionally not using a
     * useRef hook, because that state would be shared across all concurrent
     * copies of the hook/component.
     */
    let hasMemo = false
    let memoizedSnapshot: Snapshot
    let memoizedSelection: Selection

    const memoizedSelector = (nextSnapshot: Snapshot) => {
      if (!hasMemo) {
        /** The first time the hook is called, there is no memoized result. */

        // oxlint-disable-next-line react/immutability
        hasMemo = true
        memoizedSnapshot = nextSnapshot

        const nextSelection = selector(nextSnapshot)

        if (isEqual !== undefined) {
          /**
           * Even if the selector has changed, the currently rendered selection
           * may be equal to the new selection. We should attempt to reuse the
           * current value if possible, to preserve downstream memoizations.
           */
          // oxlint-disable-next-line unicorn/no-lonely-if
          if (inst.hasValue) {
            const currentSelection = inst.value
            if (isEqual(currentSelection, nextSelection)) {
              memoizedSelection = currentSelection
              return currentSelection
            }
          }
        }
        memoizedSelection = nextSelection
        return nextSelection
      }

      /** We may be able to reuse the previous invocation's result. */
      // oxlint-disable-next-line typescript/no-explicit-any
      const prevSnapshot: Snapshot = memoizedSnapshot as any
      // oxlint-disable-next-line typescript/no-explicit-any
      const prevSelection: Selection = memoizedSelection as any

      if (is(prevSnapshot, nextSnapshot)) {
        /** The snapshot is the same as last time. Reuse the previous selection. */
        return prevSelection
      }

      /** The snapshot has changed, so we need to compute a new selection. */
      const nextSelection = selector(nextSnapshot)

      /**
       * If a custom isEqual function is provided, use that to check if the data
       * has changed. If it hasn't, return the previous selection. That signals
       * to React that the selections are conceptually equal, and we can bail
       * out of rendering.
       */
      if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
        /**
         * The snapshot still has changed, so make sure to update to not keep
         * old references alive.
         */
        memoizedSnapshot = nextSnapshot
        return prevSelection
      }

      memoizedSnapshot = nextSnapshot
      memoizedSelection = nextSelection

      return nextSelection
    }

    /** Assigning this to a constant so that Flow knows it can't change. */
    const maybeGetServerSnapshot =
      getServerSnapshot === undefined ? null : getServerSnapshot
    const getSnapshotWithSelector = () => memoizedSelector(getSnapshot())
    const getServerSnapshotWithSelector =
      maybeGetServerSnapshot === null
        ? undefined
        : () => memoizedSelector(maybeGetServerSnapshot())

    return [getSnapshotWithSelector, getServerSnapshotWithSelector]
    // oxlint-disable-next-line react/memo-dependencies react-hooks/exhaustive-deps
  }, [getSnapshot, getServerSnapshot, selector, isEqual])

  const value = useSyncExternalStore(
    subscribe,
    getSelection,
    getServerSelection,
  )

  useEffect(() => {
    // oxlint-disable-next-line react/immutability
    inst.hasValue = true
    inst.value = value
    // oxlint-disable-next-line react/exhaustive-effect-dependencies react-hooks/exhaustive-deps
  }, [value])

  useDebugValue(value)

  return value
}
