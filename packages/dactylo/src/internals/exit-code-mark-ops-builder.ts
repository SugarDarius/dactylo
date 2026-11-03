import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockWithInlineContent } from './blocks'
import { warn } from './console'
import { getBlockWithInlineContent } from './document'
import type { EditorContext } from './editor-context'
import { isMarkEnabled } from './marks'
import type { Marks } from './marks'
import {
  createTextNode,
  isInlineNodeWithEditableText,
  isTextNode,
} from './nodes'
import type { InlineNode, InlineNodeWithEditableText } from './nodes'
import type { Operation } from './operations'
import type { BuilderOpsIntent, OperationRule } from './operations-builder'
import {
  OperationsBuilder,
  withTrailingSelectionOp,
} from './operations-builder'
import { createCursor, isCursorSelection, isSelectionActive } from './selection'
import type { TextCursor } from './selection'

/** Situation with no collapsed caret to exit from. */
export interface ExitCodeMarkOpsNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation with a cursor selection. */
export interface ExitCodeMarkOpsCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** Caret at which ops are applied. */
  readonly at: TextCursor

  /** Block with inline content subject to ops. */
  readonly block: BlockWithInlineContent

  /** Inline node with editable text subject to ops. */
  readonly node: InlineNodeWithEditableText

  /** Index of the inline node with editable text in the block. */
  readonly index: number
}

/** Situation of an exit-code-mark operation. */
export type ExitCodeMarkOpsSituation =
  | ExitCodeMarkOpsNoSelectionSituation
  | ExitCodeMarkOpsCursorSelectionSituation

/** Exit-code-mark operation rule. */
export type ExitCodeMarkOpsRule = OperationRule<
  ExitCodeMarkOpsSituation,
  unknown,
  unknown
>

/**
 * Whether `node` is already an unmarked-text hatch after a code run.
 * Markdown `` `code` `` inserts an empty continuation; do not add a space.
 */
export function isUnmarkedTextExitHatch(node: InlineNode | undefined): boolean {
  return (
    node !== undefined && isTextNode(node) && !isMarkEnabled(node.marks, 'code')
  )
}

/** Marks for the space hatch: keep sibling marks, drop `code`. */
export function marksWithoutCode(marks: Marks): Marks {
  return { ...marks, code: false }
}

/** Rules for cursor selection. */
export const cursorRules: ExitCodeMarkOpsRule[] = [
  {
    /**
     * 💡 Cursor is at the end of a non-empty text/link node with `code`.
     * 🎯 Insert a `" "` text node after it (not a link) without `code`,
     *    and put the caret after that space.
     */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node } = situation

      const insertedText = createTextNode({
        marks: marksWithoutCode(node.marks),
        text: ' ',
      })

      const ops: Operation[] = [
        {
          __type: 'insert_inline_node',
          afterNodeId: node.id,
          blockId: block.id,
          node: insertedText,
        },
      ]

      return withTrailingSelectionOp(
        ops,
        createCursor({
          blockId: at.blockId,
          nodeId: insertedText.id,
          offset: insertedText.text.length,
        }),
        context.selection,
      )
    },
    name: 'cursor/at-code-end/insert-space-hatch',
    when: ({ situation }): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { at, block, index, node } = situation
      const nextNode = block.content[index + 1]

      return (
        isMarkEnabled(node.marks, 'code') &&
        node.text.length > 0 &&
        at.offset === node.text.length &&
        !isUnmarkedTextExitHatch(nextNode)
      )
    },
  },
]

/** Exit-code-mark operations builder. */
export class ExitCodeMarkOpsBuilder extends OperationsBuilder<
  ExitCodeMarkOpsSituation,
  unknown,
  unknown
> {
  constructor() {
    super({ name: 'exit-code-mark-ops-builder' })
  }

  /** Describes the {@link ExitCodeMarkOpsSituation}. */
  describe(context: EditorContext): ExitCodeMarkOpsSituation {
    const { selection, state } = context
    if (!isSelectionActive(selection) || !isCursorSelection(selection)) {
      return { kind: 'no-selection' }
    }

    const block = getBlockWithInlineContent(state, selection.anchor.blockId)
    const found = findNodeInBlockWithInlineContent(
      block,
      selection.anchor.nodeId,
    )

    if (!found || !isInlineNodeWithEditableText(found.node)) {
      return { kind: 'no-selection' }
    }

    return {
      at: selection.anchor,
      block,
      index: found.index,
      kind: 'cursor-selection',
      node: found.node,
    }
  }

  /**
   * Builds ops to exit an inline code run by inserting a trailing space.
   * Returns `null` when the caret is not at the end of a code-marked node.
   */
  build(context: EditorContext): BuilderOpsIntent | null {
    const situation = this.describe(context)
    if (situation.kind === 'no-selection') {
      return null
    }

    const match = this.iterRules({
      context,
      input: null,
      resources: null,
      rules: cursorRules,
      situation,
    }).next()
    if (match.done) {
      return null
    }

    const ops = match.value({
      context,
      input: null,
      resources: null,
      situation,
    })
    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'ExitCodeMarkOpsBuilder/#build',
      )
      return null
    }

    return { label: 'exit-code-mark', ops }
  }
}
