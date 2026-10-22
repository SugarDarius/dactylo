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
import {
  coalesceInlineNodes,
  createTextNode,
  isInlineNodeWithEditableText,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { DeleteTextOp, MergeBlocksOp, Operation } from './operations'
import {
  buildBackwardTrimBlockOps,
  buildCollapseEmptyBlockToActiveMarksOps,
  buildDeleteBlocksBetweenOps,
  buildDeleteRangeWithinBlockOps,
  buildError,
  buildForwardTrimBlockOps,
  computeSplitMergeAtIndex,
  computeSplitTailSnapshot,
  iterRules,
  previewInlineContentAfterTrimOps,
  rangeCollapsedError,
  resolveRangeInsertCaretAfterPrefixOps,
  resolvesMergeBlocksUndoFields,
  resolveTextInsertTarget,
} from './operations-builder'
import type {
  BuilderOpsIntent,
  OperationRule,
  OperationsBuilder,
} from './operations-builder'
import {
  cursorAtBlockStart,
  getRangeSelectionTopology,
  isCursorAtBlockEnd,
  isCursorSelection,
  isSelectionActive,
} from './selection'
import type { CursorSelection, RangeSelection, TextCursor } from './selection'

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

  /** Range selection topology. */
  readonly topology:
    | {
        readonly kind: 'same-node'

        /** Block with inline content subject to the operation.  */
        readonly block: BlockWithInlineContent

        /** Inline node with editable text subject to the operation. */
        readonly node: InlineNodeWithEditableText
      }
    | {
        readonly kind: 'same-block'

        /** Block with inline content subject to the operation.  */
        readonly block: BlockWithInlineContent
      }
    | {
        readonly kind: 'cross-block'

        /** Block with inline content at the start of the range selection. */
        readonly startBlock: BlockWithInlineContent

        /** Block with inline content at the end of the range selection. */
        readonly endBlock: BlockWithInlineContent
      }
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

/**
 * Builds block-level hard-break operations at a caret inside one block.
 *
 * Mirrors cursor situation rules:
 * - At block end → `insert_block` with an empty paragraph (active marks), caret at new block start.
 * - Otherwise → `split_block` at the caret, caret at the tail block start.
 */
export function buildHardBreakBlockOpsAtCaret(
  context: EditorContext,
  block: BlockWithInlineContent,
  at: TextCursor,
  node: InlineNodeWithEditableText,
  index: number,
): { ops: Operation[]; next: CursorSelection } {
  if (isCursorAtBlockEnd(at, block)) {
    const insertedBlock = createParagraphBlockAfter(block, [
      createTextNode({ marks: context.activeMarks, text: '' }),
    ])

    const ops: Operation[] = [
      {
        __type: 'insert_block',
        afterBlockId: block.id,
        block: insertedBlock,
      },
    ]

    const next = cursorAtBlockStart(insertedBlock.id, insertedBlock)
    if (!next) {
      buildError(
        'New paragraph has no editable inline node for caret',
        'HardBreakOpsBuilder/buildHardBreakBlockOpsAtCaret',
      )
    }

    return { next, ops }
  }

  const atIndex = computeSplitMergeAtIndex(block, { index, node }, at.offset)

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
  ]

  const next = cursorAtBlockStart(insertedBlock.id, insertedBlock)
  if (!next) {
    buildError(
      'Split tail block has no editable inline node for caret',
      'HardBreakOpsBuilder/buildHardBreakBlockOpsAtCaret',
    )
  }

  return { next, ops }
}

/**
 * Builds hard-break and selection ops after a range delete in the same op batch.
 *
 * Resolves the caret at `at` by replaying `prefixOps` on the block snapshot.
 * Mirrors contract {@link buildSoftBreakAndSelectionAtRangeOps} and
 * {@link buildInsertTextAndSelectionAtRangeOps}.
 */
export function buildHardBreakAndSelectionAtRangeOps(
  context: EditorContext,
  range: RangeSelection,
  at: TextCursor,
  opts: {
    /** Ops already queued for this block before the break (e.g. `delete_text`, `merge_blocks`). */
    prefixOps?: Operation[]
    /**
     * When the live document does not yet contain the target tree
     * (e.g. cross-block merge preview), resolve against this block instead of `state`.
     */
    blockSnapshot?: BlockWithInlineContent
  } = {},
): Operation[] {
  const { prefixOps = [], blockSnapshot } = opts
  const block =
    blockSnapshot ?? getBlockWithInlineContent(context.state, at.blockId)

  const insertAt = resolveRangeInsertCaretAfterPrefixOps(block, at, prefixOps)

  const previewContent = previewInlineContentAfterTrimOps(
    block.content,
    [...prefixOps],
    block.id,
  )

  const previewBlock: BlockWithInlineContent = {
    ...block,
    content: previewContent,
  }

  const { node, index } = resolveTextInsertTarget(block, prefixOps, insertAt)

  const blockOps = buildHardBreakBlockOpsAtCaret(
    context,
    previewBlock,
    insertAt,
    node,
    index,
  )

  return [
    ...blockOps.ops,
    {
      __type: 'set_selection',
      next: blockOps.next,
      prev: range,
    },
  ]
}

/** Rules for range selection. */
export const rangeRules: HardBreakOpsRule[] = [
  {
    /**
     * 💡 Range selection lies entirely inside one editable text node.
     * 🎯 `delete_text` on `[anchor, focus)`, then hard-break at anchor (post-delete caret).
     */
    build: ({ context, situation }): Operation[] | null => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'same-node'
      ) {
        return null
      }

      const { range, topology } = situation
      const { anchor, focus } = range
      const { block, node } = topology

      const deleteOffset = anchor.offset
      const deleteLength = focus.offset - anchor.offset

      if (deleteLength <= 0) {
        rangeCollapsedError(
          'Range selection is collapsed; expected non-empty text range.',
          'HardBreakOpsBuilder/#build',
        )
      }

      const ops: Operation[] = []
      const deleteTextOp: DeleteTextOp = {
        __type: 'delete_text',
        blockId: block.id,
        length: deleteLength,
        nodeId: node.id,
        offset: deleteOffset,
        snapshot: {
          marks: node.marks,
          text: node.text.slice(deleteOffset, deleteOffset + deleteLength),
        },
      }

      ops.push(deleteTextOp)

      const rangeOps = buildHardBreakAndSelectionAtRangeOps(
        context,
        range,
        anchor,
        {
          prefixOps: [deleteTextOp],
        },
      )
      ops.push(...rangeOps)

      return ops
    },
    /** Same node → `delete_text` + block split or new paragraph + `set_selection`. */
    name: 'range/same-node/delete-then-hard-break',
    when: ({ situation }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'same-node',
  },
  {
    /**
     * 💡 Range spans multiple inline nodes in one block.
     * 🎯 Delete the range without joining survivors, then soft-break at anchor.
     */
    build: ({ context, situation }): Operation[] | null => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'same-block'
      ) {
        return null
      }

      const { range, topology } = situation
      const { anchor, focus } = range
      const { block } = topology

      const deleteOps = buildDeleteRangeWithinBlockOps(
        context,
        block,
        anchor,
        focus,
        range,
        { joinSurvivors: false, setSelection: false },
      )

      const ops: Operation[] = [...deleteOps]
      const rangeOps = buildHardBreakAndSelectionAtRangeOps(
        context,
        range,
        anchor,
        {
          prefixOps: deleteOps,
        },
      )
      ops.push(...rangeOps)

      return ops
    },
    /** Same block, multiple nodes → range delete (no join) + soft break at anchor. */
    name: 'range/same-block/delete-then-soft-break',
    when: ({ situation }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'same-block',
  },
  {
    /**
     * 💡 Range crosses block boundaries.
     * 🎯 Forward trim → delete middle blocks → backward trim → merge → hard-break at merge split.
     */
    build: ({ context, situation }): Operation[] | null => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'cross-block'
      ) {
        return null
      }

      const { range, topology } = situation
      const { anchor, focus } = range
      const { startBlock, endBlock } = topology

      const ops: Operation[] = []

      const forward = buildForwardTrimBlockOps(startBlock, anchor)
      ops.push(...forward)

      let targetHead = previewInlineContentAfterTrimOps(
        startBlock.content,
        forward,
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

      const deleted = buildDeleteBlocksBetweenOps(
        context,
        startBlock.id,
        endBlock.id,
      )
      ops.push(...deleted)

      const backward = buildBackwardTrimBlockOps(endBlock, focus)
      ops.push(...backward)

      const tailContent = previewInlineContentAfterTrimOps(
        endBlock.content,
        backward,
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

      const mergedContentPreview = coalesceInlineNodes([
        ...targetHead,
        ...tailContent,
      ])

      const mergedBlockSnapshot: BlockWithInlineContent = {
        ...startBlock,
        content: mergedContentPreview,
      }

      const mergeBlockOp: MergeBlocksOp = {
        __type: 'merge_blocks',
        atIndex: targetHead.length,
        mergedTailSnapshot: [...tailContent],
        sourceBlockId: endBlock.id,
        sourceSnapshot: trimmedSourceSnapshot,
        splitAtNodeId,
        splitAtOffset,
        targetBlockId: startBlock.id,
      }

      const hardBreakOps = buildHardBreakAndSelectionAtRangeOps(
        context,
        range,
        {
          blockId: startBlock.id,
          nodeId: splitAtNodeId,
          offset: splitAtOffset,
        },
        {
          blockSnapshot: mergedBlockSnapshot,
          prefixOps: [mergeBlockOp],
        },
      )
      ops.push(mergeBlockOp, ...hardBreakOps)

      return ops
    },
    /** Cross-blocks → trim/delete/merge surgery, then soft break at split caret. */
    name: 'range/cross-block/surgery-then-soft-break',
    when: ({ situation }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'cross-block',
  },
]

/** Hard break ops builder. */
export class HardBreakOpsBuilder implements OperationsBuilder<
  HardBreakOpsSituation,
  HardBreakOpsRule
> {
  /** Describes the {@link HardBreakOpsSituation}. */
  describe(context: EditorContext): HardBreakOpsSituation {
    const { selection, state } = context
    if (!isSelectionActive(selection)) {
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

    const topology = getRangeSelectionTopology(normalized)
    if (topology === 'same-node') {
      const block = getBlockWithInlineContent(state, selection.anchor.blockId)
      const found = findNodeInBlockWithInlineContent(
        block,
        selection.anchor.nodeId,
      )

      if (!found) {
        buildError(
          `Node ${selection.anchor.nodeId} not found in block ${block.id}`,
          'SoftBreakOpsBuilder/#describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'SoftBreakOpsBuilder/#describe',
        )
      }

      return {
        kind: 'range-selection',
        range: normalized,
        topology: { block, kind: 'same-node', node: found.node },
      }
    }

    if (topology === 'same-block') {
      const block = getBlockWithInlineContent(state, selection.anchor.blockId)

      return {
        kind: 'range-selection',
        range: normalized,
        topology: { block, kind: 'same-block' },
      }
    }

    const startBlock = getBlockWithInlineContent(state, anchor.blockId)
    const endBlock = getBlockWithInlineContent(state, focus.blockId)

    return {
      kind: 'range-selection',
      range: normalized,
      topology: { endBlock, kind: 'cross-block', startBlock },
    }
  }

  /** Builds ops to apply a hard break. */
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
