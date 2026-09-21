'use client'

import {
  createContext as createContext_byReact,
  useContext as useContext_byReact,
} from 'react'

/** Create a safe context and returns a provider and a hook to use it. */
export function createSafeContext<C>(opts: {
  /** The error message to throw if the context is not found. */
  errorMsg: string
}) {
  const Context = createContext_byReact<C | null>(null)

  const useContext = (): C => {
    const ctx = useContext_byReact(Context)
    if (!ctx) {
      throw new Error(opts.errorMsg)
    }

    return ctx
  }

  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const Provider = ({
    value,
    children,
  }: React.PropsWithChildren<{ value: C }>) => (
    <Context.Provider value={value}>{children}</Context.Provider>
  )

  return { Provider, useContext } as const
}
