import {
  createDividerBlock,
  createHeadingBlock,
  createParagraphBlock,
  createParagraphBlockAfter,
  findNodeInBlockWithInlineContent,
  isBlockWithInlineContent,
  sortBlockOrder,
  touchBlock,
} from './blocks'
import type { BlockId, BlockWithInlineContent, HeadingBlock } from './blocks'
import type { TextPlainData } from './clipboard'
import { warn, warnOnceIf } from './console'
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
import { GraphemeOffsetCaret } from './grapheme'
import { HardBreakOpsBuilder } from './hard-break-ops-builder'
import { InsertTextOpsBuilder } from './insert-text-ops-builder'
import type { ArrowDirection } from './keyboard'
import { applyNormalizedMarks, isMarksEqual } from './marks'
import type { MarkKey } from './marks'
import { MarksOpsBuilder } from './marks-ops-builder'
import { MoveSelectionOpsBuilder } from './move-selection-ops-builder'
import {
  coalesceInlineNodes,
  createTextNode,
  getInlineNodeTextLength,
  isInlineNodeWithEditableText,
  splitInlineNodeWithEditableTextAt,
} from './nodes'
import type { InlineNode, InlineNodeWithEditableText, NodeId } from './nodes'
import type {
  DeleteBlockOp,
  DeleteTextOp,
  InsertBlockOp,
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
import type {
  BuilderOpsIntent,
  InsertBlockPosition,
  InsertBlockSpec,
} from './operations-builder'
import { PastePlainTextOpsBuilder } from './paste-plain-text-ops-builder'
import {
  areSelectionsEqual,
  createCursor,
  createRangeSelectingInlineContentInBlock,
  isCursorSelection,
  isRangeSelection,
  isSelectionActive,
} from './selection'
import type { TextCursor, Selection } from './selection'
import { SoftBreakOpsBuilder } from './soft-break-ops-builder'
import type { Metadata } from './types'
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

/** Applies an `insert_block` operation to {@link EditorContext}. */
export function applyInsertBlockOp(
  context: EditorContext,
  op: InsertBlockOp,
): EditorContext {
  let state = insertBlock(context.state, op.block)

  state = { ...state, blockOrderById: sortBlockOrder(state.blocks) }
  return withDocumentState(context, state)
}

/** Applies a `delete_block` operation to {@link EditorContext}. */
export function applyDeleteBlockOp(
  context: EditorContext,
  op: DeleteBlockOp,
): EditorContext {
  const state = deleteBlock(context.state, op.blockId)
  return withDocumentState(context, state)
}

/**
 * Applies a `merge_blocks` operation to {@link EditorContext}.
 * It splices source content into target at `op.atIndex`,
 * then removes source blocks.
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

/** Applies a `split_block` operation to {@link EditorContext}. */
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

/** Applies an `insert_text` operation to {@link EditorContext}. */
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

/** Applies a `delete_text` operation to {@link EditorContext}. */
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

/** Applies a `set_active_marks` operation to {@link EditorContext}. */
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

/** Applies a `set_marks` operation to {@link EditorContext}. */
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

/** Applies a `insert_inline_node` operation to {@link EditorContext}. */
export function applyInsertInlineNodeOp(
  context: EditorContext,
  op: InsertInlineNodeOp,
): EditorContext {
  const block = getBlockWithInlineContent(context.state, op.blockId)

  const content = [...block.content]
  content.splice(op.index, 0, op.node)

  return updateBlockWithInlineContent(context, op.blockId, content)
}

/** Applies a `remove_inline_node` operation to {@link EditorContext}. */
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

// --- Engine ─────────────────────────────────────────---------------

/** Options for constructing a {@link OperationsEngine} instance. */
export interface OperationsEngineOptions {
  /**
   * Whether to enable debug mode.
   * Defaults to `false`
   */
  readonly debug: boolean

  /** Configuration for mentions. */
  readonly mentions: {
    /** Whether to enable mentions. */
    readonly enabled: boolean

    /** Character to trigger a mention. */
    readonly character: string
  }

  /** Configuration for inline command trigger. */
  readonly inlineCommandTrigger: {
    /** Whether to enable inline command trigger. */
    readonly enabled: boolean

    /** Character to trigger an inline command. */
    readonly character: string
  }

  /** Locales to use when handling text operations. */
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

  /** Character to use for mentions. */
  readonly character: string
}

/** Configuration for inline command trigger. */
export interface OperationEngineInlineCommandTriggerConfig {
  /** Whether to enable inline command trigger. */
  readonly enabled: boolean

  /** Character to use for inline command trigger. */
  readonly character: string
}

/** Configuration for autolink detection. */
export interface OperationEngineAutolinkConfig {
  /** Whether to enable autolink detection. */
  readonly enabled: boolean
}

/**
 * Engine to build operations to use in {@link TransactionPipeline}.
 * Ops are built based on current state and input events for:
 *  - Validating operations
 *  - Applying operations
 *  - Inverting operations
 *
 * It allows to handle inline composition with mentions and slash command.
 */
export class OperationsEngine {
  /** Whether to enable debug mode. */
  readonly #debug: boolean

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

  /** Move selection ops builder. */
  readonly #moveSelectionOpsBuilder: MoveSelectionOpsBuilder

  constructor(options: OperationsEngineOptions) {
    this.#debug = options.debug ?? false
    const graphemeOffsetCaret = new GraphemeOffsetCaret({
      locales: options.locales,
    })

    this.#marksOpsBuilder = new MarksOpsBuilder()
    this.#insertTextOpsBuilder = new InsertTextOpsBuilder({
      inlineCommandTrigger: options.inlineCommandTrigger,
      mentions: options.mentions,
    })
    this.#deleteContentOpsBuilder = new DeleteContentOpsBuilder({
      graphemeOffsetCaret,
    })
    this.#pastePlainTextOpsBuilder = new PastePlainTextOpsBuilder({
      autolink: options.autolink,
      graphemeOffsetCaret,
    })
    this.#softBreakOpsBuilder = new SoftBreakOpsBuilder()
    this.#hardBreakOpsBuilder = new HardBreakOpsBuilder()
    this.#moveSelectionOpsBuilder = new MoveSelectionOpsBuilder({
      graphemeOffsetCaret,
    })
  }

  // --- Core engine ─────────────────────────────────────────---------

  /**
   * Validate operation against current {@link EditorContext}.
   * Throws when operation does not respect rules implemented.
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

  /** Apply single operation to {@link EditorContext}. */
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

  /** Revert operation to restore prior context. */
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
   * Builds operations to toggle a mark on or off. */
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
    /** Plain text data to paste. */
    data: TextPlainData,
  ): BuilderOpsIntent | null {
    return this.#pastePlainTextOpsBuilder.build(context, { data })
  }

  // --- Selection operations ─────────────────────────────────────────

  /** builds operations to select all content. */
  buildSelectAllOps(context: EditorContext): BuilderOpsIntent | null {
    if (!isSelectionActive(context.selection)) {
      return null
    }

    // @todo: handle range selection later with a structured algorithm to select all blocks from a range.
    if (isRangeSelection(context.selection)) {
      warn('Select all from a range selection is not implemented yet.')
      return null
    }

    const { selection, state } = context
    const { anchor } = selection

    const block = getBlockWithInlineContent(state, anchor.blockId)
    const next = createRangeSelectingInlineContentInBlock(block)

    if (next === null) {
      return null
    }

    const ops: Operation[] = [
      {
        __type: 'set_selection',
        next,
        prev: selection,
      },
    ]

    return { label: 'select-all', ops }
  }

  /**
   * Builds operations to navigate selection with arrow keys.
   * Extends existing selection when `extend` is set to `true`.
   */
  buildArrowNavigationOps(
    context: EditorContext,
    direction: ArrowDirection,
    extend: boolean,
  ): BuilderOpsIntent | null {
    return this.#moveSelectionOpsBuilder.build(context, { direction, extend })
  }

  /** Builds operations to set selection to end of last block in document order. */
  buildPutCursorSelectionAtDocumentEndOps(
    context: EditorContext,
  ): BuilderOpsIntent | null {
    const next = createCursorAtDocumentEnd(context.state)
    if (!next) {
      buildError(
        'Failed to create cursor selection at document end',
        'OperationsEngine/buildPutCursorSelectionAtDocumentEndOps',
      )
    }

    const prev = context.selection

    /** Skip if selection is already at document's end. */
    if (
      prev?.__type === 'cursor' &&
      prev.anchor.blockId === next.anchor.blockId &&
      prev.anchor.nodeId === next.anchor.nodeId &&
      prev.anchor.offset === next.anchor.offset
    ) {
      return null
    }

    const ops: Operation[] = [
      {
        __type: 'set_selection',
        next,
        prev,
      },
    ]

    return { label: 'put-cursor-at-document-end', ops }
  }

  /** Builds operations to update selection. */
  buildUpdateSelectionOps(
    context: EditorContext,
    next: Selection | null,
  ): BuilderOpsIntent | null {
    /** Skip if next selection is equal to current selection. */
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

    return { label: 'update', ops }
  }

  /** Builds operations to clear selection. */
  buildClearSelectionOps(context: EditorContext): BuilderOpsIntent | null {
    const { selection } = context

    /** Skip if selection is already set to `null`. */
    if (!selection) {
      return null
    }

    // @todo: handle clear selection on all blocks.
    const ops: Operation[] = [
      {
        __type: 'set_selection',
        next: null,
        prev: selection,
      },
    ]

    return { label: 'clear', ops }
  }

  // --- Blocks operations ─────────────────────────────────────────---

  /** Builds operations to insert a {@link Block} according to the given specification and position. */
  #buildInsertBlockOps(
    context: EditorContext,
    spec: InsertBlockSpec,
    pos?: InsertBlockPosition,
  ): BuilderOpsIntent | null {
    const { state, selection } = context

    /** Do not insert if `pos` isn't given or selection is not active. */
    if (pos === undefined && !isSelectionActive(selection)) {
      warn(
        'Cannot insert paragraph block without a given insert position or an active selection.',
      )
      return null
    }

    const finalPos: InsertBlockPosition =
      pos ??
      (isSelectionActive(selection)
        ? {
            blockId: isCursorSelection(selection)
              ? selection.anchor.blockId
              : selection.focus.blockId,
            type: 'after',
          }
        : { type: 'end' })

    const posKey = computeInsertBlockPosKey(state, finalPos)
    const afterBlockId = resolveInsertAfterBlockId(state, finalPos)

    const { type } = spec
    switch (type) {
      case 'paragraph': {
        const insertedText = createTextNode({
          marks: context.activeMarks,
          text: '',
        })
        const paragraph = createParagraphBlock({
          content: [insertedText],
          metadata: spec.metadata,
          posKey,
        })

        const ops: Operation[] = [
          {
            __type: 'insert_block',
            afterBlockId,
            block: paragraph,
          },
          {
            __type: 'set_selection',
            next: createCursor({
              blockId: paragraph.id,
              nodeId: insertedText.id,
              offset: 0,
            }),
            prev: selection,
          },
        ]

        return { label: 'insert-paragraph', ops }
      }
      case 'heading': {
        const insertedText = createTextNode({
          marks: context.activeMarks,
          text: '',
        })
        const heading = createHeadingBlock({
          content: [insertedText],
          level: spec.level,
          metadata: spec.metadata,
          posKey,
        })

        const ops: Operation[] = [
          {
            __type: 'insert_block',
            afterBlockId,
            block: heading,
          },
          {
            __type: 'set_selection',
            next: createCursor({
              blockId: heading.id,
              nodeId: insertedText.id,
              offset: 0,
            }),
            prev: selection,
          },
        ]

        return { label: 'insert-heading', ops }
      }
      case 'divider': {
        const divider = createDividerBlock({
          metadata: spec.metadata,
          posKey,
        })

        /**
         * Invariant UX:
         * When inserting a divider block,
         * a {@link ParagraphBlock} is inserted right after it and
         * the selection is set inside it.
         */
        const insertedText = createTextNode({
          marks: context.activeMarks,
          text: '',
        })
        const paragraph = createParagraphBlockAfter(divider, [insertedText])

        const ops: Operation[] = [
          {
            __type: 'insert_block',
            afterBlockId,
            block: divider,
          },
          {
            __type: 'insert_block',
            afterBlockId: divider.id,
            block: paragraph,
          },
          {
            __type: 'set_selection',
            next: createCursor({
              blockId: paragraph.id,
              nodeId: insertedText.id,
              offset: 0,
            }),
            prev: selection,
          },
        ]

        return { label: 'insert-divider', ops }
      }
      default: {
        assertNever(type, { hint: 'OperationsEngine/buildInsertBlockOps' })
      }
    }
  }

  /** Builds operations to insert a {@link ParagraphBlock}. */
  buildInsertParagraphBlockOps(
    context: EditorContext,
    pos?: InsertBlockPosition,
    metadata?: Metadata,
  ): BuilderOpsIntent | null {
    return this.#buildInsertBlockOps(
      context,
      { metadata, type: 'paragraph' },
      pos,
    )
  }

  /** Builds operations to insert an {@link HeadingBlock}. */
  buildInsertHeadingBlockOps(
    context: EditorContext,
    level: HeadingBlock['level'],
    pos?: InsertBlockPosition,
    metadata?: Metadata,
  ): BuilderOpsIntent | null {
    return this.#buildInsertBlockOps(
      context,
      { level, metadata, type: 'heading' },
      pos,
    )
  }

  /** Builds operations to insert a {@link DividerBlock}. */
  buildInsertDividerBlockOps(
    context: EditorContext,
    pos?: InsertBlockPosition,
    metadata?: Metadata,
  ): BuilderOpsIntent | null {
    return this.#buildInsertBlockOps(
      context,
      { metadata, type: 'divider' },
      pos,
    )
  }

  /** Builds operations to delete a {@link Block} by ID. */
  buildDeleteBlockOps(
    context: EditorContext,
    blockId: BlockId,
  ): BuilderOpsIntent | null {
    const { state, selection } = context
    // @todo: improve by creating am invariant checker
    const block = getBlock(state, blockId)
    const idx = getBlockIndex(state, blockId)
    const isEmpty = isBlockWithInlineContentEmpty(state, blockId)

    /**
     * Invariant UX:
     *  - When block is the only one in document,
     *  - When block is empty.
     * Then skip deletion because document must have at least one block.
     */
    if (idx === 0 && isEmpty) {
      warnOnceIf(
        this.#debug,
        `Skipping deletion of block ${blockId} because it is the first empty block.`,
        'OperationsEngine/buildDeleteBlockOps',
      )
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
      /**
       * Invariant UX:
       * Assuming after a block deletion we can't predict where
       * the selection should focus on.
       */
      {
        __type: 'set_selection',
        next: null,
        prev: selection,
      },
    ]

    return { label: 'delete', ops }
  }
}
