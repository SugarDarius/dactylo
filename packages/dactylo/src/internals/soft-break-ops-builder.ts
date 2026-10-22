import { findNodeInBlockWithInlineContent } from './blocks'
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
  createLineBreakNode,
  createLinkNode,
  createTextNode,
  isInlineNodeWithEditableText,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { DeleteTextOp, MergeBlocksOp, Operation } from './operations'
import type {
  BuilderOpsIntent,
  OperationRule,
  OperationsBuilder,
} from './operations-builder'
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
  resolveRangeInsertCaretAfterPrefixOps,
  resolvesMergeBlocksUndoFields,
  resolveTextInsertTarget,
} from './operations-builder'
import {
  createCursor,
  getRangeSelectionTopology,
  isCursorAtBlockEnd,
  isCursorSelection,
  isSelectionActive,
} from './selection'
import type { CursorSelection, RangeSelection, TextCursor } from './selection'
import { assertNever } from './utils'

/** Situation with no selection. */
export interface SoftBreakOpsNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation with a cursor selection. */
export interface SoftBreakOpsCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** Cursor at which ops are applied. */
  readonly at: TextCursor

  /** Block with inline content subject to ops.  */
  readonly block: BlockWithInlineContent

  /** Inline node with editable text subject to ops. */
  readonly node: InlineNodeWithEditableText

  /** Index of the inline node with editable text in the block. */
  readonly index: number
}

/** Situation with a range selection. */
export interface SoftBreakOpsRangeSelectionSituation {
  readonly kind: 'range-selection'

  /** Range at which the typing operation is applied. */
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

/** Situation for soft break operations. */
export type SoftBreakOpsSituation =
  | SoftBreakOpsNoSelectionSituation
  | SoftBreakOpsCursorSelectionSituation
  | SoftBreakOpsRangeSelectionSituation

/** Soft break operations rule. */
export type SoftBreakOpsRule = OperationRule<
  SoftBreakOpsSituation,
  unknown,
  unknown
>

/** Rules for cursor selection. */
export const cursorRules: SoftBreakOpsRule[] = [
  {
    /**
     * 💡 Selection is a cursor and it's at block end.
     * 🎯 Inserts a new line break node after the current node
     * and a new text node with empty text.      */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, index } = situation

      const insertedText = createTextNode({
        marks: context.activeMarks,
        text: '',
      })

      const ops: Operation[] = [
        {
          __type: 'insert_inline_node',
          blockId: block.id,
          index: index + 1,
          node: createLineBreakNode(),
        },
        {
          __type: 'insert_inline_node',
          blockId: block.id,
          index: index + 2,
          node: insertedText,
        },
        {
          __type: 'set_selection',
          next: createCursor({
            blockId: at.blockId,
            nodeId: insertedText.id,
            offset: 0,
          }),
          prev: context.selection,
        },
      ]

      return ops
    },
    name: 'cursor/soft-break/at-block-end',
    when: ({ situation }): boolean => {
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
     * 🎯 Splits the node at the cursor position.
     */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node, index } = situation

      const type = node.__type
      switch (type) {
        case 'text': {
          const tailText = node.text.slice(at.offset)
          const insertedText = createTextNode({
            marks: node.marks,
            metadata: node.metadata,
            text: tailText,
          })

          const ops: Operation[] = [
            {
              __type: 'delete_text',
              blockId: block.id,
              length: tailText.length,
              nodeId: node.id,
              offset: at.offset,
              snapshot: {
                marks: node.marks,
                text: tailText,
              },
            },
            {
              __type: 'insert_inline_node',
              blockId: block.id,
              index: index + 1,
              node: createLineBreakNode(),
            },
            {
              __type: 'insert_inline_node',
              blockId: block.id,
              index: index + 2,
              node: insertedText,
            },
            {
              __type: 'set_selection',
              next: createCursor({
                blockId: block.id,
                nodeId: insertedText.id,
                offset: 0,
              }),
              prev: context.selection,
            },
          ]

          return ops
        }
        case 'link': {
          const tailText = node.text.slice(at.offset)
          const insertedLink = createLinkNode({
            marks: node.marks,
            metadata: node.metadata,
            text: tailText,
            url: node.url,
          })

          const ops: Operation[] = [
            {
              __type: 'delete_text',
              blockId: block.id,
              length: tailText.length,
              nodeId: node.id,
              offset: at.offset,
              snapshot: {
                marks: node.marks,
                text: tailText,
              },
            },
            {
              __type: 'insert_inline_node',
              blockId: block.id,
              index: index + 1,
              node: createLineBreakNode(),
            },
            {
              __type: 'insert_inline_node',
              blockId: block.id,
              index: index + 2,
              node: insertedLink,
            },
            {
              __type: 'set_selection',
              next: createCursor({
                blockId: block.id,
                nodeId: insertedLink.id,
                offset: 0,
              }),
              prev: context.selection,
            },
          ]

          return ops
        }
        default: {
          assertNever(type, { hint: 'SoftBreakOpsBuilder/#build' })
        }
      }
    },
    name: 'cursor/soft-break/split-node-at',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { block } = situation
      return !isCursorAtBlockEnd(situation.at, block)
    },
  },
]

/**
 * Builds inline soft-break operations at a caret inside a text or link node.
 *
 * Mirrors cursor rules:
 * - At block end → `line_break` + empty text (active marks), caret on new text @ 0.
 * - Otherwise → split node: trim tail, `line_break`, tail node, caret on tail @ 0.
 */
export function buildSoftBreakInlineOpsAtCaret(
  context: EditorContext,
  block: BlockWithInlineContent,
  at: TextCursor,
  node: InlineNodeWithEditableText,
  index: number,
): { ops: Operation[]; next: CursorSelection } {
  if (isCursorAtBlockEnd(at, block)) {
    const insertedText = createTextNode({
      marks: context.activeMarks,
      text: '',
    })

    const ops: Operation[] = [
      {
        __type: 'insert_inline_node',
        blockId: block.id,
        index: index + 1,
        node: createLineBreakNode(),
      },
      {
        __type: 'insert_inline_node',
        blockId: block.id,
        index: index + 2,
        node: insertedText,
      },
    ]

    const next = createCursor({
      blockId: block.id,
      nodeId: insertedText.id,
      offset: 0,
    })

    return { next, ops }
  }

  const type = node.__type
  switch (type) {
    case 'text': {
      const tailText = node.text.slice(at.offset)
      const insertedText = createTextNode({
        marks: node.marks,
        metadata: node.metadata,
        text: tailText,
      })

      const ops: Operation[] = [
        {
          __type: 'delete_text',
          blockId: block.id,
          length: tailText.length,
          nodeId: node.id,
          offset: at.offset,
          snapshot: { marks: node.marks, text: tailText },
        },
        {
          __type: 'insert_inline_node',
          blockId: block.id,
          index: index + 1,
          node: createLineBreakNode(),
        },
        {
          __type: 'insert_inline_node',
          blockId: block.id,
          index: index + 2,
          node: insertedText,
        },
      ]

      const next = createCursor({
        blockId: block.id,
        nodeId: insertedText.id,
        offset: 0,
      })

      return { next, ops }
    }
    case 'link': {
      const tailText = node.text.slice(at.offset)
      const insertedLink = createLinkNode({
        marks: node.marks,
        metadata: node.metadata,
        text: tailText,
        url: node.url,
      })

      const ops: Operation[] = [
        {
          __type: 'delete_text',
          blockId: block.id,
          length: tailText.length,
          nodeId: node.id,
          offset: at.offset,
          snapshot: { marks: node.marks, text: tailText },
        },
        {
          __type: 'insert_inline_node',
          blockId: block.id,
          index: index + 1,
          node: createLineBreakNode(),
        },
        {
          __type: 'insert_inline_node',
          blockId: block.id,
          index: index + 2,
          node: insertedLink,
        },
      ]

      const next = createCursor({
        blockId: block.id,
        nodeId: insertedLink.id,
        offset: 0,
      })

      return { next, ops }
    }
    default: {
      assertNever(type, {
        hint: 'SoftBreakOpsBuilder/buildSoftBreakInlineOpsAtCaret',
      })
    }
  }
}

/**
 * Builds soft-break and selection ops after a range delete in the same op batch.
 *
 * Resolves the editable target at `at` by replaying prefix ops on block snapshot.
 * Mirrors contract from {@link buildInsertTextAndSelectionAtRangeOps}
 */
export function buildSoftBreakAndSelectionAtRangeOps(
  context: EditorContext,
  range: RangeSelection,
  at: TextCursor,
  opts: {
    /** Ops already queued for this block before insert (e.g. range `delete_text`). */
    prefixOps?: Operation[]
    /**
     * When document does not yet contain the target tree
     * (e.g. cross-block merge preview), resolve the node from this block
     * instead of `state`.
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
  const inline = buildSoftBreakInlineOpsAtCaret(
    context,
    previewBlock,
    insertAt,
    node,
    index,
  )

  const ops: Operation[] = [
    ...inline.ops,
    {
      __type: 'set_selection',
      next: inline.next,
      prev: range,
    },
  ]

  return ops
}

/** Rules for range selection. */
export const rangeRules: SoftBreakOpsRule[] = [
  {
    /**
     * 💡 Range selection lies entirely inside one text/link node.
     * 🎯 Delete the selected run in-node, then soft-break at anchor (no survivor join).
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
          'SoftBreakOpsBuilder/#build',
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

      const rangeOps = buildSoftBreakAndSelectionAtRangeOps(
        context,
        range,
        anchor,
        { prefixOps: [deleteTextOp] },
      )
      ops.push(...rangeOps)

      return ops
    },

    /** Same node → `delete_text` + inline soft break + `set_selection` at anchor. */
    name: 'range/same-node/delete-then-soft-break',
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

      const rangeOps = buildSoftBreakAndSelectionAtRangeOps(
        context,
        range,
        anchor,
        { prefixOps: deleteOps },
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
     * 🎯 Forward trim → delete middle blocks → backward trim → merge → soft break at merge split.
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

      const softBreakOps = buildSoftBreakAndSelectionAtRangeOps(
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
      ops.push(mergeBlockOp, ...softBreakOps)

      return ops
    },
    /** Cross-blocks → trim/delete/merge surgery, then soft break at split caret. */
    name: 'range/cross-block/surgery-then-soft-break',
    when: ({ situation }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'cross-block',
  },
]

/** Soft break operations builder. */
export class SoftBreakOpsBuilder implements OperationsBuilder<
  SoftBreakOpsSituation,
  SoftBreakOpsRule
> {
  /** Describes the {@link SoftBreakOpsSituation}. */
  describe(context: EditorContext): SoftBreakOpsSituation {
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
          'PastePlainTextOpsBuilder/#describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'PastePlainTextOpsBuilder/#describe',
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
        'SoftBreakOpsBuilder/#describe',
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

  /** Builds ops to apply a soft break. */
  build(context: EditorContext): BuilderOpsIntent | null {
    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    const isCursorKind = kind === 'cursor-selection'
    const rules = isCursorKind ? cursorRules : rangeRules

    /** For soft break operations, by design we can only match one rule. */
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
        'SoftBreakOpsBuilder/#build',
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
        'SoftBreakOpsBuilder/#build',
      )
      return null
    }

    return { label: 'insert-line-break', ops }
  }
}
