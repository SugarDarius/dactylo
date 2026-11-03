import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockId, BlockWithInlineContent } from './blocks'
import { warn } from './console'
import {
  compareTextCursors,
  getBlockWithInlineContent,
  normalizeRange,
} from './document'
import type { EditorContext } from './editor-context'
import { isMarksEqual, normalizeMarks } from './marks'
import type { Marks } from './marks'
import {
  createFromInlineWithEditableText,
  createTextNode,
  isInlineNodeWithEditableText,
  isLinkNode,
} from './nodes'
import type { InlineNodeWithEditableText, NodeId } from './nodes'
import type { Operation } from './operations'
import type { BuilderOpsIntent, OperationRule } from './operations-builder'
import {
  buildDeleteRangeCrossBlockIntent,
  buildDeleteRangeWithinBlockIntent,
  buildDeleteTextRunIntent,
  buildError,
  OperationsBuilder,
  rangeCollapsedError,
  resolvesCaretNode,
  withTrailingSelectionOp,
} from './operations-builder'
import {
  createCursor,
  getRangeSelectionTopology,
  isCursorSelection,
  isSelectionActive,
} from './selection'
import type { Selection, RangeSelection, TextCursor } from './selection'

/** Situation with no selection. */
export interface InsertTextOpsNoSelectionSituation {
  readonly kind: 'no-selection'
}

export interface InsertTextOpsCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** The cursor at which ops are applied. */
  readonly at: TextCursor

  /** Block with inline content subject to the operation.  */
  readonly block: BlockWithInlineContent

  /** Inline node with editable text subject to the operation. */
  readonly node: InlineNodeWithEditableText

  /** Index of the inline node with editable text in the block. */
  readonly index: number
}

/** Situation with a range selection. */
export interface InsertTextOpsRangeSelectionSituation {
  readonly kind: 'range-selection'

  /** The range at which the typing operation is applied. */
  readonly range: RangeSelection

  /** The topology of the range selection. */
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

/** Situation of an inserted text operations. */
export type InsertTextOpsSituation =
  | InsertTextOpsNoSelectionSituation
  | InsertTextOpsCursorSelectionSituation
  | InsertTextOpsRangeSelectionSituation

/** Input given to an inserted text operation. */
export interface InsertTextOpsInput {
  /** The text to insert. */
  readonly text: string
}

/** Inserted text operation rule. */
export type InsertTextOpsRule = OperationRule<
  InsertTextOpsSituation,
  InsertTextOpsInput,
  unknown
>

/**
 * Builds operations to insert text when `activeMarks` ≠ target node marks.
 *
 * Produces `[before?][inserted_text][after?]` as separate inline nodes using:
 * - `delete_text` to trim the tail off the original node when needed
 * - `insert_inline_node` for the inserted text (known `insertNode.id`)
 * - `insert_inline_node` for the trailing segment when needed
 *
 * Does not emit `insert_text` on the original node for the new character.
 */
export function buildInsertTextWithMarkBoundaryOps(
  typingMarks: Marks,
  cursor: TextCursor,
  text: string,
  /** Target node at the caret (text or link). */
  node: InlineNodeWithEditableText,
  /** Node before `node`, or `null` if first. */
  prevNodeId: NodeId | null,
  blockId: BlockId,
  /** Previous selection for undo inversion. */
  prevSelection: Selection | null,
): Operation[] {
  const ops: Operation[] = []

  const before = node.text.slice(0, cursor.offset)
  const after = node.text.slice(cursor.offset)

  const insertNode = createFromInlineWithEditableText(node, {
    marks: typingMarks,
    metadata: node.metadata,
    text,
  })

  /** Trim tail so the surviving node is only `before`. */
  if (after.length > 0) {
    ops.push({
      __type: 'delete_text',
      blockId,
      length: after.length,
      nodeId: node.id,
      offset: cursor.offset,
      snapshot: { text: after },
    })
  }

  ops.push({
    __type: 'insert_inline_node',
    afterNodeId: before.length > 0 ? node.id : prevNodeId,
    blockId,
    node: insertNode,
  })

  if (after.length > 0) {
    ops.push({
      __type: 'insert_inline_node',
      afterNodeId: insertNode.id,
      blockId,
      node: createFromInlineWithEditableText(node, {
        marks: node.marks,
        metadata: node.metadata,
        text: after,
      }),
    })
  }

  return withTrailingSelectionOp(
    ops,
    createCursor({
      blockId,
      nodeId: insertNode.id,
      offset: text.length,
    }),
    prevSelection,
  )
}

/** Builds operations to insert text at a cursor selection. */
export function buildCursorInsertTextOps(
  context: EditorContext,
  at: TextCursor,
  block: BlockWithInlineContent,
  node: InlineNodeWithEditableText,
  /** Node before `node`, or `null` if first. */
  prevNodeId: NodeId | null,
  /** Previous selection for undo inversion. */
  prevSelection: Selection | null,
  text: string,
): Operation[] {
  const typingMarks = normalizeMarks({
    active: context.activeMarks,
    node: node.marks,
  })

  if (isMarksEqual(typingMarks, node.marks)) {
    return withTrailingSelectionOp(
      [
        {
          __type: 'insert_text',
          blockId: at.blockId,
          nodeId: at.nodeId,
          offset: at.offset,
          text,
        },
      ],
      createCursor({
        blockId: at.blockId,
        nodeId: at.nodeId,
        offset: at.offset + text.length,
      }),
      prevSelection,
    )
  }

  return buildInsertTextWithMarkBoundaryOps(
    typingMarks,
    at,
    text,
    node,
    prevNodeId,
    block.id,
    context.selection,
  )
}

/** Rules for cursor selection. */
export const cursorRules: InsertTextOpsRule[] = [
  {
    /**
     * 💡 Cursor is at the end of a link.
     * 🎯 Insert a new text node after the link instead of continuing the link.
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node } = situation
      const insertedText = createTextNode({
        marks: context.activeMarks,
        text: input.text,
      })

      return withTrailingSelectionOp(
        [
          {
            __type: 'insert_inline_node',
            afterNodeId: node.id,
            blockId: block.id,
            node: insertedText,
          },
        ],
        createCursor({
          blockId: block.id,
          nodeId: insertedText.id,
          offset: input.text.length,
        }),
        context.selection,
      )
    },
    name: 'cursor/at-link-end/insert-new-text',
    when: ({ situation }): boolean =>
      situation.kind === 'cursor-selection' &&
      isLinkNode(situation.node) &&
      situation.at.offset === situation.node.text.length,
  },
  {
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node, index } = situation

      const prevNode = block.content[index - 1]
      const prevNodeId = prevNode ? prevNode.id : null

      return buildCursorInsertTextOps(
        context,
        at,
        block,
        node,
        prevNodeId,
        context.selection,
        input.text,
      )
    },
    name: 'cursor/insert-text',
    when: ({ situation }): boolean => situation.kind === 'cursor-selection',
  },
]

/** Rules for range selection. */
export const rangeRules: InsertTextOpsRule[] = [
  {
    /**
     * 💡 Range selection is within the same node.
     * 🎯 Deleting the selection in-node, and insert replacement char
     * at current anchor position (no survivor join).
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'same-node'
      ) {
        return null
      }

      const { topology, range } = situation
      const { anchor, focus } = range
      const { block, node, index } = topology

      const prevNode = block.content[index - 1]
      const prevNodeId = prevNode ? prevNode.id : null

      const deleteIntent = buildDeleteTextRunIntent(
        block.id,
        node,
        anchor.offset,
        focus.offset,
      )

      const nodeAfterDelete: InlineNodeWithEditableText = {
        ...node,
        text: node.text.slice(0, anchor.offset) + node.text.slice(focus.offset),
      }

      return [
        ...deleteIntent.ops,
        ...buildCursorInsertTextOps(
          context,
          deleteIntent.caret,
          block,
          nodeAfterDelete,
          prevNodeId,
          context.selection,
          input.text,
        ),
      ]
    },
    /** Same node text/link → `delete_text` + `insert_text` + `set_selection` */
    name: 'range/same-node/delete-then-insert-char',
    when: ({ situation }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'same-node',
  },
  {
    /**
     * 💡 Range selection is within the same block but with multiple nodes.
     * 🎯 Deleting the selection in-block, and insert replacement char
     * at current anchor position (no survivor join).
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'same-block'
      ) {
        return null
      }

      const { topology, range } = situation
      const { anchor, focus } = range
      const { block } = topology

      const deleteIntent = buildDeleteRangeWithinBlockIntent(
        context,
        block,
        anchor,
        focus,
        { joinSurvivors: false },
      )
      const caretNode = resolvesCaretNode(block, deleteIntent)
      const caretIndex = block.content.findIndex((n) => n.id === caretNode.id)

      const prevNode = block.content[caretIndex - 1]
      const prevNodeId = prevNode ? prevNode.id : null

      return [
        ...deleteIntent.ops,
        ...buildCursorInsertTextOps(
          context,
          deleteIntent.caret,
          block,
          caretNode,
          prevNodeId,
          range,
          input.text,
        ),
      ]
    },
    /** Same block, multiple nodes → range delete (no head/tail) + `insert_text` at anchor. */
    name: 'range/same-block/delete-then-insert-char',
    when: ({ situation }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'same-block',
  },
  {
    /**
     * 💡 Range selection is across multiple blocks.
     * 🎯 Perform surgery with: forward trim → delete middle → backward trim → merge → insert at split.
     */
    build: ({ context, situation, input }): Operation[] | null => {
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

      return [
        ...deleteIntent.ops,
        ...buildCursorInsertTextOps(
          context,
          deleteIntent.caret,
          caretBlock,
          caretNode,
          null,
          range,
          input.text,
        ),
      ]
    },
    /** Cross-blocks → forward trim → delete middle → backward trim → merge → insert at split */
    name: 'range/cross-block/surgery-then-insert-char',
    when: ({ situation }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'cross-block',
  },
]

// --- Builder ───────────────────────────────────────---------------

/** Insert text operations builder. */
export class InsertTextOpsBuilder extends OperationsBuilder<
  InsertTextOpsSituation,
  InsertTextOpsInput,
  unknown
> {
  constructor() {
    super({ name: 'insert-text-ops-builder' })
  }

  /** Describes the {@link InsertTextOpsSituation}. */
  describe(context: EditorContext): InsertTextOpsSituation {
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
          'InsertTextOpsBuilder/#describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'InsertTextOpsBuilder/#describe',
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
        'InsertTextOpsRule/#describeSituation',
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
          'InsertTextOpsBuilder/#describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'InsertTextOpsBuilder/#describe',
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

  /**
   * Builds operations for a single inserted text (or emoji) at the current selection.
   * Returns `null` when there is no active selection or no rules were matched.
   */
  build(
    context: EditorContext,
    input: InsertTextOpsInput,
  ): BuilderOpsIntent | null {
    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    const isCursorKind = kind === 'cursor-selection'
    const rules = isCursorKind ? cursorRules : rangeRules

    /** For inserted text operations, by design we can only match one rule. */
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
        'InsertTextOpsBuilder/#buildInsertTextOps',
      )
      return null
    }

    const build = match.value
    const ops = build({ context, input, resources: null, situation })

    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'InsertTextOpsBuilder/#buildInsertTextOps',
      )
      return null
    }

    return {
      coalesce: true,
      label: `insert-text:${input.text}`,
      ops,
    }
  }
}
