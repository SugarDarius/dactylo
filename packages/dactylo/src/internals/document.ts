import { createInitialPlaceholderBlock } from './blocks'
import type { Block, BlockId } from './blocks'
import { DactyloError } from './errors'
import type { InsertBlockOpPosition } from './operations'
import { after, before, between, makePosition } from './position'
import type { PosKey } from './position'
import { assertNever } from './utils'

/**
 * The brain of Dactylo. It's the single in-memory snapshot
 * of everything the user has written, structured as blocks.
 *
 * It's not not the markdown string on disk, nor the React UI and nor the cursor position.
 * It's the authoritative source of truth (data) that all of of thins are derived from.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  DocumentState ← THE source of truth (in memory/RAM)    │
 * └─────────────────────────────────────────────────────────┘
 * ┌─────────────────────────────────────────────────--------┐
 * │  │ Block "blk_1"  key: "a0"  type: heading         │    │
 * │  │   └─ inline: [ text: "Hello" ]                  │    │
 * │  │ Block "blk_2"  key: "a1"  type: paragraph       │    │
 * │  │   └─ inline: [ text: "World", marks: [bold] ]   │    │
 * │  └─────────────────────────────────────────────────┘    │
 * └─────────────────────────────────────────────────────────┘
 *       │                    │                    │
 *       ▼                    ▼                    ▼
 *   toMarkdown()          React UI            AI getSummary()
 *   (export string)     (renders blocks)      (reads blocks)
 *
 * When the user types a character, Dactylo does not edit a string at all.
 * Instead it:
 *  1. Takes the current `DocumentState`
 *  2. Applies an operation (`insert_block`, `insert_text`, ...)
 *  3. Produces a new predictable and immutable snapshot
 *
 * The new snapshot is what the UI re-renders from.
 *
 * Why does it exist?
 * 👉🏻 Without `DocumentState`, we would store content as a markdown string and re-parse it
 * on every keystroke. That breaks down quickly:
 *
 * | Problem              | Why a string fails                                | How `DocumentState` solves it            |
 * |----------------------|---------------------------------------------------|------------------------------------------|
 * | Enter vs Shift+Enter | Hard to know if `\n` is a new block or soft break | Blocks + `line_break` nodes are explicit |
 * | Bold / links         | Offset math on raw markdown is fragile            | Marks live on typed `TextNode`s          |
 * | Undo                 | String diffing is ambiguous                       | Snapshots + inverse operations           |
 * | AI edits             | "Change paragraph 3" is vague                     | Stable block IDs (`blk_abc`)             |
 * | Performance          | Full re-parse on every key                        | Small structural patches                 |
 *
 * `DocumentState` is the structured representation that makes fast edits, reliable undo/redo,
 * exports, and AI-safe mutations possible.
 */
export interface DocumentState {
  /**
   * Schema version for indicating which blocks, nodes, marks, etc. are currently supported.
   * Evolving without breaking old saves
   */
  readonly schemaVersion: 1

  /**
   * Dictionary of every blocks keyed by a stable block ID in the document.
   * It gives an O(1) lookup needed for operations, Ai edits and UI rendering (memoization).
   */
  readonly blocks: ReadonlyMap<BlockId, Block>

  /**
   * Sorted list of block IDs for top-to-bottom reading.
   * Gives an O(n) sequential scan needed for exports.
   *
   * It's not array index, each block carries a `key` (fraction index string).
   * It acts as a cached sort of those keys.
   */
  readonly blockOrderById: readonly BlockId[]
}

/**
 * Creates an initial empty doc state for empty document.
 * It contains a single placeholder paragraph block with the given text.
 */
export function createInitialEmptyDocumentState(
  placeholder: string,
): DocumentState {
  const block = createInitialPlaceholderBlock(placeholder)
  return {
    blockOrderById: [block.id],
    blocks: new Map([[block.id, block]]),
    schemaVersion: 1,
  }
}

/** Immutable update: add a block and refresh cached order. */
export function insertBlockIntoDocument(
  state: DocumentState,
  block: Block,
): DocumentState {
  const blocks = new Map([...state.blocks, [block.id, block]])

  return {
    ...state,
    blockOrderById: [...state.blockOrderById, block.id],
    blocks,
  }
}

/**
 * Returns adjacent block IDs in document order.
 *
 * @param state - Current document state.
 * @param blockId - ID of the reference block.
 * @returns Previous and next block IDs, or `null` when absent.
 */
export function getBlockNeighborsInDocument(
  state: DocumentState,
  blockId: BlockId,
): { prev: BlockId | null; next: BlockId | null } {
  const idx = state.blockOrderById.indexOf(blockId)
  if (idx === -1) {
    return { next: null, prev: null }
  }

  let next: BlockId | null = null
  let prev: BlockId | null = null

  if (idx < state.blockOrderById.length - 1) {
    next = state.blockOrderById[idx + 1] ?? null
  }

  if (idx > 0) {
    prev = state.blockOrderById[idx - 1] ?? null
  }

  return {
    next,
    prev,
  }
}

/**
 * Computes the position key (fractional index) where to insert a block
 * from a `InsertBlockOpPosition` in the document.
 */
export function computeInsertBlockPosKeyInDocument(
  state: DocumentState,
  pos: InsertBlockOpPosition,
): PosKey {
  switch (pos.type) {
    case 'start': {
      const [firstBlockId] = state.blockOrderById
      if (!firstBlockId) {
        return makePosition()
      }

      const block = state.blocks.get(firstBlockId)
      if (!block) {
        throw DactyloError.from({
          code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
          hint: 'DocumentState/#computeInsertBlockPosKeyInDocument',
          message: `Block ${firstBlockId} not found in document`,
        })
      }
      return makePosition(undefined, block.posKey)
    }
    case 'end': {
      const lastBlockId = state.blockOrderById.at(-1)
      if (!lastBlockId) {
        return makePosition()
      }

      const block = state.blocks.get(lastBlockId)
      if (!block) {
        throw DactyloError.from({
          code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
          hint: 'DocumentState/#computeInsertBlockPosKeyInDocument',
          message: `Block ${lastBlockId} not found in document`,
        })
      }
      return makePosition(block.posKey)
    }
    case 'after': {
      const block = state.blocks.get(pos.blockId)
      if (!block) {
        throw DactyloError.from({
          code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
          hint: 'DocumentState/#computeInsertBlockPosKeyInDocument',
          message: `Block ${pos.blockId} not found in document`,
        })
      }

      const { next } = getBlockNeighborsInDocument(state, pos.blockId)
      if (!next) {
        return after(block.posKey)
      }

      const nextBlock = state.blocks.get(next)
      if (!nextBlock) {
        throw DactyloError.from({
          code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
          hint: 'DocumentState/#computeInsertBlockPosKeyInDocument',
          message: `Block ${next} not found in document`,
        })
      }

      return between(block.posKey, nextBlock.posKey)
    }
    case 'before': {
      const block = state.blocks.get(pos.blockId)
      if (!block) {
        throw DactyloError.from({
          code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
          hint: 'DocumentState/#computeInsertBlockPosKeyInDocument',
          message: `Block ${pos.blockId} not found in document`,
        })
      }

      const { prev } = getBlockNeighborsInDocument(state, pos.blockId)
      if (!prev) {
        return before(block.posKey)
      }

      const prevBlock = state.blocks.get(prev)
      if (!prevBlock) {
        throw DactyloError.from({
          code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
          hint: 'DocumentState/#computeInsertBlockPosKeyInDocument',
          message: `Block ${prev} not found in document`,
        })
      }

      return between(prevBlock.posKey, block.posKey)
    }
    case 'between': {
      const loBlock = state.blocks.get(pos.afterBlockId)
      if (!loBlock) {
        throw DactyloError.from({
          code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
          hint: 'DocumentState/#computeInsertBlockPosKeyInDocument',
          message: `Block ${pos.afterBlockId} not found in document`,
        })
      }

      const hiBlock = state.blocks.get(pos.beforeBlockId)
      if (!hiBlock) {
        throw DactyloError.from({
          code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
          hint: 'DocumentState/#computeInsertBlockPosKeyInDocument',
          message: `Block ${pos.beforeBlockId} not found in document`,
        })
      }
      return between(loBlock.posKey, hiBlock.posKey)
    }
    default: {
      assertNever(pos, 'Unknown insert block position type')
    }
  }
}

/**
 * Resolves the position where to insert a block from
 * a `InsertBlockOpPosition` in the document.
 */
export function resolveInsertAfterBlockIdInDocument(
  state: DocumentState,
  pos: InsertBlockOpPosition,
): BlockId | null {
  switch (pos.type) {
    case 'start': {
      return null
    }
    case 'end': {
      return state.blockOrderById.at(-1) ?? null
    }
    case 'after': {
      return pos.blockId
    }
    case 'before': {
      const { prev } = getBlockNeighborsInDocument(state, pos.blockId)
      return prev
    }
    case 'between': {
      return pos.afterBlockId
    }
    default: {
      assertNever(pos, 'Unknown insert block position type')
    }
  }
}
