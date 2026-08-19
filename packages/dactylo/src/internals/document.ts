import { createInitialPlaceholderBlock } from './blocks'
import type { Block, BlockId } from './blocks'

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
