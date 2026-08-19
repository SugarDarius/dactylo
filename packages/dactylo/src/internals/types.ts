/**
 * Brand type
 *
 * @example
 * ```ts
 * type BlockId = Brand<`blk_${string}`, 'BlockId'>
 * const blockId: BlockId = 'blk_1234567890'
 * ```
 */
declare const brand: unique symbol
export type Brand<T, TBrand extends string> = T & { [brand]: TBrand }

/**
 * Allow for an operation to return either
 * a value or a promise of a value.
 */
export type Awaitable<T> = T | PromiseLike<T>

/**
 * Forces TypeScript to "evaluate" named helper types, making API signatures
 * clearer in IDEs.
 *
 * @see https://effectivetypescript.com/2022/02/25/gentips-4-display/
 */
type Resolve<T> = T extends (...args: unknown[]) => unknown
  ? T
  : { [K in keyof T]: T[K] }

// oxlint-disable-next-line typescript/no-explicit-any
type DistributiveRelax<T, Ks extends string | number | symbol> = T extends any
  ? Resolve<
      { [K in keyof T]: T[K] } & Partial<Record<Exclude<Ks, keyof T>, never>>
    >
  : never

/**
 * Relaxes a discriminated union type definition, by explicitly adding
 * properties defined in any other member as optional `never`.
 *
 * This makes accessing the members much more relaxed in TypeScript.
 *
 * Thanks to https://github.com/nvie/decoders/blob/main/src/lib/Relax.ts
 * for the original implementation of the `Relax` type 👇🏻
 */
// oxlint-disable-next-line typescript/no-explicit-any
export type Relax<T> = DistributiveRelax<T, T extends any ? keyof T : never>

/**
 * Enables autocompletion for a union type, while keeping the ability to use any string
 * or type of `T`
 */
export type Autocomplete<U extends T, T = string> =
  | U
  | (T & Record<never, never>)

/** Metadata type to store custom data */
export type Metadata = Record<
  string,
  string | number | boolean | null | undefined
>
