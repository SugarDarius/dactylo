import {
  createHeadingBlock,
  createParagraphBlock,
  findNodeInBlockWithInlineContent,
  isBlockWithInlineContent,
  sortBlockOrder,
  touchBlock,
} from './blocks'
import type { BlockId, BlockWithInlineContent } from './blocks'
import {
  deleteBlock,
  getBlock,
  getBlockWithInlineContent,
  insertBlock,
  replaceBlock,
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
import { getInlineNodeTextLength, isInlineNodeWithEditableText } from './nodes'
import type { InlineNode, InlineNodeWithEditableText, NodeId } from './nodes'
import type {
  DeleteBlockOp,
  DeleteTextOp,
  InsertBlockOp,
  InsertInlineNodeOp,
  InsertTextOp,
  MergeBlocksOp,
  MutateBlockTypeOp,
  Operation,
  RemoveInlineNodeOp,
  SetActiveMarksOp,
  SetMarksOp,
  SetSelectionOp,
  SplitBlockOp,
} from './operations'
import { sanitizeText } from './sanitize-text'
import type { TextCursor } from './selection'
import { assertNever } from './utils'

// --- Validate ─────────────────────────────────────────------------

/** Throws a validation {@link DactyloError} for a failed op check. */
export function validationError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'VALIDATE_TRANSACTION_OPERATIONS',
    hint: 'OperationsRuntime/validateOp',
    message,
    payload: { operation: op },
  })
}

/** Returns a block with accepted inline-content or throws. */
export function requireBlockWithInlineContent(
  state: DocumentState,
  blockId: BlockId,
  op: Operation,
): BlockWithInlineContent {
  const block = getBlock(state, blockId)

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
  /** Target node text length. */
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

  if (found.node.__type === 'mention') {
    const length = getInlineNodeTextLength(found.node)
    if (cursor.offset !== 0 && cursor.offset !== length) {
      validationError(
        `Cursor offset ${cursor.offset} invalid for mention. Must be 0 or ${length}`,
        op,
      )
    }
    return
  }

  validationError(`Cursor node ${cursor.nodeId} must be text, link`, op)
}

/** Validates an {@link InsertBlockOp} operation. */
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

/** Validates a {@link DeleteBlockOp} operation. */
export function validateDeleteBlockOp(
  context: EditorContext,
  op: DeleteBlockOp,
): void | never {
  if (op.snapshot.id !== op.blockId) {
    validationError(
      `Snapshot block ID ${op.snapshot.id} does not match deleted block ID ${op.blockId}`,
      op,
    )
  }

  if (op.snapshot.id !== op.blockId) {
    validationError(
      `Snapshot block ID ${op.snapshot.id} does not match deleted block ID ${op.blockId}`,
      op,
    )
  }

  if (context.state.blockOrderById.length === 1) {
    validationError(`Cannot delete last block in document`, op)
  }
}

/** Validates a {@link SplitBlockOp} operation. */
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

/** Validates a {@link MergeBlocksOp} operation. */
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

/** Validates a {@link MutateBlockTypeOp} operation. */
export function validateMutateBlockTypeOp(
  context: EditorContext,
  op: MutateBlockTypeOp,
): void | never {
  requireBlockWithInlineContent(context.state, op.blockId, op)
  if (op.snapshot.id !== op.blockId) {
    validationError(
      `Snapshot block ID ${op.snapshot.id} does not match mutated block ID ${op.blockId}`,
      op,
    )
  }
}

/** Validates an {@link InsertTextOp} operation. */
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
}

/** Validates a {@link DeleteTextOp} operation. */
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

/** Validates a {@link InsertInlineNodeOp} operation. */
export function validateInsertInlineNodeOp(
  context: EditorContext,
  op: InsertInlineNodeOp,
): void | never {
  const block = requireBlockWithInlineContent(context.state, op.blockId, op)
  if (op.index < 0 || op.index > block.content.length) {
    validationError(`Insert index ${op.index} out of bounds`, op)
  }
}

/** Validates a {@link RemoveInlineNodeOp} operation. */
export function validateRemoveInlineNodeOp(
  context: EditorContext,
  op: RemoveInlineNodeOp,
): void | never {
  const block = requireBlockWithInlineContent(context.state, op.blockId, op)
  if (op.index < 0 || op.index >= block.content.length) {
    validationError(`Remove index ${op.index} out of bounds`, op)
  }
}

/** Validates a {@link SetMarksOp} operation. */
export function validateSetMarksOp(
  context: EditorContext,
  op: SetMarksOp,
): void | never {
  const block = requireBlockWithInlineContent(context.state, op.blockId, op)
  const { node } = requireInlineNodeWithEditableText(block, op.nodeId, op)

  assertRangeInText(op.from, op.to, node.text.length, op)
}

/** Validates a {@link SetSelectionOp} operation. */
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

/**
 * Validates an operation against {@link EditorContext} and invariant rules.
 * Throws a {@link DactyloError} on failure.
 */
export function validateOp(context: EditorContext, op: Operation): void {
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
    case 'mutate_block_type': {
      validateMutateBlockTypeOp(context, op)
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
      assertNever(type, { hint: 'OperationsRuntime/validateOp' })
    }
  }
}

// --- Apply ─────────────────────────────────────────---------------

/** Throws an apply {@link DactyloError} for a failed op check. */
export function applyError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'APPLY_TRANSACTION_OPERATIONS',
    hint: 'OperationsRuntime/applyOp',
    message,
    payload: { operation: op },
  })
}

/** Applies an {@link InsertBlockOp} operation to {@link EditorContext}. */
export function applyInsertBlockOp(
  context: EditorContext,
  op: InsertBlockOp,
): EditorContext {
  let state = insertBlock(context.state, op.block)

  state = { ...state, blockOrderById: sortBlockOrder(state.blocks) }
  return withDocumentState(context, state)
}

/** Applies a {@link DeleteBlockOp} operation to {@link EditorContext}. */
export function applyDeleteBlockOp(
  context: EditorContext,
  op: DeleteBlockOp,
): EditorContext {
  const state = deleteBlock(context.state, op.blockId)
  return withDocumentState(context, state)
}

/** Applies a {@link SplitBlockOp} operation to {@link EditorContext}. */
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
        content: headNodes,
      })

      let doc = replaceBlock(context.state, op.blockId, updatedOriginal)
      doc = insertBlock(doc, op.newBlock)

      return withDocumentState(context, doc)
    }
    case 'line_break':
    case 'mention': {
      return applyError(`Split tail is not allowed on ${type} node`, op)
    }
    default: {
      assertNever(type, {
        hint: 'OperationsRuntime/applySplitBlockOp',
      })
    }
  }
}

/**
 * Applies a {@link MergeBlocksOp} operation to {@link EditorContext}.
 * It splices source content into target at `op.atIndex`, then removes source blocks.
 */
export function applyMergeBlocksOp(
  context: EditorContext,
  op: MergeBlocksOp,
): EditorContext {
  const target = getBlockWithInlineContent(context.state, op.targetBlockId)
  const source = getBlockWithInlineContent(context.state, op.sourceBlockId)

  const mergedContent = [
    ...target.content.slice(0, op.atIndex),
    ...source.content,
    ...target.content.slice(op.atIndex),
  ]

  // @todo: add a policy config to merge blocks metadata
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

/** Applies a {@link MutateBlockTypeOp} operation to {@link EditorContext}. */
export function applyMutateBlockTypeOp(
  context: EditorContext,
  op: MutateBlockTypeOp,
): EditorContext {
  const prev = getBlockWithInlineContent(context.state, op.blockId)

  const { kind } = op.spec
  switch (kind) {
    case 'to_heading': {
      const next = createHeadingBlock({
        content: [...prev.content],
        level: op.spec.level,
        metadata: op.dropMetadata ? undefined : prev.metadata,
        parentId: prev.parentId,
        posKey: prev.posKey,
      })

      return withDocumentState(
        context,
        replaceBlock(
          context.state,
          op.blockId,
          touchBlock({ ...next, createdAt: prev.createdAt, id: prev.id }),
        ),
      )
    }
    case 'to_paragraph': {
      const next = createParagraphBlock({
        content: [...prev.content],
        metadata: op.dropMetadata ? undefined : prev.metadata,
        parentId: prev.parentId,
        posKey: prev.posKey,
      })

      return withDocumentState(
        context,
        replaceBlock(
          context.state,
          op.blockId,
          touchBlock({ ...next, createdAt: prev.createdAt, id: prev.id }),
        ),
      )
    }
    default: {
      assertNever(kind, {
        hint: 'OperationsRuntime/applyMutateBlockTypeOp',
      })
    }
  }
}

/** Applies an {@link InsertTextOp} operation to {@link EditorContext}. */
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

  const sanitized = sanitizeText(op.text)
  const text = before + sanitized + after

  content[index] = {
    ...node,
    text,
    updatedAt: new Date(),
  }

  return updateBlockWithInlineContent(context, op.blockId, content)
}

/** Applies a {@link DeleteTextOp} operation to {@link EditorContext}. */
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

/** Applies a {@link InsertInlineNodeOp} operation to {@link EditorContext}. */
export function applyInsertInlineNodeOp(
  context: EditorContext,
  op: InsertInlineNodeOp,
): EditorContext {
  const block = getBlockWithInlineContent(context.state, op.blockId)

  const content = [...block.content]
  content.splice(op.index, 0, op.node)

  return updateBlockWithInlineContent(context, op.blockId, content)
}

/** Applies a {@link RemoveInlineNodeOp} operation to {@link EditorContext}. */
export function applyRemoveInlineNodeOp(
  context: EditorContext,
  op: RemoveInlineNodeOp,
): EditorContext {
  const block = getBlockWithInlineContent(context.state, op.blockId)

  const content = [...block.content]
  content.splice(op.index, 1)

  return updateBlockWithInlineContent(context, op.blockId, content)
}

/** Applies a {@link SetActiveMarksOp} operation to {@link EditorContext}. */
export function applySetActiveMarksOp(
  context: EditorContext,
  op: SetActiveMarksOp,
): EditorContext {
  return withActiveMarks(context, op.activeMarks)
}

/** Applies a {@link SetMarksOp} operation to {@link EditorContext}. */
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
  /** We don't apply op on non-editable text nodes. */
  if (!isInlineNodeWithEditableText(node)) {
    return context
  }

  /**
   * Partial-range marks are split in {@link MarksOpsBuilder} via structural ops.
   * Engine only applies whole-node mark updates (range equals full node text).
   */
  if (op.from !== 0 || op.to !== node.text.length) {
    applyError(
      'Partial `set_marks` must be preceded by structural split ops from MarksOpsBuilder',
      op,
    )
  }

  content[index] = {
    ...node,
    marks: op.nextMarks,
    updatedAt: new Date(),
  }

  return updateBlockWithInlineContent(context, op.blockId, content)
}

/**
 * Applies an operation to the {@link EditorContext} document state.
 * Throws a {@link DactyloError} on failure.
 */
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
    case 'mutate_block_type': {
      return applyMutateBlockTypeOp(context, op)
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
      assertNever(type, { hint: 'OperationsRuntime/validateOp' })
    }
  }
}

// --- Invert -───────────────────────────────────────---------------

/** Throws a validation {@link DactyloError} for a failed op inversion. */
export function invertError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'INVERT_TRANSACTION_OPERATIONS',
    hint: 'OperationsRuntime/invertOp',
    message,
    payload: { op },
  })
}

export function invertOp(op: Operation): Operation {
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
    case 'mutate_block_type': {
      const snapshotType = op.snapshot.__type
      switch (snapshotType) {
        case 'heading': {
          return {
            __type: 'mutate_block_type',
            blockId: op.blockId,
            dropMetadata: op.dropMetadata,
            snapshot: op.snapshot,
            spec: {
              kind: 'to_heading',
              level: op.snapshot.level,
            },
          }
        }
        default: {
          return {
            __type: 'mutate_block_type',
            blockId: op.blockId,
            dropMetadata: op.dropMetadata,
            snapshot: op.snapshot,
            spec: {
              kind: 'to_paragraph',
            },
          }
        }
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
          text: op.text,
        },
      }
    }
    case 'delete_text': {
      return {
        __type: 'insert_text',
        blockId: op.blockId,
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
      assertNever(type, { hint: 'OperationsRuntime/invertOp' })
    }
  }
}

/**
 * Shared operations runtime for:
 *  - Validating ops: ensuring ops are respecting invariant rules
 *  - Applying ops: updating document state based on active marks
 *  - Inverting ops: defining inverse ops for undo.
 */
export interface OperationsRuntime {
  /**
   * Validates an operation against {@link EditorContext} and invariant rules.
   * Throws a {@link DactyloError} on failure.
   */
  readonly validateOp: (context: EditorContext, op: Operation) => void

  /**
   * Applies an operation to the {@link EditorContext} document state.
   * Throws a {@link DactyloError} on failure.
   */
  readonly applyOp: (context: EditorContext, op: Operation) => EditorContext

  /** Inverts an operation to produce the inverse operation. */
  readonly invertOp: (op: Operation) => Operation
}

/** Makes a {@link OperationsRuntime} to use in an {@link OperationsEngine}. */
export function makeOperationsRuntime(): OperationsRuntime {
  return {
    applyOp,
    invertOp,
    validateOp,
  }
}
