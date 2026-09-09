/**
 * {@link HistoryStack} defines how Dactylo tracks history in the editor.
 *
 * | Approach                                | Memory         | Speed        | Correctness                               |
 * |-----------------------------------------|----------------|--------------|-------------------------------------------|
 * | Full state snapshots                    | O(doc × depth) | Fast restore | Easy                                      |
 * | Operation inverse (chosen)              | O(ops × depth) | Fast apply   | Requires `invertOp`                       |
 * | Plain `{ undoStack, redoStack }` object | Same as class  | Same         | Harder to encapsulate coalesce + maxDepth |
 *
 * Architecture:
 * ```
 * TransactionPipeline
 * ├── #history: HistoryStack
 * └── #run(transaction)
 *       └─ commitEffects:
 *             if (policy.pushToHistory !== false)
 *               history.push({ ops, inverseOps }, { coalesce, source })
 * ```
 *
 * Stack behavior:
 * - New user transaction → `push()` clears redo branch
 * - `popUndo()` → pipeline applies `inverseOps` with `pushToHistory: false`
 * - `popRedo()` → pipeline applies forward `ops`
 * - `Batch.run()` → one history entry for entire batch
 * - Selection-only → `pushToHistory: false` on `TransactionPolicy`
 */

import { DEFAULT_HISTORY_STACK_MAX_DEPTH } from './constants'
import type { Operation } from './operations'

/**
 * One undo/redo unit
 * 👉🏻 A committed transaction's forward and inverse ops.
 */
export interface HistoryEntry {
  /** Forward operations (redo re-applies these). */
  readonly ops: readonly Operation[]

  /** Inverse operations (undo applies these). */
  readonly inverseOps: readonly Operation[]

  /** Unix timestamp when the entry was pushed. */
  readonly timestamp: number
}

/** Options for the history stack. */
export interface HistoryStackOptions {
  /** Maximum number of entries to keep in the stack. */
  readonly maxDepth?: number
}

/**
 * Undo/redo stacks owned by {@link TransactionPipeline}.
 * Encapsulates max depth, coalescing, and redo-branch clearing.
 */
export class HistoryStack {
  /** Maximum number of entries to keep in the stack. */
  readonly #maxDepth: number

  /** Undo stack. */
  #undoStack: HistoryEntry[]
  /** Redo stack. */
  #redoStack: HistoryEntry[]

  constructor(options: HistoryStackOptions = {}) {
    this.#maxDepth = options.maxDepth ?? DEFAULT_HISTORY_STACK_MAX_DEPTH

    this.#undoStack = []
    this.#redoStack = []
  }

  /** Merge consecutive single-character inserts on the same node. */
  #tryCoalesce(entry: Pick<HistoryEntry, 'ops' | 'inverseOps'>): boolean {
    const last = this.#undoStack[this.#undoStack.length - 1]
    if (!last || last.ops.length !== 1 || entry.ops.length !== 1) {
      return false
    }

    const [prev] = last.ops
    const [next] = entry.ops

    if (
      prev?.__type === 'insert_text' &&
      next?.__type === 'insert_text' &&
      prev.blockId === next.blockId &&
      prev.nodeId === next.nodeId &&
      prev.offset + prev.text.length === next.offset
    ) {
      this.#undoStack.pop()

      this.#undoStack.push({
        inverseOps: [
          {
            __type: 'delete_text',
            blockId: prev.blockId,
            length: prev.text.length + next.text.length,
            nodeId: prev.nodeId,
            offset: prev.offset,
            snapshot: {
              marks: prev.marks ?? {},
              text: prev.text + next.text,
            },
          },
        ],
        ops: [
          {
            __type: 'insert_text',
            blockId: prev.blockId,
            marks: next.marks,
            nodeId: prev.nodeId,
            offset: prev.offset,
            text: prev.text + next.text,
          },
        ],
        timestamp: Date.now(),
      })

      return true
    }

    return false
  }

  /** Whether at least one undo entry is available. */
  canUndo(): boolean {
    return this.#undoStack.length > 0
  }

  /** Whether at least one redo entry is available. */
  canRedo(): boolean {
    return this.#redoStack.length > 0
  }

  /** Number of undo entries (oldest first). Read-only view for debugging. */
  get undoDepth(): number {
    return this.#undoStack.length
  }

  /**
   * Push a committed transaction. Clears redo branch.
   * Optionally coalesces with previous single-char `insert_text` entry.
   */
  push(
    entry: Pick<HistoryEntry, 'ops' | 'inverseOps'>,
    /** When false, skip typing coalesce. Default true. */
    coalesce = true,
  ): void {
    this.#redoStack = []

    const shouldCoalesce = coalesce && this.#tryCoalesce(entry)
    if (shouldCoalesce) {
      return
    }

    this.#undoStack.push({
      inverseOps: entry.inverseOps,
      ops: entry.ops,
      timestamp: Date.now(),
    })

    while (this.#undoStack.length > this.#maxDepth) {
      this.#undoStack.shift()
    }
  }

  /** Pop newest undo entry for applying inverses. */
  popUndo(): HistoryEntry | undefined {
    const entry = this.#undoStack.pop()
    if (entry) {
      this.#redoStack.push(entry)
    }
    return entry
  }

  /** op newest redo entry for re-applying forward ops. */
  popRedo(): HistoryEntry | undefined {
    const entry = this.#redoStack.pop()
    if (entry) {
      this.#undoStack.push(entry)
    }
    return entry
  }

  /** Drop all history (e.g. after import). */
  clear(): void {
    this.#undoStack = []
    this.#redoStack = []
  }
}
