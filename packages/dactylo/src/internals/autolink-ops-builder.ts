import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockWithInlineContent } from './blocks'
import { warn } from './console'
import { INLINE_DETECTOR_TRIGGER_CHARACTER } from './constants'
import { getBlockWithInlineContent } from './document'
import type { EditorContext } from './editor-context'
import {
  createFromInlineWithEditableText,
  createLinkNode,
  isInlineNodeWithEditableText,
  isTextNode,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { Operation } from './operations'
import {
  buildError,
  OperationsBuilder,
  withTrailingSelectionOp,
} from './operations-builder'
import type {
  BuilderOpsIntent,
  OperationRule,
  PlainTextAutolinkSpec,
} from './operations-builder'
import { collectPlainTextLinks } from './plain-text'
import { sanitizeLinkHref } from './sanitize-link'
import { createCursor, isRangeSelection, isSelectionActive } from './selection'
import type { TextCursor } from './selection'

/** Situation with no selection or a range. */
export interface AutolinkOpsUnhandledSituation {
  readonly kind: 'unhandled-situation'
}

/** Situation with a cursor selection. */
export interface AutolinkOpsCursorSelectionSituation {
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

/** Situation of autolink operations. */
export type AutolinkOpsSituation =
  | AutolinkOpsUnhandledSituation
  | AutolinkOpsCursorSelectionSituation

/** Input for autolink operations. */
export interface AutolinkOpsInput {
  /** The text to insert. */
  readonly text: string
}

/** Rule for autolink operations. */
export type AutolinkOpsRule = OperationRule<
  AutolinkOpsSituation,
  AutolinkOpsInput
>

/**
 * Parses a trailing plain-text autolink immediately before `cursorOffset`.
 * The character at `cursorOffset - 1` must be {@link INLINE_DETECTOR_TRIGGER_CHARACTER},
 * a {@link collectPlainTextLinks} match must end at that space, and the match
 * must start at the node start or after whitespace so glued forms like
 * `seehttps://example.com` stay literal.
 */
export function parsePlainTextAutolink(
  nodeText: string,
  cursorOffset: number,
): PlainTextAutolinkSpec | null {
  const textBeforeCursor = nodeText.slice(0, cursorOffset)
  if (!textBeforeCursor.endsWith(INLINE_DETECTOR_TRIGGER_CHARACTER)) {
    return null
  }

  const beforeSpace = textBeforeCursor.slice(
    0,
    -INLINE_DETECTOR_TRIGGER_CHARACTER.length,
  )
  const matches = collectPlainTextLinks(beforeSpace, false)
  const last = matches[matches.length - 1]
  if (!last || last.end !== beforeSpace.length) {
    return null
  }

  if (last.start > 0) {
    const charBefore = beforeSpace[last.start - 1]
    if (charBefore === undefined || !/\s/u.test(charBefore)) {
      return null
    }
  }

  const href = sanitizeLinkHref(last.segment.href)
  if (href.length === 0) {
    return null
  }

  return {
    end: last.end,
    href,
    start: last.start,
    text: last.segment.text,
    title: last.segment.title,
  }
}

/** Builds operations to wrap a trailing autolink match in a {@link LinkNode}. */
export function buildPlainTextAutolinkOps(
  context: EditorContext,
  block: BlockWithInlineContent,
  node: InlineNodeWithEditableText,
  index: number,
  spec: PlainTextAutolinkSpec,
): Operation[] {
  const { start, end, text, href, title } = spec
  const matchLength = end - start
  const spaceAndSuffix = node.text.slice(end)

  const link = createLinkNode({
    marks: node.marks,
    metadata: node.metadata,
    text,
    url: { href, title },
  })

  const caretOffset = INLINE_DETECTOR_TRIGGER_CHARACTER.length

  if (start > 0) {
    const after = createFromInlineWithEditableText(node, {
      marks: node.marks,
      text: spaceAndSuffix,
    })

    return withTrailingSelectionOp(
      [
        {
          __type: 'delete_text',
          blockId: block.id,
          length: node.text.length - start,
          nodeId: node.id,
          offset: start,
          snapshot: { text: node.text.slice(start) },
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
      createCursor({
        blockId: block.id,
        nodeId: after.id,
        offset: caretOffset,
      }),
      context.selection,
    )
  }

  const prevNode = block.content[index - 1]

  return withTrailingSelectionOp(
    [
      {
        __type: 'delete_text',
        blockId: block.id,
        length: matchLength,
        nodeId: node.id,
        offset: 0,
        snapshot: { text: node.text.slice(0, matchLength) },
      },
      {
        __type: 'insert_inline_node',
        afterNodeId: prevNode?.id ?? null,
        blockId: block.id,
        node: link,
      },
    ],
    createCursor({
      blockId: block.id,
      nodeId: node.id,
      offset: caretOffset,
    }),
    context.selection,
  )
}

const rules: AutolinkOpsRule[] = [
  {
    /**
     * 💡 Cursor is immediately after a recognized plain-text URL or leftover
     *    `[text](url)` in an inline text node, with the match at node start or
     *    after whitespace (e.g. `see https://example.com`, not
     *    `seehttps://example.com`). The last typed character is
     *    {@link INLINE_DETECTOR_TRIGGER_CHARACTER}.
     * 🎯 Wrap that match in a {@link LinkNode}, keep the trigger space (and any
     *    prefix/suffix) as text, caret after the space (not inside the link).
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node, index } = situation
      if (
        !isTextNode(node) ||
        input.text !== INLINE_DETECTOR_TRIGGER_CHARACTER
      ) {
        return null
      }

      const spec = parsePlainTextAutolink(node.text, at.offset)
      if (spec === null) {
        return null
      }

      return buildPlainTextAutolinkOps(context, block, node, index, spec)
    },
    name: 'cursor/plain-text/inline-detector-trigger-character',
    when: ({ situation, input }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, node } = situation
      if (
        !isTextNode(node) ||
        input.text !== INLINE_DETECTOR_TRIGGER_CHARACTER
      ) {
        return false
      }

      return parsePlainTextAutolink(node.text, at.offset) !== null
    },
  },
]

/** Autolink ops builder. */
export class AutolinkOpsBuilder extends OperationsBuilder<
  AutolinkOpsSituation,
  AutolinkOpsInput
> {
  constructor() {
    super({ name: 'autolink-ops-builder' })
  }

  /** Describes the {@link AutolinkOpsSituation}. */
  describe(context: EditorContext): AutolinkOpsSituation {
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
        'AutolinkOpsBuilder/#describe',
      )
    }

    if (!isInlineNodeWithEditableText(found.node)) {
      buildError(
        `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
        'AutolinkOpsBuilder/#describe',
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

  /** Builds operations for a plain-text autolink. */
  build(
    context: EditorContext,
    input: AutolinkOpsInput,
  ): BuilderOpsIntent | null {
    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'unhandled-situation') {
      return null
    }

    /** For autolink operations, by design we can only match one rule. */
    const match = this.iterRules({
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
    const ops = build({
      context,
      input,
      resources: null,
      situation,
    })
    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'AutolinkOpsBuilder/#build',
      )
      return null
    }

    return { label: 'autolink', ops }
  }
}
