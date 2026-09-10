import { createInitialPlaceholderBlock } from './blocks'
import type { Block, BlockId } from './blocks'
import { DactyloError } from './errors'
import type { InsertBlockOpPosition } from './operations'
import { after, before, between, makePosition } from './position'
import type { PosKey } from './position'
import { appendTextSpansInRangeFromBlock, createRange } from './selection'
import type { RangeSelection, TextCursor, TextSpanInRange } from './selection'
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

// --------Blocks--------

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

/* Returns a block by ID or throws if it does not exist. */
export function getBlockInDocument(
  state: DocumentState,
  blockId: BlockId,
): Block {
  const block = state.blocks.get(blockId)
  if (!block) {
    throw DactyloError.from({
      code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
      hint: 'DocumentState/#getBlockInDocument',
      message: `Block ${blockId} not found in document`,
    })
  }

  return block
}

/** Immutable update: replace one block in document state. */
export function replaceBlockInDocument(
  state: DocumentState,
  blockId: BlockId,
  nextBlock: Block,
): DocumentState {
  const blocks = new Map([...state.blocks, [blockId, nextBlock]])

  return { ...state, blocks }
}

export function computeInsertBlockPosKeyError(blockId: BlockId): never {
  throw DactyloError.from({
    code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
    hint: 'DocumentState/#computeInsertBlockPosKeyInDocument',
    message: `Block ${blockId} not found in document`,
  })
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
        computeInsertBlockPosKeyError(firstBlockId)
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
        computeInsertBlockPosKeyError(lastBlockId)
      }
      return makePosition(block.posKey)
    }
    case 'after': {
      const block = state.blocks.get(pos.blockId)
      if (!block) {
        computeInsertBlockPosKeyError(pos.blockId)
      }

      const { next } = getBlockNeighborsInDocument(state, pos.blockId)
      if (!next) {
        return after(block.posKey)
      }

      const nextBlock = state.blocks.get(next)
      if (!nextBlock) {
        computeInsertBlockPosKeyError(next)
      }

      return between(block.posKey, nextBlock.posKey)
    }
    case 'before': {
      const block = state.blocks.get(pos.blockId)
      if (!block) {
        computeInsertBlockPosKeyError(pos.blockId)
      }

      const { prev } = getBlockNeighborsInDocument(state, pos.blockId)
      if (!prev) {
        return before(block.posKey)
      }

      const prevBlock = state.blocks.get(prev)
      if (!prevBlock) {
        computeInsertBlockPosKeyError(prev)
      }

      return between(prevBlock.posKey, block.posKey)
    }
    case 'between': {
      const loBlock = state.blocks.get(pos.afterBlockId)
      if (!loBlock) {
        computeInsertBlockPosKeyError(pos.afterBlockId)
      }

      const hiBlock = state.blocks.get(pos.beforeBlockId)
      if (!hiBlock) {
        computeInsertBlockPosKeyError(pos.beforeBlockId)
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

// --------Selection--------

/**
 * Compares two text cursors in full document order.
 * Order: block `posKey` (via `blockOrderById`) → inline content index → text offset.
 *
 * Returns negative when `a` is before `b`, zero when equal, positive when after.
 */
export function compareTextCursorsInDocument(
  state: DocumentState,
  a: TextCursor,
  b: TextCursor,
): number {
  if (a.blockId === b.blockId && a.nodeId === b.nodeId) {
    return a.offset - b.offset
  }

  const order = state.blockOrderById

  const aBlockIdx = order.indexOf(a.blockId)
  const bBlockIdx = order.indexOf(b.blockId)

  if (aBlockIdx !== bBlockIdx) {
    return aBlockIdx - bBlockIdx
  }

  const block = state.blocks.get(a.blockId)
  if (!block) {
    return 0
  }

  const aNodeIdx = block.content.findIndex((n) => n.id === a.nodeId)
  const bNodeIdx = block.content.findIndex((n) => n.id === b.nodeId)

  if (aNodeIdx !== bNodeIdx) {
    return aNodeIdx - bNodeIdx
  }

  return a.offset - b.offset
}

/**
 * Decomposes a range into per-text-node `[from, to)` slices in document order.
 *
 * Skips non-text inline nodes (`line_break`, `link`, …). Used by mark toggling,
 * future cross-block delete, and copy extraction.
 *
 * Efficiency:
 *
 * A naive block loop × content loop revisits every inline node between two endpoints
 * and repeats `findIndex` on each block iteration - `O(B x N)` in the worst case
 * (range spans `B` blocks with `N` inline nodes each).
 *
 * Selection ranges are usually short, so that cost is often negligible.
 * For a clearer bound we use a three-phase walk instead:
 *
 * 1. Tail of the start block (anchor → end of block)
 * 2. Each middle block in full (one linear scan per block, no nested block index math)
 * 3. Head oif the end block (start → focus)
 *
 * Endpoint node indices are resolved only once. Total work is `O(K)` when `K` is
 * the number of inline nodes the range actually crosses (typically it's equals to
 * the number of output spans), not the product of block count times max nodes per block.
 *
 * Returns non-empty text spans; empty when the range is collapsed.
 */
export function collectTextSpansInRangeInDocument(
  state: DocumentState,
  range: RangeSelection,
): TextSpanInRange[] {
  const { anchor, focus } = range

  if (compareTextCursorsInDocument(state, anchor, focus) >= 0) {
    return []
  }

  if (anchor.blockId === focus.blockId && anchor.nodeId === focus.nodeId) {
    return [
      {
        blockId: anchor.blockId,
        from: anchor.offset,
        nodeId: anchor.nodeId,
        to: focus.offset,
      },
    ]
  }

  const order = state.blockOrderById

  const startBi = order.indexOf(anchor.blockId)
  const endBi = order.indexOf(focus.blockId)

  if (startBi === -1 || endBi === -1) {
    return []
  }

  const startBlock = state.blocks.get(anchor.blockId)
  const endBlock = state.blocks.get(focus.blockId)

  if (!startBlock || !endBlock) {
    return []
  }

  const anchorNi = startBlock.content.findIndex((n) => n.id === anchor.nodeId)
  const focusNi = endBlock.content.findIndex((n) => n.id === focus.nodeId)

  if (anchorNi === -1 || focusNi === -1) {
    return []
  }

  let spans: TextSpanInRange[] = []

  if (startBi === endBi) {
    spans = appendTextSpansInRangeFromBlock(
      spans,
      anchor.blockId,
      startBlock.content,
      anchorNi,
      focusNi,
      anchor.offset,
      focus.offset,
    )
  }

  spans = appendTextSpansInRangeFromBlock(
    spans,
    anchor.blockId,
    startBlock.content,
    anchorNi,
    startBlock.content.length - 1,
    anchor.offset,
  )

  for (let bi = startBi + 1; bi < endBi; bi += 1) {
    const blockId = order[bi]
    if (!blockId) {
      continue
    }

    const block = state.blocks.get(blockId)
    if (!block) {
      continue
    }

    spans = appendTextSpansInRangeFromBlock(
      spans,
      blockId,
      block.content,
      0,
      block.content.length - 1,
      0,
    )
  }

  return spans
}

/**
 * Normalizes a range so anchor precedes focus in document order.
 * Works across blocks, inline nodes, and backward DOM selections.
 *
 * Returns a new range with anchor ≤ focus in document order.
 */
export function normalizeRange(
  state: DocumentState,
  selection: RangeSelection,
): RangeSelection {
  const { anchor, focus } = selection
  if (compareTextCursorsInDocument(state, anchor, focus) <= 0) {
    return selection
  }
  return createRange(focus, anchor)
}
