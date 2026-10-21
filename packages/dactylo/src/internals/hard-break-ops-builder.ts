import {
  createParagraphBlockAfter,
  findNodeInBlockWithInlineContent,
} from './blocks'
import type { BlockWithInlineContent } from './blocks'
import { warn } from './console'
import {
  compareTextCursors,
  getBlockWithInlineContent,
  normalizeRange,
} from './document'
import type { EditorContext } from './editor-context'
import { createTextNode, isInlineNodeWithEditableText } from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { Operation } from './operations'
import {
  buildError,
  computeSplitMergeAtIndex,
  computeSplitTailSnapshot,
  iterRules,
  rangeCollapsedError,
} from './operations-builder'
import type {
  BuilderOpsIntent,
  OperationRule,
  OperationsBuilder,
} from './operations-builder'
import {
  cursorAtBlockStart,
  isCursorAtBlockEnd,
  isCursorSelection,
} from './selection'
import type { RangeSelection, TextCursor } from './selection'

/** Situation with no selection. */
export interface HardBreakOpsNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation with a cursor selection. */
export interface HardBreakOpsCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** The cursor at which ops are applied. */
  readonly at: TextCursor

  /** Block with inline content subject to ops.  */
  readonly block: BlockWithInlineContent

  /** Inline node with editable text subject to ops. */
  readonly node: InlineNodeWithEditableText

  /** Index of the inline node with editable text in the block. */
  readonly index: number
}

/** Situation with a range selection. */
export interface HardBreakOpsRangeSelectionSituation {
  readonly kind: 'range-selection'

  /** The range at which the typing operation is applied. */
  readonly range: RangeSelection
}

/** Situation for hard break operations. */
export type HardBreakOpsSituation =
  | HardBreakOpsNoSelectionSituation
  | HardBreakOpsCursorSelectionSituation
  | HardBreakOpsRangeSelectionSituation

/** Hard break operations rule. */
export type HardBreakOpsRule = OperationRule<
  HardBreakOpsSituation,
  unknown,
  unknown
>

/** Rules for cursor selection. */
export const cursorRules: HardBreakOpsRule[] = [
  {
    /**
     * 💡 Selection is a cursor and it's at block end.
     * 🎯 Inserts a new block after the current block.
     */
    build: ({ context, situation }) => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block } = situation
      const insertedBlock = createParagraphBlockAfter(block, [
        createTextNode({ marks: context.activeMarks, text: '' }),
      ])

      const ops: Operation[] = [
        {
          __type: 'insert_block',
          afterBlockId: block.id,
          block: insertedBlock,
        },
        {
          __type: 'set_selection',
          next: cursorAtBlockStart(insertedBlock.id, insertedBlock),
          prev: context.selection,
        },
      ]

      return ops
    },
    name: 'cursor/hard-break/at-block-end',
    when: ({ situation }) => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { block } = situation
      return isCursorAtBlockEnd(situation.at, block)
    },
  },
  {
    /**
     * 💡 Selection is a cursor and it's not at block end.
     * 🎯 Splits the block at the cursor position.
     */
    build: ({ context, situation }) => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node, index, at } = situation

      const atIndex = computeSplitMergeAtIndex(
        block,
        { index, node },
        at.offset,
      )

      const tailSnapshot = computeSplitTailSnapshot(
        block,
        { index, node },
        at.offset,
      )

      const insertedBlock = createParagraphBlockAfter(
        block,
        tailSnapshot,
        block.metadata,
      )

      const ops: Operation[] = [
        {
          __type: 'split_block',
          atIndex,
          atNodeId: at.nodeId,
          atOffset: at.offset,
          blockId: block.id,
          newBlock: insertedBlock,
          tailSnapshot,
        },
        {
          __type: 'set_selection',
          next: cursorAtBlockStart(insertedBlock.id, insertedBlock),
          prev: context.selection,
        },
      ]

      return ops
    },
    name: 'cursor/hard-break/split-block-at',
    when: ({ situation }) => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { block } = situation
      return !isCursorAtBlockEnd(situation.at, block)
    },
  },
]

/** Rules for range selection. */
export const rangeRules: HardBreakOpsRule[] = []

/** Hard break ops builder. */
export class HardBreakOpsBuilder implements OperationsBuilder<
  HardBreakOpsSituation,
  HardBreakOpsRule
> {
  /** Describes the {@link HardBreakOpsSituation}. */
  describe(context: EditorContext): HardBreakOpsSituation {
    const { selection, state } = context
    if (selection === null) {
      return { kind: 'no-selection' }
    }

    if (isCursorSelection(selection)) {
      const block = getBlockWithInlineContent(state, selection.anchor.blockId)
      const found = findNodeInBlockWithInlineContent(
        block,
        selection.anchor.nodeId,
      )

      if (!found) {
        buildError(
          `Node ${selection.anchor.nodeId} not found in block ${block.id}`,
          'HardBreakOpsBuilder/#describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'HardBreakOpsBuilder/#describe',
        )
      }

      return {
        at: selection.anchor,
        block,
        index: found.index,
        kind: 'cursor-selection',
        node: found.node,
      }
    }

    const normalized = normalizeRange(state, selection)
    const { anchor, focus } = normalized

    /**
     * Anchor must precede focus in document order.
     * We cannot accept this case as it's a contract-violation
     * because a {@link RangeSelection} is a non-empty text range.
     */
    if (compareTextCursors(state, anchor, focus) >= 0) {
      rangeCollapsedError(
        'Range selection is collapsed; expected anchor to precede focus.',
        'HardBreakOpsBuilder/#describe',
      )
    }

    return {
      kind: 'range-selection',
      range: normalized,
    }
  }

  /** Builds the operations to apply a hard break. */
  build(context: EditorContext): BuilderOpsIntent | null {
    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    const isCursorKind = kind === 'cursor-selection'
    const rules = isCursorKind ? cursorRules : rangeRules

    /** For hard break operations, by design we can only match one rule. */
    const match = iterRules({
      context,
      input: null,
      resources: null,
      rules,
      situation,
    }).next()
    if (match.done) {
      warn(
        'No rule applied for the given situation and input.',
        'HardBreakOpsBuilder/#build',
      )
      return null
    }

    const build = match.value
    const ops = build({
      context,
      input: null,
      resources: null,
      situation,
    })

    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'HardBreakOpsBuilder/#build',
      )
      return null
    }

    return { label: 'insert-hard-break', ops }
  }
}
