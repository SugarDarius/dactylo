/**
 * Catalog of all operations supported by Dactylo.
 *
 * Operations are the public mutation vocabulary for Dactylo.
 * Each features (user typing, pasting, Enter key, markdown shortcuts, Ai Edits, undo/redo, ...)
 * decomposes into this finite set of operations.
 *
 * Properties each operation must have:
 *
 * | Property     | Requirement                                          |
 * |--------------|------------------------------------------------------|
 * | Serializable | JSON-safe for logging and Ai                         |
 * | Pure apply   | `(state, op) → state`                                |
 * | Invertible   | Enables undo/redo (op ∘ invert(op) = id)             |
 * | ID-based     | References always blocks or nodes by Id, not indexes |
 * | Small        | Prefer minimal fields for memory and efficiency      |
 */

import type { Block, BlockId, BlockWithInlineContent } from './blocks'
import type { Marks } from './marks'
import type { InlineNode, NodeId } from './nodes'
import type { Selection } from './selection'
import type { Relax } from './types'

/** Inserts a block at the given position (fractional index). */
export interface InsertBlockOp {
  readonly __type: 'insert_block'
  /** Block to insert. */
  readonly block: Block
  /**
   * Position where the block is inserted.
   * If set to `null`, then the block is inserted
   * directly at the beginning of the document.
   */
  readonly afterBlockId: BlockId | null
}

/** Describes where a new block should be inserted relative to existing blocks. */
export type InsertBlockOpPosition = Relax<
  | {
      /** Insert at document start. */
      type: 'start'
    }
  | {
      /** Insert at document end. */
      type: 'end'
    }
  | {
      /** Insert immediately after an existing block. */
      type: 'after'
      blockId: BlockId
    }
  | {
      /** Insert immediately before an existing block. */
      type: 'before'
      blockId: BlockId
    }
  | {
      /** Insert strictly between two existing blocks. */
      type: 'between'
      afterBlockId: BlockId
      beforeBlockId: BlockId
    }
>

/** Deletes a block at the given position (fractional index). */
export interface DeleteBlockOp {
  readonly __type: 'delete_block'
  /** ID of the block to delete. */
  readonly blockId: BlockId
  /** Snapshot for undo - full block as it was before deletion. */
  readonly snapshot: Block
  /**
   * Position where the block is deleted for undo re-insertion.     * If set to `null`, then the block is deleted
   * directly at the beginning of the document.
   */
  readonly afterBlockId: BlockId | null
}

/** Splits a block into two at a cursor position (Enter key). */
export interface SplitBlockOp {
  readonly __type: 'split_block'

  /** Block to split. */
  readonly blockId: BlockId

  /** Text node ID where the split occurs. */
  readonly atNodeId: NodeId

  /** Character offset within `atNodeId` where content is divided. */
  readonly atOffset: number

  /** New block created by the split (already constructed with posKey). */
  readonly newBlock: BlockWithInlineContent

  /**
   * Inline nodes moved to `newBlock` (tail content after split).
   * Stored for undo inversion.
   */
  readonly tailSnapshot: readonly InlineNode[]

  /**
   * Index in the head block's content where the tail originally started.
   * Used by undo to merge blocks back correctly.
   */
  readonly atIndex: number
}

/** Merges a source block's content into a target block (Backspace at block start). */
export interface MergeBlocksOp {
  readonly __type: 'merge_blocks'

  /** Block receiving merged content. */
  readonly targetBlockId: BlockId

  /** Block whose content is merged in and then deleted. */
  readonly sourceBlockId: BlockId

  /** Full source block snapshot before merge (for undo). */
  readonly sourceSnapshot: BlockWithInlineContent

  /** Insertion index in target content where source was spliced. */
  readonly atIndex: number

  /** Copy of source inline content before deletion (for undo). */
  readonly mergedTailSnapshot: readonly InlineNode[]

  /** Text node ID in target where undo split must occur. */
  readonly splitAtNodeId: NodeId

  /** Character offset within `splitAtNodeId` for undo split. */
  readonly splitAtOffset: number
}

/** Inserts a text into an existing text node at a character offset.  */
export interface InsertTextOp {
  readonly __type: 'insert_text'

  /** Block containing the target text node. */
  readonly blockId: BlockId

  /** Text node receiving the insertion. */
  readonly nodeId: NodeId

  /** Character offset within the text node. */
  readonly offset: number

  /** Text string to insert. */
  readonly text: string

  /** Optional partial marks applied to inserted text (defaults to node marks). */
  readonly marks?: Partial<Marks>
}

/** Deletes a run of characters from a text node. */
export interface DeleteTextOp {
  readonly __type: 'delete_text'

  /** Block containing the target text node. */
  readonly blockId: BlockId

  /** Text node from which text is removed. */
  readonly nodeId: NodeId

  /** Character offset where removal starts. */
  readonly offset: number

  /** Number of characters to remove. */
  readonly length: number

  /** Removed text and marks stored for undo. */
  readonly snapshot: {
    /** Substring removed from the text node. */
    readonly text: string
    /** Optional partial marks applied to the removed run. */
    readonly marks?: Partial<Marks>
  }
}

/** Updates active typing marks without mutating document content. */
export interface SetActiveMarksOp {
  readonly __type: 'set_active_marks'

  /** Active marks before the change (for invert). */
  readonly prevActiveMarks: Marks

  /** Active marks after the change. */
  readonly activeMarks: Marks
}

/** Applies mark changes to a character range within a text node. */
export interface SetMarksOp {
  readonly __type: 'set_marks'

  /** Block containing the target text node. */
  readonly blockId: BlockId

  /** Text node whose marks are updated. */
  readonly nodeId: NodeId

  /** Start offset (inclusive) of the mark range. */
  readonly from: number

  /** End offset (exclusive) of the mark range. */
  readonly to: number

  /** Marks before the change (for undo). */
  readonly prevMarks: Marks

  /** Marks after the change. */
  readonly nextMarks: Marks
}

/** Updates editor selection without mutating document content, */
export interface SetSelectionOp {
  readonly __type: 'set_selection'

  /** Previous selection stored for undo inversion. */
  readonly prev: Selection | null

  /** Next selection to apply after the transaction. */
  readonly next: Selection | null
}

/** Discriminated union of all operations supported by Dactylo. */
export type Operation = Relax<
  | InsertBlockOp
  | DeleteBlockOp
  | SplitBlockOp
  | MergeBlocksOp
  | InsertTextOp
  | DeleteTextOp
  | SetActiveMarksOp
  | SetMarksOp
  | SetSelectionOp
>
