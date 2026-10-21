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
import { DeleteContentOpsBuilder } from './delete-content-ops-builder'
import {
  computeInsertBlockPosKey,
  createCursorAtDocumentEnd,
  deleteBlock,
  getBlock,
  getBlockIndex,
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
import { InsertTextOpsBuilder } from './insert-text-ops-builder'
import type { ArrowDirection } from './keyboard'
import { applyNormalizedMarks, isMarksEqual } from './marks'
import type { MarkKey } from './marks'
import { MarksOpsBuilder } from './marks-ops-builder'
import {
  coalesceInlineNodes,
  isInlineNodeWithEditableText,
  splitInlineNodeWithEditableTextAt,
} from './nodes'
import type { InlineNode, InlineNodeWithEditableText, NodeId } from './nodes'
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
import { buildError } from './operations-builder'
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
import type { TextCursor, Selection } from './selection'
import { SoftBreakOpsBuilder } from './soft-break-ops-builder'
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

  /** Insert text ops builder. */
  readonly #insertTextOpsBuilder: InsertTextOpsBuilder

  /** Delete content ops builder. */
  readonly #deleteContentOpsBuilder: DeleteContentOpsBuilder

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
    this.#insertTextOpsBuilder = new InsertTextOpsBuilder({
      inlineCommandTrigger: options.inlineCommandTrigger,
      mentions: options.mentions,
    })
    this.#deleteContentOpsBuilder = new DeleteContentOpsBuilder({
      graphemeOffsetCaret: this.#graphemeOffsetCaret,
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
   * Builds the operations to toggle a mark on or off. */
  buildSetMarksOps(
    context: EditorContext,
    mark: MarkKey,
  ): BuilderOpsIntent | null {
    return this.#marksOpsBuilder.build(context, { mark })
  }

  // --- Composing operations ─────────────────────────────────────────

  /** Builds operations to insert a text (char or emoji). */
  buildInsertTextOps(
    context: EditorContext,
    text: string,
  ): BuilderOpsIntent | null {
    return this.#insertTextOpsBuilder.build(context, { text })
  }

  /** Builds operations to delete content. */
  buildDeleteContentOps(context: EditorContext): BuilderOpsIntent | null {
    return this.#deleteContentOpsBuilder.build(context)
  }

  /** Builds operations when user presses `Enter` key as a hard break. */
  buildHardBreakOps(context: EditorContext): BuilderOpsIntent | null {
    return this.#hardBreakOpsBuilder.build(context)
  }

  /** Builds operations when user presses `shift+Enter` key as a soft break. */
  buildSoftBreakOps(context: EditorContext): BuilderOpsIntent | null {
    return this.#softBreakOpsBuilder.build(context)
  }

  /** Builds operations for a pasted plain text. */
  buildPlainTextPasteOps(
    context: EditorContext,
    /** The plain text data to paste. */
    data: TextPlainData,
  ): BuilderOpsIntent | null {
    return this.#pastePlainTextOpsBuilder.build(context, { data })
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

    const ops: Operation[] = [
      {
        __type: 'delete_block',
        afterBlockId,
        blockId,
        snapshot: block,
      },
    ]

    return ops
  }
}
