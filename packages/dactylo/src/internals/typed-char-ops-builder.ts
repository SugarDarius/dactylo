import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockId, BlockWithInlineContent } from './blocks'
import { warn } from './console'
import { INLINE_DETECTOR_TRIGGER_CHARACTER } from './constants'
import {
  compareTextCursors,
  getBlockWithInlineContent,
  normalizeRange,
} from './document'
import type { EditorContext } from './editor-context'
import { isMarksEqual } from './marks'
import type { Marks } from './marks'
import {
  coalesceInlineNodes,
  createTextNode,
  isInlineNodeWithEditableText,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { DeleteTextOp, MergeBlocksOp, Operation } from './operations'
import type {
  ComposingOpsIntent,
  OperationBuilderInlineCommandTriggerConfig,
  OperationBuilderMentionsConfig,
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
  resolvesMergeBlocksUndoFields,
} from './operations-builder'
import {
  createCursor,
  getRangeSelectionTopology,
  isCursorSelection,
} from './selection'
import type { Selection, RangeSelection, TextCursor } from './selection'

/** Situation of a typed char operation when there is no selection. */
export interface TypedCharOpNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation of a typed char operation when there is a cursor selection. */
export interface TypedCharOpCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** The cursor at which the typing operation is applied. */
  readonly at: TextCursor

  /** Block with inline content subject to the operation.  */
  readonly block: BlockWithInlineContent

  /** Inline node with editable text subject to the operation. */
  readonly node: InlineNodeWithEditableText

  /** Index of the inline node with editable text in the block. */
  readonly index: number
}

/** Situation of a typed char operation when there is a range selection. */
export interface TypedCharOpRangeSelectionSituation {
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

/** Situation of a typed char operation. */
export type TypedCharOpSituation =
  | TypedCharOpNoSelectionSituation
  | TypedCharOpCursorSelectionSituation
  | TypedCharOpRangeSelectionSituation

/** Input given to a typed char operation. */
export interface TypedCharOpInput {
  /** The character to insert. */
  readonly char: string
}

/** Typed char operation rule. */
export type TypedCharOpRule = OperationRule<
  TypedCharOpSituation,
  TypedCharOpInput
>

/**
 * Builds operations to type one character when `activeMarks` ≠ target node marks.
 *
 * Produces `[before?][typedChar][after?]` as separate inline nodes using:
 * - `delete_text` to trim the tail off the original node when needed
 * - `insert_inline_node` for the typed character (known `insertNode.id`)
 * - `insert_inline_node` for the trailing segment when needed
 *
 * Does not emit `insert_text` on the original node for the new character.
 */
export function buildInsertTypedCharWithMarkBoundaryOps(
  activeMarks: Marks,
  cursor: TextCursor,
  char: string,
  /** Target node at the caret (text or link). */
  node: InlineNodeWithEditableText,
  /** Index of `node` in `block.content`. */
  nodeIndex: number,
  blockId: BlockId,
  /** Previous selection for undo inversion. */
  prevSelection: Selection | null,
): Operation[] {
  const before = node.text.slice(0, cursor.offset)
  const after = node.text.slice(cursor.offset)

  const insertNode = createTextNode({
    marks: activeMarks,
    metadata: node.metadata,
    text: char,
  })

  const ops: Operation[] = []

  /** Trim tail so the surviving node is only `before`. */
  if (after.length > 0) {
    ops.push({
      __type: 'delete_text',
      blockId,
      length: after.length,
      nodeId: node.id,
      offset: cursor.offset,
      snapshot: { marks: node.marks, text: after },
    })
  }

  /**
   * Insert position for the typed node:
   * - caret in the middle/end of a non-empty prefix → after the trimmed node
   * - caret at start (empty prefix) → before the original node
   */
  const typedInsertIndex = before.length > 0 ? nodeIndex + 1 : nodeIndex

  ops.push({
    __type: 'insert_inline_node',
    blockId,
    index: typedInsertIndex,
    node: insertNode,
  })

  if (after.length > 0) {
    ops.push({
      __type: 'insert_inline_node',
      blockId,
      index: typedInsertIndex + 1,
      node: createTextNode({
        marks: node.marks,
        metadata: node.metadata,
        text: after,
      }),
    })
  }

  ops.push({
    __type: 'set_selection',
    next: createCursor({
      blockId,
      nodeId: insertNode.id,
      offset: char.length,
    }),
    prev: prevSelection,
  })

  return ops
}

/** Rules for cursor selection. */
export const cursorRules: TypedCharOpRule[] = [
  {
    build: (
      context: EditorContext,
      situation: TypedCharOpSituation,
      input: TypedCharOpInput,
    ): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node } = situation

      const ops: Operation[] = [
        {
          __type: 'insert_text',
          blockId: block.id,
          marks: context.activeMarks,
          nodeId: node.id,
          offset: at.offset,
          text: input.char,
        },
        {
          __type: 'set_selection',
          next: createCursor({
            blockId: block.id,
            nodeId: node.id,
            offset: at.offset + input.char.length,
          }),
          prev: context.selection,
        },
      ]

      return ops
    },
    name: 'cursor/match-active-marks/insert-char',
    when: (
      context: EditorContext,
      situation: TypedCharOpSituation,
    ): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { node } = situation

      return isMarksEqual(node.marks, context.activeMarks)
    },
  },
  {
    build: (
      context: EditorContext,
      situation: TypedCharOpSituation,
      input: TypedCharOpInput,
    ): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node, index } = situation

      return buildInsertTypedCharWithMarkBoundaryOps(
        context.activeMarks,
        at,
        input.char,
        node,
        index,
        block.id,
        context.selection,
      )
    },
    name: 'cursor/mark-boundary/structural-insert-char',
    when: (
      context: EditorContext,
      situation: TypedCharOpSituation,
    ): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { node } = situation

      return !isMarksEqual(node.marks, context.activeMarks)
    },
  },
]

/**
 * Resolves the editable inline node where a typed character will be inserted
 * after replaying `prefixOps` on the block (same transaction, earlier ops).
 */
export function resolveTypedCharInsertTarget(
  block: BlockWithInlineContent,
  /** Delete/merge ops that run before insert in the same batch. */
  prefixOps: readonly Operation[],
  /** Insert caret (anchor after range delete, or merge split point). */
  at: TextCursor,
): { node: InlineNodeWithEditableText; index: number } {
  const previewContent = previewInlineContentAfterTrimOps(
    block.content,
    [...prefixOps],
    block.id,
  )

  const previewBlock: BlockWithInlineContent = {
    ...block,
    content: previewContent,
  }

  const found = findNodeInBlockWithInlineContent(previewBlock, at.nodeId)
  if (!found || !isInlineNodeWithEditableText(found.node)) {
    buildError(
      `Node ${at.nodeId} not found in block ${block.id} after prefix ops`,
      'TypedCharOpsBuilder/#resolveTypedCharInsertTarget',
    )
  }

  if (at.offset < 0 || at.offset > found.node.text.length) {
    buildError(
      `Insert offset ${at.offset} out of bounds for text length ${found.node.text.length}`,
      'TypedCharOpsBuilder/#resolveTypedCharInsertTarget',
    )
  }

  return { index: found.index, node: found.node }
}

/**
 * Builds insert + selection ops after a range was (or will be) deleted in the same batch.
 *
 * Same marks as `context.activeMarks`: `insert_text` + collapsed `set_selection`.
 * Different marks: structural boundary ops via  {@link #buildInsertTypedCharWithMarkBoundaryOps} (no split in `applyInsertTextOp`).
 */
export function buildInsertTypeCharAndSelectionAtRangeOps(
  context: EditorContext,
  range: RangeSelection,
  char: string,
  at: TextCursor,
  opts: {
    /**
     * Ops already queued for this block before insert (e.g. range `delete_text`).
     * Required so the target node's text/index match validate/apply order.
     */
    prefixOps?: readonly Operation[]
    /**
     * When the live document does not yet contain the target tree
     * cross-block merge preview), resolve the node from this block instead of `state`.
     */
    blockSnapshot?: BlockWithInlineContent
  } = {},
): Operation[] {
  const { prefixOps = [], blockSnapshot } = opts
  const block =
    blockSnapshot ?? getBlockWithInlineContent(context.state, at.blockId)

  const { node, index } = resolveTypedCharInsertTarget(block, prefixOps, at)

  if (isMarksEqual(node.marks, context.activeMarks)) {
    const ops: Operation[] = [
      {
        __type: 'insert_text',
        blockId: at.blockId,
        marks: context.activeMarks,
        nodeId: at.nodeId,
        offset: at.offset,
        text: char,
      },
      {
        __type: 'set_selection',
        next: createCursor({
          blockId: at.blockId,
          nodeId: at.nodeId,
          offset: at.offset + char.length,
        }),
        prev: range,
      },
    ]

    return ops
  }

  return buildInsertTypedCharWithMarkBoundaryOps(
    context.activeMarks,
    at,
    char,
    node,
    index,
    block.id,
    range,
  )
}

/** Rules for range selection. */
export const rangeRules: TypedCharOpRule[] = [
  {
    /**
     * 💡 Range selection is within the same node.
     * 🎯 Deleting the selection in-node, and insert replacement char
     * at current anchor position (no survivor join).
     */
    build: (
      context: EditorContext,
      situation: TypedCharOpSituation,
      input: TypedCharOpInput,
    ): Operation[] | null => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'same-node'
      ) {
        return null
      }

      const { topology, range } = situation
      const { anchor, focus } = range
      const { block, node } = topology

      const deleteOffset = anchor.offset
      const deleteLength = focus.offset - anchor.offset

      if (deleteLength <= 0) {
        rangeCollapsedError(
          'Range selection is collapsed; expected non-empty text range.',
          'TypedCharOpsBuilder/#build',
        )
      }

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

      const ops: Operation[] = [
        deleteTextOp,
        ...buildInsertTypeCharAndSelectionAtRangeOps(
          context,
          range,
          input.char,
          {
            blockId: block.id,
            nodeId: node.id,
            offset: deleteOffset,
          },
          {
            prefixOps: [deleteTextOp],
          },
        ),
      ]

      return ops
    },
    /** Same node text/link → `delete_text` + `insert_text` + `set_selection` */
    name: 'range/same-node/delete-then-insert-char',
    when: (_context: EditorContext, situation: TypedCharOpSituation): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'same-node',
  },
  {
    /**
     * 💡 Range selection is within the same block but with multiple nodes.
     * 🎯 Deleting the selection in-block, and insert replacement char
     * at current anchor position (no survivor join).
     */
    build: (
      context: EditorContext,
      situation: TypedCharOpSituation,
      input: TypedCharOpInput,
    ): Operation[] | null => {
      if (
        situation.kind !== 'range-selection' ||
        situation.topology.kind !== 'same-block'
      ) {
        return null
      }

      const { topology, range } = situation
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

      const ops: Operation[] = [
        ...deleteOps,
        ...buildInsertTypeCharAndSelectionAtRangeOps(
          context,
          range,
          input.char,
          anchor,
          {
            prefixOps: deleteOps,
          },
        ),
      ]

      return ops
    },
    /** Same block, multiple nodes → range delete (no head/tail) + `insert_text` at anchor. */
    name: 'range/same-block/delete-then-insert-char',
    when: (_context: EditorContext, situation: TypedCharOpSituation): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'same-block',
  },
  {
    /**
     * 💡 Range selection is across multiple blocks.
     * 🎯 Perform surgery with: forward trim → delete middle → backward trim → merge → insert at split.
     */
    build: (
      context: EditorContext,
      situation: TypedCharOpSituation,
      input: TypedCharOpInput,
    ): Operation[] | null => {
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

      ops.push(
        mergeBlockOp,
        ...buildInsertTypeCharAndSelectionAtRangeOps(
          context,
          range,
          input.char,
          {
            blockId: startBlock.id,
            nodeId: splitAtNodeId,
            offset: splitAtOffset,
          },
          {
            blockSnapshot: mergedBlockSnapshot,
            prefixOps: [mergeBlockOp],
          },
        ),
      )

      return ops
    },
    /** Cross-blocks → forward trim → delete middle → backward trim → merge → insert at split */
    name: 'range/cross-block/surgery-then-insert-char',
    when: (_context: EditorContext, situation: TypedCharOpSituation): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'cross-block',
  },
]

// --- Builder ───────────────────────────────────────---------------

/** Options for constructing a typing operations builder. */
export interface TypedCharOpsBuilderOptions {
  /** Configuration for mentions. */
  readonly mentions: {
    /** Whether to enable mentions. */
    readonly enabled: boolean

    /** The character to trigger a mention. */
    readonly character: string
  }

  /** Configuration for inline command trigger. */
  readonly inlineCommandTrigger: {
    /** Whether to enable inline command trigger. */
    readonly enabled: boolean

    /** The character to trigger an inline command. */
    readonly character: string
  }
}

/** Typed char operations builder. */
export class TypedCharOpsBuilder implements OperationsBuilder<
  TypedCharOpSituation,
  TypedCharOpInput,
  ComposingOpsIntent
> {
  /** Configuration for mentions. */
  readonly #mentionsConfig: OperationBuilderMentionsConfig

  /** Configuration for inline command trigger. */
  readonly #inlineCommandTriggerConfig: OperationBuilderInlineCommandTriggerConfig

  constructor(options: TypedCharOpsBuilderOptions) {
    this.#mentionsConfig = options.mentions
    this.#inlineCommandTriggerConfig = options.inlineCommandTrigger
  }

  /** Describes the {@link TypedCharOpSituation}. */
  describe(context: EditorContext): TypedCharOpSituation {
    const { selection, state } = context

    if (selection === null) {
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
          'TypedCharOpsBuilder/#describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'TypedCharOpsBuilder/#describe',
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
        'TypedCharOpRule/#describeSituation',
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
          'TypedCharOpsBuilder/#describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'TypedCharOpsBuilder/#describe',
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

  /**
   * Completes intent for a single typed character (or emoji) at the current selection.
   * Determines behaviors when:
   *  - {@link INLINE_DETECTOR_TRIGGER_CHARACTER} is typed:
   *   - → manage markdown shortcuts
   *   - → manage autolink detection
   *  - `mention_character` is typed → manage inline composition for mentions
   *  - `slash_command_character` is typed → manage inline composition for slash commands
   *  -  others chars are typed → insert the char and continue typing
   */
  #complete(
    ops: Operation[],
    char: string,
    type: 'cursor' | 'range',
  ): ComposingOpsIntent {
    const label =
      type === 'cursor' ? 'insert-char-at-cursor' : 'insert-char-at-range'

    // @todo: handle markdown shortcut
    // @todo: handle autolink detection
    // @todo: handle links finished
    if (char === INLINE_DETECTOR_TRIGGER_CHARACTER) {
      return {
        label: `markdown-shortcut`,
        ops,
        skipHistory: true,
      }
    }

    // @todo: handle mentions
    /** Apply inline composition ops for mentions. */
    if (
      this.#mentionsConfig.enabled &&
      char === this.#mentionsConfig.character
    ) {
      return { label: 'mention', ops, skipHistory: true }
    }

    // @todo: handle inline command trigger
    /** Apply inline composition ops for inline command trigger. */
    if (
      this.#inlineCommandTriggerConfig.enabled &&
      char === this.#inlineCommandTriggerConfig.character
    ) {
      return { label: 'inline-command-trigger', ops, skipHistory: true }
    }

    return {
      coalesce: true,
      label: `${label}:${char}`,
      ops,
    }
  }

  /**
   * Builds operations for a single typed character (or emoji) at the current selection.
   * Returns `null` when there is no active selection or no rules were matched.
   */
  build(
    context: EditorContext,
    input: TypedCharOpInput,
  ): ComposingOpsIntent | null {
    const { char } = input

    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    const rules = kind === 'cursor-selection' ? cursorRules : rangeRules

    /** For typed char operations, by design we can only match one rule. */
    const match = iterRules(rules, context, situation).next()
    if (match.done) {
      warn(
        'No rule applied for the given situation and input.',
        'TypedCharOpsBuilder/#buildTypedCharOps',
      )
      return null
    }

    const build = match.value
    const ops = build(context, situation, { char })

    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'TypedCharOpsBuilder/#buildTypedCharOps',
      )
      return null
    }

    return this.#complete(
      ops,
      char,
      kind === 'cursor-selection' ? 'cursor' : 'range',
    )
  }
}
