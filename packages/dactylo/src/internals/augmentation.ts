/**
 * For blocks and inline nodes developer-provided types
 * Dactylo adopts the same declaration-merging system used by Liveblocks 🚀
 * 👉🏻 https://github.com/liveblocks/liveblocks/blob/main/packages/liveblocks-core/src/globals/augmentation.ts
 *
 * Declaration merging is the zero-generic DX: `new Dactylo()` picks up
 * `DactyloTypes` through the `*Metadata` aliases. Concrete blocks, nodes,
 * factories, and commands close on those aliases (`ParagraphBlock extends
 * IBlockWithInlineContext<PBM>`, `metadata?: PBM`).
 *
 * How a missing key falls back:
 * `DactyloTypes` is empty, so `keyof DactyloTypes` is `never`. Each extendable
 * key misses that union and resolves to the default provided type (the open primitive bag).
 *
 * Trade-offs of such DX:
 *  1. One schema per app. A document composer and a comment
 *     composer in the same app cannot declare different metadata shapes.
 *  2. Compile-time only. Enter, markdown, insert, and paste apply configured
 *     `initialMetadata` for new entities of a type. Same-type continuation
 *     (list-item Enter, paragraph split, clone) still copies the source bag.
 *     Merge still spreads. Nothing validates bags at runtime.
 *  3. Required keys lie about defaults. Factories use `opts.metadata ?? {}`.
 *     Product paths pass the configured bag so `{}` is only a test/fallback.
 *     Declare optional fields (`fontSize?: number`) so `insertParagraph()`
 *     stays honest.
 *  4. Cross-type ops are unsound. `mutate_block_type` always replaces the bag
 *     with the target type’s `initialMetadata`; undo restores the snapshot
 *     bag. Merge still spreads two bags. Per-type shapes can disagree.
 *     Internals keep copying on merge; types do not invent a merge policy.
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
import type { JsonValue, Metadata } from './types'

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
  | 'MentionNodeEntityData'

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
      ? DactyloTypes[K]
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
export type PBM = GetOverride<
  'ParagraphBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link HeadingBlock}'s `metadata` */
export type HBM = GetOverride<
  'HeadingBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link QuoteBlock}'s `metadata` */
export type QBM = GetOverride<
  'QuoteBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link BulletListItemBlock}'s `metadata` */
export type BBM = GetOverride<
  'BulletListItemBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link NumberedListItemBlock}'s `metadata` */
export type NBM = GetOverride<
  'NumberedListItemBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link CheckboxListItemBlock}'s `metadata` */
export type CBM = GetOverride<
  'CheckboxListItemBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link DividerBlock}'s `metadata` */
export type DBM = GetOverride<
  'DividerBlockMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link TextNode}'s `metadata` */
export type TNM = GetOverride<
  'TextNodeMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link LinkNode}'s `metadata` */
export type LNM = GetOverride<
  'LinkNodeMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link LineBreakNode}'s `metadata` */
export type LBNM = GetOverride<
  'LineBreakNodeMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link MentionNode}'s `metadata` */
export type MNM = GetOverride<
  'MentionNodeMetadata',
  Metadata,
  'is not a valid `Metadata` value'
>

/** Extended type for {@link MentionNode}'s `entity.data` */
export type MNED = GetOverride<
  'MentionNodeEntityData',
  JsonValue,
  'is not a valid `JsonValue` value'
>
