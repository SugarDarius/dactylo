import type { DactyloOptions } from '../dactylo'
import type {
  BlockId,
  DividerBlock,
  HeadingBlock,
  ParagraphBlock,
} from '../internals/blocks'
import type {
  InlineNode,
  LineBreakNode,
  LinkNode,
  TextNode,
} from '../internals/nodes'

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
  content: InlineNode[]
}

/** Props for declaring a paragraph block component. */
export interface ComposerParagraphBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The paragraph block to render. */
  block: ParagraphBlock

  /** At which index the paragraph block is rendered inside `<Composer.Editable />`. */
  indexOfRendering: number
}

/** Props for declaring a heading block component. */
export interface ComposerHeadingBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The heading block to render. */
  block: HeadingBlock

  /** At which index the heading block is rendered inside `<Composer.Editable />`. */
  indexOfRendering: number
}

/** Props for declaring a divider block component. */
export interface ComposerDividerBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The divider block to render. */
  block: DividerBlock

  /** At which index the divider block is rendered inside `<Composer.Editable />`. */
  indexOfRendering: number
}

/** Props for declaring a block wrapper component. */
export interface ComposerBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The block ID to render. */
  blockId: BlockId

  /** At which index the block is rendered inside `<Composer.Editable />`. */
  indexOfRendering: number
}

/** Props for declaring the composer editable component. */
export interface ComposerEditableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether to place the cursor in the editor at the document end after initial mount. */
  autoFocus?: boolean
}
