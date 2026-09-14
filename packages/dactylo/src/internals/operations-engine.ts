import {
  findNodeInBlockWithInlineContent,
  isBlockWithInlineContent,
  isBlockWithPlaceholder,
  sortBlockOrder,
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
import { createTextNode, splitTextNodeAt } from './nodes'
import type { InlineNode, NodeId, TextNode } from './nodes'
import type {
  DeleteBlockOp,
  DeleteTextOp,
  InsertBlockOp,
  InsertBlockOpPosition,
  InsertTextOp,
  Operation,
  SetMarksOp,
} from './operations'
import { createCursor } from './selection'
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
        if (context.state.blocks.has(op.block.id)) {
          validationError(`Block ${op.block.id} already exists in document`, op)
        }

        if (
          op.afterBlockId !== null &&
          !context.state.blocks.has(op.afterBlockId)
        ) {
          validationError(`Unknown block: ${op.afterBlockId}`, op)
        }
        break
      }
      case 'delete_block': {
        if (op.snapshot.id !== op.blockId) {
          validationError(
            `Snapshot block ID ${op.snapshot.id} does not match the deleted block ID ${op.blockId}`,
            op,
          )
        }

        if (context.state.blockOrderById.length === 1) {
          validationError(`Cannot delete the last block in the document`, op)
        }
        break
      }
      case 'insert_text': {
        if (op.text.length === 0) {
          validationError('Cannot insert an empty text', op)
        }
        const block = requireBlockWithInlineContent(
          context.state,
          op.blockId,
          op,
        )
        const { node } = requireTextNode(block, op.nodeId, op)

        assertOffsetInText(
          op.offset,
          node.text.length,
          op,
          'Insert text offset',
        )

        break
      }
      case 'delete_text': {
        const block = requireBlockWithInlineContent(
          context.state,
          op.blockId,
          op,
        )
        const { node } = requireTextNode(block, op.nodeId, op)

        if (op.length < 0 || op.offset + op.length > node.text.length) {
          validationError('Remove range out of bounds', op)
        }

        break
      }
      case 'set_marks': {
        const block = requireBlockWithInlineContent(
          context.state,
          op.blockId,
          op,
        )
        const { node } = requireTextNode(block, op.nodeId, op)

        assertRangeInText(op.from, op.to, node.text.length, op)

        break
      }
      case 'set_selection': {
        if (op.next !== null) {
          if (op.next.__type === 'cursor') {
            validateTextCursor(context.state, op.next.anchor, op)
          } else if (op.next.__type === 'range') {
            validateTextCursor(context.state, op.next.anchor, op)
            validateTextCursor(context.state, op.next.focus, op)
          }
        }
        break
      }
      case 'set_active_marks': {
        break
      }
      default: {
        assertNever(type)
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

  const idx = content.findIndex((node) => node.id === op.nodeId)
  if (idx === -1) {
    applyError(`Node ${op.nodeId} not found in block ${block.id}`, op)
  }

  const node = content[idx]
  if (!node || node.__type !== 'text') {
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
    const updated: TextNode = { ...node, text, updatedAt: new Date() }

    content[idx] = updated
  }
  /** Otherwise we split the node and create a new text node to insert the text. */
  else {
    const updates: InlineNode[] = []

    if (before.length > 0) {
      updates.push({ ...node, text: before, updatedAt: new Date() })
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

    content.splice(idx, 1, ...updates)
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

  const idx = content.findIndex((node) => node.id === op.nodeId)
  if (idx === -1) {
    applyError(`Node ${op.nodeId} not found in block ${block.id}`, op)
  }

  const node = content[idx]
  if (!node || node.__type !== 'text') {
    applyError('`delete_text` target must be a text node', op)
  }

  const before = node.text.slice(0, op.offset)
  const after = node.text.slice(op.offset + op.length)

  content[idx] = {
    ...node,
    text: before + after,
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

  const idx = content.findIndex((node) => node.id === op.nodeId)
  const node = content[idx]

  if (!node || node.__type !== 'text') {
    applyError('`set_marks` target must be a text node', op)
  }

  /**
   * Apply operation only on a non-empty range.
   * Otherwise for this operation it's a no-op.
   */
  if (op.from !== op.to) {
    const replacement = splitTextNodeAt(node, op.from, op.to, op.nextMarks)
    if (replacement.length === 0) {
      content.splice(idx, 1)
    } else {
      content.splice(idx, 1, ...replacement)
    }

    return updateBlockWithInlineContent(context, op.blockId, content)
  }

  return context
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
    case 'insert_text': {
      return applyInsertTextOp(context, op)
    }
    case 'delete_text': {
      return applyDeleteTextOp(context, op)
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
      assertNever(type)
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
        assertNever(type)
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

/**
 * Builds operations for a single typed character at the current cursor position.
 * When the typed character is a `space` checks for markdown shortcut triggers.
 */
export function buildSingleCharInsertTextOps(
  context: EditorContext,
  /** Collapsed cursor anchor for the pending edit. */
  cursor: TextCursor,
  /** The character to insert. */
  char: string,
): Operation[] {
  const { state } = context
  let ops: Operation[] = []

  const block = getBlockWithInlineContent(state, cursor.blockId)
  if (isBlockWithPlaceholder(block)) {
    const [first] = block.content

    /**
     * Kind of overkill check as it gets re-validated during the validation phase.
     * See it as an extra-safety net and sugar for TypeScript and linters.
     */
    if (!first || first.__type !== 'text') {
      buildError(
        `First node of block ${block.id} is not a text node. Type: ${first?.__type}`,
        'OperationsEngine/buildSingleCharInsertTextOps',
      )
    }

    ops = [
      {
        __type: 'delete_text',
        blockId: block.id,
        length: first.text.length,
        nodeId: first.id,
        offset: 0,
        snapshot: { marks: first.marks, text: first.text },
      },
      {
        __type: 'insert_text',
        blockId: block.id,
        marks: context.activeMarks,
        nodeId: first.id,
        offset: 0,
        text: char,
      },
      {
        __type: 'set_selection',
        next: createCursor({
          blockId: block.id,
          nodeId: first.id,
          offset: char.length,
        }),
        prev: context.selection,
      },
    ]
  } else {
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
  }

  if (char !== ' ') {
    return ops
  }

  //@todo: detects markdown shortcut

  return ops
}

/**
 * Builds keyboard operations to handle a keyboard event.
 * Returns `null` when the selection is null or not a cursor selection.
 */
export function buildKeyboardOps(
  context: EditorContext,
  event: KeyboardEvent,
): {
  /** The operations to apply. */
  ops: Operation[]
  /** The kind of the operation. */
  kind: 'insert_single_char'
} | null {
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

  /** We build `insert_text` operation when a single character is typed. */
  if (event.key.length === 1) {
    const ops = buildSingleCharInsertTextOps(
      context,
      selection.anchor,
      event.key,
    )

    return {
      kind: 'insert_single_char',
      ops,
    }
  }

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
