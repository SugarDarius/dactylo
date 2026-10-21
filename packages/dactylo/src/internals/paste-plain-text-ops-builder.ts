import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockId, BlockWithInlineContent } from './blocks'
import type { TextPlainData } from './clipboard'
import { warn } from './console'
import {
  compareTextCursors,
  getBlockWithInlineContent,
  normalizeRange,
} from './document'
import type { EditorContext } from './editor-context'
import type { GraphemeOffsetCaret } from './grapheme'
import {
  coalesceInlineNodes,
  getInlineNodeTextLength,
  isInlineNodeWithEditableText,
} from './nodes'
import type { InlineNode, InlineNodeWithEditableText } from './nodes'
import type { Operation } from './operations'
import type {
  BuilderOpsIntent,
  OperationBuilderAutolinkConfig,
  OperationRule,
  OperationsBuilder,
} from './operations-builder'
import {
  buildError,
  iterRules,
  rangeCollapsedError,
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
  isCursorSelection,
} from './selection'
import type { RangeSelection, TextCursor } from './selection'

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

/** Preview inline content after paste-slice ops (delete_text + insert_inline_node). */
export function previewInlineContentAfterPasteSliceOps(
  content: readonly InlineNode[],
  ops: readonly Operation[],
  blockId: BlockId,
): InlineNode[] {
  const next = [...content]

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
    } else if (op.__type === 'insert_inline_node') {
      next.splice(op.index, 0, op.node)
    }
  }

  return coalesceInlineNodes(next)
}

/** Rules for cursor selection. */
export const cursorRules: PastePlainTextOpsRule[] = [
  {
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const lines = splitPlainText(input.data.text)
      if (lines.length !== 1) {
        return null
      }

      const [line] = lines as [string]
      const { block, node, at } = situation

      const ops: Operation[] = [
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
          prev: context.selection,
        },
      ]

      return ops
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

      const sliced = plainTextToEditableTextNodes(line, node.marks)
      if (sliced.length === 0) {
        return null
      }

      const after = node.text.slice(at.offset)
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

      let insertIndex = index + 1
      for (const sliceNode of sliced) {
        ops.push({
          __type: 'insert_inline_node',
          blockId: block.id,
          index: insertIndex,
          node: sliceNode,
        })
        insertIndex += 1
      }

      const pastedLength = sliced.reduce(
        (sum, n) => sum + getInlineNodeTextLength(n),
        0,
      )

      const startLinear = getLinearOffsetInBlock(block, at)
      const targetLinear =
        after.length > 0
          ? startLinear + pastedLength
          : startLinear + pastedLength

      const previewContent = previewInlineContentAfterPasteSliceOps(
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
          resources.graphemeOffsetCaret.snapOffsetToBoundary(text, offset),
      )

      ops.push({
        __type: 'set_selection',
        next: createCursor(nextAnchor),
        prev: context.selection,
      })

      return ops
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

/** Rules for range selection. */
export const rangeRules: PastePlainTextOpsRule[] = []

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
    if (selection === null) {
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

    return {
      kind: 'range-selection',
      range: normalized,
    }
  }

  /** Builds the operations to paste the data. */
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
