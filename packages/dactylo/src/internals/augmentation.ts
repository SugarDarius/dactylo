/**
 * For blocks and inline nodes developer-provided types
 * Dactylo adopts the same declaration-merging system used by Liveblocks 🚀
 * 👉🏻 https://github.com/liveblocks/liveblocks/blob/main/packages/liveblocks-core/src/globals/augmentation.ts
 *
 * The rationale behind this choice is to provide a seamless DX for developers
 * to extend the Dactylo types without having to deal with generics or runtime codecs
 * through {@link Dactylo}, {@link TransactionPipeline}, …
 *
 * How a missing key falls back:
 * `DactyloTypes` is empty, so `keyof DactyloTypes` is `never`. Each extendable
 * key misses that union and resolves to the default provided type (the open primitive bag).
 *
 * Trade-offs of such DX:
 *  1. One schema per app. A document composer and a comment
 *     composer in the same app cannot declare different metadata shapes.
 *  2. Compile-time only. Enter, split, merge, paste, and markdown shortcuts
 *     still copy or default to `{}`. Nothing validates bags at runtime.
 *  3. Required keys lie about defaults. Factories use `opts.metadata ?? {}`.
 *     Declare optional fields (`fontSize?: number`) so `insertParagraph()`
 *     stays honest.
 *  4. Cross-type ops are unsound. `mutate_block_type` copies the previous
 *     bag into a new type; merge spreads two bags. Per-type shapes can
 *     disagree. Internals keep copying; types do not invent a merge policy.
 *  5. Patch still replaces the whole record. Passing `{ textAlign: 'center' }`
 *     drops every other key at runtime.
 *
 * Usage:
 * ```ts filename="dactylo.config.ts"
 * declare global {
 *   interface DactyloTypes {
 *     ParagraphBlockMetadata: {
 *       fontSize?: number
 *       textAlign?: 'left' | 'center' | 'right'
 *     }
 *   }
 * }
 * ```
 */
import type { AllOptionalKeys, Metadata } from './types'

declare global {
  /**
   * External namespace to let developers
   * define their own Dactylo types.
   */
  // oxlint-disable-next-line typescript/no-empty-interface typescript/no-empty-object-type
  export interface DactyloTypes {}
}

/** Discriminated union of extendable {@link Dactylo} types. */
export type DactyloExtendableTypes =
  | 'HeadingBlockMetadata'
  | 'ParagraphBlockMetadata'
  | 'QuoteBlockMetadata'
  | 'BulletListItemBlockMetadata'
  | 'NumberedListItemBlockMetadata'
  | 'CheckboxListItemBlockMetadata'
  | 'DividerBlockMetadata'
  | 'TextNodeMetadata'
  | 'LinkNodeMetadata'
  | 'LineBreakNodeMetadata'
  | 'MentionNodeMetadata'

/** Hover message shown when a {@link DactyloTypes} override for `K` is invalid. */
export type MakeErrorString<
  K extends DactyloExtendableTypes,
  Reason extends string = 'does not match its requirements',
> = `The type you provided for '${K}' ${Reason}.`

/**
 * Picks the user override for `K`, or `DefaultType` when the key was not
 * declared, or `ErrorType` when the override does not match `DefaultType`.
 */
export type GetOverrideOrErrorValue<
  K extends DactyloExtendableTypes,
  DefaultType,
  ErrorType,
> = K extends keyof DactyloTypes
  ? unknown extends DactyloTypes[K]
    ? DefaultType
    : DactyloTypes[K] extends DefaultType
      ? AllOptionalKeys<DactyloTypes[K]> extends true
        ? DactyloTypes[K]
        : MakeErrorString<K, 'must only declare optional keys'>
      : ErrorType
  : DefaultType
/**
 * Resolves a {@link DactyloTypes} key to the user type, `DefaultType` if it is
 * missing, or a {@link MakeErrorString} if the override is not valid.
 */
export type GetOverride<
  K extends DactyloExtendableTypes,
  DefaultType,
  Reason extends string = 'does not match its requirements',
> = GetOverrideOrErrorValue<K, DefaultType, MakeErrorString<K, Reason>>

/** Extended type for {@link ParagraphBlock}'s `metadata` */
export type ParagraphBlockMetadata = GetOverride<
  'ParagraphBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link HeadingBlock}'s `metadata` */
export type HeadingBlockMetadata = GetOverride<
  'HeadingBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link QuoteBlock}'s `metadata` */
export type QuoteBlockMetadata = GetOverride<
  'QuoteBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link BulletListItemBlock}'s `metadata` */
export type BulletListItemBlockMetadata = GetOverride<
  'BulletListItemBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link NumberedListItemBlock}'s `metadata` */
export type NumberedListItemBlockMetadata = GetOverride<
  'NumberedListItemBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link CheckboxListItemBlock}'s `metadata` */
export type CheckboxListItemBlockMetadata = GetOverride<
  'CheckboxListItemBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link DividerBlock}'s `metadata` */
export type DividerBlockMetadata = GetOverride<
  'DividerBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link TextNode}'s `metadata` */
export type TextNodeMetadata = GetOverride<
  'TextNodeMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link LinkNode}'s `metadata` */
export type LinkNodeMetadata = GetOverride<
  'LinkNodeMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link LineBreakNode}'s `metadata` */
export type LineBreakNodeMetadata = GetOverride<
  'LineBreakNodeMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link MentionNode}'s `metadata` */
export type MentionNodeMetadata = GetOverride<
  'MentionNodeMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>
