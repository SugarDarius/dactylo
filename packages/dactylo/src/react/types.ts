import type { DactyloOptions } from '../dactylo'
import type { ParagraphBlock } from '../internals/blocks'

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

/** Props for declaring a paragraph block component. */
export interface ComposerParagraphBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The paragraph block to render. */
  block: ParagraphBlock
}

/** Props for declaring the composer editable component. */
export interface ComposerEditableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether to place the cursor in the editor at the document end after initial mount. */
  autoFocus?: boolean
}
