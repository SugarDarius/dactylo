import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockWithInlineContent } from './blocks'
import type { TextPlainData } from './clipboard'
import { warn } from './console'
import {
  compareTextCursors,
  getBlockWithInlineContent,
  normalizeRange,
} from './document'
import type { EditorContext } from './editor-context'
import type { GraphemeOffsetCaret } from './grapheme'
import { isMarksEqual } from './marks'
import {
  coalesceInlineNodes,
  createTextNode,
  getInlineNodeTextLength,
  isInlineNodeWithEditableText,
  isLinkNode,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { DeleteTextOp, MergeBlocksOp, Operation } from './operations'
import type {
  BuilderOpsIntent,
  OperationBuilderAutolinkConfig,
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
  resolveRangeInsertCaretAfterPrefixOps,
  resolveTextInsertTarget,
} from './operations-builder'
import {
  plainTextHasLinks,
  plainTextToEditableTextNodes,
  splitPlainText,
} from './plain-text'
import {
  createCursor,
  cursorFromLinearOffsetInBlock,
  getLinearOffsetInBlock,
  getRangeSelectionTopology,
  isCursorSelection,
  isSelectionActive,
} from './selection'
import type { RangeSelection, Selection, TextCursor } from './selection'

/** Situation with no selection. */
export interface PastePlainTextOpsNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation with a cursor selection. */
export interface PastePlainTextOpsCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** The cursor at which ops are applied. */
  readonly at: TextCursor

  /** Block with inline content subject to ops.  */
  readonly block: BlockWithInlineContent

  /** Inline node with editable text subject to ops. */
  readonly node: InlineNodeWithEditableText

  /** Index of the inline node with editable text in the block. */
  readonly index: number
}

/** Situation with a range selection. */
export interface PastePlainTextOpsRangeSelectionSituation {
  readonly kind: 'range-selection'

  /** The range at which the paste operation is applied. */
  readonly range: RangeSelection

  /** The topology of the range selection. */
  readonly topology:
    | {
        readonly kind: 'same-node'

        /** Block with inline content subject to ops. */
        readonly block: BlockWithInlineContent

        /** Inline node with editable text subject to ops. */
        readonly node: InlineNodeWithEditableText
      }
    | {
        readonly kind: 'same-block'

        /** Block with inline content subject to ops. */
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

/** Situation for paste plain text operations. */
export type PastePlainTextOpsSituation =
  | PastePlainTextOpsNoSelectionSituation
  | PastePlainTextOpsCursorSelectionSituation
  | PastePlainTextOpsRangeSelectionSituation

/** Input for paste plain text operations. */
export interface PastePlainTextOpsInput {
  /** The plain text data to paste. */
  readonly data: TextPlainData
}

/** Resources for paste plain text operations. */
export interface PastePlainTextOpsResources {
  /** Whether autolink detection is enabled. */
  readonly autolinkEnabled: boolean

  /** Grapheme offset caret instance. */
  readonly graphemeOffsetCaret: GraphemeOffsetCaret
}

/** Paste plain text operations rule. */
export type PastePlainTextOpsRule = OperationRule<
  PastePlainTextOpsSituation,
  PastePlainTextOpsInput,
  PastePlainTextOpsResources
>

/** Builds paste ops for a single plain-text line at a collapsed caret. */
export function buildPastePlainTextSingleLineAtCaretOps(
  line: string,
  block: BlockWithInlineContent,
  node: InlineNodeWithEditableText,
  index: number,
  at: TextCursor,
  opts: {
    autolinkEnabled: boolean
    graphemeOffsetCaret: GraphemeOffsetCaret
    prevSelection: Selection | null
  },
): Operation[] | null {
  const hasLinks = opts.autolinkEnabled && plainTextHasLinks(line)

  if (!hasLinks) {
    return [
      {
        __type: 'insert_text',
        blockId: block.id,
        marks: node.marks,
        nodeId: node.id,
        offset: at.offset,
        text: line,
      },
      {
        __type: 'set_selection',
        next: createCursor({
          blockId: block.id,
          nodeId: node.id,
          offset: at.offset + line.length,
        }),
        prev: opts.prevSelection,
      },
    ]
  }

  const before = node.text.slice(0, at.offset)
  const after = node.text.slice(at.offset)

  const sliced = plainTextToEditableTextNodes(line, node.marks)
  if (sliced.length === 0) {
    return null
  }

  const lastSlice = sliced[sliced.length - 1]
  const shouldAddTrailing = lastSlice && isLinkNode(lastSlice)
  if (shouldAddTrailing) {
    sliced.push(createTextNode({ marks: node.marks, text: ' ' }))
  }

  const ops: Operation[] = []

  if (after.length > 0) {
    ops.push({
      __type: 'delete_text',
      blockId: block.id,
      length: after.length,
      nodeId: node.id,
      offset: at.offset,
      snapshot: { marks: node.marks, text: after },
    })
  }

  let nextInsertIndex = before.length > 0 ? index + 1 : index
  for (let i = 0; i < sliced.length; i += 1) {
    const sliceNode = sliced[i]
    if (!sliceNode) {
      continue
    }

    const mergeLeadingTextIntoCaretNode =
      i === 0 &&
      sliceNode.__type === 'text' &&
      node.__type === 'text' &&
      isMarksEqual(sliceNode.marks, node.marks)

    if (mergeLeadingTextIntoCaretNode) {
      ops.push({
        __type: 'insert_text',
        blockId: block.id,
        marks: node.marks,
        nodeId: node.id,
        offset: at.offset,
        text: sliceNode.text,
      })
      nextInsertIndex = index + 1
      continue
    }

    ops.push({
      __type: 'insert_inline_node',
      blockId: block.id,
      index: nextInsertIndex,
      node: sliceNode,
    })

    nextInsertIndex += 1
  }

  if (after.length > 0) {
    ops.push({
      __type: 'insert_inline_node',
      blockId: block.id,
      index: nextInsertIndex,
      node: createTextNode({
        marks: node.marks,
        metadata: node.metadata,
        text: after,
      }),
    })
  }

  const pastedLength = sliced.reduce(
    (sum, n) => sum + getInlineNodeTextLength(n),
    0,
  )

  const startLinear = getLinearOffsetInBlock(block, at)
  const targetLinear = startLinear + pastedLength

  const previewContent = previewInlineContentAfterTrimOps(
    block.content,
    ops,
    block.id,
  )

  const previewBlock: BlockWithInlineContent = {
    ...block,
    content: previewContent,
  }

  const nextAnchor = cursorFromLinearOffsetInBlock(
    block.id,
    previewBlock,
    targetLinear,
    (text, offset) =>
      opts.graphemeOffsetCaret.snapOffsetToBoundary(text, offset),
  )

  ops.push({
    __type: 'set_selection',
    next: createCursor(nextAnchor),
    prev: opts.prevSelection,
  })

  return ops
}

/**
 * Builds paste + selection ops after a range was (or will be) deleted in the same batch.
 *
 * Mirrors contract from {@link buildInsertTextAndSelectionAtRangeOps}.
 */
export function buildPastePlainTextAndSelectionAtRangeOps(
  context: EditorContext,
  range: RangeSelection,
  data: TextPlainData,
  at: TextCursor,
  resources: PastePlainTextOpsResources,
  opts: {
    /** Ops already queued before paste (e.g. range `delete_text`). */
    prefixOps?: Operation[]
    /**
     * When the live document does not yet contain the target tree
     * (e.g. cross-block merge preview), resolve against this block instead of `state`.
     */
    blockSnapshot?: BlockWithInlineContent
  } = {},
): Operation[] | null {
  const lines = splitPlainText(data.text)
  if (lines.length !== 1) {
    return null
  }

  const [line] = lines as [string]
  const { prefixOps = [], blockSnapshot } = opts

  const block =
    blockSnapshot ?? getBlockWithInlineContent(context.state, at.blockId)

  const insertAt = resolveRangeInsertCaretAfterPrefixOps(block, at, prefixOps)
  const { node, index } = resolveTextInsertTarget(block, prefixOps, insertAt)

  const previewContent = previewInlineContentAfterTrimOps(
    block.content,
    prefixOps,
    block.id,
  )
  const previewBlock: BlockWithInlineContent = {
    ...block,
    content: previewContent,
  }

  return buildPastePlainTextSingleLineAtCaretOps(
    line,
    previewBlock,
    node,
    index,
    insertAt,
    {
      autolinkEnabled: resources.autolinkEnabled,
      graphemeOffsetCaret: resources.graphemeOffsetCaret,
      prevSelection: range,
    },
  )
}

/** Rules for cursor selection. */
export const cursorRules: PastePlainTextOpsRule[] = [
  {
    /**
     * 💡 Selection is a cursor and it does not contain links.
     * 🎯 Paste single-line plain text at the caret.
     */
    build: ({ context, situation, input, resources }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const lines = splitPlainText(input.data.text)
      if (lines.length !== 1) {
        return null
      }

      const [line] = lines as [string]
      const { block, node, index, at } = situation

      return buildPastePlainTextSingleLineAtCaretOps(
        line,
        block,
        node,
        index,
        at,
        {
          autolinkEnabled: resources.autolinkEnabled,
          graphemeOffsetCaret: resources.graphemeOffsetCaret,
          prevSelection: context.selection,
        },
      )
    },
    name: 'cursor/paste-plain-text/single-line/no-links',
    when: ({ situation, input, resources }) => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const lines = splitPlainText(input.data.text)
      if (lines.length === 1) {
        const [line] = lines as [string]
        const hasLinks = resources.autolinkEnabled && plainTextHasLinks(line)

        return !hasLinks
      }

      return false
    },
  },
  {
    /**
     * 💡 Selection is a cursor and it contains links.
     * 🎯 Paste single-line plain text at the caret.
     */
    build: ({ context, situation, input, resources }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const lines = splitPlainText(input.data.text)
      if (lines.length !== 1) {
        return null
      }

      const [line] = lines as [string]
      const { block, node, index, at } = situation

      return buildPastePlainTextSingleLineAtCaretOps(
        line,
        block,
        node,
        index,
        at,
        {
          autolinkEnabled: resources.autolinkEnabled,
          graphemeOffsetCaret: resources.graphemeOffsetCaret,
          prevSelection: context.selection,
        },
      )
    },
    name: 'cursor/paste-plain-text/single-line/with-links',
    when: ({ situation, input, resources }) => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const lines = splitPlainText(input.data.text)
      if (lines.length === 1) {
        const [line] = lines as [string]
        const hasLinks = resources.autolinkEnabled && plainTextHasLinks(line)

        return hasLinks
      }

      return false
    },
  },
]

function isSingleLinePlainTextPaste(input: PastePlainTextOpsInput): boolean {
  return splitPlainText(input.data.text).length === 1
}

/** Rules for range selection. */
export const rangeRules: PastePlainTextOpsRule[] = [
  {
    /**
     * 💡 Range selection is within the same node.
     * 🎯 Delete the selection in-node, then paste single-line plain text at anchor.
     */
    build: ({ context, situation, input, resources }): Operation[] | null => {
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
          'PastePlainTextOpsBuilder/#build',
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

      const pasteOps = buildPastePlainTextAndSelectionAtRangeOps(
        context,
        range,
        input.data,
        {
          blockId: block.id,
          nodeId: node.id,
          offset: deleteOffset,
        },
        resources,
        { prefixOps: [deleteTextOp] },
      )

      if (pasteOps === null) {
        return null
      }

      return [deleteTextOp, ...pasteOps]
    },
    /** Same node → `delete_text` + single-line paste + `set_selection`. */
    name: 'range/same-node/delete-then-paste-plain-text',
    when: ({ situation, input }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'same-node' &&
      isSingleLinePlainTextPaste(input),
  },
  {
    /**
     * 💡 Range selection is within the same block but with multiple nodes.
     * 🎯 Delete the selection in-block, then paste at anchor (no survivor join).
     */
    build: ({ context, situation, input, resources }): Operation[] | null => {
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

      const pasteOps = buildPastePlainTextAndSelectionAtRangeOps(
        context,
        range,
        input.data,
        anchor,
        resources,
        { prefixOps: deleteOps },
      )

      if (pasteOps === null) {
        return null
      }

      return [...deleteOps, ...pasteOps]
    },
    /** Same block, multiple nodes → range delete (no join) + single-line paste at anchor. */
    name: 'range/same-block/delete-then-paste-plain-text',
    when: ({ situation, input }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'same-block' &&
      isSingleLinePlainTextPaste(input),
  },
  {
    /**
     * 💡 Range selection is across multiple blocks.
     * 🎯 Forward trim → delete middle → backward trim → merge → paste at split.
     */
    build: ({ context, situation, input, resources }): Operation[] | null => {
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

      const pasteOps = buildPastePlainTextAndSelectionAtRangeOps(
        context,
        range,
        input.data,
        {
          blockId: startBlock.id,
          nodeId: splitAtNodeId,
          offset: splitAtOffset,
        },
        resources,
        {
          blockSnapshot: mergedBlockSnapshot,
          prefixOps: [mergeBlockOp],
        },
      )

      if (pasteOps === null) {
        return null
      }

      ops.push(mergeBlockOp, ...pasteOps)

      return ops
    },
    /** Cross-blocks → trim/delete/merge surgery, then single-line paste at split. */
    name: 'range/cross-block/surgery-then-paste-plain-text',
    when: ({ situation, input }): boolean =>
      situation.kind === 'range-selection' &&
      situation.topology.kind === 'cross-block' &&
      isSingleLinePlainTextPaste(input),
  },
]

/** Options for constructing a paste operations builder. */
export interface PastePlainTextOpsBuilderOptions {
  /** Configuration for autolink detection. */
  readonly autolink: {
    /** Whether to enable autolink detection. */
    readonly enabled: boolean
  }

  /** Grapheme offset caret instance. */
  readonly graphemeOffsetCaret: GraphemeOffsetCaret
}

export class PastePlainTextOpsBuilder implements OperationsBuilder<
  PastePlainTextOpsSituation,
  PastePlainTextOpsInput
> {
  /** Configuration for autolink detection. */
  readonly #autolinkConfig: OperationBuilderAutolinkConfig

  /** Grapheme offset caret instance. */
  readonly #graphemeOffsetCaret: GraphemeOffsetCaret

  constructor(options: PastePlainTextOpsBuilderOptions) {
    this.#autolinkConfig = options.autolink
    this.#graphemeOffsetCaret = options.graphemeOffsetCaret
  }

  /** Describes the {@link PastePlainTextOpsSituation}. */
  describe(context: EditorContext): PastePlainTextOpsSituation {
    const { selection, state } = context
    if (!isSelectionActive(selection)) {
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
          'PastePlainTextOpsBuilder/#describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'PastePlainTextOpsBuilder/#describe',
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
        'PastePlainTextOpsBuilder/#describe',
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
          'PastePlainTextOpsBuilder/#describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'PastePlainTextOpsBuilder/#describe',
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

  /** Builds ops to paste the data. */
  build(
    context: EditorContext,
    input: PastePlainTextOpsInput,
  ): BuilderOpsIntent | null {
    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    const isCursorKind = kind === 'cursor-selection'
    const rules = isCursorKind ? cursorRules : rangeRules

    /** For paste operations, by design we can only match one rule. */
    const match = iterRules({
      context,
      input,
      resources: {
        autolinkEnabled: this.#autolinkConfig.enabled,
        graphemeOffsetCaret: this.#graphemeOffsetCaret,
      },
      rules,
      situation,
    }).next()
    if (match.done) {
      warn(
        'No rule applied for the given situation and input.',
        'PastePlainTextOpsBuilder/#build',
      )
      return null
    }

    const build = match.value
    const ops = build({
      context,
      input,
      resources: {
        autolinkEnabled: this.#autolinkConfig.enabled,
        graphemeOffsetCaret: this.#graphemeOffsetCaret,
      },
      situation,
    })

    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'PastePlainTextOpsBuilder/#build',
      )
      return null
    }

    return {
      label: `paste-plain-text:${input.data.text}`,
      ops,
    }
  }
}
