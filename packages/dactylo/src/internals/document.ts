import {
  createParagraphBlock,
  isBlockWithInlineContent,
  isNumberedListItemBlock,
  sortBlockOrder,
} from './blocks'
import type {
  Block,
  BlockId,
  BlockWithInlineContent,
  NumberedListItemBlock,
} from './blocks'
import { DactyloError } from './errors'
import { createTextNode, isInlineContentEmpty } from './nodes'
import {
  getDefaultMarkerNumbering,
  markerNumberingAfterNeighbor,
} from './numbered-list-marker'
import type { InsertOrMoveBlockPosition } from './operations-builder'
import {
  after,
  before,
  between,
  makeInitialPosition,
  makePosition,
} from './position'
import type { PosKey } from './position'
import {
  appendTextSpansInRangeFromBlock,
  createRange,
  cursorAtBlockEnd,
} from './selection'
import type {
  CursorSelection,
  RangeSelection,
  TextCursor,
  TextSpanInRange,
} from './selection'
import { assertNever } from './utils'

/**
 * The brain of Dactylo. It's the single in-memory snapshot
 * of everything the user has written, structured as blocks.
 *
 * It's not not the markdown string on disk, nor the React UI and nor the cursor position.
 * It's the authoritative source of truth (data) that all of of thins are derived from.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  DocumentState ← The source of truth (in-memory/RAM)    │
 * └─────────────────────────────────────────────────────────┘
 * ┌─────────────────────────────────────────────────--------┐
 * │  │ Block "bl_1"  key: "a0"  type: heading          │    │
 * │  │   └─ inline: [ text: "Hello" ]                  │    │
 * │  │ Block "bl_2"  key: "a1"  type: paragraph        │    │
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

/** Creates an initial empty doc state for empty document. */
export function createInitialEmptyDocumentState(): DocumentState {
  const block = createParagraphBlock({
    content: [
      createTextNode({
        text: '',
      }),
    ],
    posKey: makeInitialPosition(),
  })
  return {
    blockOrderById: [block.id],
    blocks: new Map([[block.id, block]]),
    schemaVersion: 1,
  }
}

/** Immutable update: put a block in document state. */
export function putBlock(state: DocumentState, block: Block): DocumentState {
  const prev = state.blocks.get(block.id)
  const blocks = new Map([...state.blocks, [block.id, block]])

  if (prev && prev.posKey === block.posKey) {
    return { ...state, blocks }
  }

  return { ...state, blockOrderById: sortBlockOrder(blocks), blocks }
}

/** Immutable update: merge blocks into document state. */
export function putBlocks(
  state: DocumentState,
  incoming: Block[],
): DocumentState {
  const blocks = new Map(state.blocks)
  let orderChanged = false

  for (const block of incoming) {
    const prev = blocks.get(block.id)
    blocks.set(block.id, block)

    if (!prev || prev.posKey !== block.posKey) {
      orderChanged = true
    }
  }

  return {
    ...state,
    blockOrderById: orderChanged
      ? sortBlockOrder(blocks)
      : state.blockOrderById,
    blocks,
  }
}

/** Immutable update: delete a block and refresh cached order. */
export function deleteBlock(
  state: DocumentState,
  blockId: BlockId,
): DocumentState {
  const blocks = new Map(state.blocks)
  blocks.delete(blockId)

  return {
    ...state,
    blockOrderById: state.blockOrderById.filter((id) => id !== blockId),
    blocks,
  }
}

/** Returns the block index in the document state. */
export function getBlockIndex(state: DocumentState, blockId: BlockId): number {
  const index = state.blockOrderById.indexOf(blockId)
  if (index === -1) {
    throw DactyloError.from({
      code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
      hint: 'DocumentState/#getBlockIndex',
      message: `Block ${blockId} not found in document from block order by ID.`,
    })
  }

  return index
}

/** Returns adjacent block IDs in document order. */
export function getBlockNeighbors(
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
export function getBlock(state: DocumentState, blockId: BlockId): Block {
  const block = state.blocks.get(blockId)
  if (!block) {
    throw DactyloError.from({
      code: 'UNKNOWN_BLOCK_IN_DOCUMENT',
      hint: 'DocumentState/#getBlock',
      message: `Block ${blockId} not found in document from blocks map.`,
    })
  }

  return block
}

/** Returns a block with allowed inline content or throws. */
export function getBlockWithInlineContent(
  state: DocumentState,
  blockId: BlockId,
): BlockWithInlineContent {
  const block = getBlock(state, blockId)
  if (!isBlockWithInlineContent(block)) {
    throw DactyloError.from({
      code: 'BLOCK_NOT_ALLOWED_TO_HAVE_INLINE_CONTENT',
      hint: 'DocumentState/#getBlockWithInlineContent',
      message: `Block ${blockId} is not allowed to have inline content`,
    })
  }

  return block
}

/** Checks whether a block has no inserted text and no structural inlines. */
export function isBlockWithInlineContentEmpty(
  state: DocumentState,
  blockId: BlockId,
): boolean {
  const block = getBlockWithInlineContent(state, blockId)
  return isInlineContentEmpty(block.content)
}

/**
 * Computes the position key (fractional index) where to insert a block
 * from a {@link InsertOrMoveBlockPosition} in the document.
 */
export function computeInsertBlockPosKey(
  state: DocumentState,
  pos: InsertOrMoveBlockPosition,
): PosKey {
  switch (pos.type) {
    case 'start': {
      const [firstBlockId] = state.blockOrderById
      if (!firstBlockId) {
        return makePosition()
      }

      const block = getBlock(state, firstBlockId)
      return makePosition(undefined, block.posKey)
    }
    case 'end': {
      const lastBlockId = state.blockOrderById.at(-1)
      if (!lastBlockId) {
        return makePosition()
      }

      const block = getBlock(state, lastBlockId)
      return makePosition(block.posKey)
    }
    case 'after': {
      const block = getBlock(state, pos.blockId)

      const { next } = getBlockNeighbors(state, pos.blockId)
      if (!next) {
        return after(block.posKey)
      }

      const nextBlock = getBlock(state, next)

      return between(block.posKey, nextBlock.posKey)
    }
    case 'before': {
      const block = getBlock(state, pos.blockId)

      const { prev } = getBlockNeighbors(state, pos.blockId)
      if (!prev) {
        return before(block.posKey)
      }

      const prevBlock = getBlock(state, prev)

      return between(prevBlock.posKey, block.posKey)
    }
    default: {
      assertNever(pos, { hint: 'DocumentState/#computeInsertBlockPosKey' })
    }
  }
}

/**
 * Resolves the position where to insert a block from
 * a {@link InsertOrMoveBlockPosition} in the document.
 */
export function resolveInsertAfterBlockId(
  state: DocumentState,
  pos: InsertOrMoveBlockPosition,
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
      const { prev } = getBlockNeighbors(state, pos.blockId)
      return prev
    }
    default: {
      assertNever(pos, { hint: 'DocumentState/#resolveInsertAfterBlockId' })
    }
  }
}

/** Resolves the marker numbering for a block inserted after `afterBlockId` (`null` = start of document). */
export function resolveMarkerNumberingForInsert(
  state: DocumentState,
  afterBlockId: BlockId | null,
  variant: NumberedListItemBlock['variant'],
): string {
  if (afterBlockId === null) {
    return getDefaultMarkerNumbering(variant)
  }
  return markerNumberingAfterNeighbor(state.blocks.get(afterBlockId), variant)
}

/**
 * Whether the consecutive same-variant numbered-list run starting at
 * `fromIndex` includes `blockId`.
 *
 * Stops at the first non-numbered block or variant change.
 */
export function isNumberedListRunContainingBlock(
  state: DocumentState,
  fromIndex: number,
  blockId: BlockId,
  variant: NumberedListItemBlock['variant'],
): boolean {
  const order = state.blockOrderById
  for (let i = fromIndex; i < order.length; i += 1) {
    const id = order[i]
    if (id === undefined) {
      return false
    }
    const block = state.blocks.get(id)
    if (
      block === undefined ||
      !isNumberedListItemBlock(block) ||
      block.variant !== variant
    ) {
      return false
    }
    if (block.id === blockId) {
      return true
    }
  }
  return false
}

/**
 * Whether moving `blockId` to `pos` would leave document order unchanged.
 * Self-referential after/before destinations are treated as no-ops.
 */
export function isMoveBlockNoOp(
  state: DocumentState,
  blockId: BlockId,
  pos: InsertOrMoveBlockPosition,
): boolean {
  const from = getBlockIndex(state, blockId)

  switch (pos.type) {
    case 'start': {
      return from === 0
    }
    case 'end': {
      return from === state.blockOrderById.length - 1
    }
    case 'after': {
      if (pos.blockId === blockId) {
        return true
      }

      const target = getBlockIndex(state, pos.blockId)
      return from === target + 1
    }
    case 'before': {
      if (pos.blockId === blockId) {
        return true
      }

      const target = getBlockIndex(state, pos.blockId)
      return from === target - 1
    }
    default: {
      assertNever(pos, { hint: 'DocumentState/#isMoveBlockNoOp' })
    }
  }
}

/** Returns the next block with inline content, or `null` if already at the boundary. */
export function resolveNextInlineBlock(
  state: DocumentState,
  blockId: BlockId,
): BlockWithInlineContent | null {
  const { next: firstNext } = getBlockNeighbors(state, blockId)
  let nextBlockId = firstNext

  while (nextBlockId) {
    const block = getBlock(state, nextBlockId)
    if (isBlockWithInlineContent(block)) {
      return block
    }

    const { next } = getBlockNeighbors(state, nextBlockId)
    nextBlockId = next
  }
  return null
}

/** Returns the previous block with inline content, or `null` if already at the boundary. */
export function resolvePrevInlineBlock(
  state: DocumentState,
  blockId: BlockId,
): BlockWithInlineContent | null {
  const { prev: firstPrev } = getBlockNeighbors(state, blockId)
  let prevBlockId = firstPrev

  while (prevBlockId) {
    const block = getBlock(state, prevBlockId)
    if (isBlockWithInlineContent(block)) {
      return block
    }

    const { prev } = getBlockNeighbors(state, prevBlockId)
    prevBlockId = prev
  }
  return null
}

/**
 * Compares two text cursors in full document order.
 * Order: block `posKey` (via `blockOrderById`) → inline content index → text offset.
 *
 * Returns negative when `a` is before `b`, zero when equal, positive when after.
 */
export function compareTextCursors(
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
  if (!block || !isBlockWithInlineContent(block)) {
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
export function collectTextSpansInRange(
  state: DocumentState,
  range: RangeSelection,
): TextSpanInRange[] {
  const { anchor, focus } = range

  if (compareTextCursors(state, anchor, focus) >= 0) {
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

  if (
    !startBlock ||
    !endBlock ||
    !isBlockWithInlineContent(startBlock) ||
    !isBlockWithInlineContent(endBlock)
  ) {
    return []
  }

  const anchorNi = startBlock.content.findIndex((n) => n.id === anchor.nodeId)
  const focusNi = endBlock.content.findIndex((n) => n.id === focus.nodeId)

  if (anchorNi === -1 || focusNi === -1) {
    return []
  }

  if (startBi === endBi) {
    return appendTextSpansInRangeFromBlock(
      [],
      anchor.blockId,
      startBlock.content,
      anchorNi,
      focusNi,
      anchor.offset,
      focus.offset,
    )
  }

  let spans: TextSpanInRange[] = appendTextSpansInRangeFromBlock(
    [],
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
    if (!block || !isBlockWithInlineContent(block)) {
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

  return appendTextSpansInRangeFromBlock(
    spans,
    focus.blockId,
    endBlock.content,
    0,
    focusNi,
    0,
    focus.offset,
  )
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
  if (compareTextCursors(state, anchor, focus) <= 0) {
    return selection
  }
  return createRange(focus, anchor)
}

/**
 * Creates a collapsed cursor at the end of the last block that can hold a
 * caret (inline content). Trailing dividers are skipped.
 * Returns `null` when the document has no blocks, or no inline block.
 */
export function createCursorAtDocumentEnd(
  state: DocumentState,
): CursorSelection | null {
  const lastBlockId = state.blockOrderById[state.blockOrderById.length - 1]
  if (!lastBlockId) {
    return null
  }

  const lastBlock = getBlock(state, lastBlockId)
  const block = isBlockWithInlineContent(lastBlock)
    ? lastBlock
    : resolvePrevInlineBlock(state, lastBlockId)
  if (!block) {
    return null
  }

  return cursorAtBlockEnd(block.id, block)
}
