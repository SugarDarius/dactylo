'use client'

import { useMemo } from 'react'

/**
 * Creates a stable reference to a given value.
 * It enforces to return always the same reference at each lifecycle
 * updates after mount.
 */
export function useStableReference<R>(reference: R): R {
  // oxlint-disable-next-line react/memo-dependencies react-hooks/exhaustive-deps
  return useMemo(() => reference, [])
}
