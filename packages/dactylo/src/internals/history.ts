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
import type { InsertTextOp, Operation, SetSelectionOp } from './operations'

/**
 * Ordering inverse ops for replaying a history entry
 * when document changes must happen before selection changes.
 *
 * Keeps relative order within each group (matches reverse forward order).
 */
export function orderInverseOps(inverseOps: readonly Operation[]): Operation[] {
  const documentOps: Operation[] = []
  const selectionOps: Operation[] = []

  for (const op of inverseOps) {
    if (op.__type === 'set_selection') {
      selectionOps.push(op)
    } else {
      documentOps.push(op)
    }
  }

  return [...documentOps, ...selectionOps]
}

/** Single-char `insert_text` used for typing coalesce (ignores trailing selection). */
export function getTypingInsertOp(
  ops: readonly Operation[],
): InsertTextOp | null {
  const inserts: InsertTextOp[] = []

  for (const op of ops) {
    if (op.__type === 'insert_text') {
      inserts.push(op)
    }
  }

  if (inserts.length !== 1) {
    return null
  }

  const [first] = inserts
  if (first?.text.length !== 1) {
    return null
  }

  return first
}

/** Last `set_selection` in forward op order (if any). */
export function getTrailingSetSelectionOp(
  ops: readonly Operation[],
): SetSelectionOp | null {
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i]
    if (op?.__type === 'set_selection') {
      return op
    }
  }
  return null
}

/** Build a coalesced history entry for typing operations. */
export function buildCoalescedTypingEntry(
  prev: InsertTextOp,
  next: InsertTextOp,
  prevEntryOps: readonly Operation[],
  nextEntryOps: readonly Operation[],
): Pick<HistoryEntry, 'ops' | 'inverseOps'> {
  const merged = prev.text + next.text

  const before = getTrailingSetSelectionOp(prevEntryOps)
  const after = getTrailingSetSelectionOp(nextEntryOps)

  const forwardOps: Operation[] = [
    {
      __type: 'insert_text',
      blockId: prev.blockId,
      marks: next.marks,
      nodeId: prev.nodeId,
      offset: prev.offset,
      text: merged,
    },
  ]

  const beforeSelection = before?.prev ?? null
  const afterSelection = after?.next ?? null

  if (beforeSelection !== null || afterSelection !== null) {
    forwardOps.push({
      __type: 'set_selection',
      next: afterSelection,
      prev: beforeSelection,
    })
  }

  const inverseOps: Operation[] = [
    {
      __type: 'delete_text',
      blockId: prev.blockId,
      length: merged.length,
      nodeId: prev.nodeId,
      offset: prev.offset,
      snapshot: {
        marks: prev.marks ?? {},
        text: merged,
      },
    },
  ]

  if (beforeSelection !== null || afterSelection !== null) {
    inverseOps.push({
      __type: 'set_selection',
      next: beforeSelection,
      prev: afterSelection,
    })
  }

  const ordered = orderInverseOps(inverseOps)

  return {
    inverseOps: ordered,
    ops: forwardOps,
  }
}

/** Event emitted when working with the history stack. */
export interface HistoryEvent {
  /** Whether at least one undo entry is available. */
  readonly canUndo: boolean

  /** Whether at least one redo entry is available. */
  readonly canRedo: boolean
}

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
    if (!last) {
      return false
    }

    const prevInsert = getTypingInsertOp(last.ops)
    const nextInsert = getTypingInsertOp(entry.ops)

    if (!prevInsert || !nextInsert) {
      return false
    }

    if (
      prevInsert.blockId !== nextInsert.blockId ||
      prevInsert.nodeId !== nextInsert.nodeId ||
      prevInsert.offset + prevInsert.text.length !== nextInsert.offset
    ) {
      return false
    }

    this.#undoStack.pop()
    const coalesced = buildCoalescedTypingEntry(
      prevInsert,
      nextInsert,
      last.ops,
      entry.ops,
    )
    this.#undoStack.push({ ...coalesced, timestamp: Date.now() })

    return true
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
