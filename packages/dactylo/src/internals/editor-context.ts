import { createInitialEmptyDocumentState } from './document'
import type { DocumentState } from './document'

/**
 * `EditorContext` answers the question: what is the full editing context right now?
 *
 * It's the single immutable snapshot that the transaction pipeline reads and produces
 * on every mutation.
 * 
 * What lives where:
 * ┌────────────────────────────────────────────────────────────────---─┐
 * │                        EditorContext                               │
 * |  ┌─────────────────────---┐  ┌──────────────────────────────────┐  │
 * |  │  state: DocumentState  │  │ selection: Selection | null      │  │
 * |  │  (the written content) │  │ (where the user is editing)      │  │
 * |  └─────────────────────---┘  └──────────────────────────────────┘  │
 * |  ┌─────────────────────────────────────────────────────────────-┐  │
 * |  │    isPlaceholder: boolean (ephemeral empty-doc semantics)    │  │
 * |  └─────────────────────────────────────────────────────────────-┘  │
 * └─────────────────────────────────────────────────────────────────---┘
         │                              │
         ▼                              ▼
    toMarkdown(), exports          caret render, handleKeyDown(),
    AI reads blocks                 copy/paste, onSelectionChanged
 */
export interface EditorContext {
  /**
   * Current document state ala the manuscript
   * 👉🏻 What is written
   */
  readonly state: DocumentState

  // @todo: add selection state

  /**
   * Whether the document is a placeholder (empty)
   * 👉🏻 Session flag: `true` while the empty-document is showing
   * and the user has not typed real content yet.
   */
  readonly isPlaceholder: boolean
}

/** Creates the initial context for an empty editor with a placeholder */
export function createInitialEditorContext(placeholder: string): EditorContext {
  return {
    isPlaceholder: true,
    state: createInitialEmptyDocumentState(placeholder),
  }
}

/** Returns a copy of the context with an updated placeholder flag. */
export function withPlaceholderFlag(
  context: EditorContext,
  isPlaceholder: boolean,
): EditorContext {
  return {
    ...context,
    isPlaceholder,
  }
}

/** Returns a copy of the context with an updated document state. */
export function withDocumentState(
  context: EditorContext,
  state: DocumentState,
): EditorContext {
  return {
    ...context,
    state,
  }
}
