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
  deleteBlock,
  getBlock,
  getBlockWithInlineContent,
  insertBlock,
  normalizeRange,
  removeBlock,
  replaceBlock,
  resolveInsertAfterBlockId,
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
import { isModKey } from './keyboard'
import { isMarkEnabled, isMarksEqual, toggleMarkFlag } from './marks'
import type { MarkKey, Marks } from './marks'
import {
  coalesceInlineNodes,
  createLineBreakNode,
  createTextNode,
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
import { createCursor, cursorAtBlockEnd, cursorAtBlockStart } from './selection'
import type { TextCursor } from './selection'
import { assertNever } from './utils'

// --- Core engine ─────────────────────────────────────────---------

/** Throws a validation {@link DactyloError} for a failed op check. */
export function validationError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'VALIDATE_TRANSACTION_OPERATIONS',
    hint: 'OperationsEngine/validateOps',
    message,
    payload: { op },
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

/** Asserts a mark range `[from, to)` lies within a text node's bounds. */
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

/**
 * Validates a batch of operations against current state.
 * Throws when operations do no respects the rules implemented in the editor.
 */
export function validateOps(
  context: EditorContext,
  ops: readonly Operation[],
): void {
  for (const op of ops) {
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
        assertNever(type, { hint: 'OperationsEngine/validateOps' })
      }
    }
  }
}

/** Throws an apply {@link DactyloError} for a failed op check. */
export function applyError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'APPLY_TRANSACTION_OPERATIONS',
    hint: 'OperationsEngine/applyOps',
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

  const updatedTarget = touchBlock({ ...target, content: mergedContent })

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
  if (node.__type !== 'text') {
    applyError('`split_block` atNodeId target must be a text node', op)
  }

  const content = [...block.content]

  const headText = node.text.slice(0, op.atOffset)
  const tailText = node.text.slice(op.atOffset)

  const headNodes: InlineNode[] = content.slice(0, index)
  if (headText.length > 0 || headNodes.length === 0) {
    headNodes.push({ ...node, text: headText, updatedAt: new Date() })
  }

  const tailNodes: InlineNode[] = []
  if (tailText.length > 0) {
    tailNodes.push(createTextNode({ marks: node.marks, text: tailText }))
  }
  tailNodes.push(...content.slice(index + 1))

  const updatedOriginal = touchBlock({
    ...block,
    content: coalesceInlineNodes(headNodes),
  })

  let doc = replaceBlock(context.state, op.blockId, updatedOriginal)
  const newBlock: BlockWithInlineContent = {
    ...op.newBlock,
    content: coalesceInlineNodes(tailNodes),
  }
  doc = insertBlock(doc, newBlock)

  return withDocumentState(context, doc)
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

/** Applies a single operation to the editor context. */
export function applyOp(context: EditorContext, op: Operation): EditorContext {
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

/**
 * Apply operations in order, left to right.
 * Pure - no history, no events.
 */
export function applyOps(
  context: EditorContext,
  ops: readonly Operation[],
): EditorContext {
  let next = { ...context }

  for (const op of ops) {
    next = applyOp(next, op)
  }

  return next
}

export function invertError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'INVERT_TRANSACTION_OPERATIONS',
    hint: 'OperationsEngine/invertOps',
    message,
    payload: { op },
  })
}

/**
 * Inverts a batch of operations in reverse application order
 * to restore the prior context.
 *
 */
export function invertOps(ops: readonly Operation[]): readonly Operation[] {
  const reversed = ops.toReversed()
  const invertedOps: Operation[] = []

  for (const op of reversed) {
    const type = op.__type
    switch (type) {
      case 'insert_block': {
        invertedOps.push({
          __type: 'delete_block',
          afterBlockId: op.afterBlockId,
          blockId: op.block.id,
          snapshot: op.block,
        })
        break
      }
      case 'delete_block': {
        invertedOps.push({
          __type: 'insert_block',
          afterBlockId: op.afterBlockId,
          block: op.snapshot,
        })
        break
      }
      case 'split_block': {
        invertedOps.push({
          __type: 'merge_blocks',
          atIndex: op.atIndex,
          mergedTailSnapshot: [...op.tailSnapshot],
          sourceBlockId: op.newBlock.id,
          sourceSnapshot: op.newBlock,
          splitAtNodeId: op.atNodeId,
          splitAtOffset: op.atOffset,
          targetBlockId: op.blockId,
        })
        break
      }
      case 'merge_blocks': {
        invertedOps.push({
          __type: 'split_block',
          atIndex: op.atIndex,
          atNodeId: op.splitAtNodeId,
          atOffset: op.splitAtOffset,
          blockId: op.targetBlockId,
          newBlock: op.sourceSnapshot,
          tailSnapshot: [...op.mergedTailSnapshot],
        })
        break
      }
      case 'insert_text': {
        invertedOps.push({
          __type: 'delete_text',
          blockId: op.blockId,
          length: op.text.length,
          nodeId: op.nodeId,
          offset: op.offset,
          snapshot: {
            marks: op.marks,
            text: op.text,
          },
        })
        break
      }
      case 'delete_text': {
        invertedOps.push({
          __type: 'insert_text',
          blockId: op.blockId,
          marks: op.snapshot.marks,
          nodeId: op.nodeId,
          offset: op.offset,
          text: op.snapshot.text,
        })
        break
      }
      case 'insert_inline_node': {
        invertedOps.push({
          __type: 'remove_inline_node',
          blockId: op.blockId,
          index: op.index,
          snapshot: op.node,
        })
        break
      }
      case 'remove_inline_node': {
        invertedOps.push({
          __type: 'insert_inline_node',
          blockId: op.blockId,
          index: op.index,
          node: op.snapshot,
        })
        break
      }
      case 'set_active_marks': {
        invertedOps.push({
          __type: 'set_active_marks',
          activeMarks: op.prevActiveMarks,
          prevActiveMarks: op.activeMarks,
        })
        break
      }
      case 'set_marks': {
        invertedOps.push({
          __type: 'set_marks',
          blockId: op.blockId,
          from: op.from,
          nextMarks: op.prevMarks,
          nodeId: op.nodeId,
          prevMarks: op.nextMarks,
          to: op.to,
        })
        break
      }
      case 'set_selection': {
        invertedOps.push({
          __type: 'set_selection',
          next: op.prev,
          prev: op.next,
        })
        break
      }
      default: {
        assertNever(type, { hint: 'OperationsEngine/invertOps' })
      }
    }
  }

  return invertedOps
}

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
  atNodeId: NodeId,
  atOffset: number,
): InlineNode[] {
  const found = findNodeInBlockWithInlineContent(block, atNodeId)
  if (!found) {
    return []
  }

  const { node, index } = found
  if (node.__type !== 'text') {
    return []
  }

  const tailText = node.text.slice(atOffset)
  const tailNodes: InlineNode[] = []

  if (tailText.length > 0) {
    tailNodes.push(createTextNode({ marks: node.marks, text: tailText }))
  }

  tailNodes.push(...block.content.slice(index + 1))

  return tailNodes
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
export function buildSetMarksOps(
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

// --- Keyboard operations ─────────────────────────────────────────-

/** Intent for building keyboard operations. */
export interface KeyboardOpsIntent {
  /** The operations to apply. */
  ops: Operation[]
  /** The kind for the intent. */
  label: string
  /** When `true` merge history action for rapid typing coalescing. */
  coalesce: boolean
}

/**
 * Builds operations for a single typed character at the current cursor position.
 * When the typed character is a `space` checks for markdown shortcut triggers.
 */
// @todo: handle coalesce behaviors
export function buildTypedCharOps(
  context: EditorContext,
  /** Collapsed cursor anchor for the pending edit. */
  cursor: TextCursor,
  /** The character to insert. */
  char: string,
): KeyboardOpsIntent {
  const { state } = context

  let ops: Operation[] = []
  const block = getBlockWithInlineContent(state, cursor.blockId)

  ops = [
    {
      __type: 'insert_text',
      blockId: block.id,
      marks: context.activeMarks,
      nodeId: cursor.nodeId,
      offset: 0,
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

  if (char !== ' ') {
    return { coalesce: true, label: `insert_char:${char}`, ops }
  }

  //@todo: detects markdown shortcut

  return { coalesce: false, label: `[TBD]`, ops }
}

/**
 * Builds operations when user presses `Backspace` key,
 * to delete the previous typed character or merge with previous block at block start.
 */
// @todo: handle coalesce behaviors
// @todo: handle links, mentions, and line breaks.
export function buildBackspaceOps(
  context: EditorContext,
  /** Collapsed cursor anchor for the pending edit. */
  cursor: TextCursor,
): KeyboardOpsIntent | null {
  /** Merges the current block into the previous block when backspacing at block start. */
  if (cursor.offset === 0) {
    const index = context.state.blockOrderById.indexOf(cursor.blockId)
    /**
     * 👉🏻 Expected UX:
     * At the very start of the document (first block, offset = 0), `Backspace` key typically
     * deletes nothing. We are not at "delete the character before the cursor" (→ offset - 1),
     * because we already took the block-start branch and there is no previous block to join with.
     */
    if (index <= 0) {
      return null
    }

    const prevBlockId = context.state.blockOrderById[index - 1]
    if (prevBlockId === undefined) {
      buildError(
        `Previous block ID is not found for block ${cursor.blockId}`,
        'OperationsEngine/buildBackspaceOps',
      )
    }

    const prevBlock = getBlockWithInlineContent(context.state, prevBlockId)
    const sourceBlock = getBlockWithInlineContent(context.state, cursor.blockId)

    const { splitAtNodeId, splitAtOffset } = resolvesMergeBlocksUndoFields(
      sourceBlock,
      prevBlock,
      context.activeMarks,
    )

    const endSelection =
      cursorAtBlockEnd(prevBlockId, prevBlock) ??
      createCursor({
        blockId: prevBlockId,
        nodeId: prevBlock.content.at(-1)?.id ?? cursor.nodeId,
        offset: 0,
      })

    const ops: Operation[] = [
      {
        __type: 'merge_blocks',
        atIndex: prevBlock.content.length,
        mergedTailSnapshot: [...sourceBlock.content],
        sourceBlockId: cursor.blockId,
        sourceSnapshot: sourceBlock,
        splitAtNodeId,
        splitAtOffset,
        targetBlockId: prevBlockId,
      },
      {
        __type: 'set_selection',
        next: endSelection,
        prev: context.selection,
      },
    ]

    return {
      coalesce: true,
      label: `merge_blocks`,
      ops,
    }
  }

  const { state } = context

  const block = getBlockWithInlineContent(state, cursor.blockId)
  const found = findNodeInBlockWithInlineContent(block, cursor.nodeId)

  if (!found || found.node.__type !== 'text') {
    buildError(
      `Node ${cursor.nodeId} not found in block ${block.id}`,
      'OperationsEngine/buildDeletePreviousTypedCharOps',
    )
  }

  const { node } = found

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

  return { coalesce: true, label: 'delete_character', ops }
}

/** Builds operations when user presses `Enter` key as a hard break. */
// @todo: handle special node splits like links
// @todo: handle other upcoming blocks like lists, quotes, ...
export function buildHardBreakOps(
  context: EditorContext,
  cursor: TextCursor,
): KeyboardOpsIntent {
  const block = getBlockWithInlineContent(context.state, cursor.blockId)

  const found = findNodeInBlockWithInlineContent(block, cursor.nodeId)
  if (!found || found.node.__type !== 'text') {
    buildError(
      `Node ${cursor.nodeId} not found in block ${block.id}`,
      'OperationsEngine/buildHardBreakOps',
    )
  }

  const { node, index } = found

  const tailSnapshot = computeSplitTailSnapshot(block, node.id, cursor.offset)
  const insertedBlock = createParagraphBlockAfter(block, tailSnapshot)

  const startSelection = cursorAtBlockStart(insertedBlock.id, insertedBlock)

  if (!startSelection) {
    buildError(
      `Failed to create start selection for inserted block ${insertedBlock.id}`,
      'OperationsEngine/buildHardBreakOps',
    )
  }

  const ops: Operation[] = [
    {
      __type: 'split_block',
      atIndex: index,
      atNodeId: cursor.nodeId,
      atOffset: cursor.offset,
      blockId: block.id,
      newBlock: insertedBlock,
      tailSnapshot,
    },
    {
      __type: 'set_selection',
      next: startSelection,
      prev: context.selection,
    },
  ]

  return { coalesce: false, label: 'split_blocks', ops }
}

/** Builds operations when user presses `shift+Enter` key as a soft break. */
// @todo: handle special node splits like links
// @todo: handle other upcoming blocks like lists, quotes, ...
export function buildSoftBreakOps(
  context: EditorContext,
  cursor: TextCursor,
): KeyboardOpsIntent {
  const block = getBlockWithInlineContent(context.state, cursor.blockId)

  const found = findNodeInBlockWithInlineContent(block, cursor.nodeId)
  if (!found || found.node.__type !== 'text') {
    buildError(
      `Node ${cursor.nodeId} not found in block ${block.id}`,
      'OperationsEngine/buildSoftBreakOps',
    )
  }

  const { index } = found
  const insertedLineBreak = createLineBreakNode()

  const ops: Operation[] = [
    {
      __type: 'insert_inline_node',
      blockId: block.id,
      index: index + 1,
      node: insertedLineBreak,
    },
    {
      __type: 'set_selection',
      next: createCursor({
        blockId: cursor.blockId,
        nodeId: insertedLineBreak.id,
        offset: 0,
      }),
      prev: context.selection,
    },
  ]

  return { coalesce: false, label: 'insert_line_break', ops }
}

/**
 * Builds keyboard operations to handle a keyboard event.
 * Returns `null` when the selection is null or not a cursor selection.
 */
export function buildKeyboardOps(
  context: EditorContext,
  event: KeyboardEvent,
): KeyboardOpsIntent | null {
  const { selection } = context

  /** When we don't have any selection or it's not a cursor selection it's a no-op. */
  if (selection === null || selection?.__type !== 'cursor') {
    return null
  }

  const isMod = isModKey(event)
  /** When the event is a modifier key, it's a no-op. */
  if (isMod) {
    return null
  }

  /**
   * We build operations whe user presses `Enter` key.
   *  1. `Enter` solo is considered as an hard break.
   *  2. `shift+enter` is considered as a soft break.
   */
  if (event.key === 'Enter') {
    return event.shiftKey
      ? buildSoftBreakOps(context, selection.anchor)
      : buildHardBreakOps(context, selection.anchor)
  }

  /** We build operations when user presses `Backspace` key. */
  // @todo: handle mentions and slash commands
  if (event.key === 'Backspace') {
    return buildBackspaceOps(context, selection.anchor)
  }

  /** We build operations when a single character is pressed by user. */
  // @todo: handle mentions and slash commands
  if (event.key.length === 1) {
    return buildTypedCharOps(context, selection.anchor, event.key)
  }

  /** Event is not handled */
  return null
}

// --- Blocks operations ─────────────────────────────────────────---

/** Builds the operations to insert a block at the given position. */
export function buildInsertBlockOps(
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
export function buildDeleteBlockOps(
  context: EditorContext,
  blockId: BlockId,
): Operation[] {
  const { state } = context
  const block = getBlock(state, blockId)
  const idx = state.blockOrderById.indexOf(blockId)

  let afterBlockId: BlockId | null = null
  if (idx > 0) {
    afterBlockId = state.blockOrderById[idx - 1] ?? null
  }

  return [{ __type: 'delete_block', afterBlockId, blockId, snapshot: block }]
}
