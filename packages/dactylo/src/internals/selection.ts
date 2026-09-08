import type { BlockId } from './blocks'
import type { NodeId } from './node'
import type { Relax } from './types'

/**
 * {@link Selection} defines how Dactylo tracks cursor position and text selection
 * then combine with {@link DocumentState} into {@link EditorContext} (the full snapshot the transaction pipeline mutates)
 *
 * {@link EditorContext} is not a convenience wrapper. It's the atomic unit of changes for the entire editor:
 * content, caret and empty-doc semantics commit together.
 *
 * {@link DocumentState} alone answers "what is written?" but not "when is the user editing?",
 * and those two must stay in sync.
 *
 * Without {@link EditorContext}:
 * - Undo/redo would restore text but leave the cursor in the same place/deleted block/delete text.
 * - `keydown` events should need the cursor passed in UI libraries on every call.
 * - Export would risk leaking selection into saved JSON/markdown.
 * - Subscribers would need two separate update channels (content + caret)
 *
 * {@link EditorContext} blocks `state` + `selection` + `isPlaceholder` so one transaction
 * produces one complete next snapshot
 *
 * Why not put selection inside {@link DocumentState}?
 *
 * Treating selection as part of the document would blur two concerns:
 * 1. Content → what gets saved, exported, synced, indexed by Ai.
 * 2. Interaction → where the user is pointing while editing.
 *
 * | If selection were inside `DocState` | Problem                                                      |
 * |-------------------------------------|--------------------------------------------------------------|
 * | Export to JSON                      | Cursor coordinates leak into saved files                     |
 * | `toMarkdown()`                      | Must strip selection before every export                     |
 * | Undo of content-only AI patch       | Would accidentally restore stale cursor from another session |
 * | Two users editing (future)          | Remote cursor is not document content                        |
 *
 * Keeping {@link DocumentState} pure means export, import, and persistence never need to filter out UI state.
 * Selection travels with the editing session, not the document.
 *
 * Why the pipeline mutates {@link EditorContext} instead of {@link DocumentState}?
 *
 * Every transaction can change both content and selection in one atomic step.
 * Consider the user pressing `Enter` mid-paragraph:
 * ```
 * Before:  [ paragraph: "Hello|World" ]     selection: cursor at offset 5
 * After:   [ paragraph: "Hello" ]           selection: cursor at start of new block
 *          [ paragraph: "World" ]
 * ```
 *
 * That is one user action, but it requires:
 * - A `split_block` operation (doc change)
 * - A `set_selection` operation (cursor moves to the new block)
 *
 * If the pipeline only returned {@link DocumentState}, we would need a second, parallel mechanism to update the cursor,
 * and nothing would guarantee they stay in sync. Two updates means two subscriber notifications, two changes for UI libraries
 * to render inconsistent intermediate frames, and undo that must manually coordinate two separate stacks.
 *
 * With {@link EditorContext} one transaction produces one next snapshot:
 * ```ts
 * const nextContext = applyOps(prevContext, [
 * {
 *    type: 'split_block',
 *   blockId: block.id,
 *   atNodeId: cursor.nodeId,
 *   atOffset: cursor.offset,
 *   newBlock,
 *   tailSnapshot,
 * },
 * {
 *   type: 'set_selection',
 *   selection: cursorInNewBlock,
 *   prevSelection: prevContext.selection,
 * },
 * ])
 * // nextContext: EditorContext (state AND selection updated together)
 * ```
 *
 * This is the core meaning of {@link EditorContext}: it's the atomic unit of editor changes, not just the document.
 */

/** A cursor position inside a text-bearing inline node. */
export interface TextCursor {
  /** Block containing the target inline node. */
  readonly blockId: BlockId

  /** Inline node the cursor is anchored to. */
  readonly nodeId: NodeId

  /** Character offset within the node's text (or 0 at line_break). */
  readonly offset: number
}

/** Collapsed cursor (insertion point). */
export interface CursorSelection {
  readonly __type: 'cursor'

  /** Cursor position (anchor equals focus). */
  readonly anchor: TextCursor
}

/** Non-empty text range. anchor/focus order matters for delete direction. */
export interface RangeSelection {
  readonly __type: 'range'

  /** Range start in document order (may be after focus when selecting backward). */
  readonly anchor: TextCursor

  /** Range end in document order. */
  readonly focus: TextCursor
}

/** Block-level selection (future: drag handle, multi-block). v1: single block. */
export interface BlockSelection {
  readonly __type: 'block'

  /** Selected block ID. */
  readonly blockId: BlockId
}

/** Discriminated union of all supported selection shapes in Dactylo. */
export type Selection = Relax<CursorSelection | RangeSelection | BlockSelection>
