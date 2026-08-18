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
  readonly type: 'insert_block'
  /** Block to insert. */
  readonly block: Block
  /**
   * Position where the block is inserted.
   * If set to `null`, then the block is inserted
   * directly at the beginning of the document.
   */
  readonly afterBlockId: BlockId | null
}

/** Union type of all operations supported by Dactylo. */
export type Operation = Relax<InsertBlockOp>
