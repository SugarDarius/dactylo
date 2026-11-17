import type { Dactylo, DactyloOptions } from '../dactylo'
import type {
  BlockId,
  BulletListItemBlock,
  CheckboxListItemBlock,
  DividerBlock,
  HeadingBlock,
  NumberedListItemBlock,
  ParagraphBlock,
  QuoteBlock,
} from '../internals/blocks'
import type {
  InlineNode,
  LineBreakNode,
  LinkNode,
  MentionNode,
  NodeId,
  TextNode,
} from '../internals/nodes'

// --- Anchor Element Store ──────────────────────-------------------

/**
 * Store for keeping track of an anchor element in the DOM.
 * @private
 */
export interface AnchorElementStore<T extends HTMLElement> {
  /** Returns the DOM element. */
  getSnapshot: () => T | null

  /** Assigns the DOM element for being used externally. */
  setElement: (element: T | null) => void

  /** Subscribes to React's tree changes for updating the DOM element reference. */
  subscribe: (listener: () => void) => () => void
}

// --- Composer Context ──────────────────────────────────────-------

/** Main Composer context. */
export interface ComposerContext {
  /** The {@link Dactylo} editor instance. */
  editor: Dactylo

  /**
   * Inline mention query anchor element store.
   * @internal
   */
  imqaes: AnchorElementStore<HTMLSpanElement>

  /**
   * Inline command trigger query anchor element store.
   * @internal
   */
  ictqaes: AnchorElementStore<HTMLSpanElement>
}

// --- Composer.Root ─────────────────────────────────────────-------

/** Props for declaring the composer root component. */
export interface ComposerRootProps
  extends React.HTMLAttributes<HTMLDivElement>, DactyloOptions {
  /**
   * Whether to render the composer root only on the client side.
   * 👉🏻 Set it to `false` if there is server-side rendering in the app
   * you're building the composer for to avoid hydration issues.
   *
   * Defaults to `false`.
   */
  clientOnly?: boolean
}

// --- Composer.Editable ─────────────────────────────────────────---

/** Props for declaring an inline query node component. */
export interface ComposerInlineQueryNodeProps {
  /** Unique identifier for the node. */
  nodeId: NodeId

  /** Text content of the node. */
  text: string
}

/** Props for declaring a text node component. */
export interface ComposerTextNodeProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  'children'
> {
  /** The text node to render. */
  node: TextNode
}

/** Props for declaring a link node component. */
export interface ComposerLinkNodeProps extends React.HTMLAttributes<
  Omit<HTMLAnchorElement, 'href' | 'title' | 'children'>
> {
  /** The link node to render. */
  node: LinkNode
}

/** Props for declaring a line break node component. */
export interface ComposerLineBreakNodeProps extends Omit<
  React.HTMLAttributes<HTMLBRElement>,
  'children'
> {
  /** The line break node to render. */
  node: LineBreakNode
}

/** Props for declaring a mention node component. */
export interface ComposerMentionNodeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The mention node to render. */
  node: MentionNode
}

/** Props for declaring a slot inline content component. */
export interface ComposerSlotInlineContentProps {
  /** The inline content to render. */
  content: readonly InlineNode[]
}

/** Base props for declaring a block component. */
export interface ComposerBlockBaseProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'children'
> {
  /** At which index the block is rendered inside `<Composer.Editable />`. */
  blockIndex: number

  /** Overrides that can be applied to block components. */
  overrides?: {
    /** Override placeholder on top of {@link DactyloStaticConfig} at component level. */
    placeholder?: string
  }
}

/** Props for declaring a paragraph block component. */
export interface ComposerParagraphBlockProps extends ComposerBlockBaseProps {
  /** The paragraph block to render. */
  block: ParagraphBlock
}

/** Props for declaring a quote block component. */
export interface ComposerQuoteBlockProps extends ComposerBlockBaseProps {
  /** The quote block to render. */
  block: QuoteBlock
}

/** Props for declaring a heading block component. */
export interface ComposerHeadingBlockProps extends ComposerBlockBaseProps {
  /** The heading block to render. */
  block: HeadingBlock
}

/** Props for declaring a bullet list item block component. */
export interface ComposerBulletListItemBlockProps extends ComposerBlockBaseProps {
  /** The bullet list item block to render. */
  block: BulletListItemBlock
}

/** Props for declaring a numbered list item block component. */
export interface ComposerNumberedListItemBlockProps extends ComposerBlockBaseProps {
  /** The numbered list item block to render. */
  block: NumberedListItemBlock
}

/** Props for declaring a checkbox list item block component. */
export interface ComposerCheckboxListItemBlockProps extends ComposerBlockBaseProps {
  /** The checkbox list item block to render. */
  block: CheckboxListItemBlock

  /** A callback function that is called when the checkbox list item block is checked or unchecked. */
  onCheckedChange?: (checked: boolean) => void
}

/** Props for declaring a divider block component. */
export interface ComposerDividerBlockProps extends Omit<
  ComposerBlockBaseProps,
  'overrides'
> {
  /** The divider block to render. */
  block: DividerBlock
}

/** Props for declaring a slot block component. */
export interface ComposerSlotBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The block ID to render. */
  blockId: BlockId

  /** At which index the block is rendered inside `<Composer.Editable />`. */
  blockIndex: number
}

/**
 * Slot overrides for `<Composer.Editable />`.
 *
 * Each override must render the matching `<Composer.* />` primitive.
 * The primitive owns editor DOM (block attrs, contentEditable, inline slots).
 *
 * @example
 * ```tsx
 * <Composer.Editable
 *   components={{
 *     ParagraphBlock: ({ block, ...props }) => (
 *       <div className='my-paragraph-wrapper>
 *         <Composer.ParagraphBlock block={block} {...props} />
 *       </div>
 *     ),
 *   }}
 * />
 * ```
 */
export interface ComposeEditableComponents {
  /** Slot override for {@link ParagraphBlock}. */
  ParagraphBlock?: React.ComponentType<ComposerParagraphBlockProps>

  /** Slot override for {@link QuoteBlock}. */
  QuoteBlock?: React.ComponentType<ComposerQuoteBlockProps>

  /** Slot override for {@link HeadingBlock}. */
  HeadingBlock?: React.ComponentType<ComposerHeadingBlockProps>

  /** Slot override for {@link BulletListItemBlock}. */
  BulletListItemBlock?: React.ComponentType<ComposerBulletListItemBlockProps>

  /** Slot override for {@link NumberedListItemBlock}. */
  NumberedListItemBlock?: React.ComponentType<ComposerNumberedListItemBlockProps>

  /** Slot override for {@link CheckboxListItemBlock}. */
  CheckboxListItemBlock?: React.ComponentType<ComposerCheckboxListItemBlockProps>

  /** Slot override for {@link DividerBlock}. */
  DividerBlock?: React.ComponentType<ComposerDividerBlockProps>

  /** Slot override for {@link TextNode}. */
  TextNode?: React.ComponentType<ComposerTextNodeProps>

  /** Slot override for {@link LinkNode}. */
  LinkNode?: React.ComponentType<ComposerLinkNodeProps>

  /** Slot override for {@link LineBreakNode}. */
  LineBreakNode?: React.ComponentType<ComposerLineBreakNodeProps>

  /** Slot override for {@link MentionNode}. */
  MentionNode?: React.ComponentType<ComposerMentionNodeProps>
}

/** Context for `<Composer.Editable />`. */
export interface ComposerEditableContext {
  /**
   * Slot overrides for `<Composer.Editable />`.
   *
   * Each override must render the matching `<Composer.* />` primitive.
   * The primitive owns editor DOM (block attrs, contentEditable, inline slots).
   *
   * @example
   * ```tsx
   * <Composer.Editable
   *   components={{
   *     ParagraphBlock: ({ block, ...props }) => (
   *       <div className='my-paragraph-wrapper>
   *         <Composer.ParagraphBlock block={block} {...props} />
   *       </div>
   *     ),
   *   }}
   * />
   * ```
   */
  components: ComposeEditableComponents
}

/** Props for declaring the composer editable component. */
export interface ComposerEditableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether to place the cursor in the editor at the document end after initial mount. */
  autoFocus?: boolean

  /**
   * Slot overrides for `<Composer.Editable />`.
   *
   * Each override must render the matching `<Composer.* />` primitive.
   * The primitive owns editor DOM (block attrs, contentEditable, inline slots).
   *
   * @example
   * ```tsx
   * <Composer.Editable
   *   components={{
   *     ParagraphBlock: ({ block, ...props }) => (
   *       <div className='my-paragraph-wrapper>
   *         <Composer.ParagraphBlock block={block} {...props} />
   *       </div>
   *     ),
   *   }}
   * />
   * ```
   */
  components?: ComposeEditableComponents
}
