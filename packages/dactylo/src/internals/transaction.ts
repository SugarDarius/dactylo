/**
 * Transaction pipeline
 *
 * The pipeline enforces ordering:
 * Transaction { ops, policy } → validateOps → applyOps → commitEffects
 *                                 ↓ fail
 *                         reject (state unchanged)
 *
 * Commit effects (side effects, not pure):
 *  1. Push to history stack (unless we don't want too)
 *  2. Dispatch hooks and plugins
 *  3. Notify subscribers (UI)
 *
 * Keeping commit separate from apply stage means undo action
 * applies inverted operations through the same apply stage path
 * without re-firing history.
 *
 * Core:
 *
 * The pipeline is is built around three cooperating types:
 *  1. {@link Operation} describing what's change
 *  2. {@link Transaction} bundles operations with metadata: {@link TransactionPolicy}
 *  3. {@link DactyloContext} as the before/after snapshot
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                           Transaction                                   │
 * │  ┌─────────────────────────────┐   ┌─────────────────────────────────┐  │
 * │  │ ops: Operation[]            │   │ policy?: TransactionPolicy      │  │
 * │  │ (the structural mutations)  │   │ (how commit should behave)      │  │
 * │  └─────────────────────────────┘   └─────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *          │ validate + apply on                    │ read at commit only
 *          ▼                                        ▼
 *    DactyloContext ──────────────► DactyloContext
 *       (prev)                         (next)
 *
 * | Type                | Mutable?      | Serialized to disk?   | Role                             |
 * |---------------------|---------------|-----------------------|----------------------------------|
 * | `Operation`         | No (readonly) | Yes (history, logs)   | Atomic mutation step             |
 * | `TransactionPolicy` | No            | Optional (debug logs) | Commit-time policy               |
 * | `Transaction`       | No            | Yes                   | Unit dispatched through pipeline |
 * | `DactyloContext`    | No            | `doc` only via export | Full editing snapshot            |
 */

import type { Operation } from './operations'

/**
 * The policy layer as metadata about a {@link Transaction} not about individual operations.
 * It tells the commit phase how to treat an otherwise normal operation
 * without polluting the operations themselves or branching the apply engines.
 *
 * We don't put this on operations as they must stay:
 *  1. pure
 *  2. invertible
 *  3. serializable
 *
 * Adding `source: 'undo'` on every `insert_text` operations would:
 *  - Complicate the `invert()` -- meta fields would need stripping
 *  - Leak commit policy in the apply stage logic
 *  - Break the rule than operations describe document changes only
 *
 */
export interface TransactionPolicy {
  /**
   * Human-readable description of the transaction
   * for debugging, DevTools, Ai tracing, ...
   */
  description?: string

  /**
   * Whether to push this transaction to the history stack.
   * When set to `false`, commit phase skips history push.
   * Defaults to `true` -- history records the transaction.
   */
  pushToHistory?: boolean

  /**
   * Who/what initiated the transaction.
   * It drives history rules, hooks filtering, ...
   */
  source?:
    /**  The transaction is initiated by a user action */
    | 'user'
    /** The editor decided itself to initiate a transaction */
    | 'editor'
    /** The transaction is initiated by an import (ex. initial content) operation */
    | 'import'
    /** The transaction is an undo history operation */
    | 'undo'
    /** The transaction is a redo history operation */
    | 'redo'

  /**
   * When false, skip the merge history action for rapid typing coalescing.
   * Default: true.
   */
  coalesce?: boolean
}

/**
 * A bundle of operations with policy metadata about
 * how to commit them through the pipeline
 */
export interface Transaction {
  /** The operations to apply in the transaction */
  readonly ops: readonly Operation[]

  /** The policy metadata about the transaction */
  readonly policy?: TransactionPolicy
}
