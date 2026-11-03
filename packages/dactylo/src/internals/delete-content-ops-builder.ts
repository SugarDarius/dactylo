import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockWithInlineContent } from './blocks'
import { warn } from './console'
import {
  compareTextCursors,
  getBlockIndex,
  getBlockWithInlineContent,
  isBlockWithInlineContentEmpty,
  normalizeRange,
  resolvePrevInlineBlock,
} from './document'
import type { EditorContext } from './editor-context'
import type { GraphemeOffsetCaret } from './grapheme'
import {
  getInlineNodeTextLength,
  isInlineNodeWithEditableText,
  isLineBreakNode,
  isMentionNode,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { DeleteTextOp, Operation } from './operations'
import {
  buildCollapseEmptyBlockToActiveMarksOps,
  buildDeleteBlocksBetweenOps,
  buildDeleteRangeCrossBlockIntent,
  buildDeleteRangeWithinBlockIntent,
  buildError,
  OperationsBuilder,
  rangeCollapsedError,
  resolvesMergeBlocksUndoFields,
  withTrailingSelectionOp,
} from './operations-builder'
import type { BuilderOpsIntent, OperationRule } from './operations-builder'
import {
  createCursor,
  cursorAtBlockEnd,
  getRangeSelectionTopology,
  isCursorSelection,
  isSelectionActive,
} from './selection'
import type { Selection, RangeSelection, TextCursor } from './selection'

/** Situation with no selection. */
export interface DeleteContentOpsNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation with a cursor selection. */
export interface DeleteContentOpsCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** Cursor at which ops are applied. */
  readonly at: TextCursor

  /** Block with inline content subject to ops.  */
  readonly block: BlockWithInlineContent

  /** Block index of the inline node with editable text. */
  readonly blockIndex: number

  /** Inline node with editable text subject to ops. */
  readonly node: InlineNodeWithEditableText

  /** Index of the inline node with editable text in the block. */
  readonly nodeIndex: number
}

/** Situation with a range selection. */
export interface DeleteContentOpsRangeSelectionSituation {
  readonly kind: 'range-selection'

  /** Range at which the typing operation is applied. */
  readonly range: RangeSelection

  /** Range selection topology. */
  readonly topology:
    | {
        readonly kind: 'within-same-block'

        /** Block with inline content subject to the operation.  */
        readonly block: BlockWithInlineContent
      }
    | {
        readonly kind: 'cross-blocks'

        /** Block with inline content at the start of the range selection. */
        readonly startBlock: BlockWithInlineContent

        /** Block with inline content at the end of the range selection. */
        readonly endBlock: BlockWithInlineContent
      }
}

/** Situation for delete content operations. */
export type DeleteContentOpsSituation =
  | DeleteContentOpsNoSelectionSituation
  | DeleteContentOpsCursorSelectionSituation
  | DeleteContentOpsRangeSelectionSituation

/** Resources for delete content operations. */
export interface DeleteContentOpsResources {
  /** Grapheme offset caret instance. */
  readonly graphemeOffsetCaret: GraphemeOffsetCaret
}

/** Delete content operations rule. */
export type DeleteContentOpsRule = OperationRule<
  DeleteContentOpsSituation,
  unknown,
  DeleteContentOpsResources
>

/**
 * Drops an empty structural `text` node and places the caret at the end of
 * the previous editable inline sibling (text or link).
 *
 * Used when Backspace at node start would merge into `prevNode`, and when
 * deleting the last character in a boundary text node (e.g. a lone space after
 * a link) would otherwise require a second Backspace at `offset === 0`.
 *
 * Caller must ensure `node.text.length === 0` and `prevNode` is editable text.
 */
export function buildAbsorbEmptyTextNodeIntoPrevOps(
  block: BlockWithInlineContent,
  /** Empty text node snapshot (undo). */
  node: InlineNodeWithEditableText,
  /** Previous sibling to receive the caret (text or link). */
  prevNode: InlineNodeWithEditableText,
  prevSelection: Selection | null,
): Operation[] {
  const endOffset = getInlineNodeTextLength(prevNode)

  return withTrailingSelectionOp(
    [
      {
        __type: 'remove_inline_node',
        blockId: block.id,
        nodeId: node.id,
        snapshot: node,
      },
    ],

    createCursor({
      blockId: block.id,
      nodeId: prevNode.id,
      offset: endOffset,
    }),
    prevSelection,
  )
}

/** Rules for cursor selection. */
export const cursorRules: DeleteContentOpsRule[] = [
  {
    /**
     * 💡 Situation:
     * - Cursor is at the start of the block.
     * - There is more than one block in the document.
     *
     * 🎯 Operations:
     * - Merge the current block with the previous block.
     */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { state } = context
      const { block, at } = situation

      const targetBlock = resolvePrevInlineBlock(state, block.id)
      if (targetBlock === null) {
        buildError(
          `No previous inline block for block ${at.blockId}`,
          'DeleteContentOpsBuilder/cursor/at-block-start/merge-blocks',
        )
      }

      const ops: Operation[] = []

      const between = buildDeleteBlocksBetweenOps(
        context,
        block.id,
        targetBlock.id,
      )
      ops.push(...between)

      const hadStructuralBetween = ops.length > 0
      const isEmpty = isBlockWithInlineContentEmpty(state, block.id)

      if (isEmpty && hadStructuralBetween) {
        const currentIdx = state.blockOrderById.indexOf(block.id)
        const afterBlockId =
          currentIdx > 9 ? (state.blockOrderById[currentIdx - 1] ?? null) : null

        return withTrailingSelectionOp(
          [
            ...ops,
            {
              __type: 'delete_block',
              afterBlockId,
              blockId: block.id,
              snapshot: block,
            },
          ],
          cursorAtBlockEnd(targetBlock.id, targetBlock),
          context.selection,
        )
      }

      let targetHead = [...targetBlock.content]
      const collapsedHead = buildCollapseEmptyBlockToActiveMarksOps(
        targetBlock,
        targetHead,
        context.activeMarks,
      )
      if (collapsedHead) {
        ops.push(...collapsedHead.ops)
        targetHead = [collapsedHead.placeholder]
      }

      const { splitAtNodeId, splitAtOffset } = resolvesMergeBlocksUndoFields(
        block,
        { ...targetBlock, content: targetHead },
        context.activeMarks,
      )

      return withTrailingSelectionOp(
        [
          ...ops,
          {
            __type: 'merge_blocks',
            mergedTailSnapshot: [...block.content],
            sourceBlockId: block.id,
            sourceSnapshot: block,
            splitAtNodeId,
            splitAtOffset,
            targetBlockId: targetBlock.id,
          },
        ],
        createCursor({
          blockId: targetBlock.id,
          nodeId: splitAtNodeId,
          offset: splitAtOffset,
        }),
        context.selection,
      )
    },
    name: 'cursor/delete-content/at-block-start/merge-blocks',
    when: ({ context, situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { blockIndex, nodeIndex, at, block } = situation
      if (!(blockIndex > 0 && nodeIndex === 0 && at.offset === 0)) {
        return false
      }

      return resolvePrevInlineBlock(context.state, block.id) !== null
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is at the start of a node.
     * - The previous node is a line break or mention.
     *
     * 🎯 Operations:
     * - Remove the line break / mention.
     * - If the node before that is editable, join this node's text into it
     *   (and drop an empty structural text node).
     */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node, nodeIndex } = situation
      const prevNode = block.content[nodeIndex - 1]
      /** Should not happen as it's checked in the when clause */
      if (
        !prevNode ||
        (prevNode.__type !== 'line_break' && prevNode.__type !== 'mention')
      ) {
        buildError(
          `Previous node not found for block ${block.id} at index ${nodeIndex - 1}`,
          'DeleteContentOpsBuilder/#build',
        )
      }

      const before = block.content[nodeIndex - 2]
      if (!before || !isInlineNodeWithEditableText(before)) {
        return withTrailingSelectionOp(
          [
            {
              __type: 'remove_inline_node',
              blockId: block.id,
              nodeId: prevNode.id,
              snapshot: prevNode,
            },
          ],
          createCursor({
            blockId: block.id,
            nodeId: node.id,
            offset: 0,
          }),
          context.selection,
        )
      }

      const ops: Operation[] = [
        {
          __type: 'remove_inline_node',
          blockId: block.id,
          nodeId: prevNode.id,
          snapshot: prevNode,
        },
      ]

      if (node.text.length > 0) {
        ops.push(
          {
            __type: 'remove_inline_node',
            blockId: block.id,
            nodeId: node.id,
            snapshot: node,
          },
          {
            __type: 'insert_text',
            blockId: block.id,
            nodeId: before.id,
            offset: before.text.length,
            text: node.text,
          },
        )
      } else {
        ops.push({
          __type: 'remove_inline_node',
          blockId: block.id,
          nodeId: node.id,
          snapshot: node,
        })
      }

      return withTrailingSelectionOp(
        ops,
        createCursor({
          blockId: block.id,
          nodeId: before.id,
          offset: before.text.length,
        }),
        context.selection,
      )
    },
    name: 'cursor/delete-content/at-node-start/after-line-break-or-mention',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { block, nodeIndex, at } = situation
      const prevNode = block.content[nodeIndex - 1]

      return (
        prevNode !== undefined &&
        (isLineBreakNode(prevNode) || isMentionNode(prevNode)) &&
        at.offset === 0 &&
        nodeIndex > 0
      )
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is at the start of the node.
     * - The previous node is not a line break or mention.
     * - The current node has non-empty text.
     *
     * 🎯 Operations:
     * - Removes the current node and appends its text to the previous editable sibling.
     * - Does not emit `insert_text` with `""` (empty nodes use the absorb rule instead).
     */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node, nodeIndex } = situation
      const prevNode = block.content[nodeIndex - 1]
      if (!prevNode || !isInlineNodeWithEditableText(prevNode)) {
        buildError(
          `Previous node not found for block ${block.id} at index ${nodeIndex - 1}`,
          'DeleteContentOpsBuilder/#build',
        )
      }

      const mergeOffset = getInlineNodeTextLength(prevNode)
      return withTrailingSelectionOp(
        [
          {
            __type: 'remove_inline_node',
            blockId: block.id,
            nodeId: node.id,
            snapshot: node,
          },
          {
            __type: 'insert_text',
            blockId: block.id,
            nodeId: prevNode.id,
            offset: mergeOffset,
            text: node.text,
          },
        ],
        createCursor({
          blockId: block.id,
          nodeId: prevNode.id,
          offset: mergeOffset + node.text.length,
        }),
        context.selection,
      )
    },
    name: 'cursor/delete-content/at-node-start/merge-none-empty-into-prev',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, nodeIndex, node, block } = situation
      const prevNode = block.content[nodeIndex - 1]

      return (
        at.offset === 0 &&
        nodeIndex > 0 &&
        node.text.length > 0 &&
        prevNode !== undefined &&
        isInlineNodeWithEditableText(prevNode)
      )
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is at the start of an empty structural text node
     *   (e.g. the unmarked continuation node inserted after a mark shortcut).
     * - The previous node is editable text (not a line break or mention).
     *
     * 🎯 Operations:
     * - Deletes the grapheme before the caret (last grapheme of the previous
     *   sibling) — the empty node is not visible, so absorbing it must not
     *   consume a Backspace.
     * - Removes the empty node and lands the caret in the previous sibling.
     */
    build: ({ context, situation, resources }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node, nodeIndex } = situation

      const prevNode = block.content[nodeIndex - 1]
      if (!prevNode || !isInlineNodeWithEditableText(prevNode)) {
        buildError(
          `Previous node not found for block ${block.id} at index ${nodeIndex - 1}`,
          'DeleteContentOpsBuilder/#build',
        )
      }

      const { start, length } = resources.graphemeOffsetCaret.getDeleteRange(
        prevNode.text,
        prevNode.text.length,
      )

      if (length <= 0) {
        return buildAbsorbEmptyTextNodeIntoPrevOps(
          block,
          node,
          prevNode,
          context.selection,
        )
      }

      const deleteOp: DeleteTextOp = {
        __type: 'delete_text',
        blockId: block.id,
        length,
        nodeId: prevNode.id,
        offset: start,
        snapshot: { text: prevNode.text.slice(start, start + length) },
      }

      const removeEmpty: Operation = {
        __type: 'remove_inline_node',
        blockId: block.id,
        nodeId: node.id,
        snapshot: node,
      }

      const remainingText =
        prevNode.text.slice(0, start) + prevNode.text.slice(start + length)
      const remaining = block.content
        .filter((inline) => inline.id !== node.id)
        .map((inline) =>
          inline.id === prevNode.id
            ? { ...prevNode, text: remainingText }
            : inline,
        )

      const collapsed = buildCollapseEmptyBlockToActiveMarksOps(
        block,
        remaining,
        context.activeMarks,
      )

      if (collapsed) {
        return withTrailingSelectionOp(
          [deleteOp, removeEmpty, ...collapsed.ops],
          createCursor({
            blockId: block.id,
            nodeId: collapsed.placeholder.id,
            offset: 0,
          }),
          context.selection,
        )
      }

      return withTrailingSelectionOp(
        [deleteOp, removeEmpty],
        createCursor({
          blockId: block.id,
          nodeId: prevNode.id,
          offset: start,
        }),
        context.selection,
      )
    },
    name: 'cursor/delete-content/at-node-start/absorb-empty-into-prev',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, nodeIndex, node, block } = situation
      const prevNode = block.content[nodeIndex - 1]

      return (
        at.offset === 0 &&
        nodeIndex > 0 &&
        node.text.length === 0 &&
        prevNode !== undefined &&
        isInlineNodeWithEditableText(prevNode)
      )
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is inside a node (`offset > 0`).
     * - The previous grapheme deletion empties a boundary `text` node after a link.
     *
     * 🎯 Operations:
     * - Deletes the previous grapheme.
     * - Absorbs the empty node into the previous sibling.
     */
    build: ({ context, situation, resources }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node, nodeIndex } = situation

      const prevNode = block.content[nodeIndex - 1]
      if (!prevNode || !isInlineNodeWithEditableText(prevNode)) {
        buildError(
          `Previous node missing for absorb at block ${block.id}`,
          'DeleteContentOpsBuilder/cursor/delete-and-absorb',
        )
      }

      const { start, length } = resources.graphemeOffsetCaret.getDeleteRange(
        node.text,
        at.offset,
      )

      const deleteOp: DeleteTextOp = {
        __type: 'delete_text',
        blockId: at.blockId,
        length,
        nodeId: at.nodeId,
        offset: start,
        snapshot: { text: node.text.slice(start, start + length) },
      }

      const remaining = block.content.filter((inline) => inline.id !== node.id)
      const collapsed = buildCollapseEmptyBlockToActiveMarksOps(
        block,
        remaining,
        context.activeMarks,
      )

      if (collapsed) {
        return withTrailingSelectionOp(
          [deleteOp, ...collapsed.ops],
          createCursor({
            blockId: block.id,
            nodeId: collapsed.placeholder.id,
            offset: 0,
          }),
          context.selection,
        )
      }

      return [
        deleteOp,
        ...buildAbsorbEmptyTextNodeIntoPrevOps(
          block,
          node,
          prevNode,
          context.selection,
        ),
      ]
    },
    name: 'cursor/delete-content/inside-node/delete-and-absorb-empty-into-prev',
    when: ({ situation, resources }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, nodeIndex, node, block } = situation
      const { length } = resources.graphemeOffsetCaret.getDeleteRange(
        node.text,
        at.offset,
      )

      if (length <= 0) {
        return false
      }

      const remainingLength = node.text.length - length
      const prevNode = nodeIndex > 0 ? block.content[nodeIndex - 1] : undefined

      /**
       * Boundary UX: `[link][text " "]` → one Backspace deletes the space and
       * lands inside the link at its end, instead of leaving an empty text node.
       */
      return (
        remainingLength === 0 &&
        isInlineNodeWithEditableText(node) &&
        prevNode !== undefined &&
        isInlineNodeWithEditableText(prevNode)
      )
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is inside a node (`offset > 0`).
     * - The previous grapheme deletion does not leave an empty boundary `text` node.
     *
     * 🎯 Operations:
     * - Deletes the previous grapheme and collapse the selection to
     *   the start of the deleted run.
     */
    build: ({ context, situation, resources }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, node, block } = situation
      const { start, length } = resources.graphemeOffsetCaret.getDeleteRange(
        node.text,
        at.offset,
      )

      const deleteOp: DeleteTextOp = {
        __type: 'delete_text',
        blockId: at.blockId,
        length,
        nodeId: at.nodeId,
        offset: start,
        snapshot: { text: node.text.slice(start, start + length) },
      }

      const remainingText =
        node.text.slice(0, start) + node.text.slice(start + length)
      const remaining = block.content.map((inline) =>
        inline.id === node.id ? { ...node, text: remainingText } : inline,
      )

      const collapsed = buildCollapseEmptyBlockToActiveMarksOps(
        block,
        remaining,
        context.activeMarks,
      )

      if (collapsed) {
        return withTrailingSelectionOp(
          [deleteOp, ...collapsed.ops],
          createCursor({
            blockId: block.id,
            nodeId: collapsed.placeholder.id,
            offset: 0,
          }),
          context.selection,
        )
      }

      return withTrailingSelectionOp(
        [deleteOp],
        createCursor({
          blockId: at.blockId,
          nodeId: at.nodeId,
          offset: start,
        }),
        context.selection,
      )
    },
    name: 'cursor/delete-content/inside-node/delete-previous-grapheme',
    when: ({ situation, resources }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, nodeIndex, node, block } = situation
      if (at.offset <= 0) {
        return false
      }

      const { length } = resources.graphemeOffsetCaret.getDeleteRange(
        node.text,
        at.offset,
      )

      if (length <= 0) {
        return false
      }

      const remainingLength = node.text.length - length
      const prevNode = nodeIndex > 0 ? block.content[nodeIndex - 1] : undefined

      const wouldAbsorb =
        remainingLength === 0 &&
        isInlineNodeWithEditableText(node) &&
        prevNode !== undefined &&
        isInlineNodeWithEditableText(prevNode)

      return !wouldAbsorb
    },
  },
]

/** Rules for range selection. */
export const rangeRules: DeleteContentOpsRule[] = [
  {
    /**
     * 💡 Situation:
     * - Range selection is within a single block (aka. same node or same block).
     *
     * 🎯 Operations:
     * - Deletes the content within the range.
     */
    build: ({ context, situation }): Operation[] | null => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'within-same-block'
      ) {
        return null
      }

      const { range, topology } = situation
      const { anchor, focus } = range
      const { block } = topology

      const deleteIntent = buildDeleteRangeWithinBlockIntent(
        context,
        block,
        anchor,
        focus,
      )

      return withTrailingSelectionOp(
        deleteIntent.ops,
        createCursor(deleteIntent.caret),
        context.selection,
      )
    },
    name: 'range/delete-content/within-same-block',
    when: ({ situation }): boolean => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'within-same-block'
      ) {
        return false
      }

      return true
    },
  },
  {
    build: ({ context, situation }): Operation[] | null => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'cross-blocks'
      ) {
        return null
      }

      const { range, topology } = situation
      const { startBlock, endBlock } = topology

      const deleteIntent = buildDeleteRangeCrossBlockIntent(
        context,
        range,
        startBlock,
        endBlock,
      )

      return withTrailingSelectionOp(
        deleteIntent.ops,
        createCursor(deleteIntent.caret),
        context.selection,
      )
    },
    name: 'range/delete-content/cross-blocks',
    when: ({ situation }): boolean => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'cross-blocks'
      ) {
        return false
      }

      return true
    },
  },
]

/** Options for constructing a delete content operations builder. */
export interface DeleteContentOpsBuilderOptions {
  /** Grapheme offset caret instance. */
  readonly graphemeOffsetCaret: GraphemeOffsetCaret
}

/** Delete content operations builder. */
export class DeleteContentOpsBuilder extends OperationsBuilder<
  DeleteContentOpsSituation,
  unknown,
  DeleteContentOpsResources
> {
  /** Grapheme offset caret instance. */
  readonly #graphemeOffsetCaret: GraphemeOffsetCaret

  constructor(options: DeleteContentOpsBuilderOptions) {
    super({ name: 'delete-content-ops-builder' })
    this.#graphemeOffsetCaret = options.graphemeOffsetCaret
  }

  /** Describes the {@link DeleteContentOpsSituation}. */
  describe(context: EditorContext): DeleteContentOpsSituation {
    const { selection, state } = context
    if (!isSelectionActive(selection)) {
      return { kind: 'no-selection' }
    }

    if (isCursorSelection(selection)) {
      const block = getBlockWithInlineContent(state, selection.anchor.blockId)
      const blockIndex = getBlockIndex(state, block.id)

      const found = findNodeInBlockWithInlineContent(
        block,
        selection.anchor.nodeId,
      )

      if (!found) {
        buildError(
          `Node ${selection.anchor.nodeId} not found in block ${block.id}`,
          'DeleteContentOpsBuilder/#describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'DeleteContentOpsBuilder/#describe',
        )
      }

      return {
        at: selection.anchor,
        block,
        blockIndex,
        kind: 'cursor-selection',
        node: found.node,
        nodeIndex: found.index,
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
        'DeleteContentOpsBuilder/#describe',
      )
    }

    const topology = getRangeSelectionTopology(normalized)
    if (topology === 'same-node' || topology === 'same-block') {
      const block = getBlockWithInlineContent(state, anchor.blockId)
      return {
        kind: 'range-selection',
        range: normalized,
        topology: { block, kind: 'within-same-block' },
      }
    }

    const startBlock = getBlockWithInlineContent(state, anchor.blockId)
    const endBlock = getBlockWithInlineContent(state, focus.blockId)

    return {
      kind: 'range-selection',
      range: normalized,
      topology: { endBlock, kind: 'cross-blocks', startBlock },
    }
  }

  /** Builds ops to delete content. */
  build(context: EditorContext): BuilderOpsIntent | null {
    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    const isCursorKind = kind === 'cursor-selection'
    /**
     * 👉🏻 Expected UX:
     * At the very start of the document (first block, offset = 0), `Backspace` key typically
     * deletes nothing. We are not at "delete the character before the cursor" (→ offset - 1),
     * because we already took the block-start branch and there is no previous block to join with.
     */
    if (
      isCursorKind &&
      situation.at.offset === 0 &&
      situation.blockIndex === 0 &&
      situation.nodeIndex === 0
    ) {
      return null
    }

    const rules = isCursorKind ? cursorRules : rangeRules

    /** For delete content operations, by design we can only match one rule. */
    const match = this.iterRules({
      context,
      input: null,
      resources: { graphemeOffsetCaret: this.#graphemeOffsetCaret },
      rules,
      situation,
    }).next()
    if (match.done) {
      warn(
        'No rule applied for the given situation and input.',
        'DeleteContentOpsBuilder/#build',
      )
      return null
    }

    const build = match.value
    const ops = build({
      context,
      input: null,
      resources: { graphemeOffsetCaret: this.#graphemeOffsetCaret },
      situation,
    })

    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'DeleteContentOpsBuilder/#build',
      )
      return null
    }

    return {
      coalesce: isCursorKind ? true : undefined,
      label: 'delete-content',
      ops,
    }
  }
}
