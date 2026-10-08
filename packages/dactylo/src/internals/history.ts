import { DEFAULT_HISTORY_STACK_MAX_DEPTH } from './constants'
import type {
  DeleteTextOp,
  InsertTextOp,
  Operation,
  SetSelectionOp,
} from './operations'
import type { TypingBurstOptions } from './typing'
import { TypingBurstController } from './typing'

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

/** Sole `insert_text` in a typing transaction, if any. */
export function getSingleInsertTextOp(
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
  return inserts[0] ?? null
}

/**
 * Sole `delete_text` in a backspace transaction, if any.
 *
 * Coalescing only applies when the forward ops are a single document mutation
 * (one `delete_text`, optional trailing `set_selection`) — the same shape as
 * {@link getSingleInsertTextOp} for typing.
 */
export function getSingleDeleteTextOp(
  ops: readonly Operation[],
): DeleteTextOp | null {
  const deletes: DeleteTextOp[] = []
  for (const op of ops) {
    if (op.__type === 'delete_text') {
      deletes.push(op)
    }
  }
  if (deletes.length !== 1) {
    return null
  }
  return deletes[0] ?? null
}

/** Accumulated typing on the undo stack (may already be merged: `"Hello"`, etc.). */
export function getAccumulatedTypingInsertOp(
  ops: readonly Operation[],
): InsertTextOp | null {
  const insert = getSingleInsertTextOp(ops)
  if (!insert || insert.text.length < 1) {
    return null
  }
  return insert
}

/**
 * Accumulated backspace burst on the undo stack (may already be merged).
 * Used for the **top** history entry: one `delete_text` with `length >= 1`.
 */
export function getAccumulatedTypingDeleteOp(
  ops: readonly Operation[],
): DeleteTextOp | null {
  const del = getSingleDeleteTextOp(ops)
  if (!del || del.length < 1) {
    return null
  }
  return del
}

/** Incoming keystroke: exactly one character in the sole `insert_text`.  */
export function getIncomingTypingInsertOp(
  ops: readonly Operation[],
): InsertTextOp | null {
  const insert = getSingleInsertTextOp(ops)
  if (!insert || insert.text.length !== 1) {
    return null
  }
  return insert
}

/**
 * Incoming backspace keystroke: exactly one code unit in the sole `delete_text`.
 *
 * Matches {@link OperationsEngine.buildCursorBackspaceOps} (`length: 1`,
 * `coalesce: true`, label `delete-character`).
 */
export function getIncomingTypingDeleteOp(
  ops: readonly Operation[],
): DeleteTextOp | null {
  const del = getSingleDeleteTextOp(ops)
  if (!del || del.length !== 1) {
    return null
  }
  return del
}

/**
 * Build a coalesced history entry for consecutive backspace deletes on one text node.
 *
 * ## Geometry (mirror of typing inserts)
 *
 * Typing merges **forward** (right): `prev.offset + prev.text.length === next.offset`.
 *
 * Backspace merges **backward** (left): the new delete sits immediately before
 * the accumulated run:
 *
 * ```
 *   next.offset + next.length === prev.offset
 * ```
 *
 * Example on `"Hello"`, cursor after `"o"`:
 *
 * - 1st backspace: delete offset 4, length 1, snapshot `"o"`
 * - 2nd backspace: delete offset 3, length 1, snapshot `"l"`
 * - Merged forward: offset 3, length 2, snapshot `"lo"` (`next.text + prev.text`)
 *
 * ## Selection
 *
 * Same rule as {@link buildCoalescedTypingEntry}: selection before the burst
 * comes from the first entry; selection after the burst from the last entry.
 *
 * ## Undo
 *
 * One undo step runs a single `insert_text` restoring the merged run, then
 * selection inverse — one Cmd+Z puts back every character removed in the burst.
 */

export function buildCoalescedDeleteEntry(
  prev: DeleteTextOp,
  next: DeleteTextOp,
  prevEntryOps: readonly Operation[],
  nextEntryOps: readonly Operation[],
): Pick<HistoryEntry, 'ops' | 'inverseOps'> {
  const mergedLength = prev.length + next.length
  const mergedText = next.snapshot.text + prev.snapshot.text
  const mergedOffset = next.offset

  const before = getTrailingSetSelectionOp(prevEntryOps)
  const after = getTrailingSetSelectionOp(nextEntryOps)

  const forwardOps: Operation[] = [
    {
      __type: 'delete_text',
      blockId: prev.blockId,
      length: mergedLength,
      nodeId: prev.nodeId,
      offset: mergedOffset,
      snapshot: {
        marks: next.snapshot.marks ?? prev.snapshot.marks ?? {},
        text: mergedText,
      },
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
      __type: 'insert_text',
      blockId: prev.blockId,
      marks: next.snapshot.marks ?? prev.snapshot.marks,
      nodeId: prev.nodeId,
      offset: mergedOffset,
      text: mergedText,
    },
  ]

  if (beforeSelection !== null || afterSelection !== null) {
    inverseOps.push({
      __type: 'set_selection',
      next: beforeSelection,
      prev: afterSelection,
    })
  }

  return {
    inverseOps: orderInverseOps(inverseOps),
    ops: forwardOps,
  }
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

  /** Adaptive typing burst / undo coalesce tuning. */
  readonly typingBurst?: TypingBurstOptions
}

/**
 * {@link HistoryStack} defines how Dactylo tracks history in the editor.
 *
 * | Approach                                | Memory         | Speed        | Correctness                               |
 * |-----------------------------------------|----------------|--------------|-------------------------------------------|
 * | Full state snapshots                    | O(doc × depth) | Fast restore | Easy                                      |
 * | Operation inverse (chosen)              | O(ops × depth) | Fast apply   | Requires `invertOp`                       |
 * | Plain `{ undoStack, redoStack }` object | Same as class  | Same         | Harder to encapsulate coalesce + maxDepth |
 *
 * Each {@link HistoryEntry} stores forward `ops` and `inverseOps` for one undo/redo
 * step. {@link push} may **merge** consecutive typing transactions into a single
 * entry so undo removes a **burst** of characters instead of one key at a time.
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
 *
 * ## Two layers of coalesce
 *
 * | Layer         | Where                                                      | What it controls                                                                         |
 * |---------------|------------------------------------------------------------|------------------------------------------------------------------------------------------|
 * | **Policy**    | `TransactionPolicy.coalesce` from {@link OperationsEngine} | Whether this commit *may* merge at all. `false` for space, `@`, `/`, splits, etc.        |
 * | **Mechanism** | `#tryCoalesce` + {@link TypingBurstController}             | Whether merge is *allowed* for this keystroke: same insert target, timing, and char cap. |
 *
 * Policy alone is not enough: even when `coalesce === true`, `#tryCoalesce` can
 * refuse merge (pause, char cap, wrong block/node/offset). When merge succeeds,
 * {@link buildCoalescedTypingEntry} replaces the top undo entry with one wider
 * `insert_text` and updates {@link HistoryEntry.timestamp} to the latest key.
 *
 * ## Typing burst ({@link TypingBurstController})
 *
 * While merging, `last.timestamp` is the time of the previous commit in the burst.
 * Inter-key gap drives an **EMA** (exponential moving average) of typing speed, which
 * picks a dynamic max merge length (slow → ~{@link DEFAULT_MAX_CHAR_WHEN_SLOW},
 * fast → ~{@link DEFAULT_MAX_CHAR_WHEN_FAST}). Tuning lives in
 * {@link HistoryStackOptions.typingBurstOptions}.
 *
 * Burst checks (all must pass to merge):
 *
 * 1. Top entry and incoming tx are typing-shaped ({@link getAccumulatedTypingInsertOp} + {@link getIncomingTypingInsertOp}).
 * 2. Same `blockId`, same `nodeId`, contiguous offsets (`prev.offset + prev.text.length === next.offset`).
 * 3. {@link TypingBurstController.shouldContinue}: gap ≤ `pauseMs`, and `accumulated + incoming` ≤ speed-based cap.
 *
 * On spatial / shape mismatch, `#tryCoalesce` calls {@link TypingBurstController.reset}.
 * On pause or cap, `shouldContinue` returns `false` and resets internally.
 *
 * ## `push()` flow
 *
 * push(entry, coalesce) ──► redoStack = []
 *                │
 *                ├─ coalesce === false ? ──► #undoStack.push(entry) ──► trim maxDepth
 *                │
 *                └─ #tryCoalesce(entry) ?
 *                      │
 *                      ├─ true  ──► return (top entry merged in place)
 *                      │
 *                      └─ false ──► #undoStack.push(entry) ──► trim maxDepth
 *
 * Semantics (`#tryCoalesce` + burst):
 *
 * #tryCoalesce(entry) ──► peek #undoStack[-1]
 *                │
 *                ├─ no top entry ? ──► false
 *                │
 *                ├─ not typing pair ?
 *                │     (accumulated insert_text + single-char insert_text)
 *                │     ──► TypingBurstController.reset() ──► false
 *                │
 *                ├─ blockId / nodeId / offset not contiguous ?
 *                │     ──► TypingBurstController.reset() ──► false
 *                │
 *                └─ TypingBurstController.shouldContinue(last.timestamp, now) ?
 *                      │
 *                      ├─ gap > pauseMs ? ──► reset() ──► false
 *                      │
 *                      ├─ accumulated + incoming > speed cap ? ──► reset() ──► false
 *                      │
 *                      └─ ok ──► pop top ──► buildCoalescedTypingEntry
 *                                ──► push merged entry (timestamp = now) ──► true
 *
 * End-to-end (policy → stack):
 *
 * OperationsEngine ──► TransactionPolicy.coalesce
 *                │
 *                ├─ false (space, @, /, split, …) ──► push(..., false) ──► new undo step
 *                │
 *                └─ true (normal char) ──► push(..., true) ──► may merge via #tryCoalesce
 *
 * ## Stack behavior (non-coalesce)
 *
 * - Any `push` clears the redo branch.
 * - {@link popUndo} / {@link popRedo} move entries between stacks; they do not run burst logic.
 * - {@link clear} empties both stacks and resets {@link TypingBurstController}.
 *
 * @see TypingBurstController — pause threshold, EMA IKI, speed-dependent char cap
 * @see buildCoalescedTypingEntry — merges forward/inverse ops for typing bursts
 */
export class HistoryStack {
  /** Maximum number of entries to keep in the stack. */
  readonly #maxDepth: number

  /** Undo stack. */
  #undoStack: HistoryEntry[]
  /** Redo stack. */
  #redoStack: HistoryEntry[]

  /** Pause + EMA IKI → speed-dependent max merge length for typing. */
  readonly #typingBurstController: TypingBurstController

  constructor(options: HistoryStackOptions = {}) {
    this.#maxDepth = options.maxDepth ?? DEFAULT_HISTORY_STACK_MAX_DEPTH

    this.#undoStack = []
    this.#redoStack = []

    this.#typingBurstController = new TypingBurstController(options.typingBurst)
  }

  /**
   * Merge consecutive single-character {@link InsertTextOp} on the same node
   * when policy {@link TransactionPolicy.coalesce} is true.
   */
  #tryCoalesceInsert(
    last: HistoryEntry,
    entry: Pick<HistoryEntry, 'ops' | 'inverseOps'>,
    prevInsert: InsertTextOp,
    nextInsert: InsertTextOp,
  ): boolean {
    if (
      prevInsert.blockId !== nextInsert.blockId ||
      prevInsert.nodeId !== nextInsert.nodeId ||
      prevInsert.offset + prevInsert.text.length !== nextInsert.offset
    ) {
      this.#typingBurstController.reset()
      return false
    }

    const now = Date.now()
    const continueBurst = this.#typingBurstController.shouldContinue({
      accumulatedChars: prevInsert.text.length,
      incomingChars: nextInsert.text.length,
      lastEventMs: last.timestamp,
      nowMs: now,
    })

    if (!continueBurst) {
      return false
    }

    this.#undoStack.pop()

    const coalesced = buildCoalescedTypingEntry(
      prevInsert,
      nextInsert,
      last.ops,
      entry.ops,
    )

    this.#undoStack.push({ ...coalesced, timestamp: now })

    return true
  }

  /**
   * Merge consecutive single-character {@link DeleteTextOp} (backspace) on the
   * same node when {@link OperationsEngine.buildCursorBackspaceOps} sets
   * `coalesce: true`.
   */
  #tryCoalesceDelete(
    last: HistoryEntry,
    entry: Pick<HistoryEntry, 'ops' | 'inverseOps'>,
    prevDelete: DeleteTextOp,
    nextDelete: DeleteTextOp,
  ): boolean {
    if (
      prevDelete.blockId !== nextDelete.blockId ||
      prevDelete.nodeId !== nextDelete.nodeId ||
      nextDelete.offset + nextDelete.length !== prevDelete.offset
    ) {
      this.#typingBurstController.reset()
      return false
    }

    const now = Date.now()
    const continueBurst = this.#typingBurstController.shouldContinue({
      accumulatedChars: prevDelete.length,
      incomingChars: nextDelete.length,
      lastEventMs: last.timestamp,
      nowMs: now,
    })

    if (!continueBurst) {
      return false
    }

    this.#undoStack.pop()
    const coalesced = buildCoalescedDeleteEntry(
      prevDelete,
      nextDelete,
      last.ops,
      entry.ops,
    )
    this.#undoStack.push({ ...coalesced, timestamp: now })

    return true
  }

  /** Merge consecutive single-character inserts/deletes on the same node. */
  #tryCoalesce(entry: Pick<HistoryEntry, 'ops' | 'inverseOps'>): boolean {
    const last = this.#undoStack[this.#undoStack.length - 1]
    if (!last) {
      return false
    }

    const prevInsert = getAccumulatedTypingInsertOp(last.ops)
    const nextInsert = getIncomingTypingInsertOp(entry.ops)

    const prevDelete = getAccumulatedTypingDeleteOp(last.ops)
    const nextDelete = getIncomingTypingDeleteOp(entry.ops)

    const insertPair = prevInsert !== null && nextInsert !== null
    const deletePair = prevDelete !== null && nextDelete !== null

    if (insertPair) {
      return this.#tryCoalesceInsert(last, entry, prevInsert, nextInsert)
    }

    if (deletePair) {
      return this.#tryCoalesceDelete(last, entry, prevDelete, nextDelete)
    }

    /** Mixed insert/delete or burst-shaped top vs non-matching incoming → fresh group. */
    if (
      prevInsert !== null ||
      prevDelete !== null ||
      nextInsert !== null ||
      nextDelete !== null
    ) {
      this.#typingBurstController.reset()
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
   * Optionally coalesces with the previous typing or backspace burst entry.
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

  /** Clears the undo and redo stacks. */
  clear(): void {
    this.#undoStack = []
    this.#redoStack = []
    this.#typingBurstController.reset()
  }
}
