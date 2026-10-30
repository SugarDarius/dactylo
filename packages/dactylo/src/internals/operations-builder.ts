import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockId, BlockWithInlineContent, HeadingBlock } from './blocks'
import { getBlock } from './document'
import type { EditorContext } from './editor-context'
import { DactyloError } from './errors'
import { isMarksEqual } from './marks'
import type { Marks } from './marks'
import {
  coalesceInlineNodes,
  createLinkNode,
  createTextNode,
  isCanonicalEmptyInlineContent,
  isInlineContentTextEmpty,
  isInlineNodeWithEditableText,
} from './nodes'
import type {
  InlineNode,
  InlineNodeWithEditableText,
  NodeId,
  TextNode,
} from './nodes'
import type { Operation } from './operations'
import { createCursor } from './selection'
import type { TextCursor, RangeSelection } from './selection'
import type { Metadata, Relax } from './types'
import { assertNever } from './utils'

// --- Errors -───────────────────────────────────────---------------

/** Throws a build error {@link DactyloError} when something goes wrong while building operations. */
export function buildError(message: string, hint: string): never {
  throw DactyloError.from({
    code: 'BUILD_TRANSACTION_OPERATIONS',
    hint,
    message,
  })
}

/** Throws a range selection collapsed error {@link DactyloError} when the range selection is collapsed. */
export function rangeCollapsedError(message: string, hint: string): never {
  throw DactyloError.from({
    code: 'RANGE_SELECTION_COLLAPSED',
    hint,
    message,
  })
}

// --- Interfaces -───────────────────────────────────---------------

/** Intent when building ops to send to {@link TransactionPipeline}. */
export interface BuilderOpsIntent {
  /** The operations to apply. */
  readonly ops: Operation[]

  /** The kind for the intent. */
  readonly label: string

  /** When `true` merge history action for rapid typing coalescing. */
  readonly coalesce?: true

  /** When `true` history is skipped. */
  readonly skipHistory?: true
}

/** Describes where a new block should be inserted relative to existing blocks. */
export type InsertBlockPosition = Relax<
  | {
      /** Insert at document start. */
      readonly type: 'start'
    }
  | {
      /** Insert at document end. */
      readonly type: 'end'
    }
  | {
      /** Insert immediately after an existing block. */
      readonly type: 'after'
      readonly blockId: BlockId
    }
  | {
      /** Insert immediately before an existing block. */
      readonly type: 'before'
      readonly blockId: BlockId
    }
>

/** Describes which block to create when inserting at a document position. */
export type InsertBlockSpec = Relax<
  | {
      readonly type: 'paragraph'

      /** Metadata to attach to the block. */
      readonly metadata?: Metadata
    }
  | {
      readonly type: 'heading'

      /** Level of the heading. */
      readonly level: HeadingBlock['level']

      /** Metadata to attach to the block. */
      readonly metadata?: Metadata
    }
  | {
      readonly type: 'divider'

      /** Metadata to attach to the block. */
      readonly metadata?: Metadata
    }
>

/** Configuration for autolink detection. */
export interface OperationsBuilderAutolinkConfig {
  /** Whether to enable autolink detection. */
  readonly enabled: boolean
}

// --- Core -─────────────────────────────────────────---------------

/** Rule describing a list of operations to apply to the document. */
export interface OperationRule<S, I, R> {
  /** Name given to the operation rule. */
  readonly name: string

  /**
   * Determines whether the operation rule should be applied
   * based on the {@link EditorContext}, and given situation.
   */
  readonly when: (params: {
    context: EditorContext
    situation: S
    input: I
    resources: R
  }) => boolean

  /**
   * Builds a list of operation to apply to the document
   * based on the {@link EditorContext}, given situation, and input.
   */
  readonly build: (params: {
    context: EditorContext
    situation: S
    input: I
    resources: R
  }) => Operation[] | null
}

/**
 * Iterates over the rules that should be applied to the given situation and input..
 * @yields {(params: { context: EditorContext, situation: S, input: I}) => Operation[] | null} The build function for the rule.
 */
export function* iterRules<S, I, R>(params: {
  rules: OperationRule<S, I, R>[]
  context: EditorContext
  situation: S
  input: I
  resources: R
}): Generator<
  (params: {
    context: EditorContext
    situation: S
    input: I
    resources: R
  }) => Operation[] | null
> {
  const { rules, ...rest } = params
  for (const rule of rules) {
    if (rule.when({ ...rest })) {
      yield rule.build
    }
  }
}

/** Shared interface to implement by operation builders. */
export interface OperationsBuilder<S, I> {
  /**
   * Describes the situation of the operation builder.
   * based on the given {@link EditorContext}.
   */
  readonly describe: (context: EditorContext, input: I) => S

  /**
   * Builds the output for the {@link EditorContext} and given input.
   * Returns `null` when no output should be produced.
   */
  readonly build: (context: EditorContext, input: I) => BuilderOpsIntent | null
}

// --- Builders & Helpers ─────────────────────────────---------------

/**
 * Previews in-memory the inline content of a block
 * after a list of trim operations without applying them into the document.
 *
 * Purpose:
 * After delete or replace a cross-block range selection the engine does:
 *  1. Trims the start block from the anchor forward (e.g `buildForwardTrimBlockOps`)
 *  2. Deletes blocks in the middle.
 *  3. Trims end block from the focus backward (e.g `buildBackwardTrimBlockOps`)
 *  4. Emits a `merge_blocks` operation that joins the trimmed end into the trimmed start.
 *
 * Several fields on that `merge_blocks` op must match the document at the moment this op
 * is validated/applied; after the trim ops in the same transaction have already run.
 * The build still works from the original block snapshots, so it uses this helper
 * to replay only the relevant inline ops.
 *
 * Why coalescing matters?
 * Forward trim can leave adjacent text nodes with the same marks; real apply merges them.
 * If the preview skipped coalescing, `validateMergeBlocksOp` could disagree with the state
 * seen when `merge_blocks` runs.
 *
 * Baseline: "what will this block’s inline tree be after these trim ops?"
 * So the engine can build a correct `merge_blocks` op (merge index, undo snapshots, split point, …)
 * before anything is dispatched to the document.
 */
export function previewInlineContentAfterTrimOps(
  content: readonly InlineNode[],
  ops: Operation[],
  blockId: BlockId,
): InlineNode[] {
  let next = [...content]

  for (const op of ops) {
    if (op.blockId !== blockId) {
      continue
    }

    if (op.__type === 'delete_text') {
      const idx = next.findIndex((n) => n.id === op.nodeId)
      if (idx === -1) {
        continue
      }

      const node = next[idx]
      if (!node || !isInlineNodeWithEditableText(node)) {
        continue
      }

      const before = node.text.slice(0, op.offset)
      const after = node.text.slice(op.offset + op.length)

      next[idx] = {
        ...node,
        text: before + after,
        updatedAt: new Date(),
      }
    } else if (op.__type === 'insert_text') {
      const idx = next.findIndex((n) => n.id === op.nodeId)
      if (idx === -1) {
        continue
      }

      const node = next[idx]
      if (!node || !isInlineNodeWithEditableText(node)) {
        continue
      }

      const before = node.text.slice(0, op.offset)
      const after = node.text.slice(op.offset)

      next[idx] = {
        ...node,
        text: before + op.text + after,
        updatedAt: new Date(),
      }
    } else if (op.__type === 'remove_inline_node') {
      next.splice(op.index, 1)
    } else if (op.__type === 'insert_inline_node') {
      next.splice(op.index, 0, op.node)
    }

    next = coalesceInlineNodes(next)
  }

  return next
}

/**
 * Resolves undo fields when merging two blocks for a {@link MergeBlocksOp}.
 * After a merge, the previous block’s content and the current block’s content
 * live in one block, often in one coalesced text node.
 *
 * Undo must cut the document exactly at the old block boundary—as if
 * `Enter` had been pressed there before the merge—not at an arbitrary position
 *
 * Branch-by-branch logic:
 *  1. Target has no inline content (last node is missing)
 *   1.2 Both blocks have no inline content
 *  2. Target’s last inline node is text (usual case)
 *  3. Target’s last inline node is not text (line break, link, mentions, ...)
 *
 * Mental model (`Backspace merge`):
 * ```
 * Before:
 *    Target:  [ ... , T_last(text:"abc") ]
 *    Source:  [ S_first(text:"def"), ... ]
 *
 * merge_blocks (atIndex = end of target)
 *
 * After:
 *    Target:  [ ... , coalesced "abcdef"? , ... ]
 *
 * Undo `split_block` at (T_last.id, 3)
 *    Head block keeps "abc"
 *    New/restored source block gets "def" + rest
 * ```
 *
 */
export function resolvesMergeBlocksUndoFields(
  source: BlockWithInlineContent,
  target: BlockWithInlineContent,
  marks: Marks,
): { splitAtNodeId: NodeId; splitAtOffset: number } {
  const last = target.content[target.content.length - 1]
  if (!last) {
    const [first] = source.content
    /**
     * Degenerate case (two empty paragraphs). There is no real join point in the document.
     * The helper still returns some id/offset pair so MergeBlocksOp can be constructed;
     * in practice merges like this are rare, and undo leans on sourceSnapshot / mergedTailSnapshot /
     * atIndex as well.
     * The fallback id is not in the document until something else creates it—treat this as a
     * spec placeholder for an edge case, not a happy-path path.
     */
    if (!first) {
      const fallback = createTextNode({ marks, text: '' })
      return { splitAtNodeId: fallback.id, splitAtOffset: 0 }
    }

    return { splitAtNodeId: first.id, splitAtOffset: 0 }
  }

  if (isInlineNodeWithEditableText(last)) {
    return { splitAtNodeId: last.id, splitAtOffset: last.text.length }
  }

  return { splitAtNodeId: last.id, splitAtOffset: 0 }
}

/**
 * Resolves the editable inline node where a text will be inserted
 * after replaying `prefixOps` on the block (same transaction, earlier ops).
 */
export function resolveTextInsertTarget(
  block: BlockWithInlineContent,
  /** Delete/merge ops that run before insert in the same batch. */
  prefixOps: Operation[],
  /** Insert caret (anchor after range delete, or merge split point). */
  at: TextCursor,
): { node: InlineNodeWithEditableText; index: number } {
  const previewContent = previewInlineContentAfterTrimOps(
    block.content,
    prefixOps,
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
      'OperationBuilder/resolveTextInsertTarget',
    )
  }

  if (at.offset < 0 || at.offset > found.node.text.length) {
    buildError(
      `Insert offset ${at.offset} out of bounds for text length ${found.node.text.length}`,
      'OperationBuilder/resolveTextInsertTarget',
    )
  }

  return { index: found.index, node: found.node }
}

/**
 * Collapsed caret where typing / soft-break should run after range-delete prefix ops.
 *
 * - Anchor node still in preview → clamp offset to surviving text length.
 * - Block collapsed to placeholder → caret on last `insert_inline_node` for this block.
 * - Otherwise → first editable inline node in preview.
 */
export function resolveRangeInsertCaretAfterPrefixOps(
  block: BlockWithInlineContent,
  anchor: TextCursor,
  prefixOps: Operation[],
): TextCursor {
  const preview = previewInlineContentAfterTrimOps(
    block.content,
    prefixOps,
    block.id,
  )

  const previewBlock: BlockWithInlineContent = {
    ...block,
    content: preview,
  }

  const atAnchor = findNodeInBlockWithInlineContent(previewBlock, anchor.nodeId)

  if (atAnchor && isInlineNodeWithEditableText(atAnchor.node)) {
    const offset = Math.min(
      Math.max(anchor.offset, 0),
      atAnchor.node.text.length,
    )

    return {
      blockId: block.id,
      nodeId: anchor.nodeId,
      offset,
    }
  }

  for (let i = prefixOps.length - 1; i >= 0; i -= 1) {
    const op = prefixOps[i]
    if (
      op &&
      op.__type === 'insert_inline_node' &&
      op.blockId === block.id &&
      isInlineNodeWithEditableText(op.node)
    ) {
      return {
        blockId: block.id,
        nodeId: op.node.id,
        offset: 0,
      }
    }
  }

  for (const node of preview) {
    if (isInlineNodeWithEditableText(node)) {
      return {
        blockId: block.id,
        nodeId: node.id,
        offset: 0,
      }
    }
  }

  buildError(
    `No insert caret in block ${block.id} after prefix ops`,
    'OperationBuilder/resolveRangeInsertCaretAfterPrefixOps',
  )
}

/**
 * Deletes `[from.offset, to.offset)` inside one editable text node.
 * Fast path for range backspace when anchor/focus share the same node.
 */
export function buildDeleteTextRunOps(
  blockId: BlockId,
  node: InlineNodeWithEditableText,
  from: number,
  to: number,
  range: RangeSelection,
): Operation[] {
  const length = to - from
  if (length <= 0) {
    rangeCollapsedError(
      'Range selection is collapsed; expected non-empty text range.',
      'OperationBuilder/#buildDeleteTextRunOps',
    )
  }

  return [
    {
      __type: 'delete_text',
      blockId,
      length,
      nodeId: node.id,
      offset: from,
      snapshot: {
        marks: node.marks,
        text: node.text.slice(from, to),
      },
    },
    {
      __type: 'set_selection',
      next: createCursor({ blockId, nodeId: node.id, offset: from }),
      prev: range,
    },
  ]
}

/**
 * When a block has no visible text ({@link isInlineContentTextEmpty}) but still
 * holds non-canonical inline structure (e.g. a lone empty {@link LinkNode}),
 * strip all inline nodes and insert one empty {@link TextNode} with `activeMarks`.
 *
 * Undo restores removed nodes via `remove_inline_node` snapshots.
 *
 * Returns pps plus the new placeholder node id for selection rewrite, or `null`
 * if the block is not text-empty or is already canonically empty text.
 */
export function buildCollapseEmptyBlockToActiveMarksOps(
  blockId: BlockId,
  contentAfterPriorOps: readonly InlineNode[],
  activeMarks: Marks,
): { ops: Operation[]; placeholder: TextNode } | null {
  if (!isInlineContentTextEmpty(contentAfterPriorOps)) {
    return null
  }

  if (isCanonicalEmptyInlineContent(contentAfterPriorOps, activeMarks)) {
    return null
  }

  const placeholder = createTextNode({ marks: activeMarks, text: '' })
  const ops: Operation[] = []

  for (let i = contentAfterPriorOps.length - 1; i >= 0; i -= 1) {
    const snapshot = contentAfterPriorOps[i]
    if (!snapshot) {
      continue
    }

    ops.push({
      __type: 'remove_inline_node',
      blockId,
      index: i,
      snapshot,
    })
  }

  ops.push({
    __type: 'insert_inline_node',
    blockId,
    index: 0,
    node: placeholder,
  })

  return { ops, placeholder }
}

/**
 * Previews inline content after applying `priorOps`, then appends
 * {@link buildCollapseEmptyBlockToActiveMarksOps} when the block would be
 * text-empty but not canonically empty (e.g. empty link shell).
 *
 * When collapse runs, any trailing `set_selection` in `priorOps` is dropped and
 * replaced with a caret on the new placeholder text node (undo `prev` = `selectionBefore`).
 */
export function buildMergeCollapseEmptyBlockIntoOps(
  context: EditorContext,
  blockId: BlockId,
  contentBefore: readonly InlineNode[],
  priorOps: Operation[],
): Operation[] {
  const preview = previewInlineContentAfterTrimOps(
    contentBefore,
    priorOps,
    blockId,
  )

  const collapsed = buildCollapseEmptyBlockToActiveMarksOps(
    blockId,
    preview,
    context.activeMarks,
  )

  if (!collapsed) {
    return priorOps
  }

  const withoutSelection = priorOps.filter(
    (op) => op.__type !== 'set_selection',
  ) as Operation[]

  const ops: Operation[] = [
    ...withoutSelection,
    ...collapsed.ops,
    {
      __type: 'set_selection',
      next: createCursor({
        blockId,
        nodeId: collapsed.placeholder.id,
        offset: 0,
      }),
      prev: context.selection,
    },
  ]

  return ops
}

/** Builds operations to rewrite the selection of a collapsed empty block. */
export function buildRewriteCollapsedEmptyBlockSelectionOps(
  incomingOps: Operation[],
  blockId: BlockId,
  placeholderId: NodeId,
  range: RangeSelection,
): Operation[] {
  const ops: Operation[] = incomingOps.filter(
    (op) => op.__type !== 'set_selection',
  )

  ops.push({
    __type: 'set_selection',
    next: createCursor({ blockId, nodeId: placeholderId, offset: 0 }),
    prev: range,
  })

  return ops
}

/**
 * Removes inline nodes in `[firstIndex, lastIndex]` (inclusive).
 * Emits `remove_inline_node` from highest index → lowest so indices stay valid.
 */
export function buildRemoveInlineNodeRangeOps(
  blockId: BlockId,
  content: readonly InlineNode[],
  firstIndex: number,
  lastIndex: number,
): Operation[] {
  const ops: Operation[] = []

  for (let i = lastIndex; i >= firstIndex; i -= 1) {
    const snapshot = content[i]

    if (!snapshot) {
      continue
    }

    ops.push({
      __type: 'remove_inline_node',
      blockId,
      index: i,
      snapshot,
    })
  }

  return ops
}

/**
 * Builds operations for a range delete within a single block (possibly multiple inline nodes).
 * Joins surviving head/tail text when marks match.
 */
export function buildDeleteRangeWithinBlockOps(
  context: EditorContext,
  block: BlockWithInlineContent,
  anchor: TextCursor,
  focus: TextCursor,
  range: RangeSelection,
  opts: {
    /** Whether to join survivors. */
    joinSurvivors?: boolean
    /** Whether to set the selection. */
    setSelection?: boolean
  } = {},
): Operation[] {
  const { joinSurvivors = true, setSelection = true } = opts

  const anchorFound = findNodeInBlockWithInlineContent(block, anchor.nodeId)
  const focusFound = findNodeInBlockWithInlineContent(block, focus.nodeId)

  if (!anchorFound || !focusFound) {
    buildError(
      'Anchor or focus node missing in block',
      'OperationBuilder/#buildDeleteRangeWithinBlockOps',
    )
  }

  const { index: aNi, node: aNode } = anchorFound
  const { index: fNi, node: fNode } = focusFound

  /** Same text node → single `delete_text`. */
  if (aNi === fNi && isInlineNodeWithEditableText(aNode)) {
    let ops = buildDeleteTextRunOps(
      block.id,
      aNode,
      anchor.offset,
      focus.offset,
      range,
    )

    if (!setSelection) {
      return ops.filter((op) => op.__type !== 'set_selection') as Operation[]
    }

    const preview = previewInlineContentAfterTrimOps(
      block.content,
      ops,
      block.id,
    )

    const collapsed = buildCollapseEmptyBlockToActiveMarksOps(
      block.id,
      preview,
      context.activeMarks,
    )

    if (collapsed) {
      ops = ops.filter((op) => op.__type !== 'set_selection') as Operation[]
      ops.push(...collapsed.ops)

      /** Rewrite the selection to the collapsed placeholder. */
      const rewritten = buildRewriteCollapsedEmptyBlockSelectionOps(
        ops,
        block.id,
        collapsed.placeholder.id,
        range,
      )

      return rewritten
    }

    return ops
  }

  const ops: Operation[] = []

  /**
   * Head of last node first.
   * Must run before removing nodes between anchor/focus: otherwise
   * `updateBlockWithInlineContent` may coalesce adjacent text nodes and
   * drop the focus node id before this delete_text is validated/applied.
   */
  if (fNi !== aNi && isInlineNodeWithEditableText(fNode) && focus.offset > 0) {
    ops.push({
      __type: 'delete_text',
      blockId: block.id,
      length: focus.offset,
      nodeId: fNode.id,
      offset: 0,
      snapshot: {
        marks: fNode.marks,
        text: fNode.text.slice(0, focus.offset),
      },
    })
  }

  /** Tail of first node. */
  if (isInlineNodeWithEditableText(aNode)) {
    const tailLen = aNode.text.length - anchor.offset
    if (tailLen > 0) {
      ops.push({
        __type: 'delete_text',
        blockId: block.id,
        length: tailLen,
        nodeId: aNode.id,
        offset: anchor.offset,
        snapshot: {
          marks: aNode.marks,
          text: aNode.text.slice(anchor.offset),
        },
      })
    }
  } else if (aNode && anchor.offset === 0) {
    ops.push({
      __type: 'remove_inline_node',
      blockId: block.id,
      index: aNi,
      snapshot: aNode,
    })
  }

  /** Fully selected nodes between anchor and focus. */
  const betweenFirst = aNi + 1
  const betweenLast = fNi - 1

  if (betweenFirst <= betweenLast) {
    const inlines = buildRemoveInlineNodeRangeOps(
      block.id,
      block.content,
      betweenFirst,
      betweenLast,
    )
    ops.push(...inlines)
  }

  /** Join head + tail text when both ends are text with equal marks. */
  if (
    joinSurvivors &&
    isInlineNodeWithEditableText(aNode) &&
    isInlineNodeWithEditableText(fNode) &&
    aNi !== fNi &&
    isMarksEqual(aNode.marks, fNode.marks)
  ) {
    const headText = aNode.text.slice(0, anchor.offset)
    const tailText = fNode.text.slice(focus.offset)

    if (tailText.length > 0 && headText.length >= 0) {
      ops.push({
        __type: 'insert_text',
        blockId: block.id,
        marks: aNode.marks,
        nodeId: aNode.id,
        offset: anchor.offset,
        text: tailText,
      })
      if (focus.offset < fNode.text.length) {
        ops.push({
          __type: 'remove_inline_node',
          blockId: block.id,
          index: fNi,
          snapshot: fNode,
        })
      }
    }
  }

  const preview = previewInlineContentAfterTrimOps(block.content, ops, block.id)

  const collapsed = buildCollapseEmptyBlockToActiveMarksOps(
    block.id,
    preview,
    context.activeMarks,
  )

  if (collapsed) {
    ops.push(...collapsed.ops)

    /** Rewrite the selection to the collapsed placeholder. */
    if (setSelection) {
      const rewritten = buildRewriteCollapsedEmptyBlockSelectionOps(
        ops,
        block.id,
        collapsed.placeholder.id,
        range,
      )

      return rewritten
    }
  }

  if (setSelection) {
    ops.push({
      __type: 'set_selection',
      next: createCursor({
        blockId: block.id,
        nodeId: anchor.nodeId,
        offset: anchor.offset,
      }),
      prev: range,
    })
  }

  return ops
}

/**
 * Deletes from `from` (inclusive) through the end of the block.
 * Keeps `[block start, from)`.
 */
export function buildForwardTrimBlockOps(
  block: BlockWithInlineContent,
  from: TextCursor,
): Operation[] {
  const found = findNodeInBlockWithInlineContent(block, from.nodeId)
  if (!found) {
    buildError(
      `Node ${from.nodeId} not found in block ${block.id}`,
      'OperationBuilder/#buildForwardTrimBlockOps',
    )
  }

  const { index: fromNi, node: fromNode } = found
  const ops: Operation[] = []

  if (isInlineNodeWithEditableText(fromNode)) {
    const tailLen = fromNode.text.length - from.offset
    if (tailLen > 0) {
      ops.push({
        __type: 'delete_text',
        blockId: block.id,
        length: tailLen,
        nodeId: fromNode.id,
        offset: from.offset,
        snapshot: {
          marks: fromNode.marks,
          text: fromNode.text.slice(from.offset),
        },
      })
    }
  }

  const lastIndex = block.content.length - 1
  if (fromNi < lastIndex) {
    const inlines = buildRemoveInlineNodeRangeOps(
      block.id,
      block.content,
      fromNi + 1,
      lastIndex,
    )
    ops.push(...inlines)
  }

  /** Anchor on line_break / mention at offset 0: remove that node too. */
  if (!isInlineNodeWithEditableText(fromNode) && from.offset === 0) {
    ops.push({
      __type: 'remove_inline_node',
      blockId: block.id,
      index: fromNi,
      snapshot: fromNode,
    })
  }

  return ops
}

/**
 * Deletes from the start of the block through `to` (exclusive).
 * Keeps `[to, block end)`.
 */
export function buildBackwardTrimBlockOps(
  block: BlockWithInlineContent,
  to: TextCursor,
): Operation[] {
  const found = findNodeInBlockWithInlineContent(block, to.nodeId)
  if (!found) {
    buildError(
      `Node ${to.nodeId} not found in block ${block.id}`,
      'OperationsEngine/buildBackwardTrimBlockOps',
    )
  }

  const { index: toNi, node: toNode } = found

  const ops: Operation[] = []
  const fullyConsumesFocusText =
    isInlineNodeWithEditableText(toNode) && to.offset >= toNode.text.length

  /** Partial prefix removal on the focus text node. */
  if (
    isInlineNodeWithEditableText(toNode) &&
    to.offset > 0 &&
    !fullyConsumesFocusText
  ) {
    ops.push({
      __type: 'delete_text',
      blockId: block.id,
      length: to.offset,
      nodeId: toNode.id,
      offset: 0,
      snapshot: {
        marks: toNode.marks,
        text: toNode.text.slice(0, to.offset),
      },
    })
  }

  /**
   * Fully consumed focus node (`dd` at end of selection):
   * remove the whole inline node (undo = insert_inline_node with full snapshot).
   * Must run at original `toNi` *before* removing nodes `[0, toNi)`.
   */
  if (fullyConsumesFocusText && toNi > 0) {
    ops.push({
      __type: 'remove_inline_node',
      blockId: block.id,
      index: toNi,
      snapshot: toNode,
    })
  }

  if (toNi > 0) {
    const inlines = buildRemoveInlineNodeRangeOps(
      block.id,
      block.content,
      0,
      toNi - 1,
    )
    ops.push(...inlines)
  }

  /** Fully consumed first inline in the block. */
  if (fullyConsumesFocusText && toNi === 0) {
    ops.push({
      __type: 'remove_inline_node',
      blockId: block.id,
      index: 0,
      snapshot: toNode,
    })
  }

  return ops
}

/**
 * Builds `delete_block` ops for every block strictly between `startBlockId`
 * and `endBlockId` in document order.
 */
export function buildDeleteBlocksBetweenOps(
  context: EditorContext,
  startBlockId: BlockId,
  endBlockId: BlockId,
): Operation[] {
  const { state } = context
  const order = state.blockOrderById

  const startBi = order.indexOf(startBlockId)
  const endBi = order.indexOf(endBlockId)

  if (startBi === -1 || endBi === -1 || endBi <= startBi) {
    return []
  }

  const ops: Operation[] = []

  for (let bi = startBi + 1; bi < endBi; bi += 1) {
    const blockId = order[bi]
    if (!blockId) {
      continue
    }

    const block = getBlock(state, blockId)

    let afterBlockId: BlockId | null = null
    if (bi > 0) {
      afterBlockId = order[bi - 1] ?? null
    }

    ops.push({
      __type: 'delete_block',
      afterBlockId,
      blockId,
      snapshot: block,
    })
  }

  return ops
}

/**
 * Insertion index for {@link MergeBlocksOp} when undoing this split.
 * It Mirrors head extraction in {@link applySplitBlockOp}.
 */
export function computeSplitMergeAtIndex(
  block: BlockWithInlineContent,
  atNode: { node: InlineNodeWithEditableText; index: number },
  atOffset: number,
): number {
  const { node, index } = atNode
  const { content } = block

  const headNodes: InlineNode[] = content.slice(0, index)

  const type = node.__type
  switch (type) {
    case 'text':
    case 'link': {
      const headText = node.text.slice(0, atOffset)
      if (headText.length > 0 || headNodes.length === 0) {
        headNodes.push({ ...node, text: headText })
      }
      return coalesceInlineNodes(headNodes).length
    }
    default: {
      assertNever(type, {
        hint: 'OperationsBuilder/computeSplitMergeAtIndex',
      })
    }
  }
}

/**
 * Inline nodes that move to the tail block when splitting a cursor.
 * Used by operations emitters to populate {@link SplitBlockOp} tailSnapshot field for undo.
 *
 * It mirrors tail extraction in {@link applySplitBlockOp}.
 */
export function computeSplitTailSnapshot(
  block: BlockWithInlineContent,
  atNode: { node: InlineNodeWithEditableText; index: number },
  atOffset: number,
): InlineNode[] {
  const { node, index } = atNode

  const type = node.__type
  switch (type) {
    case 'text': {
      const tailText = node.text.slice(atOffset)
      return [
        createTextNode({
          marks: node.marks,
          metadata: node.metadata,
          text: tailText,
        }),
        ...block.content.slice(index + 1),
      ]
    }
    case 'link': {
      const tailText = node.text.slice(atOffset)
      return [
        createLinkNode({
          marks: node.marks,
          metadata: node.metadata,
          text: tailText,
          url: node.url,
        }),
        ...block.content.slice(index + 1),
      ]
    }
    default: {
      assertNever(type, {
        hint: 'OperationsBuilder/computeSplitTailSnapshot',
      })
    }
  }
}
