import { DEFAULT_BATCH_MAX_SIZE } from './constants'
import type { Operation } from './operations'
import type { TransactionPolicy } from './transaction'

/** Callback to invoke when the batch is flushed. */
export type BatchFlushCallback = (
  /** The operations that were flushed. */
  ops: readonly Operation[],
  /** The policy that was used for the flush. */
  policy?: TransactionPolicy,
) => void

/** Options for constructing a {@link Batch} instance. */
export interface BatchOptions {
  /**
   * Max operations held before auto-flush.
   * defaults to 512
   */
  maxSize?: number

  /** Callback to invoke when the batch is flushed. */
  onFlush: BatchFlushCallback
}

/**
 * A dedicated `Batch` class for efficiency and control.
 *
 * | Concern               | Inline arrays                    | `Batch` class                           |
 * |-----------------------|----------------------------------|-----------------------------------------|
 * | Memory on large paste | Unbounded queue until batch ends | `maxSize` auto-flush chunks the queue   |
 * | Mid-batch commit      | Not possible                     | `flush()` commits now, batch stays open |
 * | Error recovery        | Manual queue cleanup             | `discard()` drops pending ops safely    |
 * | Testing               | Requires full `Dactylo` instance | Test queue/flush in isolation           |
 * | Observability         | No metrics                       | `pendingCount`, `depth` exposed         |
 *
 * Semantics:
 *
 * enqueue(op) ──► queue[]
 *                │
 *                ├─ queue.length >= maxSize ? ──► flush() ──► onFlush(ops) ──► runTransaction
 *                │
 * batch.run(fn) ──► depth++
 *                 fn() calls enqueue…
 *                 depth--
 *                 depth === 0 && queue not empty ? ──► flush()
 *
 * Tradeoff: `maxSize` against single undo step
 *
 * A paste of 5 000 paragraphs may exceed `maxSize`. Auto-flush produces **multiple history entries** (multiple undo steps).
 * Options:
 *  1. Default `maxSize: 512` — safe memory; large pastes = multi-step undo
 *  2. `batchMaxSize: Infinity` in options — single undo for huge paste; higher memory peak
 *  3. `flush()` at end of paste handler — one explicit commit; `maxSize` only guards runaway loops
 *
 */
export class Batch {
  /** Max operations held before auto-flush. */
  #maxSize: number

  /** Callback to invoke when the batch is flushed. */
  readonly #onFlush: BatchFlushCallback

  /** Queue of operations. */
  #queue: Operation[]

  /** Depth of the batch. */
  #depth: number

  /** Policy for the batch. */
  #policy?: TransactionPolicy

  constructor(options: BatchOptions) {
    this.#maxSize = options.maxSize ?? DEFAULT_BATCH_MAX_SIZE
    this.#onFlush = options.onFlush

    this.#queue = []
    this.#depth = 0
  }

  /** True while inside `run()`. */
  get active() {
    return this.#depth > 0
  }

  /** Nesting level (0 = outside batch). */
  get depth(): number {
    return this.#depth
  }

  /** Ops waiting to be committed. */
  get pendingCount(): number {
    return this.#queue.length
  }

  /** True when queue has ops (inside or outside batch). */
  get hasPending(): boolean {
    return this.#queue.length > 0
  }

  /**
   * Commit queued ops now. Clears queue; does not exit batch scope.
   * No-op if queue is empty.
   */
  flush(policy?: TransactionPolicy): void {
    if (this.#queue.length === 0) {
      return
    }

    const queue = [...this.#queue]
    this.#queue = []

    const mergedPolicy = { ...this.#policy, ...policy }
    this.#policy = undefined

    this.#onFlush(queue, mergedPolicy)
  }

  /** Add ops to the queue. Auto-flushes when queue would exceed maxSize. */
  enqueue(ops: Operation[], policy?: TransactionPolicy): void {
    if (policy !== undefined) {
      this.#policy = { ...this.#policy, ...policy }
    }

    for (const op of ops) {
      if (this.#queue.length >= this.#maxSize) {
        this.flush()
      }

      this.#queue.push(op)
    }
  }

  /** Drop queued ops without committing. Does not exit batch scope. */
  discard(): void {
    this.#queue = []
    this.#policy = undefined
  }

  /**
   * Run fn inside a batch scope. Flushes remaining queue when outermost scope ends.
   * Pass `{ maxSize: Infinity }` for unbounded queue (large paste).
   */
  run<T>(
    fn: () => T,
    opts: { maxSize?: number; policy?: TransactionPolicy } = {},
  ): T {
    const maxSize = opts.maxSize ?? this.#maxSize
    this.#depth += 1

    if (opts.policy !== undefined) {
      this.#policy = { ...this.#policy, ...opts.policy }
    }

    try {
      return fn()
    } catch (err) {
      this.discard()
      throw err
    } finally {
      this.#depth -= 1
      this.#maxSize = maxSize

      if (this.#depth === 0 && this.#queue.length > 0) {
        this.flush({ description: 'batch' })
      }
    }
  }
}
