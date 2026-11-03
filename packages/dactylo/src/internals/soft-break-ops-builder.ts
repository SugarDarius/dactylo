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
  createFromInlineWithEditableText,
  createLineBreakNode,
  createTextNode,
  isInlineNodeWithEditableText,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { Operation } from './operations'
import type { BuilderOpsIntent, OperationRule } from './operations-builder'
import {
  buildDeleteRangeCrossBlockIntent,
  buildDeleteRangeWithinBlockIntent,
  buildDeleteTextRunIntent,
  buildError,
  rangeCollapsedError,
  resolvesCaretNode,
  OperationsBuilder,
  withTrailingSelectionOp,
} from './operations-builder'
import {
  createCursor,
  getRangeSelectionTopology,
  isCursorAtBlockEnd,
  isCursorSelection,
  isSelectionActive,
} from './selection'
import type { CursorSelection, RangeSelection, TextCursor } from './selection'

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

/** Builds inline soft-break operations at a caret inside a text or link node. */
export function buildSoftBreakInlineOpsAtCaret(
  block: BlockWithInlineContent,
  at: TextCursor,
  node: InlineNodeWithEditableText,
  _nodeIndex: number,
): { ops: Operation[]; next: CursorSelection } {
  const lineBreak = createLineBreakNode()

  if (isCursorAtBlockEnd(at, block)) {
    const insertedText = createTextNode({
      marks: node.marks,
      text: '',
    })

    return {
      next: createCursor({
        blockId: block.id,
        nodeId: insertedText.id,
        offset: 0,
      }),
      ops: [
        {
          __type: 'insert_inline_node',
          afterNodeId: node.id,
          blockId: block.id,
          node: lineBreak,
        },
        {
          __type: 'insert_inline_node',
          afterNodeId: lineBreak.id,
          blockId: block.id,
          node: insertedText,
        },
      ],
    }
  }

  const tailText = node.text.slice(at.offset)
  const inserted = createFromInlineWithEditableText(node, { text: tailText })
  const ops: Operation[] = []

  if (tailText.length > 0) {
    ops.push({
      __type: 'delete_text',
      blockId: block.id,
      length: tailText.length,
      nodeId: node.id,
      offset: at.offset,
      snapshot: { text: tailText },
    })
  }

  ops.push(
    {
      __type: 'insert_inline_node',
      afterNodeId: node.id,
      blockId: block.id,
      node: lineBreak,
    },
    {
      __type: 'insert_inline_node',
      afterNodeId: lineBreak.id,
      blockId: block.id,
      node: inserted,
    },
  )

  return {
    next: createCursor({
      blockId: block.id,
      nodeId: inserted.id,
      offset: 0,
    }),
    ops,
  }
}

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

      const { at, block, node, index } = situation
      const { ops, next } = buildSoftBreakInlineOpsAtCaret(
        block,
        at,
        node,
        index,
      )

      return withTrailingSelectionOp(ops, next, context.selection)
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
      const { ops, next } = buildSoftBreakInlineOpsAtCaret(
        block,
        at,
        node,
        index,
      )

      return withTrailingSelectionOp(ops, next, context.selection)
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

/** Rules for range selection. */
export const rangeRules: SoftBreakOpsRule[] = [
  {
    /**
     * 💡 Range selection lies entirely inside one text/link node.
     * 🎯 Delete the selected run in-node, then soft-break at anchor (no survivor join).
     */
    build: ({ situation }): Operation[] | null => {
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
      const newBlock: BlockWithInlineContent = {
        ...block,
        content: content.splice(index, 1, nodeAfter),
      }

      const { ops, next } = buildSoftBreakInlineOpsAtCaret(
        newBlock,
        deleteIntent.caret,
        nodeAfter,
        index,
      )

      return withTrailingSelectionOp(ops, next, range)
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
    build: ({ situation }): Operation[] | null => {
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

      const { ops, next } = buildSoftBreakInlineOpsAtCaret(
        newBlock,
        deleteIntent.caret,
        caretNode,
        caretIndex,
      )

      return withTrailingSelectionOp(ops, next, range)
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
      const { startBlock, endBlock } = topology

      const deleteIntent = buildDeleteRangeCrossBlockIntent(
        context,
        range,
        startBlock,
        endBlock,
      )
      const caretBlock = deleteIntent.caretBlock ?? startBlock
      const caretNode = resolvesCaretNode(caretBlock, deleteIntent)
      const caretIndex = caretBlock.content.findIndex(
        (node) => node.id === caretNode.id,
      )

      const { ops, next } = buildSoftBreakInlineOpsAtCaret(
        caretBlock,
        deleteIntent.caret,
        caretNode,
        caretIndex,
      )

      return withTrailingSelectionOp([...deleteIntent.ops, ...ops], next, range)
    },
    /** Cross-blocks → trim/delete/merge surgery, then soft break at split caret. */
    name: 'range/cross-block/surgery-then-soft-break',
    when: ({ situation }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'cross-block',
  },
]

/** Soft break operations builder. */
export class SoftBreakOpsBuilder extends OperationsBuilder<
  SoftBreakOpsSituation,
  unknown,
  unknown
> {
  constructor() {
    super({ name: 'soft-break-ops-builder' })
  }

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
