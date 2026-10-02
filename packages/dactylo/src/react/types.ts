import type { DactyloOptions } from '../dactylo'
import type { ParagraphBlock } from '../internals/blocks'
import type { InlineNode, LineBreakNode, TextNode } from '../internals/nodes'

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

/** Props for declaring a line break node component. */
export interface ComposerLineBreakNodeProps extends React.HTMLAttributes<HTMLBRElement> {
  /** The line break node to render. */
  node: LineBreakNode
}

/** Props for declaring an inline content component. */
export interface ComposerInlineContentProps {
  /** The inline content to render. */
  content: InlineNode[]
  // @todo: add custom components
}

/** Props for declaring a paragraph block component. */
export interface ComposerParagraphBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The paragraph block to render. */
  block: ParagraphBlock
  // @todo: add custom components.
}

/** Props for declaring the composer editable component. */
export interface ComposerEditableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether to place the cursor in the editor at the document end after initial mount. */
  autoFocus?: boolean
}
