import {
  createDividerBlock,
  createParagraphBlockAfter,
  findNodeInBlockWithInlineContent,
  isParagraphBlock,
} from './blocks'
import type { BlockWithInlineContent, HeadingBlock } from './blocks'
import { warn } from './console'
import {
  ATX_MARKDOWN_HEADING_WITH_TRIGGER_SPACE_PATTERN,
  HORIZONTAL_RULE_MARKDOWN_SHORTCUT_WITH_TRIGGER_PATTERN,
  INLINE_DETECTOR_TRIGGER_CHARACTER,
} from './constants'
import {
  computeInsertBlockPosKey,
  getBlockWithInlineContent,
  resolveInsertAfterBlockId,
} from './document'
import type { EditorContext } from './editor-context'
import {
  createTextNode,
  isInlineNodeWithEditableText,
  isTextNode,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { Operation } from './operations'
import { buildError, iterRules } from './operations-builder'
import type {
  BuilderOpsIntent,
  OperationRule,
  OperationsBuilder,
} from './operations-builder'
import { createCursor, isRangeSelection, isSelectionActive } from './selection'
import type { TextCursor } from './selection'

/** Situation with no selection. */
export interface MarkdownShortcutOpsUnhandledSituation {
  readonly kind: 'unhandled-situation'
}

/** Situation with a cursor selection. */
export interface MarkdownShortcutOpsCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** The cursor at which ops are applied. */
  readonly at: TextCursor

  /** Block with inline content subject to the operation.  */
  readonly block: BlockWithInlineContent

  /** Inline node with editable text subject to the operation. */
  readonly node: InlineNodeWithEditableText

  /** Index of the inline node with editable text in the block. */
  readonly index: number
}

/** Situation of markdown operations. */
export type MarkdownShortcutOpsSituation =
  | MarkdownShortcutOpsUnhandledSituation
  | MarkdownShortcutOpsCursorSelectionSituation

/** Input for markdown operations. */
export interface MarkdownShortcutOpsInput {
  /** The text to insert. */
  readonly text: string
}

/** Rule for markdown operations. */
export type MarkdownShortcutOpsRule = OperationRule<
  MarkdownShortcutOpsSituation,
  MarkdownShortcutOpsInput,
  unknown
>

/** Parses the level of an ATX markdown heading with trigger space. */
export function parseAtxHeadingShortcutLevel(
  nodeText: string,
): HeadingBlock['level'] | null {
  const atxMatch =
    ATX_MARKDOWN_HEADING_WITH_TRIGGER_SPACE_PATTERN.exec(nodeText)
  if (!atxMatch || !atxMatch[1]) {
    return null
  }

  return atxMatch[1].length as HeadingBlock['level']
}

/** Whether the node text is a horizontal rule markdown shortcut. */
export function isMarkdownDividerShortcut(nodeText: string): boolean {
  return HORIZONTAL_RULE_MARKDOWN_SHORTCUT_WITH_TRIGGER_PATTERN.test(nodeText)
}

const rules: MarkdownShortcutOpsRule[] = [
  {
    /**
     * 💡 Cursor selection is at a {@link ParagraphBlock} within a first text node
     *    and the content inside is `(#{1,6})`, and the text currently typed is {@link INLINE_DETECTOR_TRIGGER_CHARACTER}.
     * 🎯 Detect markdown shortcut and mutate current {@link ParagraphBlock} into
     *   a {@link HeadingBlock} with the level matching and an empty text node.
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (
        situation.kind !== 'cursor-selection' ||
        input.text !== INLINE_DETECTOR_TRIGGER_CHARACTER
      ) {
        return null
      }

      const { block, node } = situation
      const level = parseAtxHeadingShortcutLevel(node.text)
      if (level === null) {
        return null
      }

      const ops: Operation[] = [
        {
          __type: 'mutate_block_type',
          blockId: block.id,
          snapshot: block,
          spec: { kind: 'to_heading', level },
        },
        {
          __type: 'delete_text',
          blockId: block.id,
          length: node.text.length,
          nodeId: node.id,
          offset: 0,
          snapshot: { marks: node.marks, text: node.text },
        },
        {
          __type: 'set_selection',
          next: createCursor({ blockId: block.id, nodeId: node.id, offset: 0 }),
          prev: context.selection,
        },
      ]

      return ops
    },
    name: 'cursor/atx-heading/inline-detector-trigger-character',
    when: ({ situation, input }): boolean => {
      if (
        situation.kind !== 'cursor-selection' ||
        input.text !== INLINE_DETECTOR_TRIGGER_CHARACTER
      ) {
        return false
      }

      const { block, node, at } = situation
      if (at.offset !== node.text.length) {
        return false
      }

      if (!isParagraphBlock(block)) {
        return false
      }

      const [first] = block.content
      if (
        !first ||
        !isTextNode(first) ||
        first.id !== node.id ||
        first.text.length !== node.text.length
      ) {
        return false
      }

      const level = parseAtxHeadingShortcutLevel(node.text)
      return level !== null
    },
  },
  {
    /**
     * 💡 Cursor selection is at a {@link ParagraphBlock}, first text node only,
     *    content is `---`, and the typed character is
     *    {@link INLINE_DETECTOR_TRIGGER_CHARACTER}.
     * 🎯 Replace the paragraph with a {@link DividerBlock} at the same document
     *    position and move the caret into a new empty {@link ParagraphBlock} below
     *    (same UX as programmatic divider insert).
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (
        situation.kind !== 'cursor-selection' ||
        input.text !== INLINE_DETECTOR_TRIGGER_CHARACTER
      ) {
        return null
      }

      const { state } = context
      const { block } = situation

      const posKey = computeInsertBlockPosKey(state, {
        blockId: block.id,
        type: 'before',
      })
      const afterBlockId = resolveInsertAfterBlockId(state, {
        blockId: block.id,
        type: 'before',
      })

      const divider = createDividerBlock({
        parentId: block.parentId,
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

      const idx = state.blockOrderById.indexOf(block.id)
      /** Keeping `undo()` consistent. */
      const afterBlockIdForDelete =
        idx > 0 ? (state.blockOrderById[idx - 1] ?? null) : null

      const ops: Operation[] = [
        {
          __type: 'insert_block',
          afterBlockId,
          block: divider,
        },
        {
          __type: 'delete_block',
          afterBlockId: afterBlockIdForDelete,
          blockId: block.id,
          snapshot: block,
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
          prev: context.selection,
        },
      ]

      return ops
    },
    name: 'cursor/horizontal-rule/inline-detector-trigger-character',
    when: ({ situation, input }): boolean => {
      if (
        situation.kind !== 'cursor-selection' ||
        input.text !== INLINE_DETECTOR_TRIGGER_CHARACTER
      ) {
        return false
      }

      const { block, node, at } = situation
      if (at.offset !== node.text.length) {
        return false
      }

      if (!isParagraphBlock(block)) {
        return false
      }

      const [first] = block.content
      if (
        !first ||
        !isTextNode(first) ||
        first.id !== node.id ||
        first.text.length !== node.text.length
      ) {
        return false
      }

      return isMarkdownDividerShortcut(node.text)
    },
  },
]

// --- Builder ───────────────────────────────────────---------------

/** Markdown ops builder. */
export class MarkdownShortcutOpsBuilder implements OperationsBuilder<
  MarkdownShortcutOpsSituation,
  MarkdownShortcutOpsInput
> {
  /** Describes the {@link MarkdownShortcutOpsSituation}. */
  describe(context: EditorContext): MarkdownShortcutOpsSituation {
    const { selection, state } = context

    if (!isSelectionActive(selection) || isRangeSelection(selection)) {
      return { kind: 'unhandled-situation' }
    }

    const block = getBlockWithInlineContent(state, selection.anchor.blockId)
    const found = findNodeInBlockWithInlineContent(
      block,
      selection.anchor.nodeId,
    )

    if (!found) {
      buildError(
        `Node ${selection.anchor.nodeId} not found in block ${block.id}`,
        'InsertTextOpsBuilder/#describe',
      )
    }

    if (!isInlineNodeWithEditableText(found.node)) {
      buildError(
        `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
        'InsertTextOpsBuilder/#describe',
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

  /** Builds operations for a markdown shortcut. */
  build(
    context: EditorContext,
    input: MarkdownShortcutOpsInput,
  ): BuilderOpsIntent | null {
    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'unhandled-situation') {
      return null
    }

    /** For markdown shortcut operations, by design we can only match one rule. */
    const match = iterRules({
      context,
      input,
      resources: null,
      rules,
      situation,
    }).next()
    if (match.done) {
      return null
    }

    const build = match.value
    const ops = build({ context, input, resources: null, situation })
    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'MarkdownOpsBuilder/#build',
      )
      return null
    }

    return { label: `markdown-shortcut`, ops }
  }
}
