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
  ITALIC_MARKDOWN_ASTERISK_SHORTCUT_PATTERN,
  ITALIC_MARKDOWN_UNDERSCORE_SHORTCUT_PATTERN,
  MARKDOWN_BOLD_ITALIC_MARK_SHORTCUT_CLOSING_DELIMITERS,
  MARKDOWN_MARK_SHORTCUT_REQUIRED_CHAR_BEFORE_OPEN_DELIMITER,
} from './constants'
import {
  computeInsertBlockPosKey,
  getBlockWithInlineContent,
  resolveInsertAfterBlockId,
} from './document'
import type { EditorContext } from './editor-context'
import { isMarksEqual } from './marks'
import type { MarkKey, Marks } from './marks'
import {
  createFromInlineWithEditableText,
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
  withTrailingSelectionOp,
} from './operations-builder'
import type {
  BuilderOpsIntent,
  MarkdownMarkShortcutSpec,
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

/**
 * Whether opening delimiters for an inline mark shortcut may start at
 * `openDelimiterOffset` in `nodeText`.
 *
 * - At node start (`0`): always allowed (`**word**` alone).
 * - Otherwise: the character immediately before `{@link openDelimiterOffset}` must
 *   be whitespace so typed markdown like `Hello **there**` transforms, while
 *   glued forms like `Hello**there**` do not..
 */
export function isMarkdownMarkShortcutOpenBoundary(
  nodeText: string,
  openDelimiterOffset: number,
): boolean {
  if (openDelimiterOffset === 0) {
    return true
  }
  const charBefore = nodeText[openDelimiterOffset - 1]
  if (charBefore === undefined) {
    return false
  }
  return MARKDOWN_MARK_SHORTCUT_REQUIRED_CHAR_BEFORE_OPEN_DELIMITER.test(
    charBefore,
  )
}

/**
 * Parses a trailing markdown mark shortcut delimiter pair at the end of a node text.
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

    if (!isMarkdownMarkShortcutOpenBoundary(nodeText, openDelimiterOffset)) {
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

  /** Italic case. */
  const italicMatch =
    ITALIC_MARKDOWN_ASTERISK_SHORTCUT_PATTERN.exec(nodeText) ??
    ITALIC_MARKDOWN_UNDERSCORE_SHORTCUT_PATTERN.exec(nodeText)

  if (italicMatch?.groups?.word) {
    const { word } = italicMatch.groups

    /** CommonMark bold delimiter length is always `2`. */
    const delimiterLength = 1
    const openDelimiterOffset = italicMatch.index

    if (!isMarkdownMarkShortcutOpenBoundary(nodeText, openDelimiterOffset)) {
      return null
    }

    const wordStartOffset = openDelimiterOffset + delimiterLength
    const wordEndOffset = wordStartOffset + word.length

    return {
      delimiterLength,
      kind: 'italic',
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
  mark: MarkKey,
): Operation[] | null {
  const prevMarks: Marks = { ...node.marks }
  const nextMarks: Marks = { ...prevMarks, [mark]: true }

  const ops: Operation[] = [
    {
      __type: 'delete_text',
      blockId: block.id,
      length: delimiterLength,
      nodeId: node.id,
      offset: wordEndOffset,
      snapshot: {
        text: node.text.slice(wordEndOffset, wordEndOffset + delimiterLength),
      },
    },
    {
      __type: 'delete_text',
      blockId: block.id,
      length: delimiterLength,
      nodeId: node.id,
      offset: openDelimiterOffset,
      snapshot: {
        text: node.text.slice(
          openDelimiterOffset,
          openDelimiterOffset + delimiterLength,
        ),
      },
    },
  ]

  const markFrom = openDelimiterOffset
  const markTo = openDelimiterOffset + word.length
  const nodeAfterDelimiters: InlineNodeWithEditableText = {
    ...node,
    text:
      node.text.slice(0, openDelimiterOffset) +
      word +
      node.text.slice(wordEndOffset + delimiterLength),
  }

  const partial = buildPartialMarkRangeOps(
    block.id,
    nodeAfterDelimiters,
    markFrom,
    markTo,
    nextMarks,
    prevMarks,
  )

  let caretNodeId = node.id
  let caretOffset = markTo

  if (partial === null) {
    ops.push({
      __type: 'set_marks',
      blockId: block.id,
      from: markFrom,
      nextMarks,
      nodeId: node.id,
      prevMarks,
      to: markTo,
    })
  } else {
    ops.push(...partial.ops)
    caretNodeId = partial.marked.nodeId
    caretOffset = partial.marked.to
  }

  if (!isMarksEqual(nextMarks, context.activeMarks)) {
    const inserted = createFromInlineWithEditableText(node, {
      marks: context.activeMarks,
      text: '',
    })

    ops.push({
      __type: 'insert_inline_node',
      afterNodeId: caretNodeId,
      blockId: block.id,
      node: inserted,
    })

    return withTrailingSelectionOp(
      ops,
      createCursor({ blockId: block.id, nodeId: inserted.id, offset: 0 }),
      context.selection,
    )
  }

  return withTrailingSelectionOp(
    ops,
    createCursor({
      blockId: block.id,
      nodeId: caretNodeId,
      offset: caretOffset,
    }),
    context.selection,
  )
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
          snapshot: { text: node.text },
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
     * 💡 Cursor is at the end of an inline text node whose content nds with
     *    `**word**` or `__word__`, with opening delimiters at node start or after
     *    whitespace (e.g. `Hello **world**`, not `Hello**world**`). The last typed
     *    character is the final closing delimiter (`*` or `_`).
     * 🎯 Remove both delimiter pairs, apply bold only on `word` (prefix such as
     *    `Hello ` stays un-bold), caret after `word`.
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node } = situation

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
        'bold',
      )
    },
    name: 'cursor/bold-mark/inline-closing-delimiter',
    when: ({ situation, input }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { node } = situation

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
  {
    /**
     * 💡 Cursor is at the end of an inline text node whose content ends with
     *    `*word*` or `__word__`, with opening delimiters at node start or after
     *    whitespace (e.g. `Hello *world*`, not `Hello*world*`). The last typed
     *    character is the final closing delimiter (`*` or `_`).
     * 🎯 Remove both delimiter pairs, apply italic only on `word` (prefix such as
     *    `Hello ` stays un-italic), caret after `word`.
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { block, node } = situation

      const spec = parseMarkdownMarkShortcut(node.text)
      if (
        spec === null ||
        spec.kind !== 'italic' ||
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
        'italic',
      )
    },
    name: 'cursor/italic-mark/inline-closing-delimiter',
    when: ({ situation, input }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { node } = situation

      const spec = parseMarkdownMarkShortcut(node.text)
      if (
        spec === null ||
        spec.kind !== 'italic' ||
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
