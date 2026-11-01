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
  BOLD_MARKDOWN_ASTERISK_SHORTCUT_PATTERN,
  BOLD_MARKDOWN_UNDERSCORE_SHORTCUT_PATTERN,
  HORIZONTAL_RULE_MARKDOWN_SHORTCUT_WITH_TRIGGER_PATTERN,
  INLINE_DETECTOR_TRIGGER_CHARACTER,
  MARKDOWN_BOLD_ITALIC_MARK_SHORTCUT_CLOSING_DELIMITERS,
} from './constants'
import {
  computeInsertBlockPosKey,
  getBlockWithInlineContent,
  resolveInsertAfterBlockId,
} from './document'
import type { EditorContext } from './editor-context'
import type { MarkKey, Marks } from './marks'
import {
  createTextNode,
  isInlineNodeWithEditableText,
  isTextNode,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { Operation } from './operations'
import {
  buildError,
  buildPartialMarkRangeOps,
  iterRules,
  previewInlineContentAfterTrimOps,
} from './operations-builder'
import type {
  BuilderOpsIntent,
  MarkdownMarkShortcutSpec,
  OperationRule,
  OperationsBuilder,
} from './operations-builder'
import {
  createCursor,
  cursorAnchorFromLinearOffsetInBlock,
  getLinearOffsetInBlock,
  isRangeSelection,
  isSelectionActive,
  snapOffsetToTextLength,
} from './selection'
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

/**
 * Parses a trailing `**word**` or `__word__` markdown bold shortcut
 * at the end of a node text.
 *
 * Returns spec about the location of the shortcut.
 */
export function parseMarkdownMarkShortcut(
  nodeText: string,
): MarkdownMarkShortcutSpec | null {
  /** Bold case. */
  const boldMatch =
    BOLD_MARKDOWN_ASTERISK_SHORTCUT_PATTERN.exec(nodeText) ??
    BOLD_MARKDOWN_UNDERSCORE_SHORTCUT_PATTERN.exec(nodeText)

  if (boldMatch?.groups?.word) {
    const { word } = boldMatch.groups

    /** CommonMark bold delimiter length is always `2`. */
    const delimiterLength = 2
    const openDelimiterOffset = boldMatch.index

    /** Rejects `prefix**hello**` or `prefix__hello__`. */
    if (openDelimiterOffset !== 0) {
      return null
    }

    const wordStartOffset = openDelimiterOffset + delimiterLength
    const wordEndOffset = wordStartOffset + word.length

    return {
      delimiterLength,
      kind: 'bold',
      openDelimiterOffset,
      word,
      wordEndOffset,
      wordStartOffset,
    }
  }

  return null
}

/** Builds operations for a markdown mark shortcut. */
export function buildMarkdownMarkShortcutOps(
  context: EditorContext,
  block: BlockWithInlineContent,
  node: InlineNodeWithEditableText,
  wordEndOffset: number,
  openDelimiterOffset: number,
  delimiterLength: number,
  word: string,
  at: TextCursor,
  mark: MarkKey,
): Operation[] | null {
  const prevMarks: Marks = { ...node.marks }
  const nextMarks: Marks = { ...prevMarks, [mark]: true }

  const closingDelimiterText = node.text.slice(
    wordEndOffset,
    wordEndOffset + delimiterLength,
  )
  const openingDelimiterText = node.text.slice(
    openDelimiterOffset,
    openDelimiterOffset + delimiterLength,
  )

  const ops: Operation[] = [
    {
      __type: 'delete_text',
      blockId: block.id,
      length: delimiterLength,
      nodeId: node.id,
      offset: wordEndOffset,
      snapshot: { marks: prevMarks, text: closingDelimiterText },
    },
    {
      __type: 'delete_text',
      blockId: block.id,
      length: delimiterLength,
      nodeId: node.id,
      offset: openDelimiterOffset,
      snapshot: { marks: prevMarks, text: openingDelimiterText },
    },
  ]

  const markFrom = openDelimiterOffset
  const markTo = openDelimiterOffset + word.length

  const previewContent = previewInlineContentAfterTrimOps(
    block.content,
    ops,
    block.id,
  )

  const previewBlock = { ...block, content: previewContent }
  const previewFound = findNodeInBlockWithInlineContent(previewBlock, node.id)

  if (!previewFound || !isInlineNodeWithEditableText(previewFound.node)) {
    return null
  }

  const previewNode = previewFound.node
  const previewIndex = previewFound.index

  const partialMarkOps = buildPartialMarkRangeOps(
    block.id,
    previewNode,
    previewIndex,
    markFrom,
    markTo,
    nextMarks,
    prevMarks,
  )

  if (partialMarkOps === null) {
    /** Whole-node mark applied (typical mark shortcut with no prefix text). */
    ops.push({
      __type: 'set_marks',
      blockId: block.id,
      from: markFrom,
      nextMarks,
      nodeId: previewNode.id,
      prevMarks,
      to: markTo,
    })
  } else {
    ops.push(...partialMarkOps)
  }

  const linearAt = getLinearOffsetInBlock(block, at)
  const targetLinear = linearAt - delimiterLength * 2

  const previewAfterAll = previewInlineContentAfterTrimOps(
    block.content,
    ops,
    block.id,
  )

  const nextAnchor = cursorAnchorFromLinearOffsetInBlock(
    block.id,
    { ...block, content: previewAfterAll },
    targetLinear,
    snapOffsetToTextLength,
  )

  ops.push({
    __type: 'set_selection',
    next: createCursor(nextAnchor),
    prev: context.selection,
  })

  return ops
}

const rules: MarkdownShortcutOpsRule[] = [
  {
    /**
     * 💡 Cursor is at the end of an inline text node whose **entire** content is
     *    `**word**` or `__word__` (not `prefix**word**`), and the keystroke just
     *    typed is the final closing delimiter (`*` or `_`).
     * 🎯 Strip both delimiter pairs, apply bold on `word`, and collapse the
     *    selection at the end of that word.
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
  {
    /**
     * 💡 Cursor is at the end of an inline text node whose content ends with
     *    `**word**` or `__word__`, and the keystroke just typed is the final
     *    closing delimiter (`*` or `_`).
     * 🎯 Strip both delimiter pairs, apply {@link Marks} bold on `word`, and
     *    collapse the selection at the end of that word (after formatting).
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node, at } = situation

      const spec = parseMarkdownMarkShortcut(node.text)
      if (
        spec === null ||
        spec.kind !== 'bold' ||
        !MARKDOWN_BOLD_ITALIC_MARK_SHORTCUT_CLOSING_DELIMITERS.includes(
          input.text,
        )
      ) {
        return null
      }

      const { delimiterLength, openDelimiterOffset, word, wordEndOffset } = spec

      return buildMarkdownMarkShortcutOps(
        context,
        block,
        node,
        wordEndOffset,
        openDelimiterOffset,
        delimiterLength,
        word,
        at,
        'bold',
      )
    },
    name: 'cursor/bold-mark/inline-closing-delimiter',
    when: ({ situation, input }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, node } = situation

      /** Shortcut is detected only when the trigger character was just appended at the tail. */
      if (at.offset !== node.text.length) {
        return false
      }

      const spec = parseMarkdownMarkShortcut(node.text)
      if (
        spec === null ||
        spec.kind !== 'bold' ||
        !MARKDOWN_BOLD_ITALIC_MARK_SHORTCUT_CLOSING_DELIMITERS.includes(
          input.text,
        )
      ) {
        return false
      }
      return true
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
