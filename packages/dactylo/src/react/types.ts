import type { DactyloOptions } from '../dactylo'
import type { BlockId } from '../internals/blocks'

// --- Composer.Root ─────────────────────────────────────────-------

/** Props for declaring the composer root component. */
export interface ComposerRootProps
  extends React.HTMLAttributes<HTMLDivElement>, DactyloOptions {}

// --- Composer.Editable ─────────────────────────────────────────---

/** Props for declaring a block component. */
export interface ComposerBlockProps {
  /** Block id rendered by this surface. */
  blockId: BlockId
}

/** Props for declaring a paragraph block component. */
export interface ComposerParagraphBlockProps
  extends React.HTMLAttributes<HTMLDivElement>, ComposerBlockProps {}

/** Props for declaring the composer editable component. */
export interface ComposerEditableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether to place the cursor in the editor at the document end  after initial mount. */
  autoFocus?: boolean
}
