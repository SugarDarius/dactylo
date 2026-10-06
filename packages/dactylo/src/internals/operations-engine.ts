import {
  createParagraphBlockAfter,
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
import {
  collectTextSpansInRange,
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
  removeBlock,
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
import type { ArrowDirection } from './keyboard'
import { isMarkEnabled, isMarksEqual, toggleMarkFlag } from './marks'
import type { MarkKey, Marks } from './marks'
import {
  coalesceInlineNodes,
  createLineBreakNode,
  createLinkNode,
  createTextNode,
  getInlineNodeTextLength,
  splitTextNodeAt,
} from './nodes'
import type { InlineNode, NodeId, TextNode } from './nodes'
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
  SetMarksOp,
  SetSelectionOp,
  SplitBlockOp,
} from './operations'
import {
  areSelectionsEqual,
  createCursor,
  createRange,
  cursorAtBlockEnd,
  cursorAtBlockStart,
  isCursorAtBlockEnd,
  isCursorSelection,
  isRangeSelection,
  isSelectionActive,
} from './selection'
import type { TextCursor } from './selection'
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

/** Finds a text node inside a block or throws. */
export function requireTextNode(
  block: BlockWithInlineContent,
  nodeId: NodeId,
  op: Operation,
): { node: TextNode; index: number } {
  const found = findNodeInBlockWithInlineContent(block, nodeId)
  if (!found || found.node.__type !== 'text') {
    validationError(`Text node ${nodeId} not found in block ${block.id}`, op)
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
// @todo: handle links and mentions
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

  if (found.node.__type === 'text') {
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

  validationError(`Cursor node ${cursor.nodeId} must be text or line_break`, op)
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

  if (splitNode.node.__type === 'text') {
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
  const { node } = requireTextNode(block, op.atNodeId, op)

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
  const { node } = requireTextNode(block, op.nodeId, op)

  assertOffsetInText(op.offset, node.text.length, op, 'Insert text offset')
}

/** Validates a `delete_text` operation. */
export function validateDeleteTextOp(
  context: EditorContext,
  op: DeleteTextOp,
): void | never {
  const block = requireBlockWithInlineContent(context.state, op.blockId, op)
  const { node } = requireTextNode(block, op.nodeId, op)

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
  const { node } = requireTextNode(block, op.nodeId, op)

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

  let doc = replaceBlock(context.state, op.targetBlockId, updatedTarget)
  doc = removeBlock(doc, op.sourceBlockId)

  return withDocumentState(context, doc)
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
    case 'text': {
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
    case 'link': {
      const headText = node.textNode.text.slice(0, op.atOffset)

      const headNodes: InlineNode[] = content.slice(0, index)
      if (headText.length > 0 || headNodes.length === 0) {
        const updatedAt = new Date()
        headNodes.push({
          ...node,
          textNode: { ...node.textNode, text: headText, updatedAt },
          updatedAt: new Date(),
        })
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

/**
 * Normalizes marks between active marks and a text node marks.
 *
 * When a text is inserted not by typing a character, then it means the text node is
 * inserted by an external source (e.g: copy/paste, Ai agent). So in that case the intent
 * is to say the final marks applied are the ones from the operation not the current active marks.
 *
 * By design it's a cascade: Text node marks > Active marks.
 */
export function applyNormalizedMarks(
  /** Active marks in the editor context. */
  editor: Marks,
  /** Marks required for inserting a text */
  text: Partial<Marks>,
): Marks {
  return { ...editor, ...text }
}

/** Applies an `insert_text` operation to the editor context. */
// @todo: handle links and mentions
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
  if (node.__type !== 'text') {
    applyError('`insert_text` target must be a text node', op)
  }

  const before = node.text.slice(0, op.offset)
  const after = node.text.slice(op.offset)

  const marks = op.marks
    ? applyNormalizedMarks(context.activeMarks, op.marks)
    : { ...context.activeMarks }

  /** When marks are the same we append the text in the same existing node. */
  if (isMarksEqual(node.marks, marks)) {
    const text = before + op.text + after
    const updated: TextNode = {
      ...node,
      text,
      updatedAt: new Date(),
    }

    content[index] = updated
  }
  /** Otherwise we split the node and create a new text node to insert the text. */
  else {
    const updates: InlineNode[] = []

    if (before.length > 0) {
      updates.push({
        ...node,
        text: before,
        updatedAt: new Date(),
      })
    }

    /* By design the text in the operation is never empty as its validated in the validation phase. */
    updates.push(
      createTextNode({
        marks,
        metadata: node.metadata,
        text: op.text,
      }),
    )

    if (after.length > 0) {
      updates.push(
        createTextNode({
          marks: node.marks,
          metadata: node.metadata,
          text: after,
        }),
      )
    }

    content.splice(index, 1, ...updates)
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

  if (node.__type !== 'text') {
    applyError('`delete_text` target must be a text node', op)
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
  if (node.__type !== 'text') {
    applyError('`set_marks` target must be a text node', op)
  }

  /**
   * Apply operation only on a non-empty range.
   * Otherwise for this operation it's a no-op.
   */
  if (op.from !== op.to) {
    const replacement = splitTextNodeAt(node, op.from, op.to, op.nextMarks)
    if (replacement.length === 0) {
      content.splice(index, 1)
    } else {
      content.splice(index, 1, ...replacement)
    }

    return updateBlockWithInlineContent(context, op.blockId, content)
  }

  return context
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

  if (last.__type === 'text') {
    return { splitAtNodeId: last.id, splitAtOffset: last.text.length }
  }

  return { splitAtNodeId: last.id, splitAtOffset: 0 }
}

/**
 * Inline nodes that move to the tail block when splitting a cursor.
 * Used by operations emitters to populate {@link SplitBlockOp} tailSnapshot field for undo.
 *
 * It mirrors tail extraction in {@link applySplitBlockOp}.
 */
export function computeSplitTailSnapshot(
  block: BlockWithInlineContent,
  atNode: { node: InlineNode; index: number },
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
      const tailText = node.textNode.text.slice(atOffset)
      return [
        createLinkNode({
          textNode: createTextNode({
            marks: node.textNode.marks,
            metadata: node.textNode.metadata,
            text: tailText,
          }),
          url: node.url,
        }),
        ...block.content.slice(index + 1),
      ]
    }
    case 'line_break':
    case 'mention': {
      return buildError(
        `Split tail is not allowed on ${type} node`,
        'OperationsEngine/computeSplitTailSnapshot',
      )
    }
    default: {
      assertNever(type, {
        hint: 'OperationsEngine/computeSplitTailSnapshot',
      })
    }
  }
}

/** Intent for building composing operations. */
export interface ComposingOpsIntent {
  /** The operations to apply. */
  ops: Operation[]
  /** The kind for the intent. */
  label: string
  /** When `true` merge history action for rapid typing coalescing. */
  coalesce: boolean
}

/** Options for constructing a {@link OperationsEngine} instance. */
export interface OperationsEngineOptions {
  /** Configuration for mentions. */
  mentions: {
    character: string
  }
  /** Configuration for slash command. */
  slashCommand: {
    character: string
  }
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
  /** Options for the operations engine. */
  #options: OperationsEngineOptions

  constructor(options: OperationsEngineOptions) {
    this.#options = options
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
        return withActiveMarks(context, op.activeMarks)
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
   * Builds the operations to toggle a mark on or off
   * and indicates if we should push the operation to the history stack.
   *
   * Returns `set_active_marks` operation when the selection is a cursor.
   * Returns `set_marks` operation when the selection is a range.
   * Returns `null` when the selection is null.
   */
  buildSetMarksOps(
    context: EditorContext,
    markKey: MarkKey,
  ): {
    /** The operations to apply. */
    ops: Operation[]
    /** The kind of the operation. */
    kind: 'set_active_marks' | 'set_marks'
  } | null {
    const { selection, state } = context

    /** When we don't have any selection it's a no-op. */
    if (selection === null) {
      return null
    }

    /**
     * When the selection is a cursor, we enable the active mark for the given mark key
     * for the whole document (e.g the mark is active on typing).
     */
    if (selection.__type === 'cursor') {
      const prev = context.activeMarks
      const next = toggleMarkFlag(prev, markKey)

      return {
        kind: 'set_active_marks',
        ops: [
          {
            __type: 'set_active_marks',
            activeMarks: next,
            prevActiveMarks: prev,
          },
        ],
      }
    }
    /**
     * When the selection is a range, we enable the active mark for the given mark key
     * only for the range of text nodes.
     */
    else if (selection.__type === 'range') {
      const normalized = normalizeRange(state, selection)
      const { anchor, focus } = normalized

      /**
       * Anchor must precede focus in document order.
       * We cannot accept this case as it's a contract-violation
       * because a {@link RangeSelection} is a non-empty text range.
       */
      if (compareTextCursors(state, anchor, focus) >= 0) {
        throw DactyloError.from({
          code: 'RANGE_SELECTION_COLLAPSED',
          hint: 'Use selection.__type === "cursor" (or toggleMark with a collapsed caret) to change activeMarks in editor context.',
          message:
            'Range selection is collapsed; expected anchor to precede focus.',
        })
      }

      /**
       * Collecting text spans must yield at least one text slice.
       * An empty span list is also a contract-violation (collapsed range stored as `range`, stale cursors,
       * or range or non-text-only inline nodes) - not a cue to toggle {@link EditorContext} active marks.
       *
       * Use only `selection.__type === 'cursor'` to toggle active marks.
       */
      const spans = collectTextSpansInRange(state, normalized)
      if (spans.length <= 0) {
        throw DactyloError.from({
          code: 'RANGE_SELECTION_NO_TEXT_SPANS',
          hint: 'Ensure the range covers at least one text node with non-zero length.',
          message: 'Range selection produced no text spans.',
        })
      }

      const enabling = spans.every((span) => {
        const block = getBlockWithInlineContent(state, span.blockId)
        const found = findNodeInBlockWithInlineContent(block, span.nodeId)

        if (!found || found.node.__type !== 'text') {
          return false
        }

        return isMarkEnabled(found.node.marks, markKey)
      })

      const ops: Operation[] = []

      for (const span of spans) {
        const block = getBlockWithInlineContent(state, span.blockId)
        const found = findNodeInBlockWithInlineContent(block, span.nodeId)

        if (!found || found.node.__type !== 'text') {
          continue
        }

        const { node } = found
        const nextMarks: Marks = { ...node.marks }

        if (enabling) {
          nextMarks[markKey] = true
        }

        ops.push({
          __type: 'set_marks',
          blockId: span.blockId,
          from: span.from,
          nextMarks,
          nodeId: span.nodeId,
          prevMarks: { ...node.marks },
          to: span.to,
        })
      }

      return {
        kind: 'set_marks',
        ops,
      }
    }

    return null
  }

  // --- Composing operations ─────────────────────────────────────────

  /**
   * Builds operations for a single typed character at the current cursor position.
   * When the typed character is a `space` checks for markdown shortcut triggers.
   */
  // @todo: handle coalesce behaviors
  buildTypedCharOps(
    context: EditorContext,
    /** Collapsed cursor anchor for the pending edit. */
    cursor: TextCursor,
    /** The character to insert. */
    char: string,
  ): ComposingOpsIntent {
    const { state } = context

    let ops: Operation[] = []
    const block = getBlockWithInlineContent(state, cursor.blockId)

    ops = [
      {
        __type: 'insert_text',
        blockId: block.id,
        marks: context.activeMarks,
        nodeId: cursor.nodeId,
        offset: cursor.offset,
        text: char,
      },
      {
        __type: 'set_selection',
        next: createCursor({
          blockId: block.id,
          nodeId: cursor.nodeId,
          offset: cursor.offset + char.length,
        }),
        prev: context.selection,
      },
    ]

    // oxlint-disable-next-line no-negated-condition no-else-return unicorn/prefer-ternary
    if (char === ' ') {
      // @todo: handle markdown shortcut
      return { coalesce: true, label: `insert-char:${char}`, ops }
    } else if (char === this.#options.mentions.character) {
      // @todo: handle mentions
      return { coalesce: true, label: `mention`, ops }
    } else if (char === this.#options.slashCommand.character) {
      // @todo: handle slash command
      return { coalesce: true, label: `slash-command`, ops }
    }

    return { coalesce: true, label: `insert-char:${char}`, ops }
  }

  /** Merges the current block into the previous block when backspacing at block start. */
  // @todo: handle blocks with no inline content
  #buildMergeBlocksOps(
    context: EditorContext,
    /** Collapsed cursor anchor for the pending edit. */
    cursor: TextCursor,
    block: BlockWithInlineContent,
  ): ComposingOpsIntent {
    const neighbors = getBlockNeighbors(context.state, block.id)
    /** Should not happen as we already checked if there is only one block in the document. */
    if (neighbors.prev === null) {
      buildError(
        `Previous block ID is not found for block ${cursor.blockId}`,
        'OperationsEngine/buildCursorBackspaceOps',
      )
    }

    const prevBlock = getBlockWithInlineContent(context.state, neighbors.prev)
    const { splitAtNodeId, splitAtOffset } = resolvesMergeBlocksUndoFields(
      block,
      prevBlock,
      context.activeMarks,
    )

    const endSelection =
      cursorAtBlockEnd(prevBlock.id, prevBlock) ??
      createCursor({
        blockId: prevBlock.id,
        nodeId: prevBlock.content.at(-1)?.id ?? cursor.nodeId,
        offset: 0,
      })

    const ops: Operation[] = [
      {
        __type: 'merge_blocks',
        atIndex: prevBlock.content.length,
        mergedTailSnapshot: [...block.content],
        sourceBlockId: block.id,
        sourceSnapshot: block,
        splitAtNodeId,
        splitAtOffset,
        targetBlockId: prevBlock.id,
      },
      {
        __type: 'set_selection',
        next: endSelection,
        prev: context.selection,
      },
    ]

    return {
      coalesce: true,
      label: `merge-blocks`,
      ops,
    }
  }

  /**
   * Builds operations when user presses `Backspace` key,
   * to delete the previous typed character or merge with previous block at block start.
   */
  // @todo: handle links
  buildCursorBackspaceOps(
    context: EditorContext,
    /** Collapsed cursor anchor for the pending edit. */
    cursor: TextCursor,
  ): ComposingOpsIntent | null {
    const block = getBlockWithInlineContent(context.state, cursor.blockId)
    const blockIndex = getBlockIndex(context.state, block.id)

    const found = findNodeInBlockWithInlineContent(block, cursor.nodeId)
    if (!found || found.node.__type !== 'text') {
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
          'OperationsEngine/buildCursorBackspaceOps',
        )
      }

      const prevType = prevNode.__type
      // @todo: handle links
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

          if (before.__type === 'text') {
            ops.push(
              {
                __type: 'insert_text',
                blockId: block.id,
                marks: node.marks,
                nodeId: before.id,
                offset: before.text.length,
                text: node.text,
              },
              {
                __type: 'set_selection',
                next: createCursor({
                  blockId: block.id,
                  nodeId: before.id,
                  offset: before.text.length,
                }),
                prev: context.selection,
              },
            )
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
          return { coalesce: true, label: 'remove-node-and-merge', ops }
        }
        /** Merge the current node with the previous node. */
        default: {
          const offset = getInlineNodeTextLength(prevNode)
          const ops: Operation[] = [
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
              offset,
              text: node.text,
            },
            {
              __type: 'set_selection',
              next: createCursor({
                blockId: block.id,
                nodeId: prevNode.id,
                offset,
              }),
              prev: context.selection,
            },
          ]

          return { coalesce: true, label: 'merge-node-and-insert-text', ops }
        }
      }
    }

    /**
     * 2️⃣ Second case where the cursor is somewhere inside a node.
     * We checks if we must:
     *  1. Delete the previous character
     *  2. Or, delete the previous char and update a link
     */
    const ops: Operation[] = [
      {
        __type: 'delete_text',
        blockId: cursor.blockId,
        length: 1,
        nodeId: cursor.nodeId,
        offset: cursor.offset - 1,
        snapshot: {
          marks: node.marks,
          text: node.text[cursor.offset - 1] ?? '',
        },
      },
      {
        __type: 'set_selection',
        next: createCursor({
          blockId: cursor.blockId,
          nodeId: cursor.nodeId,
          offset: cursor.offset - 1,
        }),
        prev: context.selection,
      },
    ]

    return { coalesce: true, label: 'delete-character', ops }
  }

  /** Builds operations when user presses `Enter` key as a hard break. */
  buildHardBreakOps(
    context: EditorContext,
    cursor: TextCursor,
  ): ComposingOpsIntent {
    const block = getBlockWithInlineContent(context.state, cursor.blockId)

    const found = findNodeInBlockWithInlineContent(block, cursor.nodeId)
    if (!found || found.node.__type !== 'text') {
      buildError(
        `Node ${cursor.nodeId} not found in block ${block.id}`,
        'OperationsEngine/buildHardBreakOps',
      )
    }

    const isBlockEnd = isCursorAtBlockEnd(cursor, block)
    /** At block end we insert a new block after the current one. */
    if (isBlockEnd) {
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

      return { coalesce: false, label: 'insert-block', ops }
    }

    /** Otherwise we split the block at the cursor position. */
    const tailSnapshot = computeSplitTailSnapshot(block, found, cursor.offset)
    const insertedBlock = createParagraphBlockAfter(
      block,
      tailSnapshot,
      block.metadata,
    )

    const ops: Operation[] = [
      {
        __type: 'split_block',
        atIndex: found.index,
        atNodeId: cursor.nodeId,
        atOffset: cursor.offset,
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

    return { coalesce: false, label: 'split-block', ops }
  }

  /** Builds operations when user presses `shift+Enter` key as a soft break. */
  // @todo: handle other upcoming blocks like lists, quotes, ...
  buildSoftBreakOps(
    context: EditorContext,
    cursor: TextCursor,
  ): ComposingOpsIntent {
    const block = getBlockWithInlineContent(context.state, cursor.blockId)

    const found = findNodeInBlockWithInlineContent(block, cursor.nodeId)
    if (!found) {
      buildError(
        `Node ${cursor.nodeId} not found in block ${block.id}`,
        'OperationsEngine/buildSoftBreakOps',
      )
    }

    const { index, node } = found

    const isBlockEnd = isCursorAtBlockEnd(cursor, block)
    /** At block end we insert a new line break node followed by an empty text node. */
    if (isBlockEnd) {
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
            blockId: cursor.blockId,
            nodeId: insertedText.id,
            offset: 0,
          }),
          prev: context.selection,
        },
      ]

      return { coalesce: false, label: 'insert-line-break-node', ops }
    }

    /** Otherwise we split the node at the cursor position. */
    const type = node.__type
    switch (type) {
      case 'text': {
        const tailText = node.text.slice(cursor.offset)
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
            offset: cursor.offset,
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
              blockId: cursor.blockId,
              nodeId: insertedText.id,
              offset: 0,
            }),
            prev: context.selection,
          },
        ]

        return {
          coalesce: false,
          label: 'split-inline-node-and-insert-line-break-node',
          ops,
        }
      }
      case 'link': {
        const tailText = node.textNode.text.slice(cursor.offset)
        const insertedText = createTextNode({
          marks: node.textNode.marks,
          metadata: node.textNode.metadata,
          text: tailText,
        })
        const insertedLink = createLinkNode({
          metadata: node.metadata,
          textNode: insertedText,
          url: node.url,
        })

        const ops: Operation[] = [
          {
            __type: 'delete_text',
            blockId: block.id,
            length: tailText.length,
            nodeId: node.textNode.id,
            offset: cursor.offset,
            snapshot: {
              marks: node.textNode.marks,
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
              blockId: cursor.blockId,
              nodeId: insertedText.id,
              offset: 0,
            }),
            prev: context.selection,
          },
        ]

        return {
          coalesce: false,
          label: 'split-inline-node-and-insert-line-break-node',
          ops,
        }
      }
      case 'line_break':
      case 'mention': {
        return buildError(
          `Split tail is not allowed on ${type} node`,
          'OperationsEngine/buildSoftBreakOps',
        )
      }
      default: {
        assertNever(type, { hint: 'OperationsEngine/buildSoftBreakOps' })
      }
    }
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

    const nextFocus = stepTextCursor(context.state, origin, direction)
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

  /** Builds the operations to clear the selection. */
  buildClearSelectionOps(context: EditorContext): Operation[] | null {
    const { selection } = context

    /** Skip if the selection is already set to `null`. */
    if (!selection) {
      return null
    }

    return [
      {
        __type: 'set_selection',
        next: null,
        prev: selection,
      },
    ]
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
