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
  TextNode,
} from '../internals/nodes'

// --- Composer Context ──────────────────────────────────────-------

/** Main Composer context. */
export interface ComposerContext {
  /** The {@link Dactylo} editor instance. */
  editor: Dactylo
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

/** Props for declaring a text node component. */
export interface ComposerTextNodeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The text node to render. */
  node: TextNode
}

/** Props for declaring a link node component. */
export interface ComposerLinkNodeProps extends React.HTMLAttributes<
  Omit<HTMLAnchorElement, 'href' | 'title'>
> {
  /** The link node to render. */
  node: LinkNode
}

/** Props for declaring a line break node component. */
export interface ComposerLineBreakNodeProps extends React.HTMLAttributes<HTMLBRElement> {
  /** The line break node to render. */
  node: LineBreakNode
}

/** Props for declaring an inline content component. */
export interface ComposerInlineContentProps {
  /** The inline content to render. */
  content: readonly InlineNode[]
}

/** Base props for declaring a block component. */
export interface ComposerBlockBaseProps extends React.HTMLAttributes<HTMLDivElement> {
  /** At which index the block is rendered inside `<Composer.Editable />`. */
  blockIndex: number
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
export interface ComposerDividerBlockProps extends ComposerBlockBaseProps {
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

/** Props for declaring the composer editable component. */
export interface ComposerEditableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether to place the cursor in the editor at the document end after initial mount. */
  autoFocus?: boolean
}
