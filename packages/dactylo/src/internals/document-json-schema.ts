import type { Marks } from './marks'
import type { DateToString } from './types'

/**
 * Properties owned by Dactylo model itself.
 * Those properties purely `internal` and are not exposed outside of Dactylo as:
 *  - `id` and `postKey` are used to identify the node in the document once in memory.
 *    We don't want / need to get them from input or give them to output.
 *  - `parentId` is used to identify the parent of the node in the document.
 *    From a DX standpoint based on the current architecture of Dactylo it's better to use
 *    a `children` array instead.
 */
export type OwnedModelProperties = 'id' | 'posKey' | 'parentId'

/** Properties seeded by developers as input to Dactylo. */
export type InputSeededModelProperties =
  | 'createdAt'
  | 'updatedAt'
  | 'metadata'
  | 'marks'

/**
 * Renames the `__type` property to `type` in the JSON input schema.
 * Some frameworks don't support properties starting with `__` in JSON.
 */
export type RenameInputTypeProp<T> = T extends { readonly __type: infer D }
  ? Omit<T, '__type'> & { readonly type: D }
  : T

/** Optional properties seeded by developer as input to Dactylo. */
export type OptionalInputSeededModelProperties<T> = Omit<
  T,
  Extract<keyof T, InputSeededModelProperties>
> &
  Partial<Pick<T, Extract<keyof T, InputSeededModelProperties>>>

/** Converts a type from Dactylo model node or block to its JSON input schema. */
export type ToJsonInput<T> = T extends unknown
  ? OptionalInputSeededModelProperties<
      DateToString<Omit<RenameInputTypeProp<T>, OwnedModelProperties>>
    >
  : never

/** Makes `marks` property optional in the JSON input schema. */
export type ToMarksJsonInput<T> = T extends unknown
  ? 'marks' extends keyof T
    ? Omit<T, 'marks'> & { readonly marks?: Partial<Marks> }
    : T
  : never

/** Makes `content` property from a model type to its JSON input schema. */
export type ToContentJsonInput<T, C> = T extends unknown
  ? 'content' extends keyof T
    ? Omit<T, 'content'> & {
        readonly content: readonly C[]
      }
    : T
  : never
