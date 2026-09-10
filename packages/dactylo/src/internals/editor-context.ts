import { createInitialEmptyDocumentState } from './document'
import type { DocumentState } from './document'
import { createInitialActiveMarks, isMarkEnabled } from './marks'
import type { MarkKey, Marks } from './marks'
import type { Selection } from './selection'

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
 * |  |  activeMarks: Marks    |  | (where the user is editing)      |  |
 * |  │  (the written content) │  │                                  │  │
 * |  └─────────────────────---┘  └──────────────────────────────────┘  │
 * |  ┌─────────────────────────────────────────────────────────────-┐  │
 * |  │    isPlaceholder: boolean (ephemeral empty-doc semantics)    │  │
 * |  └─────────────────────────────────────────────────────────────-┘  │
 * └─────────────────────────────────────────────────────────────────---┘
 *         │                              │
 *         ▼                              ▼
 *  toMarkdown(), exports          caret render, keydown handlers(),
 *  AI reads blocks                copy/paste, onSelectionChanged
 *
 * Why {@link Selection} is a first-class field (not external)?
 *
 * Storing {@link Selection} inside {@link EditorContext} means:
 * - `insertText` reads the current selection with no extra parameter on every call from the UI.
 * - Undo/redo restores exactly where the user was (via `set_selection` in the op batch)
 * - Subscribers give UI libraries one context to derive both block list and caret from
 * - Tests assert on a single `getContextSnapshot()` return value
 *
 * Why `selection: null` is meaningful?
 *
 * `null` is not an error state. It means "the editor is not focused", no action insertion point,
 * Cases:
 * - Initial mount before the user clicks in.
 * - After deselection when focus leaves the editor.
 * - Programmatic read-only mode (export preview, Ai summary view)
 *
 * Keyboard handlers check this first before handling key events.
 * Without an explicit `null`, we would need a sentinel cursor or risk applying edits to a stale position.
 *
 * Why `activeMarks: Marks` lives in {@link EditorContext}?
 *
 * Active marks are note a second copy of document marks. It holds pending format for the next keystroke
 * when the caret is collapsed and nothing has been inserted yet:
 *
 * | Concern                   | `TextNode.marks`                        | `EditorContext.activeMarks`                        |
 * |---------------------------|-----------------------------------------|----------------------------------------------------|
 * | Scope                     | Characters already in the document      | Next `insert_text` from the keyboard               |
 * | In `DocumentState`        | Yes                                     | No                                                 |
 * | Exported in JSON/Markdown | Yes (on text nodes only)                | No                                                 |
 * | Undo/redo                 | Via `set_marks` / `insert_text` history | Intentionally no history: `pushToHistory` is false |
 *
 * It lives on {@link EditorContext} (alongside `selection`) so the pipeline and subscribers expose one snapshot (caret position,
 * placeholder flag, document can current typing mode for the toolbar) without mixing pending typing mode
 * into {@link DocumentState} before any characters are written.
 *
 * Do not think marks are "not document content". Only the pre-keystroke typing button is excluded from export;
 * applied marks first-class document content.
 *
 * Why `isPlaceholder: boolean` lives in {@link EditorContext}?
 *
 * The placeholder is a **UX state**, not document content. When the user sees "Write something...",
 * the document technically contains one paragraph with placeholder metadata - but the user
 * hasn't committed any real content uet.
 *
 * The first keystroke behaves differently from normal typing:
 * 1. Remove placeholder text (not a normal backspace)
 * 2. Clear the placeholder flag (`isPlaceholder: false`)
 * 3. Insert the typed character
 *
 * That flag cannot live in {@link DocumentState} without polluting the exported JSON/markdown.
 * It cannot also live in UI libraries without breaking keydown handlers when no layer is mounted (tests, Ai agents, CLI).
 * On {@link EditorContext}, the keyboard builder an apply engine share the same signal.
 *
 * How {@link EditorContext} connects to the rest of Dactylo:
 * ```
 * User presses "A"
 *        |
 *        ▼
 * TransactPipeline.#context (EditorContext) → buildKeyOps({ context, cursor })
 *        │                                         │
 *        │                                         ▼
 *        |                            [ insert_text, set_selection ]
 *        |                                         │
 *        ▼                                         ▼
 * TransactionPipeline.#run() → applyOps() → new EditorContext
 *        |
 *        ▼
 * Dactylo.getContextSnapshot()     → next content
 * subscribe listeners (context)    → UI libraries re-renders blocks and caret
 * on selection changed hooks       → floating toolbar, etc.
 * ```
 *
 * The pattern is trying to be intentionally simple and predictable for UI libraries like React:
 * ```tsx
 * import { useSyncExternalStore } from 'react'
 * import { editor } from '~/dactylo'
 *
 * export function EditableDocument() {
 *   // 👉🏻 One object drives everything: the document, the selection, the marks, and the placeholder flag.
 *   const context = useSyncExternalStore((listener) => editor.subscribe(() => listener()), editor.getContextSnapshot)
 *
 *   return <>...</>
 * }
 * ```
 *
 * No prop drilling or cursor separate from content. No risk of rendering new content with an old caret position.
 */
export interface EditorContext {
  /**
   * Current document state as structured document context (blocks, nodes, order)
   * Exported to JSON/markdown; selection is intentionally excluded.
   *
   * 👉🏻 What is written aka the manuscript
   */
  readonly state: DocumentState

  /**
   * Marks for the next keyboard `insert_text` when the caret is collapsed.
   * Pending typing mode only — applied marks live on {@link TextNode}
   * in {@link DocumentState} and are exported via JSON / Markdown.
   *
   * 👉🏻 What is the current typing mode
   */
  readonly activeMarks: Marks

  /**
   * Active cursor, range, or block selection; `null` when unfocused.
   * Commits together with document changes so undo/redo restores both.
   *
   * 👉🏻 Where editing happens aka the finger on the page
   */
  readonly selection: Selection | null

  /**
   * Whether the document is a placeholder (empty)
   * 👉🏻 Session flag: `true` while the empty-document is showing
   * and the user has not typed real content yet.
   */
  readonly isPlaceholder: boolean
}

/** Callback invoked after each editor context update with the latest context. */
export type EditorContextListener = (context: EditorContext) => void

/** Creates the initial context for an empty editor with a placeholder */
export function createInitialEditorContext(placeholder: string): EditorContext {
  return {
    activeMarks: createInitialActiveMarks(),
    isPlaceholder: true,
    selection: null,
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

/** Returns a copy of the context with updated active marks. */
export function withActiveMarks(
  context: EditorContext,
  activeMarks: Marks,
): EditorContext {
  return {
    ...context,
    activeMarks,
  }
}

/**
 * Whether a mark is active or not depending from the selection on the given editor context.
 * 👉🏻  A toolbar button for a mark that should appear pressed or not.
 *
 * - Cursor: reflects `activeMarks`
 * - Range (single): `true` when mark enabled on that node
 */
export function isMarkActiveInContext(
  context: EditorContext,
  markKey: MarkKey,
): boolean {
  const { selection, activeMarks } = context

  if (selection === null) {
    return false
  }

  if (selection.__type === 'cursor') {
    return isMarkEnabled(activeMarks, markKey)
  } else if (selection.__type === 'range') {
    // @todo: implement range check
  }

  return false
}
