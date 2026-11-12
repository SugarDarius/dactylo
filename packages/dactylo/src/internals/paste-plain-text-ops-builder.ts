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
import { isMarksEqual } from './marks'
import {
  createTextNode,
  getInlineNodeTextLength,
  isInlineNodeWithEditableText,
  isLinkNode,
  isTextNode,
} from './nodes'
import type { InlineNodeWithEditableText, NodeId } from './nodes'
import type { Operation } from './operations'
import type {
  BuilderOpsIntent,
  OperationRule,
  OperationsBuilderAutolinkConfig,
  OperationsBuilderInitialMetadata,
} from './operations-builder'
import {
  buildDeleteRangeCrossBlockIntent,
  buildDeleteRangeWithinBlockIntent,
  buildDeleteTextRunIntent,
  buildError,
  OperationsBuilder,
  rangeCollapsedError,
  resolvesCaretNode,
  withTrailingSelectionOp,
} from './operations-builder'
import {
  plainTextHasLinks,
  plainTextToEditableTextNodes,
  splitPlainText,
} from './plain-text'
import {
  createCursor,
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

        /** Index of the inline node with editable text in the block. */
        readonly index: number
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

  /** Initial metadata applied when creating blocks and inline nodes. */
  readonly initialMetadata: OperationsBuilderInitialMetadata
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
  nodeIndex: number,
  at: TextCursor,
  opts: {
    autolinkEnabled: boolean
    prevSelection: Selection | null
    initialMetadata: OperationsBuilderInitialMetadata
  },
): Operation[] | null {
  const hasLinks = opts.autolinkEnabled && plainTextHasLinks(line)
  if (!hasLinks) {
    return withTrailingSelectionOp(
      [
        {
          __type: 'insert_text',
          blockId: block.id,
          nodeId: node.id,
          offset: at.offset,
          text: line,
        },
      ],
      createCursor({
        blockId: block.id,
        nodeId: node.id,
        offset: at.offset + line.length,
      }),
      opts.prevSelection,
    )
  }

  const before = node.text.slice(0, at.offset)
  const after = node.text.slice(at.offset)

  const sliced = plainTextToEditableTextNodes(line, node.marks, {
    link: opts.initialMetadata.link,
    text: opts.initialMetadata.text,
  })
  if (sliced.length === 0) {
    return null
  }

  const lastSlice = sliced[sliced.length - 1]
  if (lastSlice && isLinkNode(lastSlice)) {
    sliced.push(
      createTextNode({
        marks: node.marks,
        metadata: opts.initialMetadata.text,
        text: ' ',
      }),
    )
  }

  const [firstSlice] = sliced

  const mergeLeading =
    firstSlice !== undefined &&
    isTextNode(firstSlice) &&
    isTextNode(node) &&
    isMarksEqual(firstSlice.marks, node.marks)

  const ops: Operation[] = []

  if (after.length > 0) {
    ops.push({
      __type: 'delete_text',
      blockId: block.id,
      length: after.length,
      nodeId: node.id,
      offset: at.offset,
      snapshot: { text: after },
    })
  }

  if (isTextNode(node) && before.length === 0 && !mergeLeading) {
    ops.push({
      __type: 'remove_inline_node',
      blockId: block.id,
      nodeId: node.id,
      snapshot: node,
    })
  }
  const prevNode = block.content[nodeIndex - 1]

  let afterNodeId: NodeId | null =
    before.length > 0 ? node.id : (prevNode?.id ?? null)

  let caretNodeId = node.id
  let caretOffset = at.offset

  for (let i = 0; i < sliced.length; i += 1) {
    const sliceNode = sliced[i]
    if (!sliceNode) {
      continue
    }

    if (i === 0 && mergeLeading && isInlineNodeWithEditableText(firstSlice)) {
      ops.push({
        __type: 'insert_text',
        blockId: block.id,
        nodeId: node.id,
        offset: at.offset,
        text: firstSlice.text,
      })

      caretNodeId = node.id
      caretOffset = at.offset + firstSlice.text.length
      afterNodeId = node.id

      continue
    }

    ops.push({
      __type: 'insert_inline_node',
      afterNodeId,
      blockId: block.id,
      node: sliceNode,
    })

    afterNodeId = sliceNode.id
    caretNodeId = sliceNode.id
    caretOffset = getInlineNodeTextLength(sliceNode)
  }

  if (after.length > 0) {
    ops.push({
      __type: 'insert_inline_node',
      afterNodeId,
      blockId: block.id,
      node: createTextNode({
        marks: node.marks,
        metadata: node.metadata,
        text: after,
      }),
    })
  }

  return withTrailingSelectionOp(
    ops,
    createCursor({
      blockId: block.id,
      nodeId: caretNodeId,
      offset: caretOffset,
    }),
    opts.prevSelection,
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
          initialMetadata: resources.initialMetadata,
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
          initialMetadata: resources.initialMetadata,
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
      const { block, node, index } = topology

      const deleteIntent = buildDeleteTextRunIntent(
        block.id,
        node,
        anchor.offset,
        focus.offset,
      )

      const nodeAfter: InlineNodeWithEditableText = {
        ...node,
        text: node.text.slice(0, anchor.offset) + node.text.slice(focus.offset),
      }

      const lines = splitPlainText(input.data.text)
      if (lines.length !== 1) {
        return null
      }

      const [line] = lines as [string]

      const pasteOps = buildPastePlainTextSingleLineAtCaretOps(
        line,
        block,
        nodeAfter,
        index,
        deleteIntent.caret,
        {
          autolinkEnabled: resources.autolinkEnabled,
          initialMetadata: resources.initialMetadata,
          prevSelection: context.selection,
        },
      )

      if (pasteOps === null) {
        return null
      }

      return [...deleteIntent.ops, ...pasteOps]
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

      const deleteIntent = buildDeleteRangeWithinBlockIntent(
        block,
        anchor,
        focus,
        {
          joinSurvivors: false,
          textMetadata: resources.initialMetadata.text,
        },
      )
      const caretNode = resolvesCaretNode(block, deleteIntent)

      const lines = splitPlainText(input.data.text)
      if (lines.length !== 1) {
        return null
      }
      const [line] = lines as [string]

      const content = [...block.content]
      const caretIndex = content.findIndex((n) => n.id === caretNode.id)

      const newBlock: BlockWithInlineContent = {
        ...block,
        content: caretIndex === -1 ? [caretNode] : content,
      }

      const pasteOps = buildPastePlainTextSingleLineAtCaretOps(
        line,
        newBlock,
        caretNode,
        caretIndex,
        deleteIntent.caret,
        {
          autolinkEnabled: resources.autolinkEnabled,
          initialMetadata: resources.initialMetadata,
          prevSelection: context.selection,
        },
      )

      if (pasteOps === null) {
        return null
      }

      return [...deleteIntent.ops, ...pasteOps]
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
      const { startBlock, endBlock } = topology

      const deleteIntent = buildDeleteRangeCrossBlockIntent(
        context,
        range,
        startBlock,
        endBlock,
        resources.initialMetadata.text,
      )

      const caretBlock = deleteIntent.caretBlock ?? startBlock
      const caretNode = resolvesCaretNode(caretBlock, deleteIntent)

      const lines = splitPlainText(input.data.text)
      if (lines.length !== 1) {
        return null
      }
      const [line] = lines as [string]

      const caretIndex = caretBlock.content.findIndex(
        (node) => node.id === caretNode.id,
      )

      const pasteOps = buildPastePlainTextSingleLineAtCaretOps(
        line,
        caretBlock,
        caretNode,
        caretIndex,
        deleteIntent.caret,
        {
          autolinkEnabled: resources.autolinkEnabled,
          initialMetadata: resources.initialMetadata,
          prevSelection: context.selection,
        },
      )

      if (pasteOps === null) {
        return null
      }

      return [...deleteIntent.ops, ...pasteOps]
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

  /** Initial metadata applied when creating blocks and inline nodes. */
  readonly initialMetadata: OperationsBuilderInitialMetadata
}

export class PastePlainTextOpsBuilder extends OperationsBuilder<
  PastePlainTextOpsSituation,
  PastePlainTextOpsInput,
  PastePlainTextOpsResources
> {
  /** Configuration for autolink detection. */
  readonly #autolinkConfig: OperationsBuilderAutolinkConfig

  /** Initial metadata applied when creating blocks and inline nodes. */
  readonly #initialMetadata: OperationsBuilderInitialMetadata

  constructor(options: PastePlainTextOpsBuilderOptions) {
    super({ name: 'paste-plain-text-ops-builder' })
    this.#autolinkConfig = options.autolink
    this.#initialMetadata = options.initialMetadata
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
        topology: {
          block,
          index: found.index,
          kind: 'same-node',
          node: found.node,
        },
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
    const match = this.iterRules({
      context,
      input,
      resources: {
        autolinkEnabled: this.#autolinkConfig.enabled,
        initialMetadata: this.#initialMetadata,
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
        initialMetadata: this.#initialMetadata,
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
