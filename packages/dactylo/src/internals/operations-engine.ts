import {
  findNodeInBlock,
  isBlockWithInlineContent,
  sortBlockOrder,
} from './blocks'
import type { Block, BlockId } from './blocks'
import { getBlock, insertBlock } from './document'
import type { DocumentState } from './document'
import {
  updateBlockContent,
  withActiveMarks,
  withDocumentState,
  withPlaceholderFlag,
} from './editor-context'
import type { EditorContext } from './editor-context'
import { DactyloError } from './errors'
import { splitTextNodeAt } from './nodes'
import type { NodeId, TextNode } from './nodes'
import type { Operation } from './operations'

/** Throws a validation {@link DactyloError} for a failed op check. */
export function validationError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'VALIDATE_TRANSACTION_OPERATION',
    hint: 'OperationsEngine/validateOps',
    message,
    payload: { op },
  })
}

/** Returns a block or accepted inline-content or throws. */
export function requireInlineBlock(
  state: DocumentState,
  blockId: BlockId,
  op: Operation,
): Block {
  const block = getBlock(state, blockId)

  if (!isBlockWithInlineContent(block)) {
    validationError(`Block ${blockId} is not allowed to receive inline ops`, op)
  }

  return block
}

/** Finds a text node inside a block or throws. */
export function requireTextNode(
  block: Block,
  nodeId: NodeId,
  op: Operation,
): { node: TextNode; index: number } {
  const found = findNodeInBlock(block, nodeId)
  if (!found || found.node.__type !== 'text') {
    validationError(`Text node ${nodeId} not found in block ${block.id}`, op)
  }

  return { index: found.index, node: found.node }
}

/**
 * Asserts a mark range `[from, to)` lies within a text node's bounds.
 * Throws when the range is invalid or out of bounds.
 */
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

/** Validate a batch of operations against current state. */
export function validateOps(
  context: EditorContext,
  ops: readonly Operation[],
): void {
  for (const op of ops) {
    switch (op.__type) {
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
      case 'set_marks': {
        const block = requireInlineBlock(context.state, op.blockId, op)
        const { node } = requireTextNode(block, op.nodeId, op)

        assertRangeInText(op.from, op.to, node.text.length, op)

        break
      }
      case 'set_active_marks': {
        break
      }
      default: {
        validationError(`Unknown operation: ${op.__type}`, op)
      }
    }
  }
}

/** Throws an apply {@link DactyloError} for a failed op check. */
export function applyError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'APPLY_TRANSACTION_OPERATION',
    hint: 'OperationsEngine/applyOps',
    message,
    payload: { op },
  })
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
    switch (op.__type) {
      case 'insert_block': {
        let state = insertBlock(context.state, op.block)

        state = { ...state, blockOrderById: sortBlockOrder(state.blocks) }
        next = withPlaceholderFlag(withDocumentState(context, state), false)

        break
      }
      case 'set_active_marks': {
        next = withActiveMarks(context, op.activeMarks)
        break
      }
      case 'set_marks': {
        const block = getBlock(context.state, op.blockId)

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
          const replacement = splitTextNodeAt(
            node,
            op.from,
            op.to,
            op.nextMarks,
          )
          if (replacement.length === 0) {
            content.splice(idx, 1)
          } else {
            content.splice(idx, 1, ...replacement)
          }

          next = updateBlockContent(context, op.blockId, content)
        }
        break
      }
      default: {
        applyError(`Unknown operation: ${op.__type}`, op)
      }
    }
  }

  return next
}

export function invertError(message: string, op: Operation): never {
  throw DactyloError.from({
    code: 'INVERT_TRANSACTION_OPERATION',
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
    switch (op.__type) {
      case 'insert_block': {
        invertedOps.push({
          __type: 'delete_block',
          afterBlockId: op.afterBlockId,
          blockId: op.block.id,
          snapshot: op.block,
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
      default: {
        invertError(`Unknown operation: ${op.__type}`, op)
      }
    }
  }

  return invertedOps
}
