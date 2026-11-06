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
  createTextNode,
  isInlineNodeWithEditableText,
  isLinkNode,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
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
import type { RangeSelection, Selection, TextCursor } from './selection'

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
  InsertTextOpsInput
>

/** Builds operations to insert text at a cursor selection. */
export function buildCursorInsertTextOps(
  at: TextCursor,
  prevSelection: Selection | null,
  text: string,
): Operation[] {
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

/**
 * Replaces a selected run inside a link with a text node.
 * Unselected prefix/suffix stay as link nodes.
 */
export function buildReplaceLinkRangeWithTextOps(
  block: BlockWithInlineContent,
  node: InlineNodeWithEditableText,
  /** Index of `node` in the block. */
  index: number,
  from: number,
  to: number,
  text: string,
  prevSelection: Selection | null,
): Operation[] {
  const before = node.text.slice(0, from)
  const after = node.text.slice(to)

  const insertedText = createTextNode({
    marks: node.marks,
    text,
  })

  const prevNode = block.content[index - 1]
  const prevNodeId = prevNode ? prevNode.id : null

  const ops: Operation[] = []

  if (before.length === 0) {
    if (after.length === 0) {
      ops.push({
        __type: 'remove_inline_node',
        blockId: block.id,
        nodeId: node.id,
        snapshot: node,
      })
    } else {
      ops.push(...buildDeleteTextRunIntent(block.id, node, from, to).ops)
    }

    ops.push({
      __type: 'insert_inline_node',
      afterNodeId: prevNodeId,
      blockId: block.id,
      node: insertedText,
    })
  } else {
    ops.push(
      {
        __type: 'delete_text',
        blockId: block.id,
        length: node.text.length - from,
        nodeId: node.id,
        offset: from,
        snapshot: { text: node.text.slice(from) },
      },
      {
        __type: 'insert_inline_node',
        afterNodeId: node.id,
        blockId: block.id,
        node: insertedText,
      },
    )

    if (after.length > 0) {
      ops.push({
        __type: 'insert_inline_node',
        afterNodeId: insertedText.id,
        blockId: block.id,
        node: createFromInlineWithEditableText(node, {
          marks: node.marks,
          metadata: node.metadata,
          text: after,
        }),
      })
    }
  }

  return withTrailingSelectionOp(
    ops,
    createCursor({
      blockId: block.id,
      nodeId: insertedText.id,
      offset: text.length,
    }),
    prevSelection,
  )
}

/**
 * Inserts typed text next to a remaining link instead of continuing it.
 * After a range delete that started in a link, the caret is at the remaining end
 * (`offset > 0`) or at an emptied link (`offset === 0`).
 */
export function buildInsertTextExitingLinkAtCaretOps(
  block: BlockWithInlineContent,
  caretNode: InlineNodeWithEditableText,
  caret: TextCursor,
  text: string,
  prevSelection: Selection | null,
): Operation[] {
  const insertedText = createTextNode({
    marks: caretNode.marks,
    text,
  })
  const caretIndex = block.content.findIndex((node) => node.id === caretNode.id)
  const prevNode = block.content[caretIndex - 1]

  return withTrailingSelectionOp(
    [
      {
        __type: 'insert_inline_node',
        afterNodeId: caret.offset === 0 ? (prevNode?.id ?? null) : caretNode.id,
        blockId: block.id,
        node: insertedText,
      },
    ],
    createCursor({
      blockId: block.id,
      nodeId: insertedText.id,
      offset: text.length,
    }),
    prevSelection,
  )
}

/** Rules for cursor selection. */
export const cursorRules: InsertTextOpsRule[] = [
  {
    /**
     * 💡 Cursor is at the beginning of a link.
     * 🎯 Insert a new text node before the link instead of continuing the link.
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, index, node } = situation

      const prevNode = block.content[index - 1]
      const insertedText = createTextNode({
        marks: node.marks,
        text: input.text,
      })

      return withTrailingSelectionOp(
        [
          {
            __type: 'insert_inline_node',
            afterNodeId: prevNode ? prevNode.id : null,
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
    name: 'cursor/at-link-start/insert-new-text',
    when: ({ situation }): boolean =>
      situation.kind === 'cursor-selection' &&
      isLinkNode(situation.node) &&
      situation.at.offset === 0 &&
      situation.node.text.length > 0,
  },
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
        marks: node.marks,
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

      const { at } = situation

      return buildCursorInsertTextOps(at, context.selection, input.text)
    },
    name: 'cursor/insert-text',
    when: ({ situation }): boolean => situation.kind === 'cursor-selection',
  },
]

/** Rules for range selection. */
export const rangeRules: InsertTextOpsRule[] = [
  {
    /**
     * 💡 Range selection lies inside a link (partial or full).
     * 🎯 Replace the selected link run with a text node.
     *    Unselected prefix/suffix stay as link nodes.
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'same-node' ||
        !isLinkNode(situation.topology.node)
      ) {
        return null
      }

      const { topology, range } = situation
      const { block, node, index } = topology

      return buildReplaceLinkRangeWithTextOps(
        block,
        node,
        index,
        range.anchor.offset,
        range.focus.offset,
        input.text,
        context.selection,
      )
    },
    name: 'range/same-node/link/replace-with-text',
    when: ({ situation }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'same-node' &&
      isLinkNode(situation.topology.node),
  },
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
      const { block, node } = topology

      const deleteIntent = buildDeleteTextRunIntent(
        block.id,
        node,
        anchor.offset,
        focus.offset,
      )

      return [
        ...deleteIntent.ops,
        ...buildCursorInsertTextOps(
          deleteIntent.caret,
          context.selection,
          input.text,
        ),
      ]
    },
    name: 'range/same-node/delete-then-insert-char',
    when: ({ situation }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'same-node',
  },
  {
    /**
     * 💡 Range starts inside a link and extends into later nodes in the block.
     *    Live selections of a link suffix often include the following text node.
     * 🎯 Delete the range, then insert a text node instead of continuing the link.
     */
    build: ({ situation, input }): Operation[] | null => {
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
        block,
        anchor,
        focus,
        { joinSurvivors: false },
      )
      const caretNode = resolvesCaretNode(block, deleteIntent)

      return [
        ...deleteIntent.ops,
        ...buildInsertTextExitingLinkAtCaretOps(
          block,
          caretNode,
          deleteIntent.caret,
          input.text,
          range,
        ),
      ]
    },
    name: 'range/same-block/link/replace-with-text',
    when: ({ situation }): boolean => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'same-block'
      ) {
        return false
      }

      const found = findNodeInBlockWithInlineContent(
        situation.topology.block,
        situation.range.anchor.nodeId,
      )
      return found !== null && isLinkNode(found.node)
    },
  },
  {
    /**
     * 💡 Range selection is within the same block but with multiple nodes.
     * 🎯 Deleting the selection in-block, and insert replacement char
     * at current anchor position (no survivor join).
     */
    build: ({ situation, input }): Operation[] | null => {
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
        block,
        anchor,
        focus,
        { joinSurvivors: false },
      )
      return [
        ...deleteIntent.ops,
        ...buildCursorInsertTextOps(deleteIntent.caret, range, input.text),
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

      return [
        ...deleteIntent.ops,
        ...buildCursorInsertTextOps(deleteIntent.caret, range, input.text),
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
  InsertTextOpsInput
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
