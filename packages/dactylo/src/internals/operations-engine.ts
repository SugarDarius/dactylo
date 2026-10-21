import {
  findNodeInBlockWithInlineContent,
  isBlockWithInlineContent,
  sortBlockOrder,
  touchBlock,
} from './blocks'
import type {
  Block,
  BlockId,
  BlockWithInlineContent,
  BlockWithoutPosKey,
} from './blocks'
import type { TextPlainData } from './clipboard'
import {
  compareTextCursors,
  computeInsertBlockPosKey,
  createCursorAtDocumentEnd,
  deleteBlock,
  getBlock,
  getBlockIndex,
  getBlockNeighbors,
  getBlockWithInlineContent,
  insertBlock,
  isBlockWithInlineContentEmpty,
  normalizeRange,
  replaceBlock,
  resolveInsertAfterBlockId,
  stepTextCursor,
} from './document'
import type { DocumentState } from './document'
import {
  updateBlockWithInlineContent,
  withActiveMarks,
  withDocumentState,
  withSelection,
} from './editor-context'
import type { EditorContext } from './editor-context'
import { DactyloError } from './errors'
import { GraphemeOffsetCaret } from './grapheme'
import { HardBreakOpsBuilder } from './hard-break-ops-builder'
import type { ArrowDirection } from './keyboard'
import { applyNormalizedMarks, isMarksEqual } from './marks'
import type { MarkKey, Marks } from './marks'
import { MarksOpsBuilder } from './marks-ops-builder'
import {
  coalesceInlineNodes,
  createLinkNode,
  createTextNode,
  getInlineNodeTextLength,
  isCanonicalEmptyInlineContent,
  isInlineContentTextEmpty,
  isInlineNodeWithEditableText,
  isTextNode,
  splitInlineNodeWithEditableTextAt,
} from './nodes'
import type {
  InlineNode,
  InlineNodeWithEditableText,
  NodeId,
  TextNode,
} from './nodes'
import type {
  DeleteBlockOp,
  DeleteTextOp,
  InsertBlockOp,
  InsertBlockOpPosition,
  InsertInlineNodeOp,
  InsertTextOp,
  MergeBlocksOp,
  Operation,
  RemoveInlineNodeOp,
  SetActiveMarksOp,
  SetMarksOp,
  SetSelectionOp,
  SplitBlockOp,
} from './operations'
import type { BuilderOpsIntent } from './operations-builder'
import { PastePlainTextOpsBuilder } from './paste-plain-text-ops-builder'
import {
  areSelectionsEqual,
  createCursor,
  createRange,
  isCursorSelection,
  isRangeSelection,
  isSelectionActive,
} from './selection'
import type { TextCursor, Selection, RangeSelection } from './selection'
import { SoftBreakOpsBuilder } from './soft-break-ops-builder'
import { TypedCharOpsBuilder } from './typed-char-ops-builder'
import { assertNever } from './utils'

// --- Validate ─────────────────────────────────────────------------

/** Throws a validation {@link DactyloError} for a failed op check. */
export function validationError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'VALIDATE_TRANSACTION_OPERATIONS',
    hint: 'OperationsEngine/validateOp',
    message,
    payload: { op: JSON.stringify(op, null, 2) },
  })
}

/** Returns a block with accepted inline-content or throws. */
export function requireBlockWithInlineContent(
  state: DocumentState,
  blockId: BlockId,
  op: Operation,
): BlockWithInlineContent {
  const block = getBlockWithInlineContent(state, blockId)

  if (!isBlockWithInlineContent(block)) {
    validationError(`Block ${blockId} is not allowed to receive inline ops`, op)
  }

  return block
}

/** Finds an inline node with editable text inside a block or throws. */
export function requireInlineNodeWithEditableText(
  block: BlockWithInlineContent,
  nodeId: NodeId,
  op: Operation,
): { node: InlineNodeWithEditableText; index: number } {
  const found = findNodeInBlockWithInlineContent(block, nodeId)
  if (!found || !isInlineNodeWithEditableText(found.node)) {
    validationError(
      `Inline node with editable text ${nodeId} not found in block ${block.id}`,
      op,
    )
  }

  return { index: found.index, node: found.node }
}

/** Asserts an offset lies within a text node's bounds. */
export function assertOffsetInText(
  offset: number,
  textLength: number,
  op: Operation,
  label: string,
): void {
  if (offset < 0 || offset > textLength) {
    validationError(
      `${label}: Offset ${offset} out of bounds for text length ${textLength}`,
      op,
    )
  }
}

/** Asserts a mark range `[from, to]` lies within a text node's bounds. */
export function assertRangeInText(
  /** Range start (inclusive). */
  from: number,
  /** Range end (exclusive). */
  to: number,
  /** Length of the target text node. */
  textLength: number,
  op: Operation,
): void {
  if (from < 0 || to < from || to > textLength) {
    validationError(
      `Mark range [${from}, ${to}) out of bounds for text length ${textLength}`,
      op,
    )
  }
}

/** Validates a text cursor by checking its type and offset. */
export function validateTextCursor(
  state: DocumentState,
  cursor: TextCursor,
  op: Operation,
): void {
  const block = requireBlockWithInlineContent(state, cursor.blockId, op)
  const found = findNodeInBlockWithInlineContent(block, cursor.nodeId)

  if (!found) {
    validationError(`Node ${cursor.nodeId} no found in block ${block.id}`, op)
  }

  if (isInlineNodeWithEditableText(found.node)) {
    assertOffsetInText(
      cursor.offset,
      found.node.text.length,
      op,
      'Cursor offset',
    )
    return
  }

  if (found.node.__type === 'line_break') {
    if (cursor.offset !== 0) {
      validationError(
        `Cursor offset ${cursor.offset} invalid for line_break`,
        op,
      )
    }
    return
  }

  validationError(
    `Cursor node ${cursor.nodeId} must be text, link, or line_break`,
    op,
  )
}

/** Validates an `insert_block` operation. */
export function validateInsertBlockOp(
  context: EditorContext,
  op: InsertBlockOp,
): void | never {
  if (context.state.blocks.has(op.block.id)) {
    validationError(`Block ${op.block.id} already exists in document`, op)
  }

  if (op.afterBlockId !== null && !context.state.blocks.has(op.afterBlockId)) {
    validationError(`Unknown block: ${op.afterBlockId}`, op)
  }
}

/** Validates a `delete_block` operation. */
export function validateDeleteBlockOp(
  context: EditorContext,
  op: DeleteBlockOp,
): void | never {
  if (op.snapshot.id !== op.blockId) {
    validationError(
      `Snapshot block ID ${op.snapshot.id} does not match the deleted block ID ${op.blockId}`,
      op,
    )
  }

  if (op.snapshot.id !== op.blockId) {
    validationError(
      `Snapshot block ID ${op.snapshot.id} does not match the deleted block ID ${op.blockId}`,
      op,
    )
  }

  if (context.state.blockOrderById.length === 1) {
    validationError(`Cannot delete the last block in the document`, op)
  }
}

/** Validates a `merge_blocks` operation. */
export function validateMergeBlocksOp(
  context: EditorContext,
  op: MergeBlocksOp,
): void | never {
  if (op.sourceBlockId === op.targetBlockId) {
    validationError(`Source and target block IDs cannot be the same`, op)
  }

  const target = requireBlockWithInlineContent(
    context.state,
    op.targetBlockId,
    op,
  )

  const source = requireBlockWithInlineContent(
    context.state,
    op.sourceBlockId,
    op,
  )

  if (op.sourceSnapshot.id !== op.sourceBlockId) {
    validationError(`Snapshot id mismatch for ${op.sourceBlockId}`, op)
  }
  if (op.atIndex < 0 || op.atIndex > target.content.length) {
    validationError(`Merge atIndex out of bounds`, op)
  }
  if (op.mergedTailSnapshot.length !== source.content.length) {
    validationError(
      `mergedTailSnapshot length does not match source block content`,
      op,
    )
  }

  for (let i = 0; i < source.content.length; i += 1) {
    if (op.mergedTailSnapshot[i]?.id !== source.content[i]?.id) {
      validationError(
        `mergedTailSnapshot does not match source block content`,
        op,
      )
    }
  }

  const splitNode = findNodeInBlockWithInlineContent(target, op.splitAtNodeId)
  if (!splitNode) {
    validationError(
      `Node ${op.splitAtNodeId} not found in target block ${op.targetBlockId}`,
      op,
    )
  }

  if (isInlineNodeWithEditableText(splitNode.node)) {
    assertOffsetInText(
      op.splitAtOffset,
      splitNode.node.text.length,
      op,
      'Merge split offset',
    )
  } else if (op.splitAtOffset !== 0) {
    validationError(
      `Merge split offset ${op.splitAtOffset} invalid for non-text node`,
      op,
    )
  }
}

/** Validates a `split_block` operation. */
export function validateSplitBlockOp(
  context: EditorContext,
  op: SplitBlockOp,
): void | never {
  const block = requireBlockWithInlineContent(context.state, op.blockId, op)
  const { node } = requireInlineNodeWithEditableText(block, op.atNodeId, op)

  assertOffsetInText(op.atOffset, node.text.length, op, 'Split block offset')

  if (context.state.blocks.has(op.newBlock.id)) {
    validationError(
      `New block ${op.newBlock.id} already exists in document`,
      op,
    )
  }
}

/** Validates an `insert_text` operation. */
export function validateInsertTextOp(
  context: EditorContext,
  op: InsertTextOp,
): void | never {
  if (op.text.length === 0) {
    validationError('Cannot insert an empty text', op)
  }
  const block = requireBlockWithInlineContent(context.state, op.blockId, op)
  const { node } = requireInlineNodeWithEditableText(block, op.nodeId, op)

  assertOffsetInText(op.offset, node.text.length, op, 'Insert text offset')

  const marks = applyNormalizedMarks(context.activeMarks, op.marks)
  if (!isMarksEqual(node.marks, marks)) {
    validationError('Insert text marks do not match node marks', op)
  }
}

/** Validates a `delete_text` operation. */
export function validateDeleteTextOp(
  context: EditorContext,
  op: DeleteTextOp,
): void | never {
  const block = requireBlockWithInlineContent(context.state, op.blockId, op)
  const { node } = requireInlineNodeWithEditableText(block, op.nodeId, op)

  if (op.length < 0 || op.offset + op.length > node.text.length) {
    validationError('Remove range out of bounds', op)
  }
}

/** Validates a `set_marks` operation. */
export function validateSetMarksOp(
  context: EditorContext,
  op: SetMarksOp,
): void | never {
  const block = requireBlockWithInlineContent(context.state, op.blockId, op)
  const { node } = requireInlineNodeWithEditableText(block, op.nodeId, op)

  assertRangeInText(op.from, op.to, node.text.length, op)
}

/** Validates a `set_selection` operation. */
export function validateSetSelectionOp(
  context: EditorContext,
  op: SetSelectionOp,
): void | never {
  if (op.next !== null) {
    if (op.next.__type === 'cursor') {
      validateTextCursor(context.state, op.next.anchor, op)
    } else if (op.next.__type === 'range') {
      validateTextCursor(context.state, op.next.anchor, op)
      validateTextCursor(context.state, op.next.focus, op)
    }
  }
}

/** Validates a `insert_inline_node` operation. */
export function validateInsertInlineNodeOp(
  context: EditorContext,
  op: InsertInlineNodeOp,
): void | never {
  const block = requireBlockWithInlineContent(context.state, op.blockId, op)
  if (op.index < 0 || op.index > block.content.length) {
    validationError(`Insert index ${op.index} out of bounds`, op)
  }
}

/** Validates a `remove_inline_node` operation. */
export function validateRemoveInlineNodeOp(
  context: EditorContext,
  op: RemoveInlineNodeOp,
): void | never {
  const block = requireBlockWithInlineContent(context.state, op.blockId, op)
  if (op.index < 0 || op.index >= block.content.length) {
    validationError(`Remove index ${op.index} out of bounds`, op)
  }
}

// --- Apply ─────────────────────────────────────────---------------

/** Throws an apply {@link DactyloError} for a failed op check. */
export function applyError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'APPLY_TRANSACTION_OPERATIONS',
    hint: 'OperationsEngine/applyOp',
    message,
    payload: { op },
  })
}

/** Applies an `insert_block` operation to the editor context. */
export function applyInsertBlockOp(
  context: EditorContext,
  op: InsertBlockOp,
): EditorContext {
  let state = insertBlock(context.state, op.block)

  state = { ...state, blockOrderById: sortBlockOrder(state.blocks) }
  return withDocumentState(context, state)
}

/** Applies a `delete_block` operation to the editor context. */
export function applyDeleteBlockOp(
  context: EditorContext,
  op: DeleteBlockOp,
): EditorContext {
  const state = deleteBlock(context.state, op.blockId)
  return withDocumentState(context, state)
}

/**
 * Applies a `merge_blocks` operation to the editor context.
 * It splices source content into the target at `op.atIndex`,
 * then removes the source blocks.
 */
export function applyMergeBlocksOp(
  context: EditorContext,
  op: MergeBlocksOp,
): EditorContext {
  const target = getBlockWithInlineContent(context.state, op.targetBlockId)
  const source = getBlockWithInlineContent(context.state, op.sourceBlockId)

  const mergedContent = coalesceInlineNodes([
    ...target.content.slice(0, op.atIndex),
    ...source.content,
    ...target.content.slice(op.atIndex),
  ])

  // @todo: add policy to merge blocks metadata
  const mergedMetadata = { ...target.metadata, ...source.metadata }
  const updatedTarget = touchBlock({
    ...target,
    content: mergedContent,
    metadata: mergedMetadata,
  })

  let state = replaceBlock(context.state, op.targetBlockId, updatedTarget)
  state = deleteBlock(state, op.sourceBlockId)

  return withDocumentState(context, state)
}

/** Applies a `split_block` operation to the editor context. */
export function applySplitBlockOp(
  context: EditorContext,
  op: SplitBlockOp,
): EditorContext {
  const block = getBlockWithInlineContent(context.state, op.blockId)

  const found = findNodeInBlockWithInlineContent(block, op.atNodeId)
  if (!found) {
    applyError(`Node ${op.atNodeId} not found in block ${block.id}`, op)
  }

  const { node, index } = found
  const content = [...block.content]

  const type = node.__type
  switch (type) {
    case 'text':
    case 'link': {
      const headText = node.text.slice(0, op.atOffset)

      const headNodes: InlineNode[] = content.slice(0, index)
      if (headText.length > 0 || headNodes.length === 0) {
        headNodes.push({ ...node, text: headText, updatedAt: new Date() })
      }

      const updatedOriginal = touchBlock({
        ...block,
        content: coalesceInlineNodes(headNodes),
      })

      let doc = replaceBlock(context.state, op.blockId, updatedOriginal)
      const newBlock: BlockWithInlineContent = {
        ...op.newBlock,
        content: coalesceInlineNodes(op.newBlock.content),
      }
      doc = insertBlock(doc, newBlock)

      return withDocumentState(context, doc)
    }
    case 'line_break':
    case 'mention': {
      return applyError(`Split tail is not allowed on ${type} node`, op)
    }
    default: {
      assertNever(type, {
        hint: 'OperationsEngine/applySplitBlockOp',
      })
    }
  }
}

/** Applies an `insert_text` operation to the editor context. */
export function applyInsertTextOp(
  context: EditorContext,
  op: InsertTextOp,
): EditorContext {
  const block = getBlockWithInlineContent(context.state, op.blockId)
  const content = [...block.content]

  const found = findNodeInBlockWithInlineContent(block, op.nodeId)
  if (!found) {
    applyError(`Node ${op.nodeId} not found in block ${block.id}`, op)
  }

  const { node, index } = found
  if (!isInlineNodeWithEditableText(node)) {
    applyError('`insert_text` target must be a text node', op)
  }

  const before = node.text.slice(0, op.offset)
  const after = node.text.slice(op.offset)

  const text = before + op.text + after

  content[index] = {
    ...node,
    text,
    updatedAt: new Date(),
  }

  return updateBlockWithInlineContent(context, op.blockId, content)
}

/** Applies a `delete_text` operation to the editor context. */
export function applyDeleteTextOp(
  context: EditorContext,
  op: DeleteTextOp,
): EditorContext {
  const block = getBlockWithInlineContent(context.state, op.blockId)
  const content = [...block.content]

  const found = findNodeInBlockWithInlineContent(block, op.nodeId)
  if (!found) {
    applyError(`Node ${op.nodeId} not found in block ${block.id}`, op)
  }

  const { node, index } = found

  if (!isInlineNodeWithEditableText(node)) {
    applyError(
      '`delete_text` target must be an inline node with editable text',
      op,
    )
  }

  const before = node.text.slice(0, op.offset)
  const after = node.text.slice(op.offset + op.length)

  const text = before + after

  content[index] = {
    ...node,
    text,
    updatedAt: new Date(),
  }

  return updateBlockWithInlineContent(context, op.blockId, content)
}

/** Applies a `set_active_marks` operation to the editor context. */
export function applySetActiveMarksOp(
  context: EditorContext,
  op: SetActiveMarksOp,
): EditorContext {
  const next = withActiveMarks(context, op.activeMarks)
  if (op.copyTo === null) {
    return next
  }

  const block = getBlockWithInlineContent(next.state, op.copyTo.blockId)
  const found = findNodeInBlockWithInlineContent(block, op.copyTo.nodeId)
  if (!found) {
    applyError(`Node ${op.copyTo.nodeId} not found in block ${block.id}`, op)
  }

  const { index, node } = found

  if (!isInlineNodeWithEditableText(node) || node.text.length > 0) {
    return next
  }

  const content = [...block.content]
  content[index] = {
    ...node,
    marks: op.activeMarks,
    updatedAt: new Date(),
  }

  return updateBlockWithInlineContent(next, op.copyTo.blockId, content)
}

/** Applies a `set_marks` operation to the editor context. */
export function applySetMarksOp(
  context: EditorContext,
  op: SetMarksOp,
): EditorContext {
  const block = getBlockWithInlineContent(context.state, op.blockId)
  const content = [...block.content]

  const found = findNodeInBlockWithInlineContent(block, op.nodeId)
  if (!found) {
    applyError(`Node ${op.nodeId} not found in block ${block.id}`, op)
  }

  const { node, index } = found
  if (!isInlineNodeWithEditableText(node)) {
    applyError(
      '`set_marks` target must be an inline node with editable text',
      op,
    )
  }

  /** We don't apply op on an empty range. */
  if (op.from === op.to) {
    return context
  }

  /** Whole-node mark toggle: update marks only (undo = invert mark swap on same node). */
  if (op.from === 0 && op.to === node.text.length) {
    content[index] = {
      ...node,
      marks: op.nextMarks,
      updatedAt: new Date(),
    }

    return updateBlockWithInlineContent(context, op.blockId, content)
  }

  /** Partial range via `set_marks`: new toggles use structural ops from {@link buildSetMarksOps}. */
  const replacement = splitInlineNodeWithEditableTextAt(
    node,
    op.from,
    op.to,
    op.nextMarks,
  )
  if (replacement.length === 0) {
    content.splice(index, 1)
  } else {
    content.splice(index, 1, ...replacement)
  }

  return updateBlockWithInlineContent(context, op.blockId, content)
}

/** Applies a `insert_inline_node` operation to the editor context. */
export function applyInsertInlineNodeOp(
  context: EditorContext,
  op: InsertInlineNodeOp,
): EditorContext {
  const block = getBlockWithInlineContent(context.state, op.blockId)

  const content = [...block.content]
  content.splice(op.index, 0, op.node)

  return updateBlockWithInlineContent(context, op.blockId, content)
}

/** Applies a `remove_inline_node` operation to the editor context. */
export function applyRemoveInlineNodeOp(
  context: EditorContext,
  op: RemoveInlineNodeOp,
): EditorContext {
  const block = getBlockWithInlineContent(context.state, op.blockId)

  const content = [...block.content]
  content.splice(op.index, 1)

  return updateBlockWithInlineContent(context, op.blockId, content)
}

// --- Invert ─────────────────────────────────────────--------------

export function invertError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'INVERT_TRANSACTION_OPERATIONS',
    hint: 'OperationsEngine/invertOp',
    message,
    payload: { op },
  })
}

// --- Build ─────────────────────────────────────────---------------

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
 * Previews in-memory the inline content of a block
 * after a list of trim operations without applying them into the document.
 *
 * Purpose:
 * After delete or replace a cross-block range selection the engine does:
 *  1. Trims the start block from the anchor forward (e.g `#buildForwardTrimBlockOps`
 *  2. Deletes blocks in the middle.
 *  3. Trims end block from the focus backward (e.g `#buildBackwardTrimBlockOps`)
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
    } else if (op.__type === 'remove_inline_node') {
      next.splice(op.index, 1)
    }
    next = coalesceInlineNodes(next)
  }

  return next
}

/** Computes the tail node for a sliced inline node with editable text. */
export function computeTailInlineNode(
  node: InlineNodeWithEditableText,
  tailText: string,
): InlineNode {
  if (node.__type === 'link') {
    return createLinkNode({
      marks: node.marks,
      metadata: node.metadata,
      text: tailText,
      url: node.url,
    })
  }

  return createTextNode({
    marks: node.marks,
    metadata: node.metadata,
    text: tailText,
  })
}

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
      'OperationsEngine/resolveTypedCharInsertTarget',
    )
  }

  if (at.offset < 0 || at.offset > found.node.text.length) {
    buildError(
      `Insert offset ${at.offset} out of bounds for text length ${found.node.text.length}`,
      'OperationsEngine/resolveTypedCharInsertTarget',
    )
  }

  return { index: found.index, node: found.node }
}

/** Intent for building composing operations. */
export interface ComposingOpsIntent {
  /** The operations to apply. */
  readonly ops: Operation[]
  /** The kind for the intent. */
  readonly label: string
  /** When `true` merge history action for rapid typing coalescing. */
  readonly coalesce?: true
  /** When `true` history is skipped. */
  readonly skipHistory?: true
}

/** Options for constructing a {@link OperationsEngine} instance. */
export interface OperationsEngineOptions {
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

  /** The locales to use when handling text operations. */
  readonly locales: Intl.LocalesArgument

  /** Configuration for autolink detection. */
  readonly autolink: {
    /** Whether to enable autolink detection. */
    readonly enabled: boolean
  }
}

/** Configuration for mentions. */
export interface OperationEngineMentionsConfig {
  /** Whether to enable mentions. */
  readonly enabled: boolean

  /** The character to use for mentions. */
  readonly character: string
}

/** Configuration for inline command trigger. */
export interface OperationEngineInlineCommandTriggerConfig {
  /** Whether to enable inline command trigger. */
  readonly enabled: boolean

  /** The character to use for inline command trigger. */
  readonly character: string
}

/** Configuration for autolink detection. */
export interface OperationEngineAutolinkConfig {
  /** Whether to enable autolink detection. */
  readonly enabled: boolean
}

/**
 * Engine to build operations for the editor.
 * It is responsible for building the operations for the editor
 * based on the current state and the input events for:
 *  - Validating operations
 *  - Applying operations
 *  - Inverting operations
 *
 * It allows to handle inline composition with mentions and slash command
 */
export class OperationsEngine {
  /** Marks ops builder. */
  readonly #marksOpsBuilder: MarksOpsBuilder

  /** Typed char ops builder. */
  readonly #typedCharOpsBuilder: TypedCharOpsBuilder

  /** Paste plain text ops builder. */
  readonly #pastePlainTextOpsBuilder: PastePlainTextOpsBuilder

  /** Soft break ops builder. */
  readonly #softBreakOpsBuilder: SoftBreakOpsBuilder

  /** Hard break ops builder. */
  readonly #hardBreakOpsBuilder: HardBreakOpsBuilder

  /** Grapheme offset caret instance. */
  readonly #graphemeOffsetCaret: GraphemeOffsetCaret

  constructor(options: OperationsEngineOptions) {
    this.#graphemeOffsetCaret = new GraphemeOffsetCaret({
      locales: options.locales,
    })

    this.#marksOpsBuilder = new MarksOpsBuilder()
    this.#typedCharOpsBuilder = new TypedCharOpsBuilder({
      inlineCommandTrigger: options.inlineCommandTrigger,
      mentions: options.mentions,
    })
    this.#pastePlainTextOpsBuilder = new PastePlainTextOpsBuilder({
      autolink: options.autolink,
      graphemeOffsetCaret: this.#graphemeOffsetCaret,
    })
    this.#softBreakOpsBuilder = new SoftBreakOpsBuilder()
    this.#hardBreakOpsBuilder = new HardBreakOpsBuilder()
  }

  // --- Core engine ─────────────────────────────────────────---------

  /**
   * Validates an operation against current state.
   * Throws when operation does not respect the rules implemented in the editor.
   */
  validateOp(context: EditorContext, op: Operation): void {
    const type = op.__type
    switch (type) {
      case 'insert_block': {
        validateInsertBlockOp(context, op)
        break
      }
      case 'delete_block': {
        validateDeleteBlockOp(context, op)
        break
      }
      case 'split_block': {
        validateSplitBlockOp(context, op)
        break
      }
      case 'merge_blocks': {
        validateMergeBlocksOp(context, op)
        break
      }
      case 'insert_text': {
        validateInsertTextOp(context, op)
        break
      }
      case 'delete_text': {
        validateDeleteTextOp(context, op)
        break
      }
      case 'insert_inline_node': {
        validateInsertInlineNodeOp(context, op)
        break
      }
      case 'remove_inline_node': {
        validateRemoveInlineNodeOp(context, op)
        break
      }
      case 'set_marks': {
        validateSetMarksOp(context, op)
        break
      }
      case 'set_selection': {
        validateSetSelectionOp(context, op)
        break
      }
      case 'set_active_marks': {
        break
      }
      default: {
        assertNever(type, { hint: 'OperationsEngine/validateOp' })
      }
    }
  }

  /** Applies a single operation to the editor context. */
  applyOp(context: EditorContext, op: Operation): EditorContext {
    const type = op.__type
    switch (type) {
      case 'insert_block': {
        return applyInsertBlockOp(context, op)
      }
      case 'delete_block': {
        return applyDeleteBlockOp(context, op)
      }
      case 'split_block': {
        return applySplitBlockOp(context, op)
      }
      case 'merge_blocks': {
        return applyMergeBlocksOp(context, op)
      }
      case 'insert_text': {
        return applyInsertTextOp(context, op)
      }
      case 'delete_text': {
        return applyDeleteTextOp(context, op)
      }
      case 'insert_inline_node': {
        return applyInsertInlineNodeOp(context, op)
      }
      case 'remove_inline_node': {
        return applyRemoveInlineNodeOp(context, op)
      }
      case 'set_active_marks': {
        return applySetActiveMarksOp(context, op)
      }
      case 'set_marks': {
        return applySetMarksOp(context, op)
      }
      case 'set_selection': {
        return withSelection(context, op.next)
      }
      default: {
        assertNever(type, { hint: 'OperationsEngine/applyOp' })
      }
    }
  }

  /** Reverts an operation to restore the prior context. */
  invertOp(op: Operation): Operation {
    const type = op.__type
    switch (type) {
      case 'insert_block': {
        return {
          __type: 'delete_block',
          afterBlockId: op.afterBlockId,
          blockId: op.block.id,
          snapshot: op.block,
        }
      }
      case 'delete_block': {
        return {
          __type: 'insert_block',
          afterBlockId: op.afterBlockId,
          block: op.snapshot,
        }
      }
      case 'split_block': {
        return {
          __type: 'merge_blocks',
          atIndex: op.atIndex,
          mergedTailSnapshot: [...op.tailSnapshot],
          sourceBlockId: op.newBlock.id,
          sourceSnapshot: op.newBlock,
          splitAtNodeId: op.atNodeId,
          splitAtOffset: op.atOffset,
          targetBlockId: op.blockId,
        }
      }
      case 'merge_blocks': {
        return {
          __type: 'split_block',
          atIndex: op.atIndex,
          atNodeId: op.splitAtNodeId,
          atOffset: op.splitAtOffset,
          blockId: op.targetBlockId,
          newBlock: op.sourceSnapshot,
          tailSnapshot: [...op.mergedTailSnapshot],
        }
      }
      case 'insert_text': {
        return {
          __type: 'delete_text',
          blockId: op.blockId,
          length: op.text.length,
          nodeId: op.nodeId,
          offset: op.offset,
          snapshot: {
            marks: op.marks,
            text: op.text,
          },
        }
      }
      case 'delete_text': {
        return {
          __type: 'insert_text',
          blockId: op.blockId,
          marks: op.snapshot.marks,
          nodeId: op.nodeId,
          offset: op.offset,
          text: op.snapshot.text,
        }
      }
      case 'insert_inline_node': {
        return {
          __type: 'remove_inline_node',
          blockId: op.blockId,
          index: op.index,
          snapshot: op.node,
        }
      }
      case 'remove_inline_node': {
        return {
          __type: 'insert_inline_node',
          blockId: op.blockId,
          index: op.index,
          node: op.snapshot,
        }
      }
      case 'set_active_marks': {
        return {
          __type: 'set_active_marks',
          activeMarks: op.prevActiveMarks,
          copyTo: op.copyTo,
          prevActiveMarks: op.activeMarks,
        }
      }
      case 'set_marks': {
        return {
          __type: 'set_marks',
          blockId: op.blockId,
          from: op.from,
          nextMarks: op.prevMarks,
          nodeId: op.nodeId,
          prevMarks: op.nextMarks,
          to: op.to,
        }
      }
      case 'set_selection': {
        return {
          __type: 'set_selection',
          next: op.prev,
          prev: op.next,
        }
      }
      default: {
        assertNever(type, { hint: 'OperationsEngine/invertOp' })
      }
    }
  }

  // --- Marks operations ─────────────────────────────────────────----

  /**
   * Builds the operations to toggle a mark on or off.
   * Returns `null` when there is no active selection or no rules were matched.
   */
  buildSetMarksOps(
    context: EditorContext,
    mark: MarkKey,
  ): BuilderOpsIntent | null {
    return this.#marksOpsBuilder.build(context, { mark })
  }

  // --- Composing operations ─────────────────────────────────────────

  /**
   * Builds operations for a single typed character (or emoji) at the current selection.
   * Returns `null` when there is no active selection or no rules were matched.
   */
  buildTypedCharOps(
    context: EditorContext,
    char: string,
  ): BuilderOpsIntent | null {
    return this.#typedCharOpsBuilder.build(context, { char })
  }

  /** Builds operations for a pasted plain text. */
  buildPlainTextPasteOps(
    context: EditorContext,
    /** The plain text data to paste. */
    data: TextPlainData,
  ): BuilderOpsIntent | null {
    return this.#pastePlainTextOpsBuilder.build(context, { data })
  }

  /** Merges the current block into the previous block when backspacing at block start. */
  // @todo: handle blocks with no inline content
  #buildMergeBlocksOps(
    context: EditorContext,
    /** Collapsed cursor anchor for the pending edit. */
    cursor: TextCursor,
    /** The block to merge into the previous block. */
    block: BlockWithInlineContent,
  ): ComposingOpsIntent {
    const neighbors = getBlockNeighbors(context.state, block.id)
    /** Should not happen as we already checked if there is only one block in the document. */
    if (neighbors.prev === null) {
      buildError(
        `Previous block ID is not found for block ${cursor.blockId}`,
        'OperationsEngine/buildMergeBlocksOps',
      )
    }

    const prevBlock = getBlockWithInlineContent(context.state, neighbors.prev)
    const ops: Operation[] = []

    let targetHead = [...prevBlock.content]
    const collapsedHead = this.#buildCollapseEmptyBlockToActiveMarksOps(
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

    return {
      label: `merge-blocks`,
      ops,
    }
  }

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
  #buildBackspaceAbsorbEmptyTextNodeIntoPrevOps(
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

  /**
   * Builds operations for `Backspace` with a collapsed caret.
   *
   * When the caret is at offset `0` inside the current inline node:
   * - At block start → merge with the previous block, or no-op at document start.
   * - After a line break / mention → remove those nodes and optionally join text.
   * - After text or link → remove the current node and merge its text into the
   *   previous node. **Empty** text nodes (e.g. ZWSP placeholders after a link)
   *   must not emit `insert_text` with `""` — see {@link validateInsertTextOp}.
   *
   * When the caret is inside the node (`offset > 0`), deletes the previous grapheme.
   */
  #buildDeleteBackspaceAtCursorOps(
    context: EditorContext,
    /** Collapsed cursor anchor for the pending edit. */
    cursor: TextCursor,
  ): ComposingOpsIntent | null {
    const block = getBlockWithInlineContent(context.state, cursor.blockId)
    const blockIndex = getBlockIndex(context.state, block.id)

    const found = findNodeInBlockWithInlineContent(block, cursor.nodeId)
    if (!found || !isInlineNodeWithEditableText(found.node)) {
      buildError(
        `Node ${cursor.nodeId} not found in block ${block.id}`,
        'OperationsEngine/buildDeletePreviousTypedCharOps',
      )
    }

    const { node, index } = found

    /**
     * 1️⃣ First case where the cursor is at the start of node.
     * We checks if we must:
     *  1. Merge the current block with the previous block
     *  2. Or, merge the current node with the previous node if applicable,
     *  3. Or, just remove the line break or the mention
     */
    if (cursor.offset === 0) {
      /** Case where the cursor is at the start of the block and there is only one block in the document. */
      if (blockIndex === 0 && index === 0) {
        /**
         * 👉🏻 Expected UX:
         * At the very start of the document (first block, offset = 0), `Backspace` key typically
         * deletes nothing. We are not at "delete the character before the cursor" (→ offset - 1),
         * because we already took the block-start branch and there is no previous block to join with.
         */
        return null
      }

      /** Merge the current block with the previous block. */
      if (index === 0) {
        return this.#buildMergeBlocksOps(context, cursor, block)
      }

      const prevNode = block.content[index - 1]
      /** Should not happen. */
      if (!prevNode) {
        buildError(
          `Previous node not found for block ${block.id} at index ${index}`,
          'OperationsEngine/buildDeleteBackspaceAtCursorOps',
        )
      }

      const prevType = prevNode.__type
      switch (prevType) {
        /** Remove line break or mention and merge if applicable. */
        case 'line_break':
        case 'mention': {
          const ni = index - 1
          const ops: Operation[] = [
            {
              __type: 'remove_inline_node',
              blockId: block.id,
              index,
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
              `Before node not found for block ${block.id} at index ${ni}`,
              'OperationsEngine/buildCursorBackspaceOps',
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
          return {
            label: 'remove-node-and-merge',
            ops,
          }
        }
        /**
         * Join the caret node into the previous text or link node.
         * Structural empty text siblings carry no model text; only remove them
         * and place the caret at the end of the previous node.
         */
        default: {
          const mergeOffset = getInlineNodeTextLength(prevNode)
          const mergingText = node.text

          const ops: Operation[] = []

          if (mergingText.length > 0) {
            ops.push(
              {
                __type: 'remove_inline_node',
                blockId: block.id,
                index,
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
            )

            return { label: 'merge-node-and-insert-text', ops }
          }

          ops.push(
            ...this.#buildBackspaceAbsorbEmptyTextNodeIntoPrevOps(
              context,
              block.id,
              index,
              node,
              prevNode,
            ),
          )
          return { label: 'remove-empty-node-at-boundary', ops }
        }
      }
    }

    /**
     * 2️⃣ Second case where the cursor is somewhere inside a node.
     * We checks if we must:
     *  1. Delete the previous character
     *  2. Or, delete the previous char and update a link
     */
    const { start, length } = this.#graphemeOffsetCaret.getDeleteRange(
      node.text,
      cursor.offset,
    )

    const remainingLength = node.text.length - length
    const prevNode = index > 0 ? block.content[index - 1] : undefined

    if (length <= 0) {
      return null
    }

    const ops: Operation[] = [
      {
        __type: 'delete_text',
        blockId: cursor.blockId,
        length,
        nodeId: cursor.nodeId,
        offset: start,
        snapshot: {
          marks: node.marks,
          text: node.text.slice(start, start + length),
        },
      },
    ]

    /**
     * Boundary UX: `[link][text " "]` → one Backspace deletes the space and
     * lands inside the link at its end, instead of leaving an empty text node.
     */
    const shouldAbsorbIntoPrev =
      remainingLength === 0 &&
      isTextNode(node) &&
      prevNode !== undefined &&
      isInlineNodeWithEditableText(prevNode)

    if (shouldAbsorbIntoPrev) {
      ops.push(
        ...this.#buildBackspaceAbsorbEmptyTextNodeIntoPrevOps(
          context,
          block.id,
          index,
          node,
          prevNode,
        ),
      )

      return {
        label: 'delete-last-char-absorb-empty-into-prev',
        ops,
      }
    }

    ops.push({
      __type: 'set_selection',
      next: createCursor({
        blockId: cursor.blockId,
        nodeId: cursor.nodeId,
        offset: start,
      }),
      prev: context.selection,
    })

    return { coalesce: true, label: 'delete-previous-character', ops }
  }

  /**
   * Deletes `[from.offset, to.offset)` inside one editable text node.
   * Fast path for range backspace when anchor/focus share the same node.
   */
  #buildDeleteTextRunOps(
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
        'OperationsEngine/buildDeleteTextRunOps',
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

  /** Builds operations to collapse an empty block to the active marks. */
  #buildCollapseEmptyBlockToActiveMarksOps(
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

  /** Builds operations to rewrite the selection of a collapsed empty block. */
  #buildRewriteCollapsedEmptyBlockSelectionOps(
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
  #buildRemoveInlineNodeRangeOps(
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
   * Builds operations for a range backspace within a single block (possibly multiple inline nodes).
   * Joins surviving head/tail text when marks match.
   */
  #buildDeleteRangeWithinBlockOps(
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
        'OperationsEngine/buildDeleteRangeWithinBlockOps',
      )
    }

    const { index: aNi, node: aNode } = anchorFound
    const { index: fNi, node: fNode } = focusFound

    /** Same text node → single delete_text. */
    if (aNi === fNi && isInlineNodeWithEditableText(aNode)) {
      let ops = this.#buildDeleteTextRunOps(
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
      const collapsed = this.#buildCollapseEmptyBlockToActiveMarksOps(
        block.id,
        preview,
        context.activeMarks,
      )

      if (collapsed) {
        ops = ops.filter((op) => op.__type !== 'set_selection') as Operation[]
        ops.push(...collapsed.ops)

        /** Rewrite the selection to the collapsed placeholder. */
        const rewritten = this.#buildRewriteCollapsedEmptyBlockSelectionOps(
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
    if (
      fNi !== aNi &&
      isInlineNodeWithEditableText(fNode) &&
      focus.offset > 0
    ) {
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
      const inlines = this.#buildRemoveInlineNodeRangeOps(
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

    const preview = previewInlineContentAfterTrimOps(
      block.content,
      ops,
      block.id,
    )
    const collapsed = this.#buildCollapseEmptyBlockToActiveMarksOps(
      block.id,
      preview,
      context.activeMarks,
    )

    if (collapsed) {
      ops.push(...collapsed.ops)

      /** Rewrite the selection to the collapsed placeholder. */
      if (setSelection) {
        const rewritten = this.#buildRewriteCollapsedEmptyBlockSelectionOps(
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
  #buildForwardTrimBlockOps(
    block: BlockWithInlineContent,
    from: TextCursor,
  ): Operation[] {
    const found = findNodeInBlockWithInlineContent(block, from.nodeId)
    if (!found) {
      buildError(
        `Node ${from.nodeId} not found in block ${block.id}`,
        'OperationsEngine/buildForwardTrimBlockOps',
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
      const inlines = this.#buildRemoveInlineNodeRangeOps(
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
   * Builds `delete_block` ops for every block strictly between `startBlockId`
   * and `endBlockId` in document order.
   */
  #buildDeleteBlocksBetweenOps(
    state: DocumentState,
    startBlockId: BlockId,
    endBlockId: BlockId,
  ): Operation[] {
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
   * Deletes from the start of the block through `to` (exclusive).
   * Keeps `[to, block end)`.
   */
  #buildBackwardTrimBlockOps(
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
      const inlines = this.#buildRemoveInlineNodeRangeOps(
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
   * Builds operations when user presses `Backspace` key at the current range position.
   *
   * | Case                       | Behavior                                                                                   |
   * |----------------------------|--------------------------------------------------------------------------------------------|
   * | Same node, text/link       | `delete_text`                                                                              |
   * | Same block, multiple nodes | `delete_text` + `remove_inline_node` (+ optional text join)                                |
   * | Cross-block                | forward trim start block → delete middle blocks → backward trim end block → `merge_blocks` |
   */
  #buildDeleteBackspaceAtRangeOps(
    context: EditorContext,
    range: RangeSelection,
  ): ComposingOpsIntent {
    const { state } = context

    const normalized = normalizeRange(context.state, range)
    const { anchor, focus } = normalized

    if (compareTextCursors(state, anchor, focus) >= 0) {
      rangeCollapsedError(
        'Range selection is collapsed; expected anchor to precede focus.',
        'OperationsEngine/buildDeleteBackspaceAtRangeOps',
      )
    }

    /**
     * 1️⃣ First case: range selection is within the same block.
     * 👉🏻 Deleting only the content inside the block.
     */
    if (anchor.blockId === focus.blockId) {
      const block = getBlockWithInlineContent(state, anchor.blockId)
      const ops = this.#buildDeleteRangeWithinBlockOps(
        context,
        block,
        anchor,
        focus,
        range,
      )

      return { label: 'delete-content-inside-block', ops }
    }

    /**
     * 2️⃣ Second case: range selection is in different blocks.
     * 👉🏻 Deleting the context cross-blocks and maybe removing some blocks.
     */
    const startBlock = getBlockWithInlineContent(state, anchor.blockId)
    const endBlock = getBlockWithInlineContent(state, focus.blockId)

    const ops: Operation[] = []

    const forwards = this.#buildForwardTrimBlockOps(startBlock, anchor)
    ops.push(...forwards)

    let targetHead = previewInlineContentAfterTrimOps(
      startBlock.content,
      forwards,
      startBlock.id,
    )

    const collapsedHead = this.#buildCollapseEmptyBlockToActiveMarksOps(
      startBlock.id,
      targetHead,
      context.activeMarks,
    )

    if (collapsedHead) {
      ops.push(...collapsedHead.ops)
      targetHead = [collapsedHead.placeholder]
    }

    const between = this.#buildDeleteBlocksBetweenOps(
      state,
      startBlock.id,
      endBlock.id,
    )
    ops.push(...between)

    const backwards = this.#buildBackwardTrimBlockOps(endBlock, focus)
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
    const collapsedMerged = this.#buildCollapseEmptyBlockToActiveMarksOps(
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

    return { label: 'delete-range-cross-blocks', ops }
  }

  /**
   * Builds operations when user presses `Backspace` key at the current selection.
   * Returns `null` when there is no active selection.
   */
  buildDeleteBackspaceOps(context: EditorContext): ComposingOpsIntent | null {
    if (isCursorSelection(context.selection)) {
      return this.#buildDeleteBackspaceAtCursorOps(
        context,
        context.selection.anchor,
      )
    }

    if (isRangeSelection(context.selection)) {
      return this.#buildDeleteBackspaceAtRangeOps(context, context.selection)
    }

    return null
  }

  /** Builds operations when user presses `Enter` key as a hard break. */
  buildHardBreakOps(context: EditorContext): BuilderOpsIntent | null {
    return this.#hardBreakOpsBuilder.build(context)
  }

  /** Builds operations when user presses `shift+Enter` key as a soft break. */
  buildSoftBreakOps(context: EditorContext): BuilderOpsIntent | null {
    return this.#softBreakOpsBuilder.build(context)
  }

  // --- Selection operations ─────────────────────────────────────────

  /**
   * Builds the operations to navigate the selection with arrow keys.
   * Extends the existing selection when `extend` is `true`.
   *
   * Returns `null` when the selection would not change.
   */
  buildArrowNavigationOps(
    context: EditorContext,
    direction: ArrowDirection,
    extend: boolean,
  ): Operation[] | null {
    if (!isSelectionActive(context.selection)) {
      return null
    }

    let origin: TextCursor
    let rangeAnchor: TextCursor | undefined

    if (isCursorSelection(context.selection)) {
      origin = context.selection.anchor
      rangeAnchor = extend ? context.selection.anchor : undefined
    } else {
      const normalized = normalizeRange(context.state, context.selection)
      if (extend) {
        origin = context.selection.focus
        rangeAnchor = context.selection.anchor
      } else {
        const collapseToStart = direction === 'left' || direction === 'up'
        origin = collapseToStart ? normalized.anchor : normalized.focus
        rangeAnchor = undefined
      }
    }

    const nextFocus = stepTextCursor(context.state, origin, direction, {
      getNext: (text, offset) =>
        this.#graphemeOffsetCaret.getNextOffset(text, offset),
      getPrev: (text, offset) =>
        this.#graphemeOffsetCaret.getPrevOffset(text, offset),
      snapToBoundary: (text, offset) =>
        this.#graphemeOffsetCaret.snapOffsetToBoundary(text, offset),
    })
    if (!nextFocus) {
      if (!extend && isRangeSelection(context.selection)) {
        const collapsed = createCursor(origin)
        const isEqual = areSelectionsEqual(
          {
            anchor: collapsed.anchor,
          },
          { anchor: context.selection.anchor, focus: context.selection.focus },
        )

        if (isEqual) {
          return null
        }

        const ops: Operation[] = [
          {
            __type: 'set_selection',
            next: collapsed,
            prev: context.selection,
          },
        ]

        return ops
      }
      return null
    }

    const next =
      extend && rangeAnchor
        ? createRange(rangeAnchor, nextFocus)
        : createCursor(nextFocus)

    const isEqual = areSelectionsEqual(context.selection, next)
    if (isEqual) {
      return null
    }

    const ops: Operation[] = [
      {
        __type: 'set_selection',
        next,
        prev: context.selection,
      },
    ]

    return ops
  }

  /**
   * Builds the operations to set the selection to the end of the last block in document order.
   * Returns `null` when the selection is already set so we can skip it.
   */
  buildPutCursorSelectionAtDocumentEndOps(
    context: EditorContext,
  ): Operation[] | null {
    const next = createCursorAtDocumentEnd(context.state)
    if (!next) {
      buildError(
        'Failed to create cursor selection at document end',
        'OperationsEngine/buildPutCursorSelectionAtDocumentEndOps',
      )
    }

    const prev = context.selection

    /** Skip if the selection is already at the end of the document. */
    if (
      prev?.__type === 'cursor' &&
      prev.anchor.blockId === next.anchor.blockId &&
      prev.anchor.nodeId === next.anchor.nodeId &&
      prev.anchor.offset === next.anchor.offset
    ) {
      return null
    }

    return [
      {
        __type: 'set_selection',
        next,
        prev,
      },
    ]
  }

  /** Builds the operations to update selection. */
  buildUpdateSelectionOps(
    context: EditorContext,
    next: Selection | null,
  ): Operation[] | null {
    /** Skip if the selection is already the same. */
    if (areSelectionsEqual(context.selection, next)) {
      return null
    }

    const ops: Operation[] = [
      {
        __type: 'set_selection',
        next,
        prev: context.selection,
      },
    ]

    return ops
  }

  /** Builds the operations to clear the selection. */
  buildClearSelectionOps(context: EditorContext): Operation[] | null {
    const { selection } = context

    /** Skip if the selection is already set to `null`. */
    if (!selection) {
      return null
    }

    const ops: Operation[] = [
      {
        __type: 'set_selection',
        next: null,
        prev: selection,
      },
    ]

    return ops
  }

  // --- Blocks operations ─────────────────────────────────────────---

  /** Builds the operations to insert a block at the given position. */
  buildInsertBlockOps(
    context: EditorContext,
    insertPos: InsertBlockOpPosition,
    block: BlockWithoutPosKey,
  ): Operation[] {
    const { state } = context

    const afterBlockId = resolveInsertAfterBlockId(state, insertPos)
    const posKey = computeInsertBlockPosKey(state, insertPos)

    const blockWithPosKey: Block = { ...block, posKey }

    return [
      {
        __type: 'insert_block',
        afterBlockId,
        block: blockWithPosKey,
      },
    ]
  }

  /** Builds the operations to delete a block by ID. */
  buildDeleteBlockOps(
    context: EditorContext,
    blockId: BlockId,
  ): Operation[] | null {
    const { state } = context
    const block = getBlock(state, blockId)
    const idx = getBlockIndex(state, blockId)
    const isEmpty = isBlockWithInlineContentEmpty(state, blockId)

    /** Invariant: skip deletion of the first empty block. */
    if (idx === 0 && isEmpty) {
      return null
    }

    let afterBlockId: BlockId | null = null
    if (idx > 0) {
      afterBlockId = state.blockOrderById[idx - 1] ?? null
    }

    return [{ __type: 'delete_block', afterBlockId, blockId, snapshot: block }]
  }
}
