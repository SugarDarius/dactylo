import {
  findNodeInBlockWithInlineContent,
  isNumberedListItemBlock,
} from './blocks'
import type { BlockWithInlineContent } from './blocks'
import { warn } from './console'
import {
  compareTextCursors,
  getBlockIndex,
  getBlockWithInlineContent,
  isBlockWithInlineContentEmpty,
  normalizeRange,
  resolveNextInlineBlock,
} from './document'
import type { EditorContext } from './editor-context'
import type { GraphemeOffsetCaret } from './grapheme'
import {
  getInlineNodeTextLength,
  isEmptyEditableRunway,
  isInlineNodeWithEditableText,
  isLineBreakNode,
  isMentionNode,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { DeleteTextOp, Operation } from './operations'
import {
  buildCollapseEmptyBlockOps,
  buildDeleteBlocksBetweenOps,
  buildDeleteRangeCrossBlockIntent,
  buildDeleteRangeWithinBlockIntent,
  buildError,
  buildReindexAfterRemovedNumberedItemOps,
  OperationsBuilder,
  rangeCollapsedError,
  resolvesMergeBlocksUndoFields,
  stripEmptyRunwaysAtMergeSeam,
  withTrailingSelectionOp,
} from './operations-builder'
import type {
  BuilderOpsIntent,
  OperationRule,
  OperationsBuilderInitialMetadata,
} from './operations-builder'
import {
  createCursor,
  cursorAtBlockStart,
  getRangeSelectionTopology,
  isCursorSelection,
  isSelectionActive,
} from './selection'
import type { RangeSelection, Selection, TextCursor } from './selection'

/** Situation with no selection. */
export interface DeleteContentForwardOpsNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation with a cursor selection. */
export interface DeleteContentForwardOpsCursorSelectionSituation {
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
export interface DeleteContentForwardOpsRangeSelectionSituation {
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

/** Situation for delete content forward operations. */
export type DeleteContentForwardOpsSituation =
  | DeleteContentForwardOpsNoSelectionSituation
  | DeleteContentForwardOpsCursorSelectionSituation
  | DeleteContentForwardOpsRangeSelectionSituation

/** Resources for delete content forward operations. */
export interface DeleteContentForwardOpsResources {
  /** Grapheme offset caret instance. */
  readonly graphemeOffsetCaret: GraphemeOffsetCaret

  /** Initial metadata applied when creating blocks and inline nodes. */
  readonly initialMetadata: OperationsBuilderInitialMetadata
}

/** Delete content forward operations rule. */
export type DeleteContentForwardOpsRule = OperationRule<
  DeleteContentForwardOpsSituation,
  unknown,
  DeleteContentForwardOpsResources
>

/**
 * Drops an empty structural `text` node and places the caret at the start of
 * the next editable inline sibling (text or link).
 *
 * Used when Delete at node end would merge into `nextNode`, and when
 * deleting the last character in a boundary text node (e.g. a lone space before
 * a link) would otherwise require a second Delete at the next node's start.
 *
 * Caller must ensure `node.text.length === 0` and `nextNode` is editable text.
 */
export function buildAbsorbEmptyTextNodeIntoNextOps(
  block: BlockWithInlineContent,
  /** Empty text node snapshot (undo). */
  node: InlineNodeWithEditableText,
  /** Next sibling to receive the caret (text or link). */
  nextNode: InlineNodeWithEditableText,
  prevSelection: Selection | null,
): Operation[] {
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
      nodeId: nextNode.id,
      offset: 0,
    }),
    prevSelection,
  )
}

/** Whether the caret sits at the end of its current editable node. */
function isAtNodeEnd(
  situation: DeleteContentForwardOpsCursorSelectionSituation,
): boolean {
  return situation.at.offset === situation.node.text.length
}

/** Whether the caret sits at the end of the last inline node in its block. */
function isAtBlockEnd(
  situation: DeleteContentForwardOpsCursorSelectionSituation,
): boolean {
  return (
    situation.nodeIndex === situation.block.content.length - 1 &&
    isAtNodeEnd(situation)
  )
}

/** Rules for cursor selection. */
export const cursorRules: DeleteContentForwardOpsRule[] = [
  {
    /**
     * 💡 Situation:
     * - Cursor is at the end of the block.
     * - There is a following block with inline content.
     *
     * 🎯 Operations:
     * - Merge the next block into the current block.
     */
    build: ({ context, situation, resources }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { state } = context
      const { block, at } = situation

      const sourceBlock = resolveNextInlineBlock(state, block.id)
      if (sourceBlock === null) {
        buildError(
          `No next inline block for block ${at.blockId}`,
          'DeleteContentForwardOpsBuilder/cursor/at-block-end/merge-blocks',
        )
      }

      const ops: Operation[] = []

      const between = buildDeleteBlocksBetweenOps(
        context,
        block.id,
        sourceBlock.id,
      )
      ops.push(...between)

      const hadStructuralBetween = ops.length > 0
      const isEmpty = isBlockWithInlineContentEmpty(state, block.id)

      if (isEmpty && hadStructuralBetween) {
        const currentIdx = state.blockOrderById.indexOf(block.id)
        const afterBlockId =
          currentIdx > 0 ? (state.blockOrderById[currentIdx - 1] ?? null) : null

        const deleteOps: Operation[] = [
          ...ops,
          {
            __type: 'delete_block',
            afterBlockId,
            blockId: block.id,
            snapshot: block,
          },
        ]
        if (isNumberedListItemBlock(block)) {
          deleteOps.push(
            ...buildReindexAfterRemovedNumberedItemOps(state, block),
          )
        }

        const nextCaret = cursorAtBlockStart(sourceBlock.id, sourceBlock)
        if (!nextCaret) {
          buildError(
            `Next block ${sourceBlock.id} has no start caret`,
            'DeleteContentForwardOpsBuilder/cursor/at-block-end/merge-blocks',
          )
        }

        return withTrailingSelectionOp(deleteOps, nextCaret, context.selection)
      }

      let targetHead = [...block.content]
      const collapsedHead = buildCollapseEmptyBlockOps(
        block,
        targetHead,
        resources.initialMetadata.text,
      )
      if (collapsedHead) {
        ops.push(...collapsedHead.ops)
        targetHead = [collapsedHead.placeholder]
      }

      const stripped = stripEmptyRunwaysAtMergeSeam(
        { ...block, content: targetHead },
        sourceBlock,
      )
      ops.push(...stripped.ops)

      const strippedTarget = {
        ...block,
        content: stripped.targetContent,
      }
      const strippedSource = {
        ...sourceBlock,
        content: stripped.sourceContent,
      }

      const { splitAtNodeId, splitAtOffset } = resolvesMergeBlocksUndoFields(
        strippedSource,
        strippedTarget,
      )

      const mergeOps: Operation[] = [
        ...ops,
        {
          __type: 'merge_blocks',
          mergedTailSnapshot: [...stripped.sourceContent],
          sourceBlockId: sourceBlock.id,
          sourceSnapshot: strippedSource,
          splitAtNodeId,
          splitAtOffset,
          targetBlockId: block.id,
        },
      ]
      if (isNumberedListItemBlock(sourceBlock)) {
        mergeOps.push(
          ...buildReindexAfterRemovedNumberedItemOps(state, sourceBlock),
        )
      }

      return withTrailingSelectionOp(
        mergeOps,
        createCursor({
          blockId: block.id,
          nodeId: splitAtNodeId,
          offset: splitAtOffset,
        }),
        context.selection,
      )
    },
    name: 'cursor/delete-content-forward/at-block-end/merge-blocks',
    when: ({ context, situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      if (!isAtBlockEnd(situation)) {
        return false
      }

      return resolveNextInlineBlock(context.state, situation.block.id) !== null
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is at the end of a node.
     * - The next node is a line break or mention.
     *
     * 🎯 Operations:
     * - Remove the line break / mention.
     * - If the node after that is editable, join its text into this node
     *   (and drop an empty structural text node).
     */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node, nodeIndex } = situation
      const nextNode = block.content[nodeIndex + 1]
      if (
        !nextNode ||
        (nextNode.__type !== 'line_break' && nextNode.__type !== 'mention')
      ) {
        buildError(
          `Next node not found for block ${block.id} at index ${nodeIndex + 1}`,
          'DeleteContentForwardOpsBuilder/build',
        )
      }

      const after = block.content[nodeIndex + 2]
      if (!after || !isInlineNodeWithEditableText(after)) {
        return withTrailingSelectionOp(
          [
            {
              __type: 'remove_inline_node',
              blockId: block.id,
              nodeId: nextNode.id,
              snapshot: nextNode,
            },
          ],
          createCursor({
            blockId: block.id,
            nodeId: node.id,
            offset: node.text.length,
          }),
          context.selection,
        )
      }

      const ops: Operation[] = [
        {
          __type: 'remove_inline_node',
          blockId: block.id,
          nodeId: nextNode.id,
          snapshot: nextNode,
        },
      ]

      if (after.text.length > 0) {
        ops.push(
          {
            __type: 'remove_inline_node',
            blockId: block.id,
            nodeId: after.id,
            snapshot: after,
          },
          {
            __type: 'insert_text',
            blockId: block.id,
            nodeId: node.id,
            offset: node.text.length,
            text: after.text,
          },
        )
      } else {
        ops.push({
          __type: 'remove_inline_node',
          blockId: block.id,
          nodeId: after.id,
          snapshot: after,
        })
      }

      return withTrailingSelectionOp(
        ops,
        createCursor({
          blockId: block.id,
          nodeId: node.id,
          offset: node.text.length,
        }),
        context.selection,
      )
    },
    name: 'cursor/delete-content-forward/at-node-end/before-line-break-or-mention',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { block, nodeIndex } = situation
      const nextNode = block.content[nodeIndex + 1]

      return (
        isAtNodeEnd(situation) &&
        nextNode !== undefined &&
        (isLineBreakNode(nextNode) || isMentionNode(nextNode))
      )
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is at the end of a non-empty node.
     * - The next sibling is an empty mark-toggle runway.
     *
     * 🎯 Operations:
     * - Remove the empty runway instead of merging its (empty) text into this node.
     * - Caret stays at the end of the current node.
     */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node, nodeIndex } = situation
      const nextNode = block.content[nodeIndex + 1]
      if (!nextNode || !isEmptyEditableRunway(nextNode)) {
        buildError(
          `Next empty runway not found for block ${block.id} at index ${nodeIndex + 1}`,
          'DeleteContentForwardOpsBuilder/build',
        )
      }

      return withTrailingSelectionOp(
        [
          {
            __type: 'remove_inline_node',
            blockId: block.id,
            nodeId: nextNode.id,
            snapshot: nextNode,
          },
        ],
        createCursor({
          blockId: block.id,
          nodeId: node.id,
          offset: node.text.length,
        }),
        context.selection,
      )
    },
    name: 'cursor/delete-content-forward/at-node-end/drop-empty-next-runway',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { node, nodeIndex, block } = situation
      const nextNode = block.content[nodeIndex + 1]

      return (
        isAtNodeEnd(situation) &&
        node.text.length > 0 &&
        nextNode !== undefined &&
        isEmptyEditableRunway(nextNode)
      )
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is at the end of the node.
     * - The next node is not a line break, mention, or empty runway.
     * - The next node has non-empty text.
     *
     * 🎯 Operations:
     * - Removes the next node and appends its text to the current node.
     */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node, nodeIndex } = situation
      const nextNode = block.content[nodeIndex + 1]
      if (!nextNode || !isInlineNodeWithEditableText(nextNode)) {
        buildError(
          `Next node not found for block ${block.id} at index ${nodeIndex + 1}`,
          'DeleteContentForwardOpsBuilder/build',
        )
      }

      const mergeOffset = getInlineNodeTextLength(node)
      return withTrailingSelectionOp(
        [
          {
            __type: 'remove_inline_node',
            blockId: block.id,
            nodeId: nextNode.id,
            snapshot: nextNode,
          },
          {
            __type: 'insert_text',
            blockId: block.id,
            nodeId: node.id,
            offset: mergeOffset,
            text: nextNode.text,
          },
        ],
        createCursor({
          blockId: block.id,
          nodeId: node.id,
          offset: mergeOffset,
        }),
        context.selection,
      )
    },
    name: 'cursor/delete-content-forward/at-node-end/merge-none-empty-next-into-current',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { nodeIndex, block } = situation
      const nextNode = block.content[nodeIndex + 1]

      return (
        isAtNodeEnd(situation) &&
        nextNode !== undefined &&
        isInlineNodeWithEditableText(nextNode) &&
        nextNode.text.length > 0 &&
        !isEmptyEditableRunway(nextNode)
      )
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is in an empty structural text node
     *   (e.g. the unmarked continuation node inserted after a mark shortcut).
     * - The next node is editable text (not a line break or mention).
     *
     * 🎯 Operations:
     * - Deletes the grapheme after the caret (first grapheme of the next
     *   sibling) — the empty node is not visible, so absorbing it must not
     *   consume a Delete.
     * - Removes the empty node and lands the caret in the next sibling.
     */
    build: ({ context, situation, resources }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node, nodeIndex } = situation

      const nextNode = block.content[nodeIndex + 1]
      if (!nextNode || !isInlineNodeWithEditableText(nextNode)) {
        buildError(
          `Next node not found for block ${block.id} at index ${nodeIndex + 1}`,
          'DeleteContentForwardOpsBuilder/build',
        )
      }

      const { start, length } =
        resources.graphemeOffsetCaret.getForwardDeleteRange(nextNode.text, 0)

      if (length <= 0) {
        return buildAbsorbEmptyTextNodeIntoNextOps(
          block,
          node,
          nextNode,
          context.selection,
        )
      }

      const deleteOp: DeleteTextOp = {
        __type: 'delete_text',
        blockId: block.id,
        length,
        nodeId: nextNode.id,
        offset: start,
        snapshot: { text: nextNode.text.slice(start, start + length) },
      }

      const removeEmpty: Operation = {
        __type: 'remove_inline_node',
        blockId: block.id,
        nodeId: node.id,
        snapshot: node,
      }

      const remainingText = nextNode.text.slice(start + length)
      const remaining = block.content
        .filter((inline) => inline.id !== node.id)
        .map((inline) =>
          inline.id === nextNode.id
            ? { ...nextNode, text: remainingText }
            : inline,
        )

      const collapsed = buildCollapseEmptyBlockOps(
        block,
        remaining,
        resources.initialMetadata.text,
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
          nodeId: nextNode.id,
          offset: start,
        }),
        context.selection,
      )
    },
    name: 'cursor/delete-content-forward/at-node-end/absorb-empty-next',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { nodeIndex, node, block } = situation
      const nextNode = block.content[nodeIndex + 1]

      return (
        isAtNodeEnd(situation) &&
        node.text.length === 0 &&
        nextNode !== undefined &&
        isInlineNodeWithEditableText(nextNode)
      )
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is inside a node (`offset < text.length`).
     * - The next grapheme deletion empties a boundary `text` node before a link.
     *
     * 🎯 Operations:
     * - Deletes the next grapheme.
     * - Absorbs the empty node into the next sibling.
     */
    build: ({ context, situation, resources }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node, nodeIndex } = situation

      const nextNode = block.content[nodeIndex + 1]
      if (!nextNode || !isInlineNodeWithEditableText(nextNode)) {
        buildError(
          `Next node missing for absorb at block ${block.id}`,
          'DeleteContentForwardOpsBuilder/cursor/delete-and-absorb',
        )
      }

      const { start, length } =
        resources.graphemeOffsetCaret.getForwardDeleteRange(
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
      const collapsed = buildCollapseEmptyBlockOps(
        block,
        remaining,
        resources.initialMetadata.text,
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
        ...buildAbsorbEmptyTextNodeIntoNextOps(
          block,
          node,
          nextNode,
          context.selection,
        ),
      ]
    },
    name: 'cursor/delete-content-forward/inside-node/delete-and-absorb-empty-into-next',
    when: ({ situation, resources }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, nodeIndex, node, block } = situation
      const { length } = resources.graphemeOffsetCaret.getForwardDeleteRange(
        node.text,
        at.offset,
      )

      if (length <= 0) {
        return false
      }

      const remainingLength = node.text.length - length
      const nextNode =
        nodeIndex < block.content.length - 1
          ? block.content[nodeIndex + 1]
          : undefined

      /**
       * Boundary UX: `[text " "][link]` → one Delete deletes the space and
       * lands inside the link at its start, instead of leaving an empty text node.
       */
      return (
        remainingLength === 0 &&
        isInlineNodeWithEditableText(node) &&
        nextNode !== undefined &&
        isInlineNodeWithEditableText(nextNode)
      )
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is inside a node (`offset < text.length`).
     * - The next grapheme deletion does not leave an empty boundary `text` node.
     *
     * 🎯 Operations:
     * - Deletes the next grapheme and collapse the selection to
     *   the start of the deleted run.
     */
    build: ({ context, situation, resources }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, node, block } = situation
      const { start, length } =
        resources.graphemeOffsetCaret.getForwardDeleteRange(
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

      const collapsed = buildCollapseEmptyBlockOps(
        block,
        remaining,
        resources.initialMetadata.text,
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
    name: 'cursor/delete-content-forward/inside-node/delete-next-grapheme',
    when: ({ situation, resources }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, nodeIndex, node, block } = situation
      if (at.offset >= node.text.length) {
        return false
      }

      const { length } = resources.graphemeOffsetCaret.getForwardDeleteRange(
        node.text,
        at.offset,
      )

      if (length <= 0) {
        return false
      }

      const remainingLength = node.text.length - length
      const nextNode =
        nodeIndex < block.content.length - 1
          ? block.content[nodeIndex + 1]
          : undefined

      const wouldAbsorb =
        remainingLength === 0 &&
        isInlineNodeWithEditableText(node) &&
        nextNode !== undefined &&
        isInlineNodeWithEditableText(nextNode)

      return !wouldAbsorb
    },
  },
]

/** Rules for range selection. */
export const rangeRules: DeleteContentForwardOpsRule[] = [
  {
    /**
     * 💡 Situation:
     * - Range selection is within a single block (aka. same node or same block).
     *
     * 🎯 Operations:
     * - Deletes the content within the range.
     */
    build: ({ context, situation, resources }): Operation[] | null => {
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
        block,
        anchor,
        focus,
        { textMetadata: resources.initialMetadata.text },
      )

      return withTrailingSelectionOp(
        deleteIntent.ops,
        createCursor(deleteIntent.caret),
        context.selection,
      )
    },
    name: 'range/delete-content-forward/within-same-block',
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
    build: ({ context, situation, resources }): Operation[] | null => {
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
        resources.initialMetadata.text,
      )

      return withTrailingSelectionOp(
        deleteIntent.ops,
        createCursor(deleteIntent.caret),
        context.selection,
      )
    },
    name: 'range/delete-content-forward/cross-blocks',
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

/** Options for constructing a delete content forward operations builder. */
export interface DeleteContentForwardOpsBuilderOptions {
  /** Grapheme offset caret instance. */
  readonly graphemeOffsetCaret: GraphemeOffsetCaret

  /** Initial metadata applied when creating blocks and inline nodes. */
  readonly initialMetadata: OperationsBuilderInitialMetadata
}

/** Delete content forward operations builder. */
export class DeleteContentForwardOpsBuilder extends OperationsBuilder<
  DeleteContentForwardOpsSituation,
  unknown,
  DeleteContentForwardOpsResources
> {
  /** Grapheme offset caret instance. */
  readonly #graphemeOffsetCaret: GraphemeOffsetCaret

  /** Initial metadata applied when creating blocks and inline nodes. */
  readonly #initialMetadata: OperationsBuilderInitialMetadata

  constructor(options: DeleteContentForwardOpsBuilderOptions) {
    super({ name: 'delete-content-forward-ops-builder' })
    this.#graphemeOffsetCaret = options.graphemeOffsetCaret
    this.#initialMetadata = options.initialMetadata
  }

  /** Describes the {@link DeleteContentForwardOpsSituation}. */
  describe(context: EditorContext): DeleteContentForwardOpsSituation {
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
          'DeleteContentForwardOpsBuilder/describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'DeleteContentForwardOpsBuilder/describe',
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
        'DeleteContentForwardOpsBuilder/describe',
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

  /** Builds ops to delete content forward. */
  build(context: EditorContext): BuilderOpsIntent | null {
    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    const isCursorKind = kind === 'cursor-selection'
    /**
     * 👉🏻 Expected UX:
     * At the very end of the document (last inline block, caret after the last
     * character), `Delete` typically deletes nothing. There is no next character
     * and no following block to join with.
     */
    if (
      isCursorKind &&
      isAtBlockEnd(situation) &&
      resolveNextInlineBlock(context.state, situation.block.id) === null
    ) {
      return null
    }

    const rules = isCursorKind ? cursorRules : rangeRules

    /** For delete content forward operations, by design we can only match one rule. */
    const match = this.iterRules({
      context,
      input: null,
      resources: {
        graphemeOffsetCaret: this.#graphemeOffsetCaret,
        initialMetadata: this.#initialMetadata,
      },
      rules,
      situation,
    }).next()
    if (match.done) {
      warn(
        'No rule applied for the given situation and input.',
        'DeleteContentForwardOpsBuilder/build',
      )
      return null
    }

    const build = match.value
    const ops = build({
      context,
      input: null,
      resources: {
        graphemeOffsetCaret: this.#graphemeOffsetCaret,
        initialMetadata: this.#initialMetadata,
      },
      situation,
    })

    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'DeleteContentForwardOpsBuilder/build',
      )
      return null
    }

    return {
      coalesce: isCursorKind ? true : undefined,
      label: 'delete-content-forward',
      ops,
    }
  }
}
