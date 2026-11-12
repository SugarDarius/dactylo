import type {
  BBM,
  CBM,
  DBM,
  HBM,
  LBNM,
  LNM,
  MNM,
  NBM,
  PBM,
  QBM,
  TNM,
} from './augmentation'
import {
  findNodeInBlockWithInlineContent,
  isNumberedListItemBlock,
  touchBlock,
} from './blocks'
import type {
  BlockId,
  BlockWithInlineContent,
  HeadingBlock,
  NumberedListItemBlock,
} from './blocks'
import { getBlock, isNumberedListRunContainingBlock } from './document'
import type { DocumentState } from './document'
import type { EditorContext } from './editor-context'
import { DactyloError } from './errors'
import { createBaseMarks, isMarksEqual } from './marks'
import type { Marks } from './marks'
import {
  collectLeadingEmptyRunways,
  collectTrailingEmptyRunways,
  createFromInlineWithEditableText,
  createLinkNode,
  createTextNode,
  isCanonicalEmptyInlineContent,
  isInlineContentTextEmpty,
  isInlineNodeWithEditableText,
  isTextNode,
  joinInlineContentAtMergeSeam,
  touchInlineNode,
} from './nodes'
import type {
  InlineNode,
  InlineNodeWithEditableText,
  NodeId,
  TextNode,
} from './nodes'
import {
  getDefaultMarkerNumbering,
  getMarkerNumbering,
  parseMarkerNumbering,
} from './numbered-list-marker'
import type { Operation, UpdateBlockOp } from './operations'
import type { RangeSelection, Selection, TextCursor } from './selection'
import type { Metadata, Relax } from './types'
import { assertNever } from './utils'

// --- Interfaces -───────────────────────────────────---------------

/** Initial metadata applied when creating blocks and inline nodes. */
export interface OperationsBuilderInitialMetadata {
  /** {@link ParagraphBlock} metadata taken from augmented type {@link PBM} */
  readonly paragraph: PBM

  /** {@link HeadingBlock} metadata taken from augmented type {@link HBM} */
  readonly heading: HBM

  /** {@link QuoteBlock} metadata taken from augmented type {@link QBM} */
  readonly quote: QBM

  /** {@link BulletListItemBlock} metadata taken from augmented type {@link BBM} */
  readonly bulletedList: BBM

  /** {@link NumberedListItemBlock} metadata taken from augmented type {@link NBM} */
  readonly numberedList: NBM

  /** {@link CheckboxListItemBlock} metadata taken from augmented type {@link CBM} */
  readonly checkboxList: CBM

  /** {@link DividerBlock} metadata taken from augmented type {@link DBM} */
  readonly divider: DBM

  /** {@link TextNode} metadata taken from augmented type {@link TNM} */
  readonly text: TNM

  /** {@link LinkNode} metadata taken from augmented type {@link LNM} */
  readonly link: LNM

  /** {@link LineBreakNode} metadata taken from augmented type {@link LBNM} */
  readonly lineBreak: LBNM

  /** {@link MentionNode} metadata taken from augmented type {@link MNM} */
  readonly mentions: MNM
}

/** Creates initial metadata for operations builders. */
export function createInitialMetadata(): OperationsBuilderInitialMetadata {
  return {
    bulletedList: {} as BBM,
    checkboxList: {} as CBM,
    divider: {} as DBM,
    heading: {} as HBM,
    lineBreak: {} as LBNM,
    link: {} as LNM,
    mentions: {} as MNM,
    numberedList: {} as NBM,
    paragraph: {} as PBM,
    quote: {} as QBM,
    text: {} as TNM,
  }
}

/** Intent when building ops to delete text. */
export interface BuilderDeleteIntent {
  /** The operations to apply. */
  readonly ops: Operation[]

  /** The caret position after the operations are applied. */
  readonly caret: TextCursor

  /**
   * Block that owns {@link caret} after `ops` apply.
   * Cross-block deletes set this to the merged target so follow-up
   * insert/break/paste can construct against post-delete geometry.
   */
  readonly caretBlock?: BlockWithInlineContent
}

/**
 * Intent when splitting a node to apply marks on a proper sub-range.
 * `marked` is where that run lives after `ops` apply.
 */
export interface PartialMarkRangeIntent {
  readonly ops: Operation[]

  /** Marked run after the split (whole new node, or prefix of the original). */
  readonly marked: {
    readonly from: number
    readonly nodeId: NodeId
    readonly to: number
  }

  /**
   * Trailing run after the marked range, when the range was not at the node
   * end. Same marks as the original node (`prevMarks`).
   */
  readonly after?: {
    readonly nodeId: NodeId
  }
}

/**
 * Intent when collapsing a text-empty non-canonical block.
 * Strips remaining inlines, insert one empty unmarked {@link TextNode}.
 */
export interface BuilderCollapseIntent {
  readonly ops: Operation[]

  /** The placeholder text node to use. */
  readonly placeholder: TextNode
}

/** Intent when building ops to send to {@link TransactionPipeline}. */
export interface BuilderOpsIntent {
  /** The operations to apply. */
  readonly ops: Operation[]

  /** The kind for the intent. */
  readonly label: string

  /** When `true` merge history action for rapid typing coalescing. */
  readonly coalesce?: true

  /** When `true` history is skipped. */
  readonly skipHistory?: true
}

/** Describes where a block should be inserted (or moved to) relative to existing blocks. */
export type InsertOrMoveBlockPosition = Relax<
  | {
      /** Insert at document start. */
      readonly type: 'start'
    }
  | {
      /** Insert at document end. */
      readonly type: 'end'
    }
  | {
      /** Insert immediately after an existing block. */
      readonly type: 'after'
      readonly blockId: BlockId
    }
  | {
      /** Insert immediately before an existing block. */
      readonly type: 'before'
      readonly blockId: BlockId
    }
>

/** Describes which block to create when inserting at a document position. */
export type InsertBlockSpec = Relax<
  | {
      readonly type: 'paragraph'

      /** Metadata to attach to the {@link ParagraphBlock}. */
      readonly metadata?: Metadata
    }
  | {
      readonly type: 'quote'

      /** Metadata to attach to the {@link QuoteBlock}. */
      readonly metadata?: Metadata
    }
  | {
      readonly type: 'heading'

      /** Level of the heading. */
      readonly level: HeadingBlock['level']

      /** Metadata to attach to the {@link HeadingBlock}. */
      readonly metadata?: Metadata
    }
  | {
      readonly type: 'bullet_list_item'

      /** Metadata to attach to the {@link BulletListItemBlock}. */
      readonly metadata?: Metadata
    }
  | {
      readonly type: 'numbered_list_item'

      /** Variant to use in order to display item marker. */
      readonly variant?: NumberedListItemBlock['variant']

      /** Metadata to attach to the {@link NumberedListItemBlock}. */
      readonly metadata?: Metadata
    }
  | {
      readonly type: 'checkbox_list_item'

      /** Whether the item is checked. */
      readonly checked?: boolean

      /** Metadata to attach to the {@link CheckboxListItemBlock}. */
      readonly metadata?: Metadata
    }
  | {
      readonly type: 'divider'

      /** Metadata to attach to the {@link DividerBlock}. */
      readonly metadata?: Metadata
    }
>

/** Describes which block to patch. */
export type PatchBlockSpec = {
  /** Replaces the block metadata record when provided. */
  readonly metadata?: Metadata
} & Relax<
  | {
      readonly type: 'paragraph'

      /** {@link ParagraphBlock}'s  content.  */
      readonly content?: InlineNode[]
    }
  | {
      readonly type: 'quote'

      /** {@link QuoteBlock}'s content. */
      readonly content?: InlineNode[]
    }
  | {
      readonly type: 'heading'

      /** {@link HeadingBlock}'s level. */
      readonly level?: HeadingBlock['level']

      /** {@link HeadingBlock}'s content. */
      readonly content?: InlineNode[]
    }
  | {
      readonly type: 'bullet_list_item'

      /** {@link BulletListItemBlock}'s content. */
      readonly content?: InlineNode[]
    }
  | {
      readonly type: 'numbered_list_item'

      /** {@link NumberedListItemBlock}'s variant. */
      readonly variant?: NumberedListItemBlock['variant']

      /** {@link NumberedListItemBlock}'s content. */
      readonly content?: InlineNode[]
    }
  | {
      readonly type: 'checkbox_list_item'

      /** Whether the item is checked. */
      readonly checked?: boolean

      /** {@link CheckboxListItemBlock}'s content. */
      readonly content?: InlineNode[]
    }
  | {
      readonly type: 'divider'
    }
>

/**
 * Describes spec location about a markdown shortcut mark.
 * All offset are in the string before delimiter removal.
 */
export type MarkdownMarkShortcutSpec = {
  /** Length of each delimiter run. */
  readonly delimiterLength: number

  /** Index where the opening delimiter starts (inclusive). */
  readonly openDelimiterOffset: number

  /** Index where the marked word starts (after opening delimiter). */
  readonly wordStartOffset: number

  /** Index where the marked word ends (exclusive, before closing delimiter). */
  readonly wordEndOffset: number

  /** The inner word without delimiters. */
  readonly word: string
} & Relax<
  | {
      readonly kind: 'bold'
    }
  | {
      readonly kind: 'italic'
    }
  | {
      readonly kind: 'strikethrough'
    }
  | {
      readonly kind: 'code'
    }
>

/** Describes spec for a trailing plain-text autolink immediately before the trigger space. */
export interface PlainTextAutolinkSpec {
  /** Index where the matched URL or markdown link starts (inclusive). */
  readonly start: number

  /** Index where the match ends (exclusive), at the trigger space. */
  readonly end: number

  /** Visible link text (URL string, or markdown label). */
  readonly text: string

  /** Sanitized href to store on the created {@link LinkNode}. */
  readonly href: string

  /** Title from the collected segment. */
  readonly title: string
}

/** Configuration for autolink detection. */
export interface OperationsBuilderAutolinkConfig {
  /** Whether to enable autolink detection. */
  readonly enabled: boolean
}

// --- Core -─────────────────────────────────────────---------------

/** Rule describing a list of operations to apply to the document. */
export interface OperationRule<S, I = unknown, R = unknown> {
  /** Name given to the operation rule. */
  readonly name: string

  /**
   * Determines whether the operation rule should be applied
   * based on the {@link EditorContext}, and given situation.
   */
  readonly when: (params: {
    context: EditorContext
    situation: S
    input: I
    resources: R
  }) => boolean

  /**
   * Builds a list of operation to apply to the document
   * based on the {@link EditorContext}, given situation, and input.
   */
  readonly build: (params: {
    context: EditorContext
    situation: S
    input: I
    resources: R
  }) => Operation[] | null
}

/** Options for constructing an operation builder. */
export interface OperationsBuilderOptions {
  /** The name of the operation builder. */
  readonly name: string
}

/**
 * Shared class for ops builders.
 * Forcing to implement `describe` and `build` methods.
 */
export abstract class OperationsBuilder<S, I = unknown, R = unknown> {
  /** Operation builder name. */
  readonly name: string

  constructor(options: OperationsBuilderOptions) {
    this.name = options.name
  }

  /**
   * Iterates over the rules that should be applied to the given situation and input.
   * @yields {(params: { context: EditorContext, situation: S, input: I}) => Operation[] | null}
   *  → The build function for the rule.
   */
  *iterRules(params: {
    rules: OperationRule<S, I, R>[]
    context: EditorContext
    situation: S
    input: I
    resources: R
  }): Generator<
    (params: {
      context: EditorContext
      situation: S
      input: I
      resources: R
    }) => Operation[] | null
  > {
    const { rules, ...rest } = params
    for (const rule of rules) {
      if (rule.when({ ...rest })) {
        yield rule.build
      }
    }
  }

  /**
   * Describes the situation of the operation builder.
   * based on the given {@link EditorContext}.
   */
  abstract describe(context: EditorContext, input: I): S

  /**
   * Builds the output for the {@link EditorContext} and given input.
   * Returns `null` when no output should be produced.
   */
  abstract build(context: EditorContext, input: I): BuilderOpsIntent | null
}

// --- Builders & Helpers ─────────────────────────────---------------

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

/**
 * Appends a trailing {@link SetSelectionOp}.
 * `ops` must not already contain a set selection op.
 */
export function withTrailingSelectionOp(
  ops: Operation[],
  next: Selection | null,
  prev: Selection | null,
): Operation[] {
  if (ops.some((op) => op.__type === 'set_selection')) {
    buildError(
      'withTrailingSelectionOp: ops must not contain a set selection op',
      'OperationsBuilder/withTrailingSelectionOp',
    )
  }

  return [
    ...ops,
    {
      __type: 'set_selection',
      next,
      prev,
    },
  ]
}

/** Resolves inline nodes that remain after deleting `[from, block_end]`. */
export function resolvesRemainingInlineNodesAfterForwardTripOps(
  block: BlockWithInlineContent,
  from: TextCursor,
): InlineNode[] {
  const found = findNodeInBlockWithInlineContent(block, from.nodeId)
  if (!found) {
    buildError(
      `Node ${from.nodeId} not found in block ${block.id}`,
      'OperationsBuilder/resolvesRemainingInlineNodesAfterForwardTripOps',
    )
  }

  const { index, node } = found
  const head = block.content.slice(0, index)

  if (isInlineNodeWithEditableText(node)) {
    const prefix = node.text.slice(0, from.offset)
    return [...head, touchInlineNode({ ...node, text: prefix })]
  }

  if (from.offset === 0) {
    return head
  }

  return [...head, node]
}

/** Resolves inline nodes that remain after deleting `[block_start, to]`. */
export function resolvesRemainingInlineNodesAfterBackwardTripOps(
  block: BlockWithInlineContent,
  to: TextCursor,
): InlineNode[] {
  const found = findNodeInBlockWithInlineContent(block, to.nodeId)
  if (!found) {
    buildError(
      `Node ${to.nodeId} not found in block ${block.id}`,
      'OperationsBuilder/resolvesRemainingInlineNodesAfterBackwardTripOps',
    )
  }

  const { index, node } = found
  const tail = block.content.slice(index + 1)

  if (isInlineNodeWithEditableText(node) && to.offset < node.text.length) {
    return [
      touchInlineNode({ ...node, text: node.text.slice(to.offset) }),
      ...tail,
    ]
  }

  return [...tail]
}

/**
 * Resolves inline nodes that remain after an in-block range delete,
 * including optional survivor join onto the anchor node.,
 */
export function resolvesRemainingInlineNodesAfterInBlockRange(
  block: BlockWithInlineContent,
  anchor: TextCursor,
  focus: TextCursor,
  /**
   * Append focus tail text onto the anchor node
   * when both ends are editable text with equal marks
   */
  joinSurvivors: boolean,
): InlineNode[] {
  const anchorFound = findNodeInBlockWithInlineContent(block, anchor.nodeId)
  const focusFound = findNodeInBlockWithInlineContent(block, focus.nodeId)

  if (!anchorFound || !focusFound) {
    buildError(
      'Anchor or focus node missing in block',
      'OperationsBuilder/resolvesRemainingInlineNodesAfterInBlockRange',
    )
  }

  const { index: aNi, node: aNode } = anchorFound
  const { index: fNi, node: fNode } = focusFound

  if (aNi === fNi && isInlineNodeWithEditableText(aNode)) {
    const text =
      aNode.text.slice(0, anchor.offset) + aNode.text.slice(focus.offset)
    return block.content.map((node, index) =>
      index === aNi ? touchInlineNode({ ...aNode, text }) : node,
    )
  }

  const head = block.content.slice(0, aNi)
  const between: InlineNode[] = []

  let keptAnchor: InlineNode | null = null
  if (isInlineNodeWithEditableText(aNode)) {
    keptAnchor = touchInlineNode({
      ...aNode,
      text: aNode.text.slice(0, anchor.offset),
    })
  } else if (anchor.offset !== 0) {
    keptAnchor = aNode
  }

  let keptFocus: InlineNode | null = null
  if (isInlineNodeWithEditableText(fNode) && focus.offset < fNode.text.length) {
    keptFocus = touchInlineNode({
      ...fNode,
      text: fNode.text.slice(focus.offset),
    })
  }

  if (
    joinSurvivors &&
    keptAnchor &&
    keptFocus &&
    isInlineNodeWithEditableText(keptAnchor) &&
    isInlineNodeWithEditableText(keptFocus) &&
    isMarksEqual(keptAnchor.marks, keptFocus.marks)
  ) {
    keptAnchor = touchInlineNode({
      ...keptAnchor,
      text: keptAnchor.text + keptFocus.text,
    })
    keptFocus = null
  }

  const tail = block.content.slice(fNi + 1)
  return [
    ...head,
    ...(keptAnchor ? [keptAnchor] : []),
    ...between,
    ...(keptFocus ? [keptFocus] : []),
    ...tail,
  ]
}

/**
 * Resolves undo fields when merging two blocks for a {@link MergeBlocksOp}.
 * After a merge, the previous block’s content and the current block’s content
 * live in one block, often in one coalesced text node.
 *
 * Undo must cut the document exactly at the old block boundary—as if
 * `Enter` had been pressed there before the merge—not at an arbitrary position
 *
 * Branch-by-branch logic:
 *  1. Target has no inline content (last node is missing)
 *   1.2 Both blocks have no inline content
 *  2. Target’s last inline node is text (usual case)
 *  3. Target’s last inline node is not text (line break, link, mentions, ...)
 *
 * Mental model (`Backspace merge`):
 * ```md
 * Before:
 *    Target:  [ ... , T_last(text:"abc") ]
 *    Source:  [ S_first(text:"def"), ... ]
 *
 * merge_blocks (atIndex = end of target)
 *
 * After:
 *    Target:  [ ... , coalesced "abcdef"? , ... ]
 *
 * Undo `split_block` at (T_last.id, 3)
 *    Head block keeps "abc"
 *    New/restored source block gets "def" + rest
 * ```
 *
 */
export function resolvesMergeBlocksUndoFields(
  source: BlockWithInlineContent,
  target: BlockWithInlineContent,
): { splitAtNodeId: NodeId; splitAtOffset: number } {
  const last = target.content[target.content.length - 1]
  if (!last) {
    const [first] = source.content
    /**
     * Degenerate case (two empty paragraphs). There is no real join point in the document.
     * The helper still returns some id/offset pair so MergeBlocksOp can be constructed;
     * in practice merges like this are rare, and undo leans on sourceSnapshot / mergedTailSnapshot /
     * atIndex as well.
     *
     * The fallback id is not in the document until something else creates it—treat this as a
     * spec placeholder for an edge case, not a happy-path path.
     */
    if (!first) {
      const fallback = createTextNode({ text: '' })
      return { splitAtNodeId: fallback.id, splitAtOffset: 0 }
    }

    return { splitAtNodeId: first.id, splitAtOffset: 0 }
  }

  if (isInlineNodeWithEditableText(last)) {
    return { splitAtNodeId: last.id, splitAtOffset: last.text.length }
  }

  return { splitAtNodeId: last.id, splitAtOffset: 0 }
}

/** Resolved editable inline node for caret after a delete intent */
export function resolvesCaretNode(
  block: BlockWithInlineContent,
  intent: BuilderDeleteIntent,
): InlineNodeWithEditableText {
  const { ops, caret } = intent

  for (const op of ops) {
    if (
      op.__type === 'insert_inline_node' &&
      op.node.id === caret.nodeId &&
      isInlineNodeWithEditableText(op.node)
    ) {
      return op.node
    }
  }

  const found = findNodeInBlockWithInlineContent(block, caret.nodeId)
  if (found && isInlineNodeWithEditableText(found.node)) {
    return found.node
  }

  buildError(
    `Caret node ${caret.nodeId} not allocated and not in block ${block.id}`,
    'InsertTextOpsBuilder/resolveCaretNode',
  )
}

/**
 * Inline nodes that move to the tail block when splitting a cursor.
 * Used by operations emitters to populate {@link SplitBlockOp} tailSnapshot field for undo.
 *
 * It mirrors tail extraction in {@link applySplitBlockOp}.
 */
export function computeSplitTailSnapshot(
  block: BlockWithInlineContent,
  atNode: { node: InlineNodeWithEditableText; index: number },
  atOffset: number,
): InlineNode[] {
  const { node, index } = atNode

  const type = node.__type
  switch (type) {
    case 'text': {
      const tailText = node.text.slice(atOffset)
      return [
        createTextNode({
          marks: node.marks,
          metadata: node.metadata,
          text: tailText,
        }),
        ...block.content.slice(index + 1),
      ]
    }
    case 'link': {
      const tailText = node.text.slice(atOffset)
      return [
        createLinkNode({
          marks: node.marks,
          metadata: node.metadata,
          text: tailText,
          url: node.url,
        }),
        ...block.content.slice(index + 1),
      ]
    }
    default: {
      assertNever(type, {
        hint: 'OperationsBuilder/computeSplitTailSnapshot',
      })
    }
  }
}

/**
 * Builds delete intent `[from_offset, to_offset]` inside one inline node with editable node.
 * Document-only: caller appends set selection op from the returned caret.
 */
export function buildDeleteOpsIntent(
  blockId: BlockId,
  node: InlineNodeWithEditableText,
  from: number,
  to: number,
): BuilderDeleteIntent {
  const length = to - from
  if (length <= 0) {
    rangeCollapsedError(
      'Range selection is collapsed; expected non-empty text range.',
      'OperationsBuilder/buildDeleteOpsIntent',
    )
  }

  return {
    caret: { blockId, nodeId: node.id, offset: from },
    ops: [
      {
        __type: 'delete_text',
        blockId,
        length,
        nodeId: node.id,
        offset: from,
        snapshot: { text: node.text.slice(from, to) },
      },
    ],
  }
}

/**
 * Deletes `[from.offset, to.offset]` inside one editable text node.
 * Document-only: caller appends set selection op from the returned caret.
 */
export function buildDeleteTextRunIntent(
  blockId: BlockId,
  node: InlineNodeWithEditableText,
  /** Inclusive start offset. */
  from: number,
  /** Exclusive end offset. */
  to: number,
): BuilderDeleteIntent {
  const length = to - from
  if (length <= 0) {
    rangeCollapsedError(
      'Range selection is collapsed; expected non-empty text range.',
      'OperationBuilder/#buildDeleteTextRunOps',
    )
  }

  return {
    caret: { blockId, nodeId: node.id, offset: from },
    ops: [
      {
        __type: 'delete_text',
        blockId,
        length,
        nodeId: node.id,
        offset: from,
        snapshot: { text: node.text.slice(from, to) },
      },
    ],
  }
}

/**
 * Removes inline nodes in `[firstIndex, lastIndex]` (inclusive).
 * Emits `remove_inline_node` from highest index → lowest so indices stay valid.
 */
export function buildRemoveInlineNodeRangeOps(
  block: BlockWithInlineContent,
  content: readonly InlineNode[],
  firstIndex: number,
  lastIndex: number,
): Operation[] {
  const ops: Operation[] = []

  for (let i = lastIndex; i >= firstIndex; i -= 1) {
    const snapshot = content[i]

    if (!snapshot) {
      continue
    }

    ops.push({
      __type: 'remove_inline_node',
      blockId: block.id,
      nodeId: snapshot.id,
      snapshot,
    })
  }

  return ops
}

/** Removes the given empty runway nodes from `block`. */
export function buildRemoveEmptyRunwayOps(
  blockId: BlockId,
  nodes: readonly InlineNode[],
): Operation[] {
  return nodes.map((node) => ({
    __type: 'remove_inline_node',
    blockId,
    nodeId: node.id,
    snapshot: node,
  }))
}

/**
 * Drops unused empty mark-toggle runways at a merge seam.
 * Trailing empties on the target and leading empties on the source, never the
 * sole remaining node of either block.
 */
export function stripEmptyRunwaysAtMergeSeam(
  target: BlockWithInlineContent,
  source: BlockWithInlineContent,
): {
  ops: Operation[]
  sourceContent: readonly InlineNode[]
  targetContent: readonly InlineNode[]
} {
  const trailing = collectTrailingEmptyRunways(target.content)
  const leading = collectLeadingEmptyRunways(source.content)

  return {
    ops: [
      ...buildRemoveEmptyRunwayOps(target.id, trailing),
      ...buildRemoveEmptyRunwayOps(source.id, leading),
    ],
    sourceContent: source.content.slice(leading.length),
    targetContent: target.content.slice(
      0,
      target.content.length - trailing.length,
    ),
  }
}

/**
 * Deletes from `from` (inclusive) through the end of the block.
 * Keeps `[block_start, from]`.
 */
export function buildForwardTrimBlockOps(
  block: BlockWithInlineContent,
  from: TextCursor,
): Operation[] {
  const found = findNodeInBlockWithInlineContent(block, from.nodeId)
  if (!found) {
    buildError(
      `Node ${from.nodeId} not found in block ${block.id}`,
      'OperationBuilder/#buildForwardTrimBlockOps',
    )
  }

  const { index: fromNi, node: fromNode } = found
  const ops: Operation[] = []

  if (isInlineNodeWithEditableText(fromNode)) {
    const tailLen = fromNode.text.length - from.offset
    if (tailLen > 0) {
      ops.push({
        __type: 'delete_text',
        blockId: block.id,
        length: tailLen,
        nodeId: fromNode.id,
        offset: from.offset,
        snapshot: {
          text: fromNode.text.slice(from.offset),
        },
      })
    }
  }

  const lastIndex = block.content.length - 1
  if (fromNi < lastIndex) {
    const inlines = buildRemoveInlineNodeRangeOps(
      block,
      [...block.content],
      fromNi + 1,
      lastIndex,
    )
    ops.push(...inlines)
  }

  /** Anchor on line_break / mention at offset 0: remove that node too. */
  if (!isInlineNodeWithEditableText(fromNode) && from.offset === 0) {
    ops.push({
      __type: 'remove_inline_node',
      blockId: block.id,
      nodeId: fromNode.id,
      snapshot: fromNode,
    })
  }

  return ops
}

/**
 * Builds `delete_block` ops for every block strictly between `startBlockId`
 * and `endBlockId` in document order.
 */
export function buildDeleteBlocksBetweenOps(
  context: EditorContext,
  startBlockId: BlockId,
  endBlockId: BlockId,
): Operation[] {
  const { state } = context
  const order = state.blockOrderById

  const startBi = order.indexOf(startBlockId)
  const endBi = order.indexOf(endBlockId)

  if (startBi === -1 || endBi === -1 || endBi <= startBi) {
    return []
  }

  const ops: Operation[] = []

  for (let bi = startBi + 1; bi < endBi; bi += 1) {
    const blockId = order[bi]
    if (!blockId) {
      continue
    }

    const block = getBlock(state, blockId)

    let afterBlockId: BlockId | null = null
    if (bi > 0) {
      afterBlockId = order[bi - 1] ?? null
    }

    ops.push({
      __type: 'delete_block',
      afterBlockId,
      blockId,
      snapshot: block,
    })
  }

  return ops
}

/**
 * Deletes from the start of the block through `to` (exclusive).
 * Keeps `[to, block end)`.
 */
export function buildBackwardTrimBlockOps(
  block: BlockWithInlineContent,
  to: TextCursor,
): Operation[] {
  const found = findNodeInBlockWithInlineContent(block, to.nodeId)
  if (!found) {
    buildError(
      `Node ${to.nodeId} not found in block ${block.id}`,
      'OperationsEngine/buildBackwardTrimBlockOps',
    )
  }

  const { index: toNi, node: toNode } = found

  const ops: Operation[] = []
  const fullyConsumesFocusText =
    isInlineNodeWithEditableText(toNode) && to.offset >= toNode.text.length

  /** Partial prefix removal on the focus text node. */
  if (
    isInlineNodeWithEditableText(toNode) &&
    to.offset > 0 &&
    !fullyConsumesFocusText
  ) {
    ops.push({
      __type: 'delete_text',
      blockId: block.id,
      length: to.offset,
      nodeId: toNode.id,
      offset: 0,
      snapshot: {
        text: toNode.text.slice(0, to.offset),
      },
    })
  }

  /**
   * Fully consumed focus node: remaining tail excludes it, so it must be
   * removed even when it is the first inline (`toNi === 0`).
   * Must run before removing nodes `[0, toNi)` so undo inserts at the original index.
   */
  if (fullyConsumesFocusText) {
    ops.push({
      __type: 'remove_inline_node',
      blockId: block.id,
      nodeId: toNode.id,
      snapshot: toNode,
    })
  }

  if (toNi > 0) {
    const inlines = buildRemoveInlineNodeRangeOps(
      block,
      [...block.content],
      0,
      toNi - 1,
    )
    ops.push(...inlines)
  }

  return ops
}

/**
 * When a block has no visible text ({@link isInlineContentTextEmpty}) but still
 * holds non-canonical inline structure (e.g. a lone empty {@link LinkNode}),
 * strip all inline nodes and insert one empty unmarked {@link TextNode}.
 *
 * If the block is already a single empty {@link TextNode} with marks, reset
 * those marks in place so the node id is preserved.
 *
 * Undo restores removed nodes via `remove_inline_node` snapshots.
 *
 * Returns ops plus the new placeholder node id for selection rewrite, or `null`
 * if the block is not text-empty or is already canonically empty text.
 */
export function buildCollapseEmptyBlockOps(
  block: BlockWithInlineContent,
  contentAfterPriorGeometry: InlineNode[],
  textMetadata?: TNM,
): { ops: Operation[]; placeholder: TextNode } | null {
  if (!isInlineContentTextEmpty(contentAfterPriorGeometry)) {
    return null
  }

  if (isCanonicalEmptyInlineContent(contentAfterPriorGeometry)) {
    return null
  }

  const emptyMarks = createBaseMarks()
  const [only] = contentAfterPriorGeometry

  if (
    contentAfterPriorGeometry.length === 1 &&
    only &&
    isTextNode(only) &&
    only.text.length === 0
  ) {
    return {
      ops: [
        {
          __type: 'set_marks',
          blockId: block.id,
          from: 0,
          nextMarks: emptyMarks,
          nodeId: only.id,
          prevMarks: only.marks,
          to: 0,
        },
      ],
      placeholder: {
        ...only,
        marks: emptyMarks,
      },
    }
  }

  const placeholder = createTextNode({ metadata: textMetadata, text: '' })
  const ops: Operation[] = [
    ...buildRemoveInlineNodeRangeOps(
      block,
      contentAfterPriorGeometry,
      0,
      contentAfterPriorGeometry.length - 1,
    ),
    {
      __type: 'insert_inline_node',
      afterNodeId: null,
      blockId: block.id,
      node: placeholder,
    },
  ]

  return { ops, placeholder }
}

/**
 * Apply collapse ops and point the caret to the allocated placeholder
 * when remaining inline nodes are text-empty and not canonical.
 */
export function buildApplyCollapseIfNeededIntent(
  block: BlockWithInlineContent,
  remaining: InlineNode[],
  intent: BuilderDeleteIntent,
  textMetadata?: TNM,
): BuilderDeleteIntent {
  const collapsed = buildCollapseEmptyBlockOps(block, remaining, textMetadata)
  if (!collapsed) {
    return intent
  }

  return {
    caret: { blockId: block.id, nodeId: collapsed.placeholder.id, offset: 0 },
    ops: [...intent.ops, ...collapsed.ops],
  }
}

/**
 * Builds intent for a range delete within a single block (possibly multiple inline nodes).
 * Joins optional surviving head/tail text when marks match onto the anchor node id.
 * Collapse allocates a placeholder and the caret is that id.
 */
export function buildDeleteRangeWithinBlockIntent(
  block: BlockWithInlineContent,
  anchor: TextCursor,
  focus: TextCursor,
  opts: {
    /** Whether to join matching-mark text ends onto the anchor. */
    joinSurvivors?: boolean

    /** Initial text metadata for a collapse placeholder. */
    textMetadata?: TNM
  } = {},
): BuilderDeleteIntent {
  const { joinSurvivors = true, textMetadata } = opts

  const anchorFound = findNodeInBlockWithInlineContent(block, anchor.nodeId)
  const focusFound = findNodeInBlockWithInlineContent(block, focus.nodeId)

  if (!anchorFound || !focusFound) {
    buildError(
      'Anchor or focus node missing in block',
      'OperationBuilder/buildDeleteRangeWithinBlockOps',
    )
  }

  const { index: aNi, node: aNode } = anchorFound
  const { index: fNi, node: fNode } = focusFound

  /** Same text node → single `delete_text`. */
  if (aNode.id === fNode.id && isInlineNodeWithEditableText(aNode)) {
    const intent = buildDeleteTextRunIntent(
      block.id,
      aNode,
      anchor.offset,
      focus.offset,
    )

    return buildApplyCollapseIfNeededIntent(
      block,
      resolvesRemainingInlineNodesAfterInBlockRange(
        block,
        anchor,
        focus,
        joinSurvivors,
      ),
      intent,
      textMetadata,
    )
  }

  const ops: Operation[] = []

  /**
   * Remaining-geometry drops a fully consumed focus text node
   * (`focus.offset >= text.length`). Ops must remove it rather than
   * `delete_text` the whole run, or the emptied sibling survives.
   */
  const fullyConsumesFocusText =
    fNi !== aNi &&
    isInlineNodeWithEditableText(fNode) &&
    focus.offset >= fNode.text.length

  const willJoinAndRemoveFocus =
    joinSurvivors &&
    isInlineNodeWithEditableText(aNode) &&
    isInlineNodeWithEditableText(fNode) &&
    aNi !== fNi &&
    isMarksEqual(aNode.marks, fNode.marks) &&
    focus.offset < fNode.text.length

  if (
    fNi !== aNi &&
    isInlineNodeWithEditableText(fNode) &&
    focus.offset > 0 &&
    !willJoinAndRemoveFocus &&
    !fullyConsumesFocusText
  ) {
    ops.push({
      __type: 'delete_text',
      blockId: block.id,
      length: focus.offset,
      nodeId: fNode.id,
      offset: 0,
      snapshot: { text: fNode.text.slice(0, focus.offset) },
    })
  }

  if (isInlineNodeWithEditableText(aNode)) {
    const tailLen = aNode.text.length - anchor.offset
    if (tailLen > 0) {
      ops.push({
        __type: 'delete_text',
        blockId: block.id,
        length: tailLen,
        nodeId: aNode.id,
        offset: anchor.offset,
        snapshot: { text: aNode.text.slice(anchor.offset) },
      })
    }
  } else if (anchor.offset === 0) {
    ops.push({
      __type: 'remove_inline_node',
      blockId: block.id,
      nodeId: aNode.id,
      snapshot: aNode,
    })
  }

  if (aNi + 1 <= fNi - 1) {
    ops.push(
      ...buildRemoveInlineNodeRangeOps(
        block,
        [...block.content],
        aNi + 1,
        fNi - 1,
      ),
    )
  }

  if (willJoinAndRemoveFocus && isInlineNodeWithEditableText(fNode)) {
    const tailText = fNode.text.slice(focus.offset)
    if (tailText.length > 0) {
      ops.push({
        __type: 'insert_text',
        blockId: block.id,
        nodeId: aNode.id,
        offset: anchor.offset,
        text: tailText,
      })
    }
    ops.push({
      __type: 'remove_inline_node',
      blockId: block.id,
      nodeId: fNode.id,
      snapshot: fNode,
    })
  } else if (fullyConsumesFocusText) {
    ops.push({
      __type: 'remove_inline_node',
      blockId: block.id,
      nodeId: fNode.id,
      snapshot: fNode,
    })
  }

  return buildApplyCollapseIfNeededIntent(
    block,
    resolvesRemainingInlineNodesAfterInBlockRange(
      block,
      anchor,
      focus,
      joinSurvivors,
    ),
    {
      caret: {
        blockId: block.id,
        nodeId: anchor.nodeId,
        offset: anchor.offset,
      },
      ops,
    },
    textMetadata,
  )
}

/**
 * Builds intent for a range delete cross-blocks.
 * Forward trim start + delete between + backward trim end + append merge.
 * Caret is hte joint point (anchor if it survived, else placeholder allocated here).
 */
export function buildDeleteRangeCrossBlockIntent(
  context: EditorContext,
  range: RangeSelection,
  startBlock: BlockWithInlineContent,
  endBlock: BlockWithInlineContent,
  textMetadata?: TNM,
): BuilderDeleteIntent {
  const ops: Operation[] = [
    ...buildForwardTrimBlockOps(startBlock, range.anchor),
    ...buildDeleteBlocksBetweenOps(context, startBlock.id, endBlock.id),
    ...buildBackwardTrimBlockOps(endBlock, range.focus),
  ]

  let remainingHead = resolvesRemainingInlineNodesAfterForwardTripOps(
    startBlock,
    range.anchor,
  )
  const collapsedHead = buildCollapseEmptyBlockOps(
    startBlock,
    remainingHead,
    textMetadata,
  )

  if (collapsedHead) {
    ops.push(...collapsedHead.ops)
    remainingHead = [collapsedHead.placeholder]
  }

  const remainingTail = resolvesRemainingInlineNodesAfterBackwardTripOps(
    endBlock,
    range.focus,
  )
  const stripped = stripEmptyRunwaysAtMergeSeam(
    { ...startBlock, content: remainingHead },
    { ...endBlock, content: remainingTail },
  )
  ops.push(...stripped.ops)

  remainingHead = [...stripped.targetContent]
  const remainingTailAfter = stripped.sourceContent
  const trimmedSource: BlockWithInlineContent = {
    ...endBlock,
    content: remainingTailAfter,
  }
  const trimmedTarget: BlockWithInlineContent = {
    ...startBlock,
    content: remainingHead,
  }

  const { splitAtNodeId, splitAtOffset } = resolvesMergeBlocksUndoFields(
    trimmedSource,
    trimmedTarget,
  )

  ops.push({
    __type: 'merge_blocks',
    mergedTailSnapshot: [...remainingTailAfter],
    sourceBlockId: endBlock.id,
    sourceSnapshot: trimmedSource,
    splitAtNodeId,
    splitAtOffset,
    targetBlockId: startBlock.id,
  })

  const mergedRemaining = joinInlineContentAtMergeSeam(
    remainingHead,
    remainingTailAfter,
  )
  const collapsedMerged = buildCollapseEmptyBlockOps(
    startBlock,
    mergedRemaining,
    textMetadata,
  )

  if (collapsedMerged) {
    ops.push(...collapsedMerged.ops)
    return {
      caret: {
        blockId: startBlock.id,
        nodeId: collapsedMerged.placeholder.id,
        offset: 0,
      },
      caretBlock: {
        ...startBlock,
        content: [collapsedMerged.placeholder],
      },
      ops,
    }
  }

  return {
    caret: {
      blockId: startBlock.id,
      nodeId: splitAtNodeId,
      offset: splitAtOffset,
    },
    caretBlock: {
      ...startBlock,
      content: mergedRemaining,
    },
    ops,
  }
}

/**
 * Whether the mark range is a proper sub range of node's text.
 * So applying a mark must split inline structure instead of toggling
 * marks on the whole node in place.
 */
export function isPartialMarkRange(
  textLen: number,
  from: number,
  to: number,
): boolean {
  return from !== to && !(from === 0 && to === textLen)
}

/**
 * Builds structural ops for toggling marks on a partial range within one
 * inline node with editable text.
 *
 * Two cases (same ID policy as split):
 *  1. `from > 0`: trim tail with `delete_text`, insert middle (+optional suffix) with `insert_inline_node`
 *     (middle node gets `nextMarks` at insert time; selection must move onto it)
 *  2. `from === 0`: trim suffix with `delete_text`, then whole-node `set_marks` on
 *     the surviving node (middle keeps the original id)
 */
export function buildPartialMarkRangeOps(
  blockId: BlockId,
  node: InlineNodeWithEditableText,
  from: number,
  to: number,
  nextMarks: Marks,
  prevMarks: Marks,
): PartialMarkRangeIntent | null {
  const { text } = node

  const middleText = text.slice(from, to)
  const afterText = text.slice(to)

  const middleLen = middleText.length

  if (!isPartialMarkRange(text.length, from, to)) {
    return null
  }

  const ops: Operation[] = []

  if (from > 0) {
    const tail = text.slice(from)

    const middleNode = createFromInlineWithEditableText(node, {
      marks: nextMarks,
      text: middleText,
    })

    ops.push(
      {
        __type: 'delete_text',
        blockId,
        length: tail.length,
        nodeId: node.id,
        offset: from,
        snapshot: {
          text: tail,
        },
      },
      {
        __type: 'insert_inline_node',
        afterNodeId: node.id,
        blockId,
        node: middleNode,
      },
    )

    if (afterText.length > 0) {
      const afterNode = createFromInlineWithEditableText(node, {
        marks: prevMarks,
        text: afterText,
      })

      ops.push({
        __type: 'insert_inline_node',
        afterNodeId: middleNode.id,
        blockId,
        node: afterNode,
      })

      return {
        after: { nodeId: afterNode.id },
        marked: { from: 0, nodeId: middleNode.id, to: middleLen },
        ops,
      }
    }

    return {
      marked: { from: 0, nodeId: middleNode.id, to: middleLen },
      ops,
    }
  }

  if (afterText.length > 0) {
    ops.push({
      __type: 'delete_text',
      blockId,
      length: afterText.length,
      nodeId: node.id,
      offset: to,
      snapshot: { text: afterText },
    })
  }

  ops.push({
    __type: 'set_marks',
    blockId,
    from: 0,
    nextMarks,
    nodeId: node.id,
    prevMarks,
    to: middleLen,
  })

  if (afterText.length > 0) {
    const afterNode = createFromInlineWithEditableText(node, {
      marks: prevMarks,
      text: afterText,
    })

    ops.push({
      __type: 'insert_inline_node',
      afterNodeId: node.id,
      blockId,
      node: afterNode,
    })

    return {
      after: { nodeId: afterNode.id },
      marked: { from: 0, nodeId: node.id, to: middleLen },
      ops,
    }
  }

  return {
    marked: { from: 0, nodeId: node.id, to: middleLen },
    ops,
  }
}

/**
 * Builds `update_block` ops so numbered items after `fromExclusiveBlockId`
 * stay consecutive in the same variant run.
 *
 * `fromExclusiveBlockId` is the block immediately before the suffix
 * (`null` = from the start of the document).
 *
 * - `continue` — increment from the given marker while the variant matches.
 * - `keep-start` — first numbered item keeps its marker; later same-variant items increment.
 * - `restart` — first matching-variant item becomes `1.` / `a.` / `i.`; later items increment.
 */
export function buildReindexNumberedListSuffixOps(
  state: DocumentState,
  fromExclusiveBlockId: BlockId | null,
  seed:
    | {
        kind: 'continue'
        markerNumbering: string
        variant: NumberedListItemBlock['variant']
      }
    | { kind: 'keep-start' }
    | {
        kind: 'restart'
        variant: NumberedListItemBlock['variant']
      },
): UpdateBlockOp[] {
  const order = state.blockOrderById
  const start =
    fromExclusiveBlockId === null ? -1 : order.indexOf(fromExclusiveBlockId)
  if (fromExclusiveBlockId !== null && start === -1) {
    return []
  }

  const ops: UpdateBlockOp[] = []
  let previous: string | null =
    seed.kind === 'continue' ? seed.markerNumbering : null
  let variant: NumberedListItemBlock['variant'] | null =
    seed.kind === 'keep-start' ? null : seed.variant

  for (let i = start + 1; i < order.length; i += 1) {
    const blockId = order[i]
    if (blockId === undefined) {
      break
    }
    const block = state.blocks.get(blockId)
    if (block === undefined || !isNumberedListItemBlock(block)) {
      break
    }

    const { markerNumbering, variant: blockVariant } = block

    if (seed.kind === 'keep-start') {
      if (variant === null) {
        variant = blockVariant
        previous = markerNumbering
        continue
      }
      if (blockVariant !== variant || previous === null) {
        break
      }
      const next = getMarkerNumbering(previous, variant)
      if (next !== markerNumbering) {
        ops.push({
          __type: 'update_block',
          patch: touchBlock({ ...block, markerNumbering: next }),
          snapshot: block,
        })
      }
      previous = next
      continue
    }

    if (variant === null || blockVariant !== variant) {
      break
    }

    const next =
      previous === null
        ? getDefaultMarkerNumbering(variant)
        : getMarkerNumbering(previous, variant)
    if (next !== markerNumbering) {
      ops.push({
        __type: 'update_block',
        patch: touchBlock({ ...block, markerNumbering: next }),
        snapshot: block,
      })
    }
    previous = next
  }

  return ops
}

/**
 * Reindexes the run after a numbered item that left the list
 * (delete, merge, or mutate to paragraph).
 */
export function buildReindexAfterRemovedNumberedItemOps(
  state: DocumentState,
  removed: NumberedListItemBlock,
): UpdateBlockOp[] {
  const order = state.blockOrderById
  const idx = order.indexOf(removed.id)
  const prevId = idx > 0 ? (order[idx - 1] ?? null) : null
  const prev = prevId === null ? undefined : state.blocks.get(prevId)

  if (
    prev &&
    isNumberedListItemBlock(prev) &&
    prev.variant === removed.variant
  ) {
    return buildReindexNumberedListSuffixOps(state, removed.id, {
      kind: 'continue',
      markerNumbering: prev.markerNumbering,
      variant: prev.variant,
    })
  }

  return buildReindexNumberedListSuffixOps(state, removed.id, {
    kind: 'restart',
    variant: removed.variant,
  })
}

/**
 * Builds `update_block` ops so numbered-list runs in the current document
 * order stay consecutive after a move of `movedBlockId`.
 *
 * `state.blockOrderById` must already be the post-move order.
 *
 * - Same-variant successor: increment from the previous desired marker.
 * - New run start that is the moved numbered item: `1.` / `a.` / `i.`.
 * - New run that still contains the moved item: keep the old run's start marker.
 * - Other new run starts: keep the stored marker.
 */
export function buildReindexNumberedListRunsOps(
  state: DocumentState,
  movedBlockId: BlockId,
): UpdateBlockOp[] {
  const order = state.blockOrderById
  const moved = state.blocks.get(movedBlockId)
  const ops: UpdateBlockOp[] = []
  let previous: {
    markerNumbering: string
    variant: NumberedListItemBlock['variant']
  } | null = null

  for (let i = 0; i < order.length; i += 1) {
    const blockId = order[i]
    if (blockId === undefined) {
      break
    }
    const block = state.blocks.get(blockId)
    if (block === undefined || !isNumberedListItemBlock(block)) {
      previous = null
      continue
    }

    const { markerNumbering, variant } = block
    let desired: string
    if (previous !== null && previous.variant === variant) {
      desired = getMarkerNumbering(previous.markerNumbering, variant)
    } else if (block.id === movedBlockId) {
      desired = getDefaultMarkerNumbering(variant)
    } else if (
      moved !== undefined &&
      isNumberedListItemBlock(moved) &&
      moved.variant === variant &&
      isNumberedListRunContainingBlock(state, i, movedBlockId, variant)
    ) {
      const movedOrdinal = parseMarkerNumbering(
        moved.markerNumbering,
        moved.variant,
      )
      const startOrdinal = parseMarkerNumbering(markerNumbering, variant)
      desired =
        movedOrdinal !== null &&
        startOrdinal !== null &&
        movedOrdinal < startOrdinal
          ? moved.markerNumbering
          : markerNumbering
    } else {
      desired = markerNumbering
    }

    if (desired !== markerNumbering) {
      ops.push({
        __type: 'update_block',
        patch: touchBlock({ ...block, markerNumbering: desired }),
        snapshot: block,
      })
    }

    previous = { markerNumbering: desired, variant }
  }

  return ops
}
