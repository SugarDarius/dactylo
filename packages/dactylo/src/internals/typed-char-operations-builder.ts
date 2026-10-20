import { findNodeInBlockWithInlineContent } from './blocks'
import type { BlockId, BlockWithInlineContent } from './blocks'
import { warn } from './console'
import { INLINE_DETECTOR_TRIGGER_CHARACTER } from './constants'
import {
  compareTextCursors,
  getBlockWithInlineContent,
  normalizeRange,
} from './document'
import type { EditorContext } from './editor-context'
import { isMarksEqual } from './marks'
import type { Marks } from './marks'
import { createTextNode, isInlineNodeWithEditableText } from './nodes'
import type { InlineNodeWithEditableText } from './nodes'
import type { Operation } from './operations'
import type {
  ComposingOpsIntent,
  OperationBuilderInlineCommandTriggerConfig,
  OperationBuilderMentionsConfig,
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
  getRangeSelectionTopology,
  isCursorSelection,
} from './selection'
import type {
  Selection,
  RangeSelection,
  RangeSelectionTopology,
  TextCursor,
} from './selection'

/** Situation of a typed char operation when there is no selection. */
export interface TypedCharOperationNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation of a typed char operation when there is a cursor selection. */
export interface TypedCharOperationCursorSelectionSituation {
  readonly kind: 'cursor-selection'

  /** The cursor at which the typing operation is applied. */
  readonly at: TextCursor

  /** Block with inline content subject to the operation.  */
  readonly block: BlockWithInlineContent

  /** Inline node with editable text subject to the operation. */
  readonly node: InlineNodeWithEditableText

  /** Index of the inline node with editable text in the block. */
  readonly index: number
}

/** Situation of a typed char operation when there is a range selection. */
export interface TypedCharOperationRangeSelectionSituation {
  readonly kind: 'range-selection'

  /** The range at which the typing operation is applied. */
  readonly range: RangeSelection

  /** The topology of the range selection. */
  readonly topology: RangeSelectionTopology
}

/** Situation of a typed char operation. */
export type TypedCharOperationSituation =
  | TypedCharOperationNoSelectionSituation
  | TypedCharOperationCursorSelectionSituation
  | TypedCharOperationRangeSelectionSituation

/** Input given to a typed char operation. */
export interface TypedCharOperationInput {
  /** The character to insert. */
  readonly char: string
}

/** Typed char operation rule. */
export type TypedCharOperationRule = OperationRule<
  TypedCharOperationSituation,
  TypedCharOperationInput
>

/**
 * Builds operations to type one character when `activeMarks` ≠ target node marks.
 *
 * Produces `[before?][typedChar][after?]` as separate inline nodes using:
 * - `delete_text` to trim the tail off the original node when needed
 * - `insert_inline_node` for the typed character (known `insertNode.id`)
 * - `insert_inline_node` for the trailing segment when needed
 *
 * Does not emit `insert_text` on the original node for the new character.
 */
export function buildInsertTypedCharWithMarkBoundaryOps(
  activeMarks: Marks,
  cursor: TextCursor,
  char: string,
  /** Target node at the caret (text or link). */
  node: InlineNodeWithEditableText,
  /** Index of `node` in `block.content`. */
  nodeIndex: number,
  blockId: BlockId,
  /** Previous selection for undo inversion. */
  prevSelection: Selection | null,
): Operation[] {
  const before = node.text.slice(0, cursor.offset)
  const after = node.text.slice(cursor.offset)

  const insertNode = createTextNode({
    marks: activeMarks,
    metadata: node.metadata,
    text: char,
  })

  const ops: Operation[] = []

  /** Trim tail so the surviving node is only `before`. */
  if (after.length > 0) {
    ops.push({
      __type: 'delete_text',
      blockId,
      length: after.length,
      nodeId: node.id,
      offset: cursor.offset,
      snapshot: { marks: node.marks, text: after },
    })
  }

  /**
   * Insert position for the typed node:
   * - caret in the middle/end of a non-empty prefix → after the trimmed node
   * - caret at start (empty prefix) → before the original node
   */
  const typedInsertIndex = before.length > 0 ? nodeIndex + 1 : nodeIndex

  ops.push({
    __type: 'insert_inline_node',
    blockId,
    index: typedInsertIndex,
    node: insertNode,
  })

  if (after.length > 0) {
    ops.push({
      __type: 'insert_inline_node',
      blockId,
      index: typedInsertIndex + 1,
      node: createTextNode({
        marks: node.marks,
        metadata: node.metadata,
        text: after,
      }),
    })
  }

  ops.push({
    __type: 'set_selection',
    next: createCursor({
      blockId,
      nodeId: insertNode.id,
      offset: char.length,
    }),
    prev: prevSelection,
  })

  return ops
}

/** Rules for cursor selection. */
export const cursorRules: TypedCharOperationRule[] = [
  {
    build: (
      context: EditorContext,
      situation: TypedCharOperationSituation,
      input: TypedCharOperationInput,
    ): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node } = situation

      const ops: Operation[] = [
        {
          __type: 'insert_text',
          blockId: block.id,
          marks: context.activeMarks,
          nodeId: node.id,
          offset: at.offset,
          text: input.char,
        },
        {
          __type: 'set_selection',
          next: createCursor({
            blockId: block.id,
            nodeId: node.id,
            offset: at.offset + input.char.length,
          }),
          prev: context.selection,
        },
      ]

      return ops
    },
    name: 'cursor/match-active-marks/insert-char',
    when: (
      context: EditorContext,
      situation: TypedCharOperationSituation,
    ): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { node } = situation

      return isMarksEqual(node.marks, context.activeMarks)
    },
  },
  {
    build: (
      context: EditorContext,
      situation: TypedCharOperationSituation,
      input: TypedCharOperationInput,
    ): Operation[] | null => {
      if (situation.kind !== 'cursor-selection') {
        return null
      }

      const { at, block, node, index } = situation

      return buildInsertTypedCharWithMarkBoundaryOps(
        context.activeMarks,
        at,
        input.char,
        node,
        index,
        block.id,
        context.selection,
      )
    },
    name: 'cursor/mark-boundary/structural-insert-char',
    when: (
      context: EditorContext,
      situation: TypedCharOperationSituation,
    ): boolean => {
      if (situation.kind !== 'cursor-selection') {
        return false
      }

      const { node } = situation

      return !isMarksEqual(node.marks, context.activeMarks)
    },
  },
]

/** Rules for range selection. */
export const rangeRules: TypedCharOperationRule[] = []

// --- Builder ───────────────────────────────────────---------------

/** Options for constructing a typing operations builder. */
export interface TypedCharOperationsBuilderOptions {
  /** Configuration for mentions. */
  readonly mentions: {
    /** Whether to enable mentions. */
    readonly enabled: boolean

    /** The character to trigger a mention. */
    readonly character: string
  }

  /** Configuration for inline command trigger. */
  readonly inlineCommandTrigger: {
    /** Whether to enable inline command trigger. */
    readonly enabled: boolean

    /** The character to trigger an inline command. */
    readonly character: string
  }
}

/** Typed char operations builder. */
export class TypedCharOperationsBuilder implements OperationsBuilder<
  TypedCharOperationSituation,
  TypedCharOperationInput,
  ComposingOpsIntent
> {
  /** Configuration for mentions. */
  readonly #mentionsConfig: OperationBuilderMentionsConfig

  /** Configuration for inline command trigger. */
  readonly #inlineCommandTriggerConfig: OperationBuilderInlineCommandTriggerConfig

  constructor(options: TypedCharOperationsBuilderOptions) {
    this.#mentionsConfig = options.mentions
    this.#inlineCommandTriggerConfig = options.inlineCommandTrigger
  }

  /** Describes the {@link TypedCharOperationSituation}. */
  describe(context: EditorContext): TypedCharOperationSituation {
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
          'TypedCharOperationsBuilder/#describe',
        )
      }

      if (!isInlineNodeWithEditableText(found.node)) {
        buildError(
          `Node ${selection.anchor.nodeId} is not an inline node with editable text`,
          'TypedCharOperationsBuilder/#describe',
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
    if (compareTextCursors(state, anchor, focus) <= 0) {
      rangeCollapsedError(
        'Range selection is collapsed; expected anchor to precede focus.',
        'TypedCharOperationRule/#describeSituation',
      )
    }

    const topology = getRangeSelectionTopology(normalized)
    return { kind: 'range-selection', range: normalized, topology }
  }

  /**
   * Completes intent for a single typed character (or emoji) at the current selection.
   * Determines behaviors when:
   *  - {@link INLINE_DETECTOR_TRIGGER_CHARACTER} is typed:
   *   - → manage markdown shortcuts
   *   - → manage autolink detection
   *  - `mention_character` is typed → manage inline composition for mentions
   *  - `slash_command_character` is typed → manage inline composition for slash commands
   *  -  others chars are typed → insert the char and continue typing
   */
  #complete(
    ops: Operation[],
    char: string,
    type: 'cursor' | 'range',
  ): ComposingOpsIntent {
    const label =
      type === 'cursor' ? 'insert-char-at-cursor' : 'insert-char-at-range'

    // @todo: handle markdown shortcut
    // @todo: handle autolink detection
    // @todo: handle links finished
    if (char === INLINE_DETECTOR_TRIGGER_CHARACTER) {
      return {
        label: `markdown-shortcut`,
        ops,
        skipHistory: true,
      }
    }

    // @todo: handle mentions
    /** Apply inline composition ops for mentions. */
    if (
      this.#mentionsConfig.enabled &&
      char === this.#mentionsConfig.character
    ) {
      return { label: 'mention', ops, skipHistory: true }
    }

    // @todo: handle inline command trigger
    /** Apply inline composition ops for inline command trigger. */
    if (
      this.#inlineCommandTriggerConfig.enabled &&
      char === this.#inlineCommandTriggerConfig.character
    ) {
      return { label: 'inline-command-trigger', ops, skipHistory: true }
    }

    return {
      coalesce: true,
      label: `${label}:${char}`,
      ops,
    }
  }

  /**
   * Builds operations for a single typed character (or emoji) at the current selection.
   * Returns `null` when there is no active selection or no rules were matched.
   */
  build(
    context: EditorContext,
    input: TypedCharOperationInput,
  ): ComposingOpsIntent | null {
    const { char } = input

    const situation = this.describe(context)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    const rules = kind === 'cursor-selection' ? cursorRules : rangeRules

    /** For typed char operations, by design we can only match one rule. */
    const match = iterRules(rules, context, situation).next()
    if (match.done) {
      warn(
        'No rule applied for the given situation and input.',
        'TypedCharOperationsBuilder/#buildTypedCharOps',
      )
      return null
    }

    const build = match.value
    const ops = build(context, situation, { char })

    if (ops === null) {
      warn(
        'No operations were built for the given situation and input.',
        'TypedCharOperationsBuilder/#buildTypedCharOps',
      )
      return null
    }

    return this.#complete(
      ops,
      char,
      kind === 'cursor-selection' ? 'cursor' : 'range',
    )
  }
}
