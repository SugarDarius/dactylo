import {
  createBulletListItemBlock,
  createCheckboxListItemBlock,
  createNumberedListItemBlock,
  createParagraphBlock,
  findNodeInBlockWithInlineContent,
  isBulletListItemBlock,
  isCheckboxListItemBlock,
  isNumberedListItemBlock,
  isQuoteBlock,
} from './blocks'
import type { BlockWithInlineContent } from './blocks'
import { warn } from './console'
import {
  compareTextCursors,
  computeInsertBlockPosKey,
  getBlockWithInlineContent,
  normalizeRange,
} from './document'
import type { DocumentState } from './document'
import type { EditorContext } from './editor-context'
import {
  createTextNode,
  isEmptyEditableRunway,
  isInlineContentWithoutVisibleText,
  isInlineNodeWithEditableText,
} from './nodes'
import type { InlineNode, InlineNodeWithEditableText } from './nodes'
import { nextMarkerNumbering } from './numbered-list-marker'
import type { Operation } from './operations'
import {
  buildDeleteRangeCrossBlockIntent,
  buildDeleteRangeWithinBlockIntent,
  buildDeleteTextRunIntent,
  buildError,
  buildReindexAfterRemovedNumberedItemOps,
  buildReindexNumberedListSuffixOps,
  computeSplitTailSnapshot,
  OperationsBuilder,
  rangeCollapsedError,
  resolvesCaretNode,
  withTrailingSelectionOp,
} from './operations-builder'
import type { BuilderOpsIntent, OperationRule } from './operations-builder'
import {
  createCursor,
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

        /** Index of the inline node with editable text in the block. */
        readonly index: number
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
export type HardBreakOpsRule = OperationRule<HardBreakOpsSituation>

/** Creates the block inserted or split by a hard break from `source`. */
export function createBlockAfterHardBreak(
  source: BlockWithInlineContent,
  content: InlineNode[],
  posKey: ReturnType<typeof computeInsertBlockPosKey>,
  metadata?: BlockWithInlineContent['metadata'],
): BlockWithInlineContent {
  if (isBulletListItemBlock(source)) {
    return createBulletListItemBlock({
      content,
      metadata,
      parentId: source.parentId,
      posKey,
    })
  }

  if (isCheckboxListItemBlock(source)) {
    return createCheckboxListItemBlock({
      content,
      metadata,
      parentId: source.parentId,
      posKey,
    })
  }

  if (isNumberedListItemBlock(source)) {
    return createNumberedListItemBlock({
      content,
      markerNumbering: nextMarkerNumbering(
        source.markerNumbering,
        source.variant,
      ),
      metadata,
      parentId: source.parentId,
      posKey,
      variant: source.variant,
    })
  }

  return createParagraphBlock({
    content,
    metadata,
    parentId: source.parentId,
    posKey,
  })
}

/**
 * Builds block-level hard-break operations at a caret inside one block.
 *
 * Mirrors cursor situation rules:
 * - Empty {@link BulletListItemBlock}, {@link CheckboxListItemBlock},
 *   {@link NumberedListItemBlock}, or {@link QuoteBlock} → `mutate_block_type`
 *   to paragraph, caret stays.
 * - At block end → `insert_block` with an unmarked empty successor (list item
 *   stays a list item; otherwise a paragraph), caret at new block start.
 * - Otherwise → `split_block` at the caret, caret at the tail block start.
 */
export function buildHardBreakBlockOpsAtCaret(
  state: DocumentState,
  block: BlockWithInlineContent,
  at: TextCursor,
  node: InlineNodeWithEditableText,
): { ops: Operation[]; next: CursorSelection } {
  if (
    (isBulletListItemBlock(block) ||
      isCheckboxListItemBlock(block) ||
      isNumberedListItemBlock(block) ||
      isQuoteBlock(block)) &&
    isInlineContentWithoutVisibleText(block.content)
  ) {
    const ops: Operation[] = [
      {
        __type: 'mutate_block_type',
        blockId: block.id,
        snapshot: block,
        spec: { kind: 'to_paragraph' },
      },
    ]
    if (isNumberedListItemBlock(block)) {
      ops.push(...buildReindexAfterRemovedNumberedItemOps(state, block))
    }

    return {
      next: createCursor(at),
      ops,
    }
  }

  const posKey = computeInsertBlockPosKey(state, {
    blockId: block.id,
    type: 'after',
  })

  if (isCursorAtBlockEnd(at, block)) {
    const insertedBlock = createBlockAfterHardBreak(
      block,
      [createTextNode({ text: '' })],
      posKey,
    )

    const next = cursorAtBlockStart(insertedBlock.id, insertedBlock)
    if (!next) {
      buildError(
        'New block has no editable inline node for caret',
        'HardBreakOpsBuilder/buildHardBreakBlockOpsAtCaret',
      )
    }

    const ops: Operation[] = []
    const last = block.content[block.content.length - 1]

    if (
      last &&
      last.id === node.id &&
      isEmptyEditableRunway(node) &&
      block.content.length > 1
    ) {
      ops.push({
        __type: 'remove_inline_node',
        blockId: block.id,
        nodeId: node.id,
        snapshot: node,
      })
    }

    ops.push({
      __type: 'insert_block',
      afterBlockId: block.id,
      block: insertedBlock,
    })

    if (
      isNumberedListItemBlock(block) &&
      isNumberedListItemBlock(insertedBlock)
    ) {
      ops.push(
        ...buildReindexNumberedListSuffixOps(state, block.id, {
          kind: 'continue',
          markerNumbering: insertedBlock.markerNumbering,
          variant: block.variant,
        }),
      )
    }

    return { next, ops }
  }

  const found = findNodeInBlockWithInlineContent(block, at.nodeId)
  if (!found) {
    buildError(
      `Node ${at.nodeId} not found in block ${block.id}`,
      'HardBreakOpsBuilder/buildHardBreakBlockOpsAtCaret',
    )
  }

  const tailSnapshot = computeSplitTailSnapshot(
    block,
    { index: found.index, node },
    at.offset,
  )
  const insertedBlock = createBlockAfterHardBreak(
    block,
    tailSnapshot,
    posKey,
    block.metadata,
  )
  const next = cursorAtBlockStart(insertedBlock.id, insertedBlock)
  if (!next) {
    buildError(
      'Split tail block has no editable inline node for caret',
      'HardBreakOpsBuilder/buildHardBreakBlockOpsAtCaret',
    )
  }

  const ops: Operation[] = [
    {
      __type: 'split_block',
      atNodeId: at.nodeId,
      atOffset: at.offset,
      blockId: block.id,
      newBlock: insertedBlock,
      tailSnapshot,
    },
  ]

  if (
    isNumberedListItemBlock(block) &&
    isNumberedListItemBlock(insertedBlock)
  ) {
    ops.push(
      ...buildReindexNumberedListSuffixOps(state, block.id, {
        kind: 'continue',
        markerNumbering: insertedBlock.markerNumbering,
        variant: block.variant,
      }),
    )
  }

  return { next, ops }
}

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

      const { block, node, at } = situation
      const { ops, next } = buildHardBreakBlockOpsAtCaret(
        context.state,
        block,
        at,
        node,
      )
      return withTrailingSelectionOp(ops, next, context.selection)
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

      const { block, node, at } = situation
      const { ops, next } = buildHardBreakBlockOpsAtCaret(
        context.state,
        block,
        at,
        node,
      )
      return withTrailingSelectionOp(ops, next, context.selection)
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
      const { block, node, index } = topology

      const deleteIntent = buildDeleteTextRunIntent(
        block.id,
        node,
        anchor.offset,
        focus.offset,
      )

      const nodeAfter: InlineNodeWithEditableText = {
        ...node,
        text: node.text.slice(0, anchor.offset) + node.text.slice(focus.offset),
      }

      const content = [...block.content]
      const blockAfter: BlockWithInlineContent = {
        ...block,
        content: content.splice(index, 1, nodeAfter),
      }

      const { ops, next } = buildHardBreakBlockOpsAtCaret(
        context.state,
        blockAfter,
        deleteIntent.caret,
        nodeAfter,
      )

      return withTrailingSelectionOp([...deleteIntent.ops, ...ops], next, range)
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
     * 🎯 Delete the range without joining survivors, then hard-break at anchor.
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

      const deleteIntent = buildDeleteRangeWithinBlockIntent(
        block,
        anchor,
        focus,
        { joinSurvivors: false },
      )
      const caretNode = resolvesCaretNode(block, deleteIntent)

      const content = [...block.content]
      const caretIndex = content.findIndex((n) => n.id === caretNode.id)

      const newBlock: BlockWithInlineContent = {
        ...block,
        content: caretIndex === -1 ? [caretNode] : content,
      }

      const { ops, next } = buildHardBreakBlockOpsAtCaret(
        context.state,
        newBlock,
        deleteIntent.caret,
        caretNode,
      )

      return withTrailingSelectionOp([...deleteIntent.ops, ...ops], next, range)
    },
    /** Same block, multiple nodes → range delete (no join) + hard break at anchor. */
    name: 'range/same-block/delete-then-hard-break',
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
      const { startBlock, endBlock } = topology

      const deleteIntent = buildDeleteRangeCrossBlockIntent(
        context,
        range,
        startBlock,
        endBlock,
      )
      const caretBlock = deleteIntent.caretBlock ?? startBlock
      const caretNode = resolvesCaretNode(caretBlock, deleteIntent)

      const { ops, next } = buildHardBreakBlockOpsAtCaret(
        context.state,
        caretBlock,
        deleteIntent.caret,
        caretNode,
      )

      return withTrailingSelectionOp([...deleteIntent.ops, ...ops], next, range)
    },
    /** Cross-blocks → trim/delete/merge surgery, then hard break at split caret. */
    name: 'range/cross-block/surgery-then-hard-break',
    when: ({ situation }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'cross-block',
  },
]

/** Hard break ops builder. */
export class HardBreakOpsBuilder extends OperationsBuilder<HardBreakOpsSituation> {
  constructor() {
    super({ name: 'hard-break-ops-builder' })
  }

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
        kind: 'range-selection',
        range: normalized,
        topology: {
          block,
          index: found.index,
          kind: 'same-node',
          node: found.node,
        },
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
    const match = this.iterRules({
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
