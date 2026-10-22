import { warn } from './console'
import { normalizeRange, stepTextCursor } from './document'
import type { EditorContext } from './editor-context'
import type { GraphemeOffsetCaret } from './grapheme'
import type { ArrowDirection } from './keyboard'
import type { Operation } from './operations'
import { iterRules } from './operations-builder'
import type {
  BuilderOpsIntent,
  OperationRule,
  OperationsBuilder,
} from './operations-builder'
import {
  areSelectionsEqual,
  createCursor,
  createRange,
  isCursorSelection,
  isRangeSelection,
  isSelectionActive,
} from './selection'
import type { CursorSelection, RangeSelection, TextCursor } from './selection'

/** Situation with no selection. */
export interface MoveSelectionOpsNoSelectionSituation {
  readonly kind: 'no-selection'
}

/** Situation with a selection. */
export interface MoveSelectionOpsSelectionSituation {
  readonly kind: 'with-selection'

  /** Caret position the step starts from. */
  readonly origin: TextCursor

  /**
   * Anchor held fixed while extending (e.g `shift` + Arrow key).
   * `null` when moving a collapsed selection.
   */
  readonly rangeAnchor: TextCursor | null

  /** Caret after one step, or `null` at a boundary. */
  readonly nextFocus: TextCursor | null
}

/** Situation for move selection operations. */
export type MoveSelectionOpsSituation =
  | MoveSelectionOpsNoSelectionSituation
  | MoveSelectionOpsSelectionSituation

/** Input for move selection operations. */
export interface MoveSelectionOpsInput {
  /** The direction to move the selection. */
  readonly direction: ArrowDirection

  /** Whether to extend the selection (e.g `shift` + Arrow key). */
  readonly extend: boolean
}

/** Move selection operations rule. */
export type MoveSelectionOpsRule = OperationRule<
  MoveSelectionOpsSituation,
  MoveSelectionOpsInput,
  unknown
>

/** Define selection after move step */
export function defineSelectionAfterMoveStep(
  nextFocus: TextCursor,
  rangeAnchor: TextCursor | null,
  extend: boolean,
): CursorSelection | RangeSelection {
  if (extend && rangeAnchor !== null) {
    return createRange(rangeAnchor, nextFocus)
  }

  return createCursor(nextFocus)
}

/** Rules for move selection operations. */
export const moveRules: MoveSelectionOpsRule[] = [
  {
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'with-selection' || situation.nextFocus === null) {
        return null
      }

      const next = createCursor(situation.nextFocus)
      const ops: Operation[] = [
        {
          __type: 'set_selection',
          next,
          prev: context.selection,
        },
      ]

      return ops
    },
    /**
     * 💡 A range is selected and the user presses an arrow without Shift.
     *    The range collapses toward the arrow end (`origin`), then the caret steps once (`nextFocus`).
     * 🎯 Set selection to a cursor at `nextFocus` (not a range, not merely `origin`).
     */
    name: 'move-selection/from-range-by-step',
    when: ({ context, situation, input }): boolean => {
      if (situation.kind !== 'with-selection' || situation.nextFocus === null) {
        return false
      }

      if (input.extend || !isRangeSelection(context.selection)) {
        return false
      }

      const next = createCursor(situation.nextFocus)
      return !areSelectionsEqual(context.selection, next)
    },
  },
  {
    /**
     * 💡 Caret moves one step and selection would change.
     * 🎯 Set selection to a cursor, or to an extended range if `shift` is held.
     */
    build: ({ context, situation, input }): Operation[] | null => {
      if (situation.kind !== 'with-selection' || situation.nextFocus === null) {
        return null
      }

      const next = defineSelectionAfterMoveStep(
        situation.nextFocus,
        situation.rangeAnchor,
        input.extend,
      )

      const ops: Operation[] = [
        {
          __type: 'set_selection',
          next,
          prev: context.selection,
        },
      ]

      return ops
    },
    name: 'move-selection/by-step',
    when: ({ context, situation, input }): boolean => {
      if (situation.kind !== 'with-selection' || situation.nextFocus === null) {
        return false
      }

      /** Range without `shift` held cannot be stepped (`from-range-by-step` rule handles it ☝🏻). */
      if (isRangeSelection(context.selection) && !input.extend) {
        return false
      }

      const next = defineSelectionAfterMoveStep(
        situation.nextFocus,
        situation.rangeAnchor,
        input.extend,
      )

      return !areSelectionsEqual(context.selection, next)
    },
  },
  {
    /**
     * 💡 At boundary with a range selected, and without `shift` held
     *    we cannot step further.
     * 🎯 Collapse the range to origin unless that would not change selection.
     */
    build: ({ context, situation }): Operation[] | null => {
      if (situation.kind !== 'with-selection') {
        return null
      }

      const next = createCursor(situation.origin)
      const ops: Operation[] = [
        {
          __type: 'set_selection',
          next,
          prev: context.selection,
        },
      ]

      return ops
    },
    name: 'move-selection/collapse-range-at-boundary',
    when: ({ context, situation, input }): boolean => {
      if (situation.kind !== 'with-selection' || situation.nextFocus === null) {
        return false
      }

      const { extend } = input
      if (extend || !isRangeSelection(context.selection)) {
        return false
      }

      const collapsed = createCursor(situation.origin)
      return !areSelectionsEqual(collapsed, context.selection)
    },
  },
]

/** Options for constructing a move selection operations builder. */
export interface MoveSelectionOpsBuilderOptions {
  /** Grapheme offset caret instance. */
  readonly graphemeOffsetCaret: GraphemeOffsetCaret
}

/** Move selection operations builder. */
export class MoveSelectionOpsBuilder implements OperationsBuilder<
  MoveSelectionOpsSituation,
  MoveSelectionOpsInput
> {
  /** Grapheme offset caret instance. */
  readonly #graphemeOffsetCaret: GraphemeOffsetCaret

  constructor(options: MoveSelectionOpsBuilderOptions) {
    this.#graphemeOffsetCaret = options.graphemeOffsetCaret
  }

  /** Describe the {@link MoveSelectionOpsSituation}. */
  describe(
    context: EditorContext,
    input: MoveSelectionOpsInput,
  ): MoveSelectionOpsSituation {
    const { selection, state } = context
    if (!isSelectionActive(selection)) {
      return { kind: 'no-selection' }
    }

    const { direction, extend } = input

    let origin: TextCursor
    let rangeAnchor: TextCursor | null = null

    if (isCursorSelection(selection)) {
      origin = selection.anchor
      rangeAnchor = extend ? selection.anchor : null
    } else {
      const normalized = normalizeRange(state, selection)
      if (extend) {
        origin = selection.focus
        rangeAnchor = selection.anchor
      } else {
        const collapseToStart = direction === 'left' || direction === 'up'
        origin = collapseToStart ? normalized.anchor : normalized.focus
        rangeAnchor = null
      }
    }

    const nextFocus = stepTextCursor(state, origin, direction, {
      getNext: (text, offset) =>
        this.#graphemeOffsetCaret.getNextOffset(text, offset),
      getPrev: (text, offset) =>
        this.#graphemeOffsetCaret.getPrevOffset(text, offset),
      snapToBoundary: (text, offset) =>
        this.#graphemeOffsetCaret.snapOffsetToBoundary(text, offset),
    })

    return {
      kind: 'with-selection',
      nextFocus,
      origin,
      rangeAnchor,
    }
  }

  /** Builds ops to move selection. */
  build(
    context: EditorContext,
    input: MoveSelectionOpsInput,
  ): BuilderOpsIntent | null {
    const situation = this.describe(context, input)
    const { kind } = situation

    if (kind === 'no-selection') {
      return null
    }

    /** For move selection operations, by design we can only match one rule. */
    const match = iterRules({
      context,
      input,
      resources: null,
      rules: moveRules,
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
        'MoveSelectionOpsBuilder/#build',
      )
      return null
    }

    return { label: 'move-selection', ops }
  }
}
