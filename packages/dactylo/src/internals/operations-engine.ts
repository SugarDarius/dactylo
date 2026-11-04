import { AutolinkOpsBuilder } from './autolink-ops-builder'
import {
  cloneBlock,
  createDividerBlock,
  createHeadingBlock,
  createParagraphBlock,
  createParagraphBlockAfter,
  isBlockWithInlineContent,
} from './blocks'
import type { BlockId, HeadingBlock } from './blocks'
import type { TextPlainData } from './clipboard'
import { warn, warnOnceIf } from './console'
import { DeleteContentOpsBuilder } from './delete-content-ops-builder'
import {
  computeInsertBlockPosKey,
  createCursorAtDocumentEnd,
  getBlock,
  getBlockIndex,
  getBlockWithInlineContent,
  isBlockWithInlineContentEmpty,
  isMoveBlockNoOp,
  resolveInsertAfterBlockId,
} from './document'
import type { EditorContext } from './editor-context'
import { ExitCodeMarkOpsBuilder } from './exit-code-mark-ops-builder'
import { GraphemeOffsetCaret } from './grapheme'
import { HardBreakOpsBuilder } from './hard-break-ops-builder'
import { InsertTextOpsBuilder } from './insert-text-ops-builder'
import { MarkdownShortcutOpsBuilder } from './markdown-shortcut-ops-builder'
import type { MarkKey } from './marks'
import { MarksOpsBuilder } from './marks-ops-builder'
import { createTextNode } from './nodes'
import type { Operation } from './operations'
import { buildError } from './operations-builder'
import type {
  BuilderOpsIntent,
  InsertOrMoveBlockPosition,
  InsertBlockSpec,
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
import type { Metadata } from './types'
import { assertNever } from './utils'

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
    this.#opsRuntime = makeOperationsRuntime()

    this.#marksOpsBuilder = new MarksOpsBuilder()
    this.#markdownShortcutOpsBuilder = new MarkdownShortcutOpsBuilder({
      autolink: options.autolink,
    })
    this.#autolinkOpsBuilder = new AutolinkOpsBuilder()
    this.#insertTextOpsBuilder = new InsertTextOpsBuilder()
    this.#deleteContentOpsBuilder = new DeleteContentOpsBuilder({
      graphemeOffsetCaret: new GraphemeOffsetCaret({
        locales: options.locales,
      }),
    })
    this.#pastePlainTextOpsBuilder = new PastePlainTextOpsBuilder({
      autolink: options.autolink,
    })
    this.#softBreakOpsBuilder = new SoftBreakOpsBuilder()
    this.#hardBreakOpsBuilder = new HardBreakOpsBuilder()
    this.#exitCodeMarkOpsBuilder = new ExitCodeMarkOpsBuilder()
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

  // --- Blocks operations ─────────────────────────────────────────---

  /** Builds operations to insert a {@link Block} according to the given specification and position. */
  #buildInsertBlockOps(
    context: EditorContext,
    spec: InsertBlockSpec,
    pos?: InsertOrMoveBlockPosition,
  ): BuilderOpsIntent | null {
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

    const { type } = spec
    switch (type) {
      case 'paragraph': {
        const insertedText = createTextNode({
          text: '',
        })

        const paragraph = createParagraphBlock({
          content: [insertedText],
          metadata: spec.metadata,
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
              nodeId: insertedText.id,
              offset: 0,
            }),
            prev: selection,
          },
        ]

        return { label: 'insert-paragraph', ops }
      }
      case 'heading': {
        const insertedText = createTextNode({
          text: '',
        })

        const heading = createHeadingBlock({
          content: [insertedText],
          level: spec.level,
          metadata: spec.metadata,
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
              nodeId: insertedText.id,
              offset: 0,
            }),
            prev: selection,
          },
        ]

        return { label: 'insert-heading', ops }
      }
      case 'divider': {
        const divider = createDividerBlock({
          metadata: spec.metadata,
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

        return { label: 'insert-divider', ops }
      }
      default: {
        assertNever(type, { hint: 'OperationsEngine/buildInsertBlockOps' })
      }
    }
  }

  /** Builds operations to insert a {@link ParagraphBlock}. */
  buildInsertParagraphBlockOps(
    context: EditorContext,
    pos?: InsertOrMoveBlockPosition,
    metadata?: Metadata,
  ): BuilderOpsIntent | null {
    return this.#buildInsertBlockOps(
      context,
      { metadata, type: 'paragraph' },
      pos,
    )
  }

  /** Builds operations to insert an {@link HeadingBlock}. */
  buildInsertHeadingBlockOps(
    context: EditorContext,
    level: HeadingBlock['level'],
    pos?: InsertOrMoveBlockPosition,
    metadata?: Metadata,
  ): BuilderOpsIntent | null {
    return this.#buildInsertBlockOps(
      context,
      { level, metadata, type: 'heading' },
      pos,
    )
  }

  /** Builds operations to insert a {@link DividerBlock}. */
  buildInsertDividerBlockOps(
    context: EditorContext,
    pos?: InsertOrMoveBlockPosition,
    metadata?: Metadata,
  ): BuilderOpsIntent | null {
    return this.#buildInsertBlockOps(
      context,
      { metadata, type: 'divider' },
      pos,
    )
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

    const clone = cloneBlock(source, posKey)

    const ops: Operation[] = [
      {
        __type: 'insert_block',
        afterBlockId,
        block: clone,
      },
    ]

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
      warnOnceIf(
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
    ]

    return { label: 'delete', ops }
  }

  /** Builds operations to move a {@link Block} by ID to a new document position. */
  buildMoveBlockOps(
    context: EditorContext,
    blockId: BlockId,
    pos: InsertOrMoveBlockPosition,
  ): BuilderOpsIntent | null {
    const { state } = context
    getBlock(state, blockId)

    /**
     * Invariant UX:
     *  When the block is already at the destination,
     *  skip the move so history is not polluted with a posKey-only change.
     */
    if (isMoveBlockNoOp(state, blockId, pos)) {
      warnOnceIf(
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
}
