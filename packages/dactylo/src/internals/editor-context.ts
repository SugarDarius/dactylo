import { findNodeInBlockWithInlineContent, touchBlock } from './blocks'
import type { BlockId, BlockWithInlineContent } from './blocks'
import {
  collectTextSpansInRange,
  createInitialEmptyDocumentState,
  getBlockWithInlineContent,
  normalizeRange,
  replaceBlock,
} from './document'
import type { DocumentState } from './document'
import { createInitialActiveMarks, isMarkEnabled } from './marks'
import type { MarkKey, Marks } from './marks'
import { coalesceInlineNodes } from './nodes'
import type { InlineNode } from './nodes'
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
 * |  |  activeMarks: Marks    |  |            |                     |  |
 * |  |         |              |  |            |                     |  |
 * |  |         ▼              |  |            ▼                     |  |
 * |  │  the written content   │  │ where the user is editing        │  │
 * |  └─────────────────────---┘  └──────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────────---┘
 *         │                              │
 *         ▼                              ▼
 *  toMarkdown(), exports,         caret render, keydown handlers(),
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
   * Active cursor, or range selection; `null` when unfocused.
   * Commits together with document changes so undo/redo restores both.
   *
   * 👉🏻 Where editing happens aka the finger on the page
   */
  readonly selection: Selection | null
}

/** Creates the initial context for an empty document. */
export function createInitialEditorContext(): EditorContext {
  const initialActiveMarks = createInitialActiveMarks()
  return {
    activeMarks: initialActiveMarks,
    selection: null,
    state: createInitialEmptyDocumentState(initialActiveMarks),
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

/** Returns a copy of the context with an updated selection. */
export function withSelection(
  context: EditorContext,
  selection: Selection | null,
): EditorContext {
  return {
    ...context,
    selection,
  }
}
/** Replaces a block's inline content and coalesces adjacent text nodes. */
export function updateBlockWithInlineContent(
  context: EditorContext,
  blockId: BlockId,
  content: InlineNode[],
): EditorContext {
  const block = getBlockWithInlineContent(context.state, blockId)
  const updated: BlockWithInlineContent = {
    ...block,
    content: coalesceInlineNodes(content),
  }
  const next = touchBlock(updated)

  return withDocumentState(context, replaceBlock(context.state, blockId, next))
}

/**
 * Whether a mark is active or not depending from the selection on the given editor context.
 * 👉🏻  A toolbar button for a mark that should appear pressed or not.
 *
 * - Cursor: reflects `activeMarks`
 * - Range: `true` when every selected text slice already has the mark
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
    const normalized = normalizeRange(context.state, selection)
    const spans = collectTextSpansInRange(context.state, normalized)

    if (spans.length <= 0) {
      return false
    }

    return spans.every((span) => {
      const block = getBlockWithInlineContent(context.state, span.blockId)
      const found = findNodeInBlockWithInlineContent(block, span.nodeId)

      if (!found || found.node.__type !== 'text') {
        return false
      }

      return isMarkEnabled(found.node.marks, markKey)
    })
  }

  return false
}

/** Whether the selection is active or not. */
export function isSelectionActive(context: EditorContext): boolean {
  return context.selection !== null
}
