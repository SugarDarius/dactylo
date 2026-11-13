import type { PBM, TNM } from './augmentation'
import { findNodeInBlockWithInlineContent, touchBlock } from './blocks'
import type { BlockId, BlockWithInlineContent } from './blocks'
import { MENTION_BUFFER_BEFORE_CHAR_OPENER } from './constants'
import {
  collectTextSpansInRange,
  createInitialEmptyDocumentState,
  getBlockWithInlineContent,
  normalizeRange,
  putBlock,
} from './document'
import type { DocumentState } from './document'
import { isMarkEnabled } from './marks'
import type { MarkKey } from './marks'
import type { MentionPointer } from './mention-buffer'
import { isInlineNodeWithEditableText, isTextNode } from './nodes'
import type { InlineNode } from './nodes'
import { isCursorSelection, isSelectionActive } from './selection'
import type { Selection } from './selection'

/**
 * `EditorContext` answers the question: what is the full editing context right now?
 *
 * It's the single immutable snapshot that the transaction pipeline reads and produces
 * on every mutation.
 *
 * What lives where:
 * ```md
 * ┌────────────────────────────────────────────────────────────────---─┐
 * │                        EditorContext                               │
 * |  ┌─────────────────────---┐  ┌──────────────────────────────────┐  │
 * |  │  state: DocumentState  │  │ selection: Selection | null      │  │
 * |  |         |              |  |            |                     |  │
 * |  |         ▼              |  |            ▼                     |  │
 * |  │  the written content   │  │   where the user is editing      │  │
 * |  └─────────────────────---┘  └──────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────────---┘
 *         │                              │
 *         ▼                              ▼
 *  toMarkdown(), exports,         caret render, keydown handlers(),
 *  AI reads blocks                copy/paste, onSelectionChanged
 * ```
 *
 * Why {@link Selection} is a first-class field (not external)?
 *
 * Storing {@link Selection} inside {@link EditorContext} means:
 * - `insertText` reads the current selection with no extra parameter on every call from the UI.
 * - Undo/redo restores exactly where the user was (via `set_selection` in the op batch)
 * - Subscribers give UI libraries one context to derive both block list and caret from
 * - Tests assert on a single `getContext()` return value
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
 * Inline marks live on {@link TextNode} / {@link LinkNode} in {@link DocumentState}.
 * The toolbar reads them from the caret node (or selected spans). Typing inherits the
 * current node's marks; hard/soft break copies them onto the continuation.
 *
 * How {@link EditorContext} connects to the rest of Dactylo:
 * ```md
 * User presses "A"
 *        |
 *        ▼
 * TransactPipeline.#context (EditorContext) → buildTypedCharOps({ context, cursor })
 *        │                                         │
 *        │                                         ▼
 *        |                            [ insert_text, set_selection ]
 *        |                                         │
 *        ▼                                         ▼
 * TransactionPipeline.#run() → applyOps() → new EditorContext
 *        |
 *        ▼
 * Dactylo.getContext()             → next content
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
 *   // 👉🏻 One object drives everything: the document, the selection, and the placeholder flag.
 *   const context = useSyncExternalStore((listener) => editor.subscribe(() => listener()), editor.getContext)
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
   * Active cursor, or range selection; `null` when unfocused.
   * Commits together with document changes so undo/redo restores both.
   *
   * 👉🏻 Where editing happens aka the finger on the page
   */
  readonly selection: Selection | null
}

/** Creates the initial context for an empty document. */
export function createInitialEditorContext(
  opts: {
    paragraphMetadata?: PBM
    textMetadata?: TNM
  } = {},
): EditorContext {
  return {
    selection: null,
    state: createInitialEmptyDocumentState({ ...opts }),
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
  content: readonly InlineNode[],
): EditorContext {
  const block = getBlockWithInlineContent(context.state, blockId)
  const updated: BlockWithInlineContent = {
    ...block,
    content,
  }
  const next = touchBlock(updated)
  return withDocumentState(context, putBlock(context.state, next))
}

/**
 * Whether a mark is active or not depending from the selection on the given editor context.
 * 👉🏻  A toolbar button for a mark that should appear pressed or not.
 *
 * - Cursor: reflects the caret node's marks
 * - Range: `true` when every selected text slice already has the mark
 */
export function isMarkActiveInContext(
  context: EditorContext,
  mark: MarkKey,
): boolean {
  const { selection } = context

  if (!isSelectionActive(selection)) {
    return false
  }

  if (selection.__type === 'cursor') {
    const { blockId, nodeId } = selection.anchor
    const block = getBlockWithInlineContent(context.state, blockId)
    const found = findNodeInBlockWithInlineContent(block, nodeId)

    if (!found || !isInlineNodeWithEditableText(found.node)) {
      return false
    }

    return isMarkEnabled(found.node.marks, mark)
  } else if (selection.__type === 'range') {
    const normalized = normalizeRange(context.state, selection)
    const spans = collectTextSpansInRange(context.state, normalized)

    if (spans.length <= 0) {
      return false
    }

    return spans.some((span) => {
      const block = getBlockWithInlineContent(context.state, span.blockId)
      const found = findNodeInBlockWithInlineContent(block, span.nodeId)

      if (!found || !isInlineNodeWithEditableText(found.node)) {
        return false
      }

      return isMarkEnabled(found.node.marks, mark)
    })
  }

  return false
}

/**
 * Whether a {@link CursorSelection} is in a {@link TextNode} to start a mention buffer.
 * Start of the {@link TextNode}, or a whitespace character immediately before the caret.
 */
export function findMentionPointerAtCursor(
  context: EditorContext,
): MentionPointer | null {
  const { selection, state } = context
  if (!isCursorSelection(selection)) {
    return null
  }

  const { anchor } = selection
  const block = getBlockWithInlineContent(state, anchor.blockId)
  const found = findNodeInBlockWithInlineContent(block, anchor.nodeId)
  if (!found || !isTextNode(found.node)) {
    return null
  }

  if (anchor.offset > 0) {
    const { text } = found.node
    const previous = text[anchor.offset - 1]

    if (
      previous === undefined ||
      !MENTION_BUFFER_BEFORE_CHAR_OPENER.test(previous)
    ) {
      return null
    }
  }

  return {
    blockId: anchor.blockId,
    nodeId: found.node.id,
    triggerOffset: anchor.offset,
  }
}
