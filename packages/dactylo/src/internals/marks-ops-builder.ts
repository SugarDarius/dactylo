import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockId, BlockWithInlineContent } from './blocks'
import { warn } from './console'
import {
  collectTextSpansInRange,
  compareTextCursors,
  getBlockWithInlineContent,
  normalizeRange,
} from './document'
import type { EditorContext } from './editor-context'
import { DactyloError } from './errors'
import { isMarkEnabled, toggleMarkFlag } from './marks'
import type { MarkKey, Marks } from './marks'
import { isInlineNodeWithEditableText } from './nodes'
import type { NodeId } from './nodes'
import type { Operation } from './operations'
import { iterRules, rangeCollapsedError } from './operations-builder'
import type {
  BuilderOpsIntent,
  OperationRule,
  OperationsBuilder,
} from './operations-builder'
import { isCursorSelection } from './selection'
import type { RangeSelection } from './selection'

/** Situation with no selection. */
export interface MarksOpNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation with a cursor selection. */
export interface MarksOpCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** Block with inline content subject to the operation.  */
  readonly block: BlockWithInlineContent
}

/** Situation with a range selection. */
export interface MarksOpRangeSelectionSituation {
  readonly kind: 'range-selection'

  /** The range at which the marks operation is applied. */
  readonly range: RangeSelection
}

/** Situation of a marks operation. */
export type MarksOpSituation =
  | MarksOpNoSelectionSituation
  | MarksOpCursorSelectionSituation
  | MarksOpRangeSelectionSituation

/** Input given to a marks operation. */
export interface MarksOpInput {
  /** The mark to toggle. */
  readonly mark: MarkKey
}

/** Marks operation rule. */
export type MarksOpRule = OperationRule<MarksOpSituation, MarksOpInput, unknown>

/** Rules for cursor selection. */
export const cursorRules: MarksOpRule[] = [
  {
    /**
     * 💡 Selection is a cursor selection.
     * 🎯 Enables the active mark for the given mark key
     * on the whole document (e.g the mark is active on typing).
     */
    build: ({ context, situation, input }): Operation[] | null => {
      const { selection } = context
      if (situation.kind !== 'cursor-selection' || selection === null) {
        return null
      }

      const prev = context.activeMarks
      const next = toggleMarkFlag(prev, input.mark)

      const { blockId, nodeId } = selection.anchor
      const { block } = situation

      const found = findNodeInBlockWithInlineContent(block, nodeId)

      let copyTo: { blockId: BlockId; nodeId: NodeId } | null = null
      if (found) {
        const { node } = found
        if (isInlineNodeWithEditableText(node) && node.text.length <= 0) {
          copyTo = { blockId, nodeId }
        }
      }

      const ops: Operation[] = [
        {
          __type: 'set_active_marks',
          activeMarks: next,
          copyTo,
          prevActiveMarks: prev,
        },
      ]

      return ops
    },
    /** Toggles an active mark on or off on {@link EditorContext}. */
    name: 'cursor/toggle-mark/on-context',
    when: ({ situation }): boolean => situation.kind === 'cursor-selection',
  },
]

/** Rules for range selection. */
export const rangeRules: MarksOpRule[] = [
  {
    /**
     * 💡 Selection is a range selection.
     * 🎯 Enables the mark for the given mark key by collecting text spans
     * contained in the range of text nodes.
     */
    build: ({ context, situation, input }): Operation[] | null => {
      const { state } = context
      if (situation.kind !== 'range-selection') {
        return null
      }

      const { range } = situation

      /**
       * Collecting text spans must yield at least one text slice.
       * An empty span list is also a contract-violation (collapsed range stored as `range`, stale cursors,
       * or range or non-text-only inline nodes) - not a cue to toggle {@link EditorContext} active marks.
       */
      const spans = collectTextSpansInRange(context.state, range)
      if (spans.length <= 0) {
        throw DactyloError.from({
          code: 'RANGE_SELECTION_NO_TEXT_SPANS',
          hint: 'Ensure the range covers at least one text node with non-zero length.',
          message: 'Range selection produced no text spans.',
        })
      }

      const enabling = spans.every((span) => {
        const block = getBlockWithInlineContent(state, span.blockId)
        const found = findNodeInBlockWithInlineContent(block, span.nodeId)

        if (!found || !isInlineNodeWithEditableText(found.node)) {
          return false
        }

        /** Toggle the mark on or off depending on the current state of the mark. */
        return !isMarkEnabled(found.node.marks, input.mark)
      })

      const ops: Operation[] = []

      for (const span of spans) {
        const block = getBlockWithInlineContent(state, span.blockId)
        const found = findNodeInBlockWithInlineContent(block, span.nodeId)

        if (!found || !isInlineNodeWithEditableText(found.node)) {
          continue
        }

        const { node } = found
        const nextMarks: Marks = { ...node.marks, [input.mark]: enabling }

        ops.push({
          __type: 'set_marks',
          blockId: span.blockId,
          from: span.from,
          nextMarks,
          nodeId: span.nodeId,
          prevMarks: { ...node.marks },
          to: span.to,
        })
      }

      return ops
    },
    /** Toggle a mark on or off on a range of nodes with editable text. */
    name: 'range/toggle-mark/on-selection',
    when: ({ situation }): boolean => situation.kind === 'range-selection',
  },
]

/** Marks operations builder. */
export class MarksOpsBuilder implements OperationsBuilder<
  MarksOpSituation,
  MarksOpInput
> {
  /** Describes the {@link MarksOpSituation}. */
  describe(context: EditorContext): MarksOpSituation {
    const { selection, state } = context
    if (selection === null) {
      return { kind: 'no-selection' }
    }

    if (isCursorSelection(selection)) {
      const { blockId } = selection.anchor
      const block = getBlockWithInlineContent(state, blockId)

      return { block, kind: 'cursor-selection' }
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
        'MarksOpsBuilder/#describe',
      )
    }

    return { kind: 'range-selection', range: normalized }
  }

  /** Builds the operations to toggle a mark on or off. */
  build(context: EditorContext, input: MarksOpInput): BuilderOpsIntent | null {
    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    const isCursorKind = kind === 'cursor-selection'
    const rules = isCursorKind ? cursorRules : rangeRules

    /** For marks operations, by design we can only match one rule. */
    const match = iterRules({
      context,
      input,
      resources: null,
      rules,
      situation,
    }).next()
    if (match.done) {
      warn(
        'No rule applied for the given situation and input.',
        'MarksOpsBuilder/#build',
      )
      return null
    }

    const build = match.value
    const ops = build({ context, input, resources: null, situation })

    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'MarksOpsBuilder/#build',
      )
      return null
    }

    const label = isCursorKind ? 'on-context' : 'on-selection'

    return {
      label: `${label}:${String(input.mark)}`,
      ops,
      skipHistory: isCursorKind ? true : undefined,
    }
  }
}
