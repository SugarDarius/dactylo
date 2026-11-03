import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockWithInlineContent } from './blocks'
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
import {
  createFromInlineWithEditableText,
  isInlineNodeWithEditableText,
} from './nodes'
import type { Operation } from './operations'
import {
  buildPartialMarkRangeOps,
  rangeCollapsedError,
  withTrailingSelectionOp,
  OperationsBuilder,
} from './operations-builder'
import type { BuilderOpsIntent, OperationRule } from './operations-builder'
import {
  createCursor,
  createRange,
  isCursorSelection,
  isSelectionActive,
} from './selection'
import type { RangeSelection, TextCursor } from './selection'

/** Situation with no selection. */
export interface MarksOpsNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation with a cursor selection. */
export interface MarksOpsCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** Block with inline content subject to ops.  */
  readonly block: BlockWithInlineContent
}

/** Situation with a range selection. */
export interface MarksOpsRangeSelectionSituation {
  readonly kind: 'range-selection'

  /** The range at which the marks operation is applied. */
  readonly range: RangeSelection
}

/** Situation of a marks operation. */
export type MarksOpsSituation =
  | MarksOpsNoSelectionSituation
  | MarksOpsCursorSelectionSituation
  | MarksOpsRangeSelectionSituation

/** Input given to a marks operation. */
export interface MarksOpsInput {
  /** The mark to toggle. */
  readonly mark: MarkKey
}

/** Marks operation rule. */
export type MarksOpsRule = OperationRule<
  MarksOpsSituation,
  MarksOpsInput,
  unknown
>

/** Rules for cursor selection. */
export const cursorRules: MarksOpsRule[] = [
  {
    /**
     * 💡 Selection is a cursor selection.
     * 🎯 Toggles the mark for the next typed characters:
     *     - Empty node: `set_marks` on that node
     *     - Non-empty node: split at the caret and insert an empty node with the
     *       toggled marks (existing text keeps its marks)
     */
    build: ({ context, situation, input }): Operation[] | null => {
      const { selection } = context
      if (
        situation.kind !== 'cursor-selection' ||
        !isSelectionActive(selection)
      ) {
        return null
      }

      const { blockId, nodeId, offset } = selection.anchor
      const { block } = situation

      const found = findNodeInBlockWithInlineContent(block, nodeId)

      if (!found || !isInlineNodeWithEditableText(found.node)) {
        return null
      }

      const { node, index } = found
      const prevMarks = node.marks
      const nextMarks = toggleMarkFlag(prevMarks, input.mark)

      if (node.text.length <= 0) {
        return [
          {
            __type: 'set_marks',
            blockId,
            from: 0,
            nextMarks,
            nodeId,
            prevMarks,
            to: 0,
          },
        ]
      }

      const inserted = createFromInlineWithEditableText(node, {
        marks: nextMarks,
        metadata: node.metadata,
        text: '',
      })
      const ops: Operation[] = []

      if (offset <= 0) {
        const prevNode = block.content[index - 1]

        ops.push({
          __type: 'insert_inline_node',
          afterNodeId: prevNode ? prevNode.id : null,
          blockId,
          node: inserted,
        })
      } else if (offset >= node.text.length) {
        ops.push({
          __type: 'insert_inline_node',
          afterNodeId: node.id,
          blockId,
          node: inserted,
        })
      } else {
        const tail = node.text.slice(offset)

        ops.push(
          {
            __type: 'delete_text',
            blockId,
            length: tail.length,
            nodeId: node.id,
            offset,
            snapshot: { text: tail },
          },
          {
            __type: 'insert_inline_node',
            afterNodeId: node.id,
            blockId,
            node: inserted,
          },
          {
            __type: 'insert_inline_node',
            afterNodeId: inserted.id,
            blockId,
            node: createFromInlineWithEditableText(node, {
              marks: prevMarks,
              metadata: node.metadata,
              text: tail,
            }),
          },
        )
      }

      return withTrailingSelectionOp(
        ops,
        createCursor({
          blockId,
          nodeId: inserted.id,
          offset: 0,
        }),
        selection,
      )
    },
    /** Splits at the caret and inserts an empty node with the toggled mark. */
    name: 'cursor/toggle-mark/on-node',
    when: ({ situation }): boolean => situation.kind === 'cursor-selection',
  },
]

/** Rules for range selection. */
export const rangeRules: MarksOpsRule[] = [
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
       * or range or non-text-only inline nodes) - not a cue to toggle the caret node.
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
      let nextAnchor: TextCursor = range.anchor
      let nextFocus: TextCursor = range.focus

      for (const span of spans) {
        const block = getBlockWithInlineContent(state, span.blockId)
        const found = findNodeInBlockWithInlineContent(block, span.nodeId)

        if (!found || !isInlineNodeWithEditableText(found.node)) {
          continue
        }

        const { node } = found

        const prevMarks: Marks = { ...node.marks }
        const nextMarks: Marks = { ...prevMarks, [input.mark]: enabling }

        const partial = buildPartialMarkRangeOps(
          span.blockId,
          node,
          span.from,
          span.to,
          nextMarks,
          prevMarks,
        )

        if (partial === null) {
          ops.push({
            __type: 'set_marks',
            blockId: span.blockId,
            from: span.from,
            nextMarks,
            nodeId: span.nodeId,
            prevMarks,
            to: span.to,
          })
          continue
        }

        ops.push(...partial.ops)

        if (
          span.blockId === range.anchor.blockId &&
          span.nodeId === range.anchor.nodeId
        ) {
          nextAnchor = {
            blockId: span.blockId,
            nodeId: partial.marked.nodeId,
            offset: partial.marked.from,
          }
        }

        if (
          span.blockId === range.focus.blockId &&
          span.nodeId === range.focus.nodeId
        ) {
          nextFocus = {
            blockId: span.blockId,
            nodeId: partial.marked.nodeId,
            offset: partial.marked.to,
          }
        }
      }

      if (ops.length === 0) {
        return null
      }

      return withTrailingSelectionOp(
        ops,
        createRange(nextAnchor, nextFocus),
        context.selection,
      )
    },
    /** Toggle a mark on or off on a range of nodes with editable text. */
    name: 'range/toggle-mark/on-selection',
    when: ({ situation }): boolean => situation.kind === 'range-selection',
  },
]

/** Marks operations builder. */
export class MarksOpsBuilder extends OperationsBuilder<
  MarksOpsSituation,
  MarksOpsInput,
  unknown
> {
  constructor() {
    super({ name: 'marks-ops-builder' })
  }

  /** Describes the {@link MarksOpsSituation}. */
  describe(context: EditorContext): MarksOpsSituation {
    const { selection, state } = context
    if (!isSelectionActive(selection)) {
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

  /** Builds ops to toggle a mark on or off. */
  build(context: EditorContext, input: MarksOpsInput): BuilderOpsIntent | null {
    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    const isCursorKind = kind === 'cursor-selection'
    const rules = isCursorKind ? cursorRules : rangeRules

    /** For marks operations, by design we can only match one rule. */
    const match = this.iterRules({
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

    const label = isCursorKind ? 'on-node' : 'on-selection'

    return {
      label: `${label}:${String(input.mark)}`,
      ops,
    }
  }
}
