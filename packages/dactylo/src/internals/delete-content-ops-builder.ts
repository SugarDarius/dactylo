import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockId, BlockWithInlineContent } from './blocks'
import { warn } from './console'
import {
  compareTextCursors,
  getBlockIndex,
  getBlockNeighbors,
  getBlockWithInlineContent,
  normalizeRange,
} from './document'
import type { EditorContext } from './editor-context'
import type { GraphemeOffsetCaret } from './grapheme'
import {
  coalesceInlineNodes,
  getInlineNodeTextLength,
  isInlineNodeWithEditableText,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { Operation } from './operations'
import {
  buildBackwardTrimBlockOps,
  buildCollapseEmptyBlockToActiveMarksOps,
  buildDeleteBlocksBetweenOps,
  buildDeleteRangeWithinBlockOps,
  buildError,
  buildForwardTrimBlockOps,
  iterRules,
  previewInlineContentAfterTrimOps,
  rangeCollapsedError,
  resolvesMergeBlocksUndoFields,
} from './operations-builder'
import type {
  BuilderOpsIntent,
  OperationRule,
  OperationsBuilder,
} from './operations-builder'
import {
  createCursor,
  getRangeSelectionTopology,
  isCursorSelection,
} from './selection'
import type { RangeSelection, TextCursor } from './selection'

/** Situation with no selection. */
export interface DeleteContentOpsNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation with a cursor selection. */
export interface DeleteContentOpsCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** The cursor at which ops are applied. */
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

  /** The range at which the typing operation is applied. */
  readonly range: RangeSelection

  /** The topology of the range selection. */
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
  context: EditorContext,
  blockId: BlockId,
  /** Content index of the empty text node to remove. */
  index: number,
  /** Empty text node snapshot (undo). */
  node: InlineNodeWithEditableText,
  /** Previous sibling to receive the caret (text or link). */
  prevNode: InlineNodeWithEditableText,
): Operation[] {
  const endOffset = getInlineNodeTextLength(prevNode)
  return [
    {
      __type: 'remove_inline_node',
      blockId,
      index,
      snapshot: node,
    },
    {
      __type: 'set_selection',
      next: createCursor({
        blockId,
        nodeId: prevNode.id,
        offset: endOffset,
      }),
      prev: context.selection,
    },
  ]
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
    // @todo: handle blocks with no inline content
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { state } = context
      const { block, at } = situation

      const neighbors = getBlockNeighbors(state, block.id)
      /** Should not happen as we already checked if there is only one block in the document. */
      if (neighbors.prev === null) {
        buildError(
          `Previous block ID is not found for block ${at.blockId}`,
          'DeleteContentOpsBuilder/#build',
        )
      }

      const prevBlock = getBlockWithInlineContent(state, neighbors.prev)
      const ops: Operation[] = []

      let targetHead = [...prevBlock.content]
      const collapsedHead = buildCollapseEmptyBlockToActiveMarksOps(
        prevBlock.id,
        targetHead,
        context.activeMarks,
      )

      if (collapsedHead) {
        ops.push(...collapsedHead.ops)
        targetHead = [collapsedHead.placeholder]
      }

      const { splitAtNodeId, splitAtOffset } = resolvesMergeBlocksUndoFields(
        block,
        { ...prevBlock, content: targetHead },
        context.activeMarks,
      )

      ops.push(
        {
          __type: 'merge_blocks',
          atIndex: targetHead.length,
          mergedTailSnapshot: [...block.content],
          sourceBlockId: block.id,
          sourceSnapshot: block,
          splitAtNodeId,
          splitAtOffset,
          targetBlockId: prevBlock.id,
        },
        {
          __type: 'set_selection',
          next: createCursor({
            blockId: prevBlock.id,
            nodeId: splitAtNodeId,
            offset: splitAtOffset,
          }),
          prev: context.selection,
        },
      )

      return ops
    },
    name: 'cursor/delete-content/at-block-start/merge-blocks',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { blockIndex, nodeIndex, at } = situation
      return blockIndex > 0 && nodeIndex === 0 && at.offset === 0
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is at the start of the block.
     * - The previous node is a line break or mention.
     *
     * 🎯 Operations:
     * - Remove the previous node and joins text when possible
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

      const ni = nodeIndex - 1
      const ops: Operation[] = [
        {
          __type: 'remove_inline_node',
          blockId: block.id,
          index: nodeIndex,
          snapshot: node,
        },
        {
          __type: 'remove_inline_node',
          blockId: block.id,
          index: ni,
          snapshot: prevNode,
        },
      ]

      const before = block.content[ni - 1]
      if (!before) {
        buildError(
          `Before node not found for block ${block.id} at index ${ni - 1}`,
          'DeleteContentOpsBuilder/#build',
        )
      }

      if (isInlineNodeWithEditableText(before)) {
        if (node.text.length > 0) {
          ops.push({
            __type: 'insert_text',
            blockId: block.id,
            marks: node.marks,
            nodeId: before.id,
            offset: before.text.length,
            text: node.text,
          })
        }

        ops.push({
          __type: 'set_selection',
          next: createCursor({
            blockId: block.id,
            nodeId: before.id,
            offset: before.text.length,
          }),
          prev: context.selection,
        })
      } else {
        const offset = getInlineNodeTextLength(before)
        ops.push({
          __type: 'set_selection',
          next: createCursor({
            blockId: block.id,
            nodeId: before.id,
            offset,
          }),
          prev: context.selection,
        })
      }

      return ops
    },
    name: 'cursor/delete-content/at-node-start/after-line-break-or-mention',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { block, nodeIndex, at } = situation
      const prevNode = block.content[nodeIndex - 1]

      return (
        (prevNode?.__type === 'line_break' || prevNode?.__type === 'mention') &&
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
      const mergingText = node.text

      const ops: Operation[] = [
        {
          __type: 'remove_inline_node',
          blockId: block.id,
          index: nodeIndex,
          snapshot: node,
        },
        {
          __type: 'insert_text',
          blockId: block.id,
          marks: node.marks,
          nodeId: prevNode.id,
          offset: mergeOffset,
          text: mergingText,
        },
        {
          __type: 'set_selection',
          next: createCursor({
            blockId: block.id,
            nodeId: prevNode.id,
            offset: mergeOffset + mergingText.length,
          }),
          prev: context.selection,
        },
      ]

      return ops
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
        prevNode?.__type !== 'line_break' &&
        prevNode?.__type !== 'mention'
      )
    },
  },
  {
    /**
     * 💡 Situation:
     * - Cursor is at the start on a empty structural text node.
     * - The previous node is not a line break or mention.
     * - The current node contains some text.
     *
     * 🎯 Operations:
     * - Removes the current node and lands the caret at the end of the previous sibling.
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

      const ops: Operation[] = buildAbsorbEmptyTextNodeIntoPrevOps(
        context,
        block.id,
        nodeIndex,
        node,
        prevNode,
      )

      return ops
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
        node.text.length > 0 &&
        prevNode?.__type !== 'line_break' &&
        prevNode?.__type !== 'mention'
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

      const ops: Operation[] = [
        {
          __type: 'delete_text',
          blockId: at.blockId,
          length,
          nodeId: at.nodeId,
          offset: start,
          snapshot: {
            marks: node.marks,
            text: node.text.slice(start, start + length),
          },
        },
      ]

      const absorbOps = buildAbsorbEmptyTextNodeIntoPrevOps(
        context,
        block.id,
        nodeIndex,
        node,
        prevNode,
      )
      ops.push(...absorbOps)

      return ops
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

      const { at, node } = situation
      const { start, length } = resources.graphemeOffsetCaret.getDeleteRange(
        node.text,
        at.offset,
      )

      const ops: Operation[] = [
        {
          __type: 'delete_text',
          blockId: at.blockId,
          length,
          nodeId: at.nodeId,
          offset: start,
          snapshot: {
            marks: node.marks,
            text: node.text.slice(start, start + length),
          },
        },
        {
          __type: 'set_selection',
          next: createCursor({
            blockId: at.blockId,
            nodeId: at.nodeId,
            offset: start,
          }),
          prev: context.selection,
        },
      ]

      return ops
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

/** Deletes content on a range that spans multiple blocks. */
export function buildDeleteContentCrossBlocksOps(
  context: EditorContext,
  range: RangeSelection,
  startBlock: BlockWithInlineContent,
  endBlock: BlockWithInlineContent,
): Operation[] {
  const { anchor, focus } = range
  const ops: Operation[] = []

  const forwards = buildForwardTrimBlockOps(startBlock, anchor)
  ops.push(...forwards)

  let targetHead = previewInlineContentAfterTrimOps(
    startBlock.content,
    forwards,
    startBlock.id,
  )

  const collapsedHead = buildCollapseEmptyBlockToActiveMarksOps(
    startBlock.id,
    targetHead,
    context.activeMarks,
  )

  if (collapsedHead) {
    ops.push(...collapsedHead.ops)
    targetHead = [collapsedHead.placeholder]
  }

  const between = buildDeleteBlocksBetweenOps(
    context,
    startBlock.id,
    endBlock.id,
  )
  ops.push(...between)

  const backwards = buildBackwardTrimBlockOps(endBlock, focus)
  ops.push(...backwards)

  const tailContent = previewInlineContentAfterTrimOps(
    endBlock.content,
    backwards,
    endBlock.id,
  )

  const trimmedSourceSnapshot: BlockWithInlineContent = {
    ...endBlock,
    content: tailContent,
  }
  const mergeTargetSnapshot: BlockWithInlineContent = {
    ...startBlock,
    content: targetHead,
  }

  const { splitAtNodeId, splitAtOffset } = resolvesMergeBlocksUndoFields(
    trimmedSourceSnapshot,
    mergeTargetSnapshot,
    context.activeMarks,
  )

  const mergedPreview = coalesceInlineNodes([...targetHead, ...tailContent])
  const collapsedMerged = buildCollapseEmptyBlockToActiveMarksOps(
    startBlock.id,
    mergedPreview,
    context.activeMarks,
  )

  ops.push({
    __type: 'merge_blocks',
    atIndex: targetHead.length,
    mergedTailSnapshot: [...tailContent],
    sourceBlockId: endBlock.id,
    sourceSnapshot: trimmedSourceSnapshot,
    splitAtNodeId,
    splitAtOffset,
    targetBlockId: startBlock.id,
  })

  if (collapsedMerged) {
    ops.push(...collapsedMerged.ops)
  }

  const nextSelection = collapsedMerged
    ? createCursor({
        blockId: startBlock.id,
        nodeId: collapsedMerged.placeholder.id,
        offset: 0,
      })
    : createCursor({
        blockId: startBlock.id,
        nodeId: splitAtNodeId,
        offset: splitAtOffset,
      })

  ops.push({
    __type: 'set_selection',
    next: nextSelection,
    prev: range,
  })

  return ops
}

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

      const ops: Operation[] = buildDeleteRangeWithinBlockOps(
        context,
        block,
        anchor,
        focus,
        range,
      )

      return ops
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

      const ops: Operation[] = buildDeleteContentCrossBlocksOps(
        context,
        range,
        startBlock,
        endBlock,
      )

      return ops
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
export class DeleteContentOpsBuilder implements OperationsBuilder<
  DeleteContentOpsSituation,
  DeleteContentOpsRule
> {
  /** Grapheme offset caret instance. */
  readonly #graphemeOffsetCaret: GraphemeOffsetCaret

  constructor(options: DeleteContentOpsBuilderOptions) {
    this.#graphemeOffsetCaret = options.graphemeOffsetCaret
  }

  /** Describes the {@link DeleteContentOpsSituation}. */
  describe(context: EditorContext): DeleteContentOpsSituation {
    const { selection, state } = context
    if (selection === null) {
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
    const match = iterRules({
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
