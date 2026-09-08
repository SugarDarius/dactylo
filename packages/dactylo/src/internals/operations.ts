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

import type { Block, BlockId } from './blocks'
import type { Relax } from './types'

/**
 * Operation to insert a block at the given
 * position (fractional index).
 */
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

/**
 * Describes where a new block should be inserted
 * relative to existing blocks. */
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

/**
 * Operation to delete a block at the given
 * position (fractional index).
 */
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

/** Discriminated union of all operations supported by Dactylo. */
export type Operation = Relax<InsertBlockOp | DeleteBlockOp>
