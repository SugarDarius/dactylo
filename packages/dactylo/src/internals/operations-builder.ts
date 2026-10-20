import type { EditorContext } from './editor-context'
import { DactyloError } from './errors'
import type { Operation } from './operations'

// --- Core- ─────────────────────────────────────────---------------

/** Throws a build error {@link DactyloError} when something goes wrong while building operations. */
export function buildError(message: string, hint: string): never {
  throw DactyloError.from({
    code: 'BUILD_TRANSACTION_OPERATIONS',
    hint,
    message,
  })
}

/** Throws a range selection collapsed error {@link DactyloError} when the range selection is collapsed. */
export function rangeCollapsedError(message: string, hint: string): never {
  throw DactyloError.from({
    code: 'RANGE_SELECTION_COLLAPSED',
    hint,
    message,
  })
}

/** Intent for building composing operations. */
export interface ComposingOpsIntent {
  /** The operations to apply. */
  readonly ops: Operation[]

  /** The kind for the intent. */
  readonly label: string

  /** When `true` merge history action for rapid typing coalescing. */
  readonly coalesce?: true

  /** When `true` history is skipped. */
  readonly skipHistory?: true
}

/** Rule describing a list of operations to apply to the document. */
export interface OperationRule<S, I> {
  /** Name given to the operation rule. */
  readonly name: string

  /**
   * Determines whether the operation rule should be applied
   * based on the {@link EditorContext}, and given situation.
   */
  readonly when: (context: EditorContext, situation: S) => boolean

  /**
   * Builds a list of operation to apply to the document
   * based on the {@link EditorContext}, given situation, and input.
   */
  readonly build: (
    context: EditorContext,
    situation: S,
    input: I,
  ) => Operation[] | null
}

/**
 * Iterates over the rules that should be applied to the given situation and input..
 * @yields {(context: EditorContext, situation: S, input: I) => Operation[] | null} The build function for the rule.
 */
export function* iterRules<S, I>(
  rules: OperationRule<S, I>[],
  context: EditorContext,
  situation: S,
): Generator<
  (context: EditorContext, situation: S, input: I) => Operation[] | null
> {
  for (const rule of rules) {
    if (rule.when(context, situation)) {
      yield rule.build
    }
  }
}

/** Shared interface to implement by operation builders. */
export interface OperationsBuilder<S, I, O> {
  /**
   * Describes the situation of the operation builder.
   * based on the given {@link EditorContext}.
   */
  readonly describe: (context: EditorContext) => S

  /**
   * Builds the output for the {@link EditorContext} and given input.
   * Returns `null` when no output should be produced.
   */
  readonly build: (context: EditorContext, input: I) => O | null
}

// --- Config ────────────────────────────────────────---------------

/** Configuration for mentions. */
export interface OperationBuilderMentionsConfig {
  /** Whether to enable mentions. */
  readonly enabled: boolean

  /** The character to use for mentions. */
  readonly character: string
}

/** Configuration for inline command trigger. */
export interface OperationBuilderInlineCommandTriggerConfig {
  /** Whether to enable inline command trigger. */
  readonly enabled: boolean

  /** The character to use for inline command trigger. */
  readonly character: string
}
