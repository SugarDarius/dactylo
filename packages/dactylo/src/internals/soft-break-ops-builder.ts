import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockWithInlineContent } from './blocks'
import { warn } from './console'
import {
  compareTextCursors,
  getBlockWithInlineContent,
  normalizeRange,
} from './document'
import type { EditorContext } from './editor-context'
import {
  createLineBreakNode,
  createLinkNode,
  createTextNode,
  isInlineNodeWithEditableText,
} from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { Operation } from './operations'
import type {
  BuilderOpsIntent,
  OperationRule,
  OperationsBuilder,
} from './operations-builder'
import {
  buildError,
  iterRules,
  rangeCollapsedError,
} from './operations-builder'
import {
  createCursor,
  isCursorAtBlockEnd,
  isCursorSelection,
} from './selection'
import type { RangeSelection, TextCursor } from './selection'
import { assertNever } from './utils'

/** Situation with no selection. */
export interface SoftBreakOpsNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation with a cursor selection. */
export interface SoftBreakOpsCursorSelectionSituation {
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
export interface SoftBreakOpsRangeSelectionSituation {
  readonly kind: 'range-selection'

  /** The range at which the typing operation is applied. */
  readonly range: RangeSelection
}

/** Situation for soft break operations. */
export type SoftBreakOpsSituation =
  | SoftBreakOpsNoSelectionSituation
  | SoftBreakOpsCursorSelectionSituation
  | SoftBreakOpsRangeSelectionSituation

/** Soft break operations rule. */
export type SoftBreakOpsRule = OperationRule<
  SoftBreakOpsSituation,
  unknown,
  unknown
>

/** Rules for cursor selection. */
export const cursorRules: SoftBreakOpsRule[] = [
  {
    /**
     * 💡 Selection is a cursor and it's at block end.
     * 🎯 Inserts a new line break node after the current node
     * and a new text node with empty text.      */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, index } = situation

      const insertedText = createTextNode({
        marks: context.activeMarks,
        text: '',
      })

      const ops: Operation[] = [
        {
          __type: 'insert_inline_node',
          blockId: block.id,
          index: index + 1,
          node: createLineBreakNode(),
        },
        {
          __type: 'insert_inline_node',
          blockId: block.id,
          index: index + 2,
          node: insertedText,
        },
        {
          __type: 'set_selection',
          next: createCursor({
            blockId: at.blockId,
            nodeId: insertedText.id,
            offset: 0,
          }),
          prev: context.selection,
        },
      ]

      return ops
    },
    name: 'cursor/soft-break/at-block-end',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { block } = situation
      return isCursorAtBlockEnd(situation.at, block)
    },
  },
  {
    /**
     * 💡 Selection is a cursor and it's not at block end.
     * 🎯 Splits the node at the cursor position.
     */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node, index } = situation

      const type = node.__type
      switch (type) {
        case 'text': {
          const tailText = node.text.slice(at.offset)
          const insertedText = createTextNode({
            marks: node.marks,
            metadata: node.metadata,
            text: tailText,
          })

          const ops: Operation[] = [
            {
              __type: 'delete_text',
              blockId: block.id,
              length: tailText.length,
              nodeId: node.id,
              offset: at.offset,
              snapshot: {
                marks: node.marks,
                text: tailText,
              },
            },
            {
              __type: 'insert_inline_node',
              blockId: block.id,
              index: index + 1,
              node: createLineBreakNode(),
            },
            {
              __type: 'insert_inline_node',
              blockId: block.id,
              index: index + 2,
              node: insertedText,
            },
            {
              __type: 'set_selection',
              next: createCursor({
                blockId: block.id,
                nodeId: insertedText.id,
                offset: 0,
              }),
              prev: context.selection,
            },
          ]

          return ops
        }
        case 'link': {
          const tailText = node.text.slice(at.offset)
          const insertedLink = createLinkNode({
            marks: node.marks,
            metadata: node.metadata,
            text: tailText,
            url: node.url,
          })

          const ops: Operation[] = [
            {
              __type: 'delete_text',
              blockId: block.id,
              length: tailText.length,
              nodeId: node.id,
              offset: at.offset,
              snapshot: {
                marks: node.marks,
                text: tailText,
              },
            },
            {
              __type: 'insert_inline_node',
              blockId: block.id,
              index: index + 1,
              node: createLineBreakNode(),
            },
            {
              __type: 'insert_inline_node',
              blockId: block.id,
              index: index + 2,
              node: insertedLink,
            },
            {
              __type: 'set_selection',
              next: createCursor({
                blockId: block.id,
                nodeId: insertedLink.id,
                offset: 0,
              }),
              prev: context.selection,
            },
          ]

          return ops
        }
        default: {
          assertNever(type, { hint: 'SoftBreakOpsBuilder/#build' })
        }
      }
    },
    name: 'cursor/soft-break/split-node-at',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { block } = situation
      return !isCursorAtBlockEnd(situation.at, block)
    },
  },
]

/** Rules for range selection. */
export const rangeRules: SoftBreakOpsRule[] = []

/** Soft break operations builder. */
export class SoftBreakOpsBuilder implements OperationsBuilder<
  SoftBreakOpsSituation,
  SoftBreakOpsRule
> {
  /** Describes the {@link SoftBreakOpsSituation}. */
  describe(context: EditorContext): SoftBreakOpsSituation {
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
        'SoftBreakOpsBuilder/#describe',
      )
    }

    return {
      kind: 'range-selection',
      range: normalized,
    }
  }

  /** Builds ops to apply a soft break. */
  build(context: EditorContext): BuilderOpsIntent | null {
    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    const isCursorKind = kind === 'cursor-selection'
    const rules = isCursorKind ? cursorRules : rangeRules

    /** For soft break operations, by design we can only match one rule. */
    const match = iterRules({
      context,
      input: null,
      resources: null,
      rules,
      situation,
    }).next()
    if (match.done) {
      warn(
        'No rule applied for the given situation and input.',
        'SoftBreakOpsBuilder/#build',
      )
      return null
    }

    const build = match.value
    const ops = build({
      context,
      input: null,
      resources: null,
      situation,
    })

    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'SoftBreakOpsBuilder/#build',
      )
      return null
    }

    return { label: 'insert-line-break', ops }
  }
}
