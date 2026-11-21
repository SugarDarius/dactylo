import type { MNED, MNM } from './augmentation'
import { AutolinkOpsBuilder } from './autolink-ops-builder'
import {
  cloneBlock,
  createBulletListItemBlock,
  createCheckboxListItemBlock,
  createDividerBlock,
  createHeadingBlock,
  createNumberedListItemBlock,
  createParagraphBlock,
  createParagraphBlockAfter,
  createQuoteBlock,
  findNodeInBlockWithInlineContent,
  isBlockWithInlineContent,
  isBulletListItemBlock,
  isCheckboxListItemBlock,
  isDividerBlock,
  isHeadingBlock,
  isNumberedListItemBlock,
  isParagraphBlock,
  isQuoteBlock,
  touchBlock,
} from './blocks'
import type { BlockId, BlockType } from './blocks'
import type { TextPlainData } from './clipboard'
import { logOnceIf, warn, warnIf } from './console'
import { DeleteContentForwardOpsBuilder } from './delete-content-forward-ops-builder'
import { DeleteContentOpsBuilder } from './delete-content-ops-builder'
import {
  computeInsertBlockPosKey,
  createCursorAtDocumentEnd,
  getBlock,
  getBlockIndex,
  getBlockNeighbors,
  getBlockWithInlineContent,
  isBlockWithInlineContentEmpty,
  isMoveBlockNoOp,
  resolveInsertAfterBlockId,
  resolveMarkerNumberingForInsert,
} from './document'
import type { EditorContext } from './editor-context'
import { ExitCodeMarkOpsBuilder } from './exit-code-mark-ops-builder'
import { GraphemeOffsetCaret } from './grapheme'
import { HardBreakOpsBuilder } from './hard-break-ops-builder'
import { InsertTextOpsBuilder } from './insert-text-ops-builder'
import { MarkdownShortcutOpsBuilder } from './markdown-shortcut-ops-builder'
import type { MarkKey } from './marks'
import { MarksOpsBuilder } from './marks-ops-builder'
import {
  createFromInlineWithEditableText,
  createMentionNode,
  createTextNode,
  getInlineNodeTextLength,
  isInlineNodeWithEditableText,
  isTextNode,
} from './nodes'
import type { InlineNode, MentionNode, NodeId } from './nodes'
import {
  formatMarkerNumbering,
  markerNumberingAfterNeighbor,
  parseMarkerNumbering,
} from './numbered-list-marker'
import type { Operation } from './operations'
import {
  buildError,
  buildReindexAfterRemovedNumberedItemOps,
  buildReindexNumberedListRunsOps,
  buildReindexNumberedListSuffixOps,
  withTrailingSelectionOp,
} from './operations-builder'
import type {
  BuilderOpsIntent,
  InsertBlockSpec,
  InsertOrMoveBlockPosition,
  MutateBlockSpec,
  OperationsBuilderInitialMetadata,
  PatchBlockSpec,
} from './operations-builder'
import { makeOperationsRuntime } from './operations-runtime'
import type { OperationsRuntime } from './operations-runtime'
import { PastePlainTextOpsBuilder } from './paste-plain-text-ops-builder'
import {
  areSelectionsEqual,
  createCursor,
  createRangeSelectingInlineContentInBlock,
  cursorAtBlockEnd,
  isCursorSelection,
  isRangeSelection,
  isSelectionActive,
} from './selection'
import type { Selection } from './selection'
import { SoftBreakOpsBuilder } from './soft-break-ops-builder'
import { assertNever } from './utils'

/** Warns about a mutate operation being a no-op. */
export function mutateOpsNoOpWarning(
  debug: boolean,
  blockId: BlockId,
  blockType: BlockType,
  hint?: string,
): void {
  warnIf(
    debug,
    `Cannot mutate ${blockType} block ${blockId} because it is already a ${blockType} block${hint ? `: ${hint}` : ''}`,
    'OperationsEngine/mutateOpsNoOpWarning',
  )
}

/** Warns about a patch operation being no-op. */
export function patchOpsNoOPWarning(
  debug: boolean,
  blockId: BlockId,
  targetBlockType: BlockType,
  sourceBlockType: BlockType,
): void {
  warnIf(
    debug,
    `Cannot patch block ${blockId} because source type is ${sourceBlockType} instead of ${targetBlockType}`,
    'OperationsEngine/patchOpsNoOPWarning',
  )
}

/** Options for constructing a {@link OperationsEngine} instance. */
export interface OperationsEngineOptions {
  /**
   * Whether to enable debug mode.
   * Defaults to `false`
   */
  readonly debug: boolean

  /** Locales to use when handling text operations. */
  readonly locales: Intl.LocalesArgument

  /** Configuration for autolink detection. */
  readonly autolink: {
    /** Whether to enable autolink detection. */
    readonly enabled: boolean
  }

  /**
   * Initial metadata applied when creating blocks and inline nodes.
   * Defaults to empty bags.
   */
  readonly initialMetadata: OperationsBuilderInitialMetadata
}

/**
 * Engine to build operations to use in {@link TransactionPipeline}.
 * Ops are built based on current state and input events for:
 *  - Validating operations
 *  - Applying operations
 *  - Inverting operations
 *
 * It allows to handle inline composition with mentions and slash command.
 */
export class OperationsEngine {
  /** Whether to enable debug mode. */
  readonly #debug: boolean

  /** Initial metadata applied when creating blocks and inline nodes. */
  readonly #initialMetadata: OperationsBuilderInitialMetadata

  /** Ops  runtime. */
  readonly #opsRuntime: OperationsRuntime

  /** Marks ops builder. */
  readonly #marksOpsBuilder: MarksOpsBuilder

  /** Markdown shortcut ops builder. */
  readonly #markdownShortcutOpsBuilder: MarkdownShortcutOpsBuilder

  /** Autolink ops builder. */
  readonly #autolinkOpsBuilder: AutolinkOpsBuilder

  /** Insert text ops builder. */
  readonly #insertTextOpsBuilder: InsertTextOpsBuilder

  /** Delete content ops builder. */
  readonly #deleteContentOpsBuilder: DeleteContentOpsBuilder

  /** Delete content forward ops builder. */
  readonly #deleteContentForwardOpsBuilder: DeleteContentForwardOpsBuilder

  /** Paste plain text ops builder. */
  readonly #pastePlainTextOpsBuilder: PastePlainTextOpsBuilder

  /** Soft break ops builder. */
  readonly #softBreakOpsBuilder: SoftBreakOpsBuilder

  /** Hard break ops builder. */
  readonly #hardBreakOpsBuilder: HardBreakOpsBuilder

  /** Exit-code-mark ops builder. */
  readonly #exitCodeMarkOpsBuilder: ExitCodeMarkOpsBuilder

  constructor(options: OperationsEngineOptions) {
    this.#debug = options.debug ?? false
    this.#initialMetadata = options.initialMetadata
    this.#opsRuntime = makeOperationsRuntime()

    this.#marksOpsBuilder = new MarksOpsBuilder()
    this.#markdownShortcutOpsBuilder = new MarkdownShortcutOpsBuilder({
      autolink: options.autolink,
      initialMetadata: this.#initialMetadata,
    })
    this.#autolinkOpsBuilder = new AutolinkOpsBuilder({
      initialMetadata: this.#initialMetadata,
    })
    this.#insertTextOpsBuilder = new InsertTextOpsBuilder({
      initialMetadata: this.#initialMetadata,
    })
    this.#deleteContentOpsBuilder = new DeleteContentOpsBuilder({
      graphemeOffsetCaret: new GraphemeOffsetCaret({
        locales: options.locales,
      }),
      initialMetadata: this.#initialMetadata,
    })
    this.#deleteContentForwardOpsBuilder = new DeleteContentForwardOpsBuilder({
      graphemeOffsetCaret: new GraphemeOffsetCaret({
        locales: options.locales,
      }),
      initialMetadata: this.#initialMetadata,
    })
    this.#pastePlainTextOpsBuilder = new PastePlainTextOpsBuilder({
      autolink: options.autolink,
      initialMetadata: this.#initialMetadata,
    })
    this.#softBreakOpsBuilder = new SoftBreakOpsBuilder({
      initialMetadata: this.#initialMetadata,
    })
    this.#hardBreakOpsBuilder = new HardBreakOpsBuilder({
      initialMetadata: this.#initialMetadata,
    })
    this.#exitCodeMarkOpsBuilder = new ExitCodeMarkOpsBuilder({
      initialMetadata: this.#initialMetadata,
    })
  }

  // --- Runtime ----─────────────────────────────────────────---------

  /** Gets the operations runtime. */
  get runtime(): OperationsRuntime {
    return this.#opsRuntime
  }

  // --- Marks operations ─────────────────────────────────────────----

  /**
   * Builds operations to toggle a mark on or off. */
  buildSetMarksOps(
    context: EditorContext,
    mark: MarkKey,
  ): BuilderOpsIntent | null {
    return this.#marksOpsBuilder.build(context, { mark })
  }

  // --- Markdown operations ──────────────────────────────────────----

  /** Builds operations for markdown shortcuts. */
  buildMarkdownShortcutOps(
    context: EditorContext,
    text: string,
  ): BuilderOpsIntent | null {
    return this.#markdownShortcutOpsBuilder.build(context, { text })
  }

  /** Builds operations for plain-text autolink detection. */
  buildAutolinkOps(
    context: EditorContext,
    text: string,
  ): BuilderOpsIntent | null {
    return this.#autolinkOpsBuilder.build(context, { text })
  }

  // --- Composing operations ─────────────────────────────────────────

  /**
   * Builds operations to insert a mention node after a mention buffer is confirmed.
   * Returns a tuple containing the operations and the created mention node.
   * Returns `null` when we cannot create the mention.
   */
  buildInsertMentionAfterBufferConfirmOps(
    context: EditorContext,
    /** Spec for inserting a mention after confirming buffer. */
    spec: {
      /** Entity related to the mention. */
      entity: { id: string; data: MNED }
      /** Metadata for the mention. */
      metadata?: MNM
      /** Block ID where the mention is being inserted. */
      blockId: BlockId
      /** Node ID where the mention is being inserted. */
      nodeId: NodeId
      /** Trigger offset where the mention is being inserted. */
      triggerOffset: number
      /** Buffered text where the mention is being inserted. */
      bufferedText: string
      /** Character that triggered the mention buffer. */
      character: string
    },
  ): [BuilderOpsIntent, MentionNode] | null {
    if (!isCursorSelection(context.selection)) {
      return null
    }

    const { state } = context
    const {
      blockId,
      entity,
      metadata,
      nodeId,
      triggerOffset,
      character,
      bufferedText,
    } = spec

    const block = getBlockWithInlineContent(state, blockId)
    const found = findNodeInBlockWithInlineContent(block, nodeId)

    if (!found || !isTextNode(found.node)) {
      return null
    }

    const { node } = found

    const opener = node.text.slice(
      triggerOffset,
      triggerOffset + character.length,
    )

    if (opener !== character) {
      return null
    }

    const qLen = character.length + bufferedText.length
    const query = node.text.slice(triggerOffset, triggerOffset + qLen)

    if (query !== character + bufferedText) {
      return null
    }

    const suffix = node.text.slice(triggerOffset + qLen)
    const mention = createMentionNode({
      entity,
      metadata: metadata ?? this.#initialMetadata.mentions,
    })

    let ops: Operation[] = []

    if (triggerOffset === 0) {
      ops.push({
        __type: 'delete_text',
        blockId: block.id,
        length: qLen,
        nodeId: node.id,
        offset: 0,
        snapshot: { text: query },
      })
    } else {
      ops.push({
        __type: 'delete_text',
        blockId: block.id,
        length: node.text.length - triggerOffset,
        nodeId: node.id,
        offset: triggerOffset,
        snapshot: { text: node.text.slice(triggerOffset) },
      })
    }

    ops.push({
      __type: 'insert_inline_node',
      afterNodeId: node.id,
      blockId: block.id,
      node: mention,
    })

    const after =
      suffix.length > 0
        ? createFromInlineWithEditableText(node, {
            marks: node.marks,
            text: suffix,
          })
        : createTextNode({
            metadata: this.#initialMetadata.text,
            text: ' ',
          })

    ops.push({
      __type: 'insert_inline_node',
      afterNodeId: mention.id,
      blockId: block.id,
      node: after,
    })

    ops = withTrailingSelectionOp(
      ops,
      createCursor({
        blockId: block.id,
        nodeId: after.id,
        offset: after.text.length,
      }),
      context.selection,
    )

    return [{ label: 'insert-after-buffer-confirm', ops }, mention]
  }

  /**
   * Builds operations to delete a command trigger buffer opener character and query span.
   * Returns `null` when the opener and query no longer match the document.
   */
  buildDeleteCommandTriggerInlineBufferSpanOps(
    context: EditorContext,
    /** Spec for deleting opener and query span after confirming buffer.  */
    spec: {
      /** Block ID where the command trigger buffer was opened. */
      blockId: BlockId
      /** Node ID where the command trigger buffer was opened. */
      nodeId: NodeId
      /** Trigger offset where the command trigger buffer was opened. */
      triggerOffset: number
      /** Buffered query text after the opener. */
      bufferedText: string
      /** Character that opened the command trigger buffer. */
      character: string
    },
  ): BuilderOpsIntent | null {
    if (!isCursorSelection(context.selection)) {
      return null
    }

    const { state } = context
    const { blockId, nodeId, triggerOffset, character, bufferedText } = spec

    const block = getBlockWithInlineContent(state, blockId)
    const found = findNodeInBlockWithInlineContent(block, nodeId)

    if (!found || !isTextNode(found.node)) {
      return null
    }

    const { node } = found

    const opener = node.text.slice(
      triggerOffset,
      triggerOffset + character.length,
    )

    if (opener !== character) {
      return null
    }

    const qLen = character.length + bufferedText.length
    const query = node.text.slice(triggerOffset, triggerOffset + qLen)

    if (query !== character + bufferedText) {
      return null
    }

    let ops: Operation[] = [
      {
        __type: 'delete_text',
        blockId: block.id,
        length: qLen,
        nodeId: node.id,
        offset: triggerOffset,
        snapshot: { text: query },
      },
    ]

    ops = withTrailingSelectionOp(
      ops,
      createCursor({
        blockId: block.id,
        nodeId: node.id,
        offset: triggerOffset,
      }),
      context.selection,
    )

    return { label: 'delete-command-trigger-inline-buffer-span', ops }
  }

  /** Builds operations to insert a text (char or emoji). */
  buildInsertTextOps(
    context: EditorContext,
    text: string,
  ): BuilderOpsIntent | null {
    return this.#insertTextOpsBuilder.build(context, { text })
  }

  /** Builds operations to delete content. */
  buildDeleteContentOps(context: EditorContext): BuilderOpsIntent | null {
    return this.#deleteContentOpsBuilder.build(context)
  }

  /** Builds operations to delete content forward. */
  buildDeleteContentForwardOps(
    context: EditorContext,
  ): BuilderOpsIntent | null {
    return this.#deleteContentForwardOpsBuilder.build(context)
  }

  /** Builds operations when user presses `Enter` key as a hard break. */
  buildHardBreakOps(context: EditorContext): BuilderOpsIntent | null {
    return this.#hardBreakOpsBuilder.build(context)
  }

  /** Builds operations when user presses `shift+Enter` key as a soft break. */
  buildSoftBreakOps(context: EditorContext): BuilderOpsIntent | null {
    return this.#softBreakOpsBuilder.build(context)
  }

  /** Builds operations for a pasted plain text. */
  buildPlainTextPasteOps(
    context: EditorContext,
    /** Plain text data to paste. */
    data: TextPlainData,
  ): BuilderOpsIntent | null {
    return this.#pastePlainTextOpsBuilder.build(context, { data })
  }

  /** Builds ops to exit an inline code run by inserting a trailing space. */
  buildExitCodeMarkOps(context: EditorContext): BuilderOpsIntent | null {
    return this.#exitCodeMarkOpsBuilder.build(context)
  }

  // --- Selection operations ─────────────────────────────────────────

  /** builds operations to select all content. */
  buildSelectAllOps(context: EditorContext): BuilderOpsIntent | null {
    if (!isSelectionActive(context.selection)) {
      return null
    }

    // @todo: handle range selection later with a structured algorithm to select all blocks from a range.
    if (isRangeSelection(context.selection)) {
      warn('Select all from a range selection is not implemented yet.')
      return null
    }

    const { selection, state } = context
    const { anchor } = selection

    const block = getBlockWithInlineContent(state, anchor.blockId)
    const next = createRangeSelectingInlineContentInBlock(block)

    if (next === null) {
      return null
    }

    const ops: Operation[] = [
      {
        __type: 'set_selection',
        next,
        prev: selection,
      },
    ]

    return { label: 'select-all', ops }
  }

  /** Builds operations to set selection to end of last block in document order. */
  buildPutCursorSelectionAtDocumentEndOps(
    context: EditorContext,
  ): BuilderOpsIntent | null {
    const next = createCursorAtDocumentEnd(context.state)
    if (!next) {
      buildError(
        'Failed to create cursor selection at document end',
        'OperationsEngine/buildPutCursorSelectionAtDocumentEndOps',
      )
    }

    const prev = context.selection

    /** Skip if selection is already at document's end. */
    if (
      prev?.__type === 'cursor' &&
      prev.anchor.blockId === next.anchor.blockId &&
      prev.anchor.nodeId === next.anchor.nodeId &&
      prev.anchor.offset === next.anchor.offset
    ) {
      return null
    }

    const ops: Operation[] = [
      {
        __type: 'set_selection',
        next,
        prev,
      },
    ]

    return { label: 'put-cursor-at-document-end', ops }
  }

  /** Builds operations to update selection. */
  buildUpdateSelectionOps(
    context: EditorContext,
    next: Selection | null,
  ): BuilderOpsIntent | null {
    /** Skip if next selection is equal to current selection. */
    if (areSelectionsEqual(context.selection, next)) {
      return null
    }

    const ops: Operation[] = [
      {
        __type: 'set_selection',
        next,
        prev: context.selection,
      },
    ]

    return { label: 'update', ops }
  }

  /** Builds operations to clear selection. */
  buildClearSelectionOps(context: EditorContext): BuilderOpsIntent | null {
    const { selection } = context

    /** Skip if selection is already set to `null`. */
    if (!selection) {
      return null
    }

    // @todo: handle clear selection on all blocks.
    const ops: Operation[] = [
      {
        __type: 'set_selection',
        next: null,
        prev: selection,
      },
    ]

    return { label: 'clear', ops }
  }

  /**
   * Builds operations to put the caret at the end of an inline-buffer span.
   * Returns `null` when the opener and query no longer match the document.
   */
  buildPutCursorAfterInlineBufferOps(
    context: EditorContext,
    spec: {
      /** Block ID where the inline buffer was opened. */
      blockId: BlockId
      /** Node ID where the inline buffer was opened. */
      nodeId: NodeId
      /** Offset inside the {@link TextNode} where the opener is located. */
      triggerOffset: number
      /** Buffered query text after the opener. */
      bufferedText: string
      /** Character that opened the inline buffer. */
      character: string
    },
  ): BuilderOpsIntent | null {
    const { state } = context
    const { blockId, nodeId, triggerOffset, bufferedText, character } = spec

    const block = state.blocks.get(blockId)
    if (!block || !isBlockWithInlineContent(block)) {
      return null
    }

    const found = findNodeInBlockWithInlineContent(block, nodeId)
    if (!found || !isTextNode(found.node)) {
      return null
    }

    const { node } = found
    const opener = node.text.slice(
      triggerOffset,
      triggerOffset + character.length,
    )

    if (opener !== character) {
      return null
    }

    const qLen = character.length + bufferedText.length
    const query = node.text.slice(triggerOffset, triggerOffset + qLen)

    if (query !== character + bufferedText) {
      return null
    }

    const ops: Operation[] = [
      {
        __type: 'set_selection',
        next: createCursor({
          blockId: block.id,
          nodeId: node.id,
          offset: triggerOffset + qLen,
        }),
        prev: context.selection,
      },
    ]

    return { label: 'put-cursor-after-inline-buffer', ops }
  }

  // --- Blocks operations ─────────────────────────────────────────---

  /**
   * Builds operations to reindex numbered-list markers after a move.
   * `context` must already reflect the post-move document.
   */
  buildReindexNumberedListAfterMoveOps(
    context: EditorContext,
    movedBlockId: BlockId,
  ): BuilderOpsIntent | null {
    const ops = buildReindexNumberedListRunsOps(context.state, movedBlockId)
    if (ops.length === 0) {
      return null
    }

    return { label: 'reindex-numbered-list-markers', ops }
  }

  /** Builds operations to insert a {@link Block} according to the given specification and position. */
  buildInsertBlockOps(
    context: EditorContext,
    spec: InsertBlockSpec,
    pos?: InsertOrMoveBlockPosition,
  ): [BuilderOpsIntent, BlockId] | null {
    const { state, selection } = context

    /** Do not insert if `pos` isn't given or selection is not active. */
    if (pos === undefined && !isSelectionActive(selection)) {
      warn(
        'Cannot insert paragraph block without a given insert position or an active selection.',
      )
      return null
    }

    const finalPos: InsertOrMoveBlockPosition =
      pos ??
      (isSelectionActive(selection)
        ? {
            blockId: isCursorSelection(selection)
              ? selection.anchor.blockId
              : selection.focus.blockId,
            type: 'after',
          }
        : { type: 'end' })

    const posKey = computeInsertBlockPosKey(state, finalPos)
    const afterBlockId = resolveInsertAfterBlockId(state, finalPos)

    const insertedText = createTextNode({
      metadata: this.#initialMetadata.text,
      text: '',
    })

    let content: InlineNode[] = [insertedText]
    let lastNode: InlineNode = insertedText
    let offset = 0

    if (spec.content !== undefined) {
      const last = spec.content[spec.content.length - 1]
      if (last !== undefined) {
        content = [...spec.content]

        /** If the last node is an editable text node, use its text length as the offset. */
        if (isInlineNodeWithEditableText(last)) {
          offset = getInlineNodeTextLength(last)
          lastNode = last
        }
        /** Otherwise, we create a new text node and set the offset to 0. */
        else {
          lastNode = createTextNode({
            metadata: this.#initialMetadata.text,
            text: '',
          })

          content.push(lastNode)
          offset = 0
        }
      }
    }

    const { type } = spec
    switch (type) {
      case 'paragraph': {
        const paragraph = createParagraphBlock({
          content,
          metadata: spec.metadata ?? this.#initialMetadata.paragraph,
          posKey,
        })

        const ops: Operation[] = [
          {
            __type: 'insert_block',
            afterBlockId,
            block: paragraph,
          },
          {
            __type: 'set_selection',
            next: createCursor({
              blockId: paragraph.id,
              nodeId: lastNode.id,
              offset,
            }),
            prev: selection,
          },
        ]

        return [{ label: 'insert-paragraph', ops }, paragraph.id]
      }
      case 'quote': {
        const quote = createQuoteBlock({
          content,
          metadata: spec.metadata ?? this.#initialMetadata.quote,
          posKey,
        })

        const ops: Operation[] = [
          {
            __type: 'insert_block',
            afterBlockId,
            block: quote,
          },
          {
            __type: 'set_selection',
            next: createCursor({
              blockId: quote.id,
              nodeId: lastNode.id,
              offset,
            }),
            prev: selection,
          },
        ]

        return [{ label: 'insert-quote', ops }, quote.id]
      }
      case 'heading': {
        const heading = createHeadingBlock({
          content,
          level: spec.level,
          metadata: spec.metadata ?? this.#initialMetadata.heading,
          posKey,
        })

        const ops: Operation[] = [
          {
            __type: 'insert_block',
            afterBlockId,
            block: heading,
          },
          {
            __type: 'set_selection',
            next: createCursor({
              blockId: heading.id,
              nodeId: lastNode.id,
              offset,
            }),
            prev: selection,
          },
        ]

        return [{ label: 'insert-heading', ops }, heading.id]
      }
      case 'bullet_list_item': {
        const bulletListItem = createBulletListItemBlock({
          content,
          metadata: spec.metadata ?? this.#initialMetadata.bulletedList,
          posKey,
        })

        const ops: Operation[] = [
          {
            __type: 'insert_block',
            afterBlockId,
            block: bulletListItem,
          },
          {
            __type: 'set_selection',
            next: createCursor({
              blockId: bulletListItem.id,
              nodeId: lastNode.id,
              offset,
            }),
            prev: selection,
          },
        ]

        return [{ label: 'insert-bullet-list-item', ops }, bulletListItem.id]
      }
      case 'numbered_list_item': {
        const variant = spec.variant ?? 'default'
        const numberedListItem = createNumberedListItemBlock({
          content,
          markerNumbering: resolveMarkerNumberingForInsert(
            state,
            afterBlockId,
            variant,
          ),
          metadata: spec.metadata ?? this.#initialMetadata.numberedList,
          posKey,
          variant,
        })

        const ops: Operation[] = [
          {
            __type: 'insert_block',
            afterBlockId,
            block: numberedListItem,
          },
          ...buildReindexNumberedListSuffixOps(state, afterBlockId, {
            kind: 'continue',
            markerNumbering: numberedListItem.markerNumbering,
            variant,
          }),
          {
            __type: 'set_selection',
            next: createCursor({
              blockId: numberedListItem.id,
              nodeId: lastNode.id,
              offset,
            }),
            prev: selection,
          },
        ]

        return [
          { label: 'insert-numbered-list-item', ops },
          numberedListItem.id,
        ]
      }
      case 'checkbox_list_item': {
        const checkboxListItem = createCheckboxListItemBlock({
          checked: spec.checked,
          content,
          metadata: spec.metadata ?? this.#initialMetadata.checkboxList,
          posKey,
        })

        const ops: Operation[] = [
          {
            __type: 'insert_block',
            afterBlockId,
            block: checkboxListItem,
          },
          {
            __type: 'set_selection',
            next: createCursor({
              blockId: checkboxListItem.id,
              nodeId: lastNode.id,
              offset,
            }),
            prev: selection,
          },
        ]

        return [
          { label: 'insert-checkbox-list-item', ops },
          checkboxListItem.id,
        ]
      }
      case 'divider': {
        const divider = createDividerBlock({
          metadata: spec.metadata ?? this.#initialMetadata.divider,
          posKey,
        })

        const paragraph = createParagraphBlockAfter(
          divider,
          [
            /**
             * Invariant UX:
             * When inserting a divider block,
             * a {@link ParagraphBlock} is inserted right after it and
             * the selection is set inside it.
             */
            insertedText,
          ],
          this.#initialMetadata.paragraph,
        )

        const ops: Operation[] = [
          {
            __type: 'insert_block',
            afterBlockId,
            block: divider,
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
            prev: selection,
          },
        ]

        return [{ label: 'insert-divider', ops }, divider.id]
      }
      default: {
        assertNever(type, { hint: 'OperationsEngine/buildInsertBlockOps' })
      }
    }
  }

  /** Builds operations to patch an existing {@link Block} in place. */
  buildPatchBlockOps(
    context: EditorContext,
    blockId: BlockId,
    spec: PatchBlockSpec,
  ): BuilderOpsIntent | null {
    const source = getBlock(context.state, blockId)

    const { type } = spec
    switch (type) {
      case 'paragraph': {
        if (!isParagraphBlock(source)) {
          patchOpsNoOPWarning(this.#debug, blockId, 'paragraph', source.__type)
          return null
        }

        const ops: Operation[] = [
          {
            __type: 'update_block',
            patch: touchBlock({
              ...source,
              content: spec.content ?? [...source.content],
              metadata: spec.metadata ?? source.metadata,
            }),
            snapshot: source,
          },
        ]

        return { label: 'patch-paragraph', ops }
      }
      case 'quote': {
        if (!isQuoteBlock(source)) {
          patchOpsNoOPWarning(this.#debug, blockId, 'quote', source.__type)
          return null
        }

        const ops: Operation[] = [
          {
            __type: 'update_block',
            patch: touchBlock({
              ...source,
              content: spec.content ?? [...source.content],
              metadata: spec.metadata ?? source.metadata,
            }),
            snapshot: source,
          },
        ]

        return { label: 'patch-quote', ops }
      }
      case 'heading': {
        if (!isHeadingBlock(source)) {
          patchOpsNoOPWarning(this.#debug, blockId, 'heading', source.__type)
          return null
        }

        const ops: Operation[] = [
          {
            __type: 'update_block',
            patch: touchBlock({
              ...source,
              content: spec.content ?? [...source.content],
              level: spec.level ?? source.level,
              metadata: spec.metadata ?? source.metadata,
            }),
            snapshot: source,
          },
        ]

        return { label: 'patch-heading', ops }
      }
      case 'bullet_list_item': {
        if (!isBulletListItemBlock(source)) {
          patchOpsNoOPWarning(
            this.#debug,
            blockId,
            'bullet_list_item',
            source.__type,
          )
          return null
        }

        const ops: Operation[] = [
          {
            __type: 'update_block',
            patch: touchBlock({
              ...source,
              content: spec.content ?? [...source.content],
              metadata: spec.metadata ?? source.metadata,
            }),
            snapshot: source,
          },
        ]

        return { label: 'patch-bullet-list-item', ops }
      }
      case 'numbered_list_item': {
        if (!isNumberedListItemBlock(source)) {
          patchOpsNoOPWarning(
            this.#debug,
            blockId,
            'numbered_list_item',
            source.__type,
          )
          return null
        }

        const variant = spec.variant ?? source.variant
        const ordinal =
          parseMarkerNumbering(source.markerNumbering, source.variant) ?? 1
        const markerNumbering =
          variant === source.variant
            ? source.markerNumbering
            : formatMarkerNumbering(ordinal, variant)

        const ops: Operation[] = [
          {
            __type: 'update_block',
            patch: touchBlock({
              ...source,
              content: spec.content ?? source.content,
              markerNumbering,
              metadata: spec.metadata ?? source.metadata,
              variant,
            }),
            snapshot: source,
          },
        ]

        if (variant !== source.variant) {
          ops.push(
            ...buildReindexNumberedListSuffixOps(context.state, source.id, {
              kind: 'continue',
              markerNumbering,
              variant,
            }),
            ...buildReindexNumberedListSuffixOps(context.state, source.id, {
              kind: 'restart',
              variant: source.variant,
            }),
          )
        }

        return { label: 'patch-numbered-list-item', ops }
      }
      case 'checkbox_list_item': {
        if (!isCheckboxListItemBlock(source)) {
          patchOpsNoOPWarning(
            this.#debug,
            blockId,
            'checkbox_list_item',
            source.__type,
          )
          return null
        }

        const ops: Operation[] = [
          {
            __type: 'update_block',
            patch: touchBlock({
              ...source,
              checked: spec.checked ?? source.checked,
              content: spec.content ?? source.content,
              metadata: spec.metadata ?? source.metadata,
            }),
            snapshot: source,
          },
        ]

        return { label: 'patch-checkbox-list-item', ops }
      }
      case 'divider': {
        if (!isDividerBlock(source)) {
          patchOpsNoOPWarning(this.#debug, blockId, 'divider', source.__type)
          return null
        }

        const ops: Operation[] = [
          {
            __type: 'update_block',
            patch: touchBlock({
              ...source,
              metadata: spec.metadata ?? source.metadata,
            }),
            snapshot: source,
          },
        ]

        return { label: 'patch-divider', ops }
      }
      default: {
        assertNever(type, { hint: 'OperationsEngine/buildPatchBlockOps' })
      }
    }
  }

  /** Builds operations to duplicate a {@link Block} by ID. */
  buildDuplicateBlockOps(
    context: EditorContext,
    blockId: BlockId,
  ): BuilderOpsIntent | null {
    const { state, selection } = context
    const source = getBlock(state, blockId)

    const pos: InsertOrMoveBlockPosition = { blockId: source.id, type: 'after' }

    const posKey = computeInsertBlockPosKey(state, pos)
    const afterBlockId = resolveInsertAfterBlockId(state, pos)

    let clone = cloneBlock(source, posKey)
    if (isNumberedListItemBlock(source) && isNumberedListItemBlock(clone)) {
      clone = {
        ...clone,
        markerNumbering: markerNumberingAfterNeighbor(source, source.variant),
      }
    }

    const ops: Operation[] = [
      {
        __type: 'insert_block',
        afterBlockId,
        block: clone,
      },
    ]

    if (isNumberedListItemBlock(clone)) {
      ops.push(
        ...buildReindexNumberedListSuffixOps(state, source.id, {
          kind: 'continue',
          markerNumbering: clone.markerNumbering,
          variant: clone.variant,
        }),
      )
    }

    /**
     * Invariant UX:
     *  When duplicating a block with inline content,
     *  the selection is set at the end of the duplicated block.
     */
    if (isBlockWithInlineContent(clone)) {
      ops.push({
        __type: 'set_selection',
        next: cursorAtBlockEnd(clone.id, clone),
        prev: selection,
      })
    }

    return { label: 'duplicate', ops }
  }

  /** Builds operations to move a {@link Block} by ID to a new document position. */
  buildMoveBlockOps(
    context: EditorContext,
    blockId: BlockId,
    pos: InsertOrMoveBlockPosition,
  ): BuilderOpsIntent | null {
    const { state } = context

    /**
     * Invariant UX:
     *  When the block is already at the destination,
     *  skip the move so history is not polluted with a posKey-only change.
     */
    if (isMoveBlockNoOp(state, blockId, pos)) {
      logOnceIf(
        this.#debug,
        `Skipping move of block ${blockId} because it is already at the destination.`,
        'OperationsEngine/buildMoveBlockOps',
      )
      return null
    }

    const posKey = computeInsertBlockPosKey(state, pos)
    const afterBlockId = resolveInsertAfterBlockId(state, pos)

    const ops: Operation[] = [
      {
        __type: 'move_block',
        afterBlockId,
        blockId,
        posKey,
      },
    ]

    return { label: 'move', ops }
  }

  /** Builds operations to mutate a {@link Block} type into another one by ID. */
  buildMutateBlockTypeOps(
    context: EditorContext,
    blockId: BlockId,
    spec: MutateBlockSpec,
  ): BuilderOpsIntent | null {
    const source = getBlock(context.state, blockId)

    if (!isBlockWithInlineContent(source)) {
      warnIf(
        this.#debug,
        `Cannot mutate block ${blockId} because source type is ${source.__type}`,
        'OperationsEngine/buildMutateBlockTypeOps',
      )
      return null
    }

    const { kind } = spec
    switch (kind) {
      case 'to_paragraph': {
        if (isParagraphBlock(source)) {
          mutateOpsNoOpWarning(this.#debug, blockId, 'paragraph')
          return null
        }

        const ops: Operation[] = [
          {
            __type: 'mutate_block_type',
            blockId: source.id,
            snapshot: source,
            spec: {
              kind: 'to_paragraph',
              metadata: spec.metadata ?? this.#initialMetadata.paragraph,
            },
          },
        ]

        if (isNumberedListItemBlock(source)) {
          ops.push(
            ...buildReindexAfterRemovedNumberedItemOps(context.state, source),
          )
        }

        return { label: 'mutate-paragraph', ops }
      }
      case 'to_quote': {
        if (isQuoteBlock(source)) {
          mutateOpsNoOpWarning(this.#debug, blockId, 'quote')
          return null
        }
        const ops: Operation[] = [
          {
            __type: 'mutate_block_type',
            blockId: source.id,
            snapshot: source,
            spec: {
              kind: 'to_quote',
              metadata: spec.metadata ?? this.#initialMetadata.quote,
            },
          },
        ]

        if (isNumberedListItemBlock(source)) {
          ops.push(
            ...buildReindexAfterRemovedNumberedItemOps(context.state, source),
          )
        }

        return { label: 'mutate-quote', ops }
      }
      case 'to_heading': {
        if (isHeadingBlock(source)) {
          mutateOpsNoOpWarning(this.#debug, blockId, 'heading')
          return null
        }
        const ops: Operation[] = [
          {
            __type: 'mutate_block_type',
            blockId: source.id,
            snapshot: source,
            spec: {
              kind: 'to_heading',
              level: spec.level,
              metadata: spec.metadata ?? this.#initialMetadata.heading,
            },
          },
        ]

        if (isNumberedListItemBlock(source)) {
          ops.push(
            ...buildReindexAfterRemovedNumberedItemOps(context.state, source),
          )
        }

        return { label: 'mutate-heading', ops }
      }
      case 'to_bullet_list_item': {
        if (isBulletListItemBlock(source)) {
          mutateOpsNoOpWarning(this.#debug, blockId, 'bullet_list_item')
          return null
        }

        const ops: Operation[] = [
          {
            __type: 'mutate_block_type',
            blockId: source.id,
            snapshot: source,
            spec: {
              kind: 'to_bullet_list_item',
              metadata: spec.metadata ?? this.#initialMetadata.bulletedList,
            },
          },
        ]

        if (isNumberedListItemBlock(source)) {
          ops.push(
            ...buildReindexAfterRemovedNumberedItemOps(context.state, source),
          )
        }

        return { label: 'mutate-bullet-list-item', ops }
      }
      case 'to_numbered_list_item': {
        if (
          isNumberedListItemBlock(source) &&
          source.variant === spec.variant
        ) {
          mutateOpsNoOpWarning(
            this.#debug,
            blockId,
            'numbered_list_item',
            `using same variant '${source.variant}'`,
          )
          return null
        }

        const variant = spec.variant ?? 'default'
        const { prev } = getBlockNeighbors(context.state, source.id)
        const markerNumbering = resolveMarkerNumberingForInsert(
          context.state,
          prev,
          variant,
        )

        const ops: Operation[] = [
          {
            __type: 'mutate_block_type',
            blockId: source.id,
            snapshot: source,
            spec: {
              kind: 'to_numbered_list_item',
              markerNumbering,
              metadata: spec.metadata ?? this.#initialMetadata.numberedList,
              variant,
            },
          },
          ...buildReindexNumberedListSuffixOps(context.state, source.id, {
            kind: 'continue',
            markerNumbering,
            variant,
          }),
        ]

        if (isNumberedListItemBlock(source) && source.variant !== variant) {
          ops.push(
            ...buildReindexNumberedListSuffixOps(context.state, source.id, {
              kind: 'restart',
              variant: source.variant,
            }),
          )
        }

        return { label: 'mutate-numbered-list-item', ops }
      }
      case 'to_checkbox_list_item': {
        if (isCheckboxListItemBlock(source)) {
          mutateOpsNoOpWarning(this.#debug, blockId, 'checkbox_list_item')
          return null
        }

        const ops: Operation[] = [
          {
            __type: 'mutate_block_type',
            blockId: source.id,
            snapshot: source,
            spec: {
              checked: spec.checked,
              kind: 'to_checkbox_list_item',
              metadata: spec.metadata ?? this.#initialMetadata.checkboxList,
            },
          },
        ]

        if (isNumberedListItemBlock(source)) {
          ops.push(
            ...buildReindexAfterRemovedNumberedItemOps(context.state, source),
          )
        }

        return { label: 'mutate-checkbox-list-item', ops }
      }
      default: {
        assertNever(kind, {
          hint: 'OperationsEngine/buildMutateBlockTypeOps',
        })
      }
    }
  }

  /** Builds operations to delete a {@link Block} by ID. */
  buildDeleteBlockOps(
    context: EditorContext,
    blockId: BlockId,
  ): BuilderOpsIntent | null {
    const { state, selection } = context
    // @todo: improve by creating am invariant checker
    const block = getBlock(state, blockId)
    const idx = getBlockIndex(state, blockId)
    const isEmpty = isBlockWithInlineContentEmpty(state, blockId)

    /**
     * Invariant UX:
     *  - When block is the only one in document,
     *  - When block is empty.
     * Then skip deletion because document must have at least one block.
     */
    if (idx === 0 && isEmpty) {
      logOnceIf(
        this.#debug,
        `Skipping deletion of block ${blockId} because it is the first empty block.`,
        'OperationsEngine/buildDeleteBlockOps',
      )
      return null
    }

    let afterBlockId: BlockId | null = null
    if (idx > 0) {
      afterBlockId = state.blockOrderById[idx - 1] ?? null
    }

    const ops: Operation[] = [
      {
        __type: 'delete_block',
        afterBlockId,
        blockId,
        snapshot: block,
      },
    ]

    if (isNumberedListItemBlock(block)) {
      ops.push(...buildReindexAfterRemovedNumberedItemOps(state, block))
    }

    ops.push(
      /**
       * Invariant UX:
       * Assuming after a block deletion we can't predict where
       * the selection should focus on.
       */
      {
        __type: 'set_selection',
        next: null,
        prev: selection,
      },
    )

    return { label: 'delete', ops }
  }
}
