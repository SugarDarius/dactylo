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
  MARKDOWN_INLINE_CODE_MARK_SHORTCUT_CLOSING_DELIMITERS,
  MARKDOWN_INLINE_CODE_MARK_SHORTCUT_PATTERN,
  MARKDOWN_LINK_SHORTCUT_CLOSING_DELIMITERS,
  MARKDOWN_LINK_SHORTCUT_PATTERN,
  MARKDOWN_MARK_SHORTCUT_REQUIRED_CHAR_BEFORE_OPEN_DELIMITER,
  MARKDOWN_STRIKETHROUGH_MARK_SHORTCUT_CLOSING_DELIMITERS,
  STRIKETHROUGH_MARKDOWN_TILDE_SHORTCUT_PATTERN,
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
  createLinkNode,
  createTextNode,
  isInlineNodeWithEditableText,
  isTextNode,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { Operation } from './operations'
import {
  buildError,
  buildPartialMarkRangeOps,
  OperationsBuilder,
  withTrailingSelectionOp,
} from './operations-builder'
import type {
  BuilderOpsIntent,
  MarkdownMarkShortcutSpec,
  OperationRule,
  OperationsBuilderAutolinkConfig,
} from './operations-builder'
import { sanitizeLinkHref } from './sanitize-link'
import { createCursor, isRangeSelection, isSelectionActive } from './selection'
import type { TextCursor } from './selection'
import { normalizeUrl } from './utils'

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

/** Resources for markdown operations. */
export interface MarkdownShortcutOpsResources {
  /** Whether autolink detection is enabled. */
  readonly autolinkEnabled: boolean
}

/** Rule for markdown operations. */
export type MarkdownShortcutOpsRule = OperationRule<
  MarkdownShortcutOpsSituation,
  MarkdownShortcutOpsInput,
  MarkdownShortcutOpsResources
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
 * Parses a trailing markdown mark shortcut delimiter pair immediately before
 * `cursorOffset` (defaults to the end of `nodeText`).
 * Returns spec about the location of the shortcut in `nodeText`.
 */
export function parseMarkdownMarkShortcut(
  nodeText: string,
  cursorOffset: number,
): MarkdownMarkShortcutSpec | null {
  const textBeforeCursor = nodeText.slice(0, cursorOffset)

  /** Bold case. */
  const boldMatch =
    BOLD_MARKDOWN_ASTERISK_SHORTCUT_PATTERN.exec(textBeforeCursor) ??
    BOLD_MARKDOWN_UNDERSCORE_SHORTCUT_PATTERN.exec(textBeforeCursor)

  if (boldMatch?.groups?.word) {
    const { word } = boldMatch.groups

    /** CommonMark bold delimiter length is always `2`. */
    const delimiterLength = 2
    const openDelimiterOffset = boldMatch.index

    if (
      !isMarkdownMarkShortcutOpenBoundary(textBeforeCursor, openDelimiterOffset)
    ) {
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
    ITALIC_MARKDOWN_ASTERISK_SHORTCUT_PATTERN.exec(textBeforeCursor) ??
    ITALIC_MARKDOWN_UNDERSCORE_SHORTCUT_PATTERN.exec(textBeforeCursor)

  if (italicMatch?.groups?.word) {
    const { word } = italicMatch.groups

    /** CommonMark bold delimiter length is always `2`. */
    const delimiterLength = 1
    const openDelimiterOffset = italicMatch.index

    if (
      !isMarkdownMarkShortcutOpenBoundary(textBeforeCursor, openDelimiterOffset)
    ) {
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

  /** Strikethrough case. */
  const strikethroughMatch =
    STRIKETHROUGH_MARKDOWN_TILDE_SHORTCUT_PATTERN.exec(textBeforeCursor)
  if (strikethroughMatch?.groups?.word) {
    const { word } = strikethroughMatch.groups

    /** CommonMark bold delimiter length is always `2`. */
    const delimiterLength = 2
    const openDelimiterOffset = strikethroughMatch.index

    if (
      !isMarkdownMarkShortcutOpenBoundary(textBeforeCursor, openDelimiterOffset)
    ) {
      return null
    }

    const wordStartOffset = openDelimiterOffset + delimiterLength
    const wordEndOffset = wordStartOffset + word.length

    return {
      delimiterLength,
      kind: 'strikethrough',
      openDelimiterOffset,
      word,
      wordEndOffset,
      wordStartOffset,
    }
  }

  /** Inline code case. */
  const inlineCodeMatch =
    MARKDOWN_INLINE_CODE_MARK_SHORTCUT_PATTERN.exec(textBeforeCursor)
  if (inlineCodeMatch?.groups?.word) {
    const { word } = inlineCodeMatch.groups

    /** CommonMark bold delimiter length is always `2`. */
    const delimiterLength = 1
    const openDelimiterOffset = inlineCodeMatch.index

    if (
      !isMarkdownMarkShortcutOpenBoundary(textBeforeCursor, openDelimiterOffset)
    ) {
      return null
    }

    const wordStartOffset = openDelimiterOffset + delimiterLength
    const wordEndOffset = wordStartOffset + word.length

    return {
      delimiterLength,
      kind: 'code',
      openDelimiterOffset,
      word,
      wordEndOffset,
      wordStartOffset,
    }
  }

  return null
}

/** Spec for a trailing markdown link shortcut before the cursor. */
export interface MarkdownLinkShortcutSpec {
  /** Discriminant. */
  readonly kind: 'link'

  /** Index where `[` starts (inclusive), in the string before delimiter removal. */
  readonly openDelimiterOffset: number

  /** Link label without brackets. */
  readonly text: string

  /** Sanitized href to store on the created {@link LinkNode}. */
  readonly href: string

  /** Optional title from `[text](url "title")`, or empty. */
  readonly title: string
}

/**
 * Parses a trailing markdown link shortcut `[text](url)` immediately before
 * `cursorOffset`. Opening `[` must be at node start or after whitespace,
 * matching mark shortcuts.
 */
export function parseMarkdownLinkShortcut(
  nodeText: string,
  cursorOffset: number,
): MarkdownLinkShortcutSpec | null {
  const textBeforeCursor = nodeText.slice(0, cursorOffset)
  const match = MARKDOWN_LINK_SHORTCUT_PATTERN.exec(textBeforeCursor)
  const text = match?.groups?.text
  const url = match?.groups?.url
  if (!match || !text || !url) {
    return null
  }

  if (!isMarkdownMarkShortcutOpenBoundary(textBeforeCursor, match.index)) {
    return null
  }

  const href = sanitizeLinkHref(normalizeUrl(url))
  if (href.length === 0) {
    return null
  }

  return {
    href,
    kind: 'link',
    openDelimiterOffset: match.index,
    text,
    title: match.groups?.title ?? '',
  }
}

/** Builds operations for a markdown link shortcut. */
export function buildMarkdownLinkShortcutOps(
  context: EditorContext,
  block: BlockWithInlineContent,
  node: InlineNodeWithEditableText,
  index: number,
  cursorOffset: number,
  spec: MarkdownLinkShortcutSpec,
): Operation[] {
  const { openDelimiterOffset, text, href, title } = spec
  const markdownLength = cursorOffset - openDelimiterOffset
  const suffix = node.text.slice(cursorOffset)

  const link = createLinkNode({
    marks: node.marks,
    metadata: node.metadata,
    text,
    url: { href, title },
  })

  if (openDelimiterOffset > 0) {
    const after = createFromInlineWithEditableText(node, {
      marks: node.marks,
      text: suffix,
    })

    return withTrailingSelectionOp(
      [
        {
          __type: 'delete_text',
          blockId: block.id,
          length: node.text.length - openDelimiterOffset,
          nodeId: node.id,
          offset: openDelimiterOffset,
          snapshot: { text: node.text.slice(openDelimiterOffset) },
        },
        {
          __type: 'insert_inline_node',
          afterNodeId: node.id,
          blockId: block.id,
          node: link,
        },
        {
          __type: 'insert_inline_node',
          afterNodeId: link.id,
          blockId: block.id,
          node: after,
        },
      ],
      createCursor({ blockId: block.id, nodeId: after.id, offset: 0 }),
      context.selection,
    )
  }

  const prevNode = block.content[index - 1]

  return withTrailingSelectionOp(
    [
      {
        __type: 'delete_text',
        blockId: block.id,
        length: markdownLength,
        nodeId: node.id,
        offset: 0,
        snapshot: { text: node.text.slice(0, markdownLength) },
      },
      {
        __type: 'insert_inline_node',
        afterNodeId: prevNode?.id ?? null,
        blockId: block.id,
        node: link,
      },
    ],
    createCursor({ blockId: block.id, nodeId: node.id, offset: 0 }),
    context.selection,
  )
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

  /**
   * Keep typing with the pre-shortcut marks, not the mark just applied.
   * A suffix split already has the original marks — park the caret there
   * instead of inserting an empty node (which paints as a ZWSP sibling).
   * Only insert an empty continuation when the shortcut is at the node end.
   */
  if (partial?.after) {
    return withTrailingSelectionOp(
      ops,
      createCursor({
        blockId: block.id,
        nodeId: partial.after.nodeId,
        offset: 0,
      }),
      context.selection,
    )
  }

  if (!isMarksEqual(nextMarks, prevMarks)) {
    const inserted = createFromInlineWithEditableText(node, {
      marks: prevMarks,
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
     * 💡 Cursor is immediately after `**word**` or `__word__` in an inline text
     *    node (end of node or mid-paragraph), with opening delimiters at node start
     *    or after whitespace (e.g. `Hello **world** there`, not `Hello**world**`).
     *    The last typed character is the final closing delimiter (`*` or `_`).
     * 🎯 Remove both delimiter pairs, apply bold only on `word` (prefix such as
     *    `Hello ` and suffix such as ` there` stay un-bold), caret after `word`.
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node } = situation

      const spec = parseMarkdownMarkShortcut(node.text, at.offset)
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

      const { at, node } = situation

      const spec = parseMarkdownMarkShortcut(node.text, at.offset)
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
     * 💡 Cursor is immediately after `*word*` or `_word_` in an inline text node
     *    (end of node or mid-paragraph), with opening delimiters at node start or
     *    after whitespace (e.g. `Hello *world* there`, not `Hello*world*`). The
     *    last typed character is the final closing delimiter (`*` or `_`).
     * 🎯 Remove both delimiter pairs, apply italic only on `word` (prefix such as
     *    `Hello ` and suffix such as ` there` stay un-italic), caret after `word`.
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node } = situation

      const spec = parseMarkdownMarkShortcut(node.text, at.offset)
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

      const { at, node } = situation

      const spec = parseMarkdownMarkShortcut(node.text, at.offset)
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
  {
    /**
     * 💡 Cursor is immediately after `~~*word~~` in an inline text
     *    node (end of node or mid-paragraph), with opening delimiters at node start
     *    or after whitespace (e.g. `Hello ~~world~~ there`, not `Hello~~world~~`).
     *    The last typed character is the final closing delimiter (`~`).
     * 🎯 Remove both delimiter pairs, apply strikethrough only on `word` (prefix such as
     *    `Hello ` and suffix such as ` there` stay un-strikethrough), caret after `word`.
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node } = situation

      const spec = parseMarkdownMarkShortcut(node.text, at.offset)
      if (
        spec === null ||
        spec.kind !== 'strikethrough' ||
        !MARKDOWN_STRIKETHROUGH_MARK_SHORTCUT_CLOSING_DELIMITERS.includes(
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
        'strikethrough',
      )
    },
    name: 'cursor/strikethrough-mark/inline-closing-delimiter',
    when: ({ situation, input }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, node } = situation

      const spec = parseMarkdownMarkShortcut(node.text, at.offset)
      if (
        spec === null ||
        spec.kind !== 'strikethrough' ||
        !MARKDOWN_STRIKETHROUGH_MARK_SHORTCUT_CLOSING_DELIMITERS.includes(
          input.text,
        )
      ) {
        return false
      }

      return true
    },
  },
  {
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node } = situation

      const spec = parseMarkdownMarkShortcut(node.text, at.offset)
      if (
        spec === null ||
        spec.kind !== 'code' ||
        !MARKDOWN_INLINE_CODE_MARK_SHORTCUT_CLOSING_DELIMITERS.includes(
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
        'code',
      )
    },
    name: 'cursor/inline-code-mark/inline-closing-delimiter',
    when: ({ situation, input }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, node } = situation

      const spec = parseMarkdownMarkShortcut(node.text, at.offset)
      if (
        spec === null ||
        spec.kind !== 'code' ||
        !MARKDOWN_INLINE_CODE_MARK_SHORTCUT_CLOSING_DELIMITERS.includes(
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
     * 💡 Cursor is immediately after `[text](url)` in an inline text node
     *    (end of node or mid-paragraph), with opening `[` at node start or after
     *    whitespace (e.g. `Hello [Liveblocks](https://liveblocks.io) there`, not
     *    `Hello[Liveblocks](https://liveblocks.io)`). The last typed character is
     *    the closing delimiter (`)`).
     * 🎯 Remove the markdown syntax, insert a {@link LinkNode} for `text`, keep
     *    prefix/suffix as text, caret after the link (not inside it).
     */
    build: ({ context, situation, input, resources }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection' || !resources.autolinkEnabled) {
        return null
      }

      const { at, block, node, index } = situation
      if (
        !isTextNode(node) ||
        !MARKDOWN_LINK_SHORTCUT_CLOSING_DELIMITERS.includes(input.text)
      ) {
        return null
      }

      const spec = parseMarkdownLinkShortcut(node.text, at.offset)
      if (spec === null) {
        return null
      }

      return buildMarkdownLinkShortcutOps(
        context,
        block,
        node,
        index,
        at.offset,
        spec,
      )
    },
    name: 'cursor/link/inline-closing-delimiter',
    when: ({ situation, input, resources }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, node } = situation
      if (
        !isTextNode(node) ||
        !MARKDOWN_LINK_SHORTCUT_CLOSING_DELIMITERS.includes(input.text)
      ) {
        return false
      }

      const isLinkShortcut =
        resources.autolinkEnabled &&
        parseMarkdownLinkShortcut(node.text, at.offset) !== null

      return isLinkShortcut
    },
  },
]

// --- Builder ───────────────────────────────────────---------------

/** Options for constructing a markdown shortcut ops builder. */
export interface MarkdownShortcutOpsBuilderOptions {
  /** Configuration for autolink detection. */
  readonly autolink: {
    /** Whether to enable autolink detection. */
    readonly enabled: boolean
  }
}

/** Markdown ops builder. */
export class MarkdownShortcutOpsBuilder extends OperationsBuilder<
  MarkdownShortcutOpsSituation,
  MarkdownShortcutOpsInput,
  MarkdownShortcutOpsResources
> {
  /** Configuration for autolink detection. */
  readonly #autolinkConfig: OperationsBuilderAutolinkConfig

  constructor(options: MarkdownShortcutOpsBuilderOptions) {
    super({ name: 'markdown-shortcut-ops-builder' })
    this.#autolinkConfig = options.autolink
  }

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
    const match = this.iterRules({
      context,
      input,
      resources: { autolinkEnabled: this.#autolinkConfig.enabled },
      rules,
      situation,
    }).next()
    if (match.done) {
      return null
    }

    const build = match.value
    const ops = build({
      context,
      input,
      resources: { autolinkEnabled: this.#autolinkConfig.enabled },
      situation,
    })
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
