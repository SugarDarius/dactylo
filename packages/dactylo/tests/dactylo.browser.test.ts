// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest'

import type {
  DactyloCommandEvent,
  DactyloErrorEvent,
  DactyloOptions,
  DactyloToolEvent,
} from '../src/dactylo'
import type { BlockId } from '../src/internals/blocks'
import {
  isBulletListItemBlock,
  isCheckboxListItemBlock,
  isDividerBlock,
  isHeadingBlock,
  isNumberedListItemBlock,
  isParagraphBlock,
  isQuoteBlock,
} from '../src/internals/blocks'
import {
  DEFAULT_AUTOLINK_ENABLED,
  DEFAULT_BULLET_LIST_ITEM_PLACEHOLDER,
  DEFAULT_CHECKBOX_LIST_ITEM_PLACEHOLDER,
  DEFAULT_COMMAND_TRIGGER_CHARACTER,
  DEFAULT_COMMAND_TRIGGER_ENABLED,
  DEFAULT_HEADING_PLACEHOLDER,
  DEFAULT_LINK_OPEN_ON_CLICK_ENABLED,
  DEFAULT_LOCALES,
  DEFAULT_MARKDOWN_SHORTCUTS_ENABLED,
  DEFAULT_MENTION_CHARACTER,
  DEFAULT_MENTIONS_ENABLED,
  DEFAULT_NUMBERED_LIST_ITEM_PLACEHOLDER,
  DEFAULT_PARAGRAPH_PLACEHOLDER,
  DEFAULT_QUOTE_PLACEHOLDER,
} from '../src/internals/constants'
import type { DocumentJsonInput } from '../src/internals/document-json-input'
import { DactyloError } from '../src/internals/errors'
import type { HistoryEvent } from '../src/internals/history'
import { isMarkEnabled } from '../src/internals/marks'
import {
  generateNodeId,
  isInlineNodeWithEditableText,
  isLineBreakNode,
  isLinkNode,
  isMentionNode,
  isTextNode,
} from '../src/internals/nodes'
import type {
  MentionDidCreatedEvent,
  Transaction,
} from '../src/internals/transaction'
import {
  deleteBackward,
  hardBreak,
  makeEditor,
  makeTypingEditor,
  pastePlainText,
  pressShortcut,
  sendInput,
  softBreak,
  tryDeleteBackward,
  typeText,
} from './utils/editor'
import {
  blockTexts,
  collectDocumentLifecycleNotifies,
  firstInlineBlock,
  nthInlineBlock,
  requireCursor,
  silenceDactyloErrorLog,
  snapshot,
} from './utils/pipeline'

/** JSON that fails schema validation so init can reach the error path. */
const INVALID_DOCUMENT_JSON = {
  blocks: {},
} as unknown as DocumentJsonInput

function threeNumberedEditor() {
  const editor = makeTypingEditor()
  const leftoverId = firstInlineBlock(editor.getContext()).id
  if (
    !editor.blocks.commands.insert({
      pos: { type: 'start' },
      spec: { type: 'numbered_list_item' },
    })
  ) {
    throw new Error('Expected an inserted numbered list item')
  }
  if (!editor.blocks.commands.delete(leftoverId)) {
    throw new Error('Expected leftover paragraph to be deleted')
  }
  editor.selection.commands.focus()
  typeText(editor, 'A')
  hardBreak(editor)
  typeText(editor, 'B')
  hardBreak(editor)
  typeText(editor, 'C')
  return editor
}

function numberedMarkers(
  editor: ReturnType<typeof makeTypingEditor>,
): string[] {
  const { state } = editor.getContext()
  return state.blockOrderById.map((id) => {
    const block = state.blocks.get(id)
    return block && isNumberedListItemBlock(block) ? block.markerNumbering : ''
  })
}

function typeMentionQuery(
  editor: ReturnType<typeof makeTypingEditor>,
  query = '',
  character = '@',
): void {
  typeText(editor, character)
  if (query.length > 0) {
    typeText(editor, query)
  }
}

/** Editor with mentions opted in — they are off by default. */
function makeMentionsEditor(options: DactyloOptions = {}) {
  return makeTypingEditor({
    ...options,
    mentions: { enabled: true, ...options.mentions },
  })
}

function typeCommandQuery(
  editor: ReturnType<typeof makeTypingEditor>,
  query = '',
  character = '/',
): void {
  typeText(editor, character)
  if (query.length > 0) {
    typeText(editor, query)
  }
}

/** Editor with command trigger opted in — it is off by default. */
function makeCommandTriggerEditor(options: DactyloOptions = {}) {
  return makeTypingEditor({
    ...options,
    commandTrigger: { enabled: true, ...options.commandTrigger },
  })
}

function withUnavailableDOM(run: () => void): void {
  Object.defineProperty(document, 'createElement', {
    configurable: true,
    value: undefined,
  })
  try {
    run()
  } finally {
    Reflect.deleteProperty(document, 'createElement')
  }
}

describe('Dactylo construction', () => {
  test('starts as an empty editable paragraph with no selection', () => {
    const editor = makeEditor()
    const context = editor.getContext()
    const block = firstInlineBlock(context)

    expect(context.state.blockOrderById).toHaveLength(1)
    expect(context.selection).toBeNull()
    expect(editor.canEdit()).toBe(true)
    expect(editor.history.tools.canUndo()).toBe(false)
    expect(editor.history.tools.canRedo()).toBe(false)
    expect(isParagraphBlock(block)).toBe(true)
    expect(editor.blocks.tools.isWithEmptyInlineContent(block.id)).toBe('empty')
  })

  test('resolves default config from constructor options', () => {
    const editor = makeEditor({ placeholder: 'Notes…' })

    expect(editor.config).toEqual({
      autolink: { enabled: DEFAULT_AUTOLINK_ENABLED },
      bulletedList: {
        initialMetadata: {},
        placeholder: DEFAULT_BULLET_LIST_ITEM_PLACEHOLDER,
      },
      checkboxList: {
        initialMetadata: {},
        placeholder: DEFAULT_CHECKBOX_LIST_ITEM_PLACEHOLDER,
      },
      commandTrigger: {
        character: DEFAULT_COMMAND_TRIGGER_CHARACTER,
        enabled: DEFAULT_COMMAND_TRIGGER_ENABLED,
      },
      divider: { initialMetadata: {} },
      heading: {
        initialMetadata: {},
        placeholder: DEFAULT_HEADING_PLACEHOLDER,
      },
      lineBreak: { initialMetadata: {} },
      link: {
        initialMetadata: {},
        openOnClick: DEFAULT_LINK_OPEN_ON_CLICK_ENABLED,
      },
      locales: DEFAULT_LOCALES,
      markdown: { enabled: DEFAULT_MARKDOWN_SHORTCUTS_ENABLED },
      mentions: {
        character: DEFAULT_MENTION_CHARACTER,
        enabled: DEFAULT_MENTIONS_ENABLED,
        initialMetadata: {},
      },
      numberedList: {
        initialMetadata: {},
        placeholder: DEFAULT_NUMBERED_LIST_ITEM_PLACEHOLDER,
      },
      paragraph: { initialMetadata: {}, placeholder: 'Notes…' },
      quote: {
        initialMetadata: {},
        placeholder: DEFAULT_QUOTE_PLACEHOLDER,
      },
      text: { initialMetadata: {} },
    })
  })

  test('applies config.editor overrides', () => {
    const editor = makeEditor({
      autolink: { enabled: false },
      bulletedList: { placeholder: 'Item' },
      commandTrigger: { character: '!', enabled: false },
      heading: { placeholder: 'Title' },
      link: { openOnClick: false },
      locales: 'fr-FR',
      markdown: { enabled: false },
      mentions: { character: '#', enabled: false },
      numberedList: { placeholder: 'Numero' },
      paragraph: { placeholder: 'Start here' },
      quote: { placeholder: 'Quote' },
    })

    expect(editor.config).toEqual({
      autolink: { enabled: false },
      bulletedList: { initialMetadata: {}, placeholder: 'Item' },
      checkboxList: {
        initialMetadata: {},
        placeholder: DEFAULT_CHECKBOX_LIST_ITEM_PLACEHOLDER,
      },
      commandTrigger: { character: '!', enabled: false },
      divider: { initialMetadata: {} },
      heading: { initialMetadata: {}, placeholder: 'Title' },
      lineBreak: { initialMetadata: {} },
      link: { initialMetadata: {}, openOnClick: false },
      locales: 'fr-FR',
      markdown: { enabled: false },
      mentions: {
        character: '#',
        enabled: false,
        initialMetadata: {},
      },
      numberedList: { initialMetadata: {}, placeholder: 'Numero' },
      paragraph: { initialMetadata: {}, placeholder: 'Start here' },
      quote: { initialMetadata: {}, placeholder: 'Quote' },
      text: { initialMetadata: {} },
    })
    expect(editor.config.paragraph.placeholder).not.toBe(
      DEFAULT_PARAGRAPH_PLACEHOLDER,
    )
  })

  test('throws when the mention character is not a single character', () => {
    expect(() => makeEditor({ mentions: { character: '@@' } })).toThrow(
      'Mention character must be a single non-empty character',
    )
  })

  test('throws when the mention character is empty', () => {
    expect(() => makeEditor({ mentions: { character: '' } })).toThrow(
      'Mention character must be a single non-empty character',
    )
  })

  test('throws when the command trigger character is not a single character', () => {
    expect(() => makeEditor({ commandTrigger: { character: '//' } })).toThrow(
      'Command trigger character must be a single non-empty character',
    )
  })

  test('throws when the command trigger character is empty', () => {
    expect(() => makeEditor({ commandTrigger: { character: '' } })).toThrow(
      'Command trigger character must be a single non-empty character',
    )
  })

  test('throws when mention and command trigger characters are the same', () => {
    expect(() =>
      makeEditor({
        commandTrigger: { character: '#' },
        mentions: { character: '#' },
      }),
    ).toThrow('Mention and command trigger characters must be different')
  })

  test('stores paragraph and text initialMetadata on config and the empty document', () => {
    const editor = makeEditor({
      paragraph: { initialMetadata: { source: 'paragraph' } },
      text: { initialMetadata: { source: 'text' } },
    })

    expect(editor.config.paragraph.initialMetadata).toEqual({
      source: 'paragraph',
    })
    expect(editor.config.text.initialMetadata).toEqual({ source: 'text' })

    const block = firstInlineBlock(editor.getContext())
    expect(block.metadata).toEqual({ source: 'paragraph' })

    const [node] = block.content
    expect(node && isTextNode(node) ? node.metadata : undefined).toEqual({
      source: 'text',
    })
  })
})

describe('Dactylo document status', () => {
  test('empty editor is ready after construction', () => {
    const editor = makeEditor()

    expect(editor.getDocumentStatus()).toBe('ready')
  })

  test('documentStatus, documentReady, and documentError do not replay after construction', () => {
    const editor = makeEditor()
    const statuses: string[] = []
    let readyCount = 0
    let errorCount = 0

    editor.events.documentStatus.subscribe((status) => {
      statuses.push(status)
    })
    editor.events.documentReady.subscribe(() => {
      readyCount += 1
    })
    editor.events.documentError.subscribe(() => {
      errorCount += 1
    })

    expect(statuses).toEqual([])
    expect(readyCount).toBe(0)
    expect(errorCount).toBe(0)
  })

  test('documentReady emits durationMs when initialization succeeds', () => {
    const lifecycle = collectDocumentLifecycleNotifies(() => {
      const editor = makeEditor()
      expect(editor.getDocumentStatus()).toBe('ready')
    })

    expect(lifecycle.statuses).toEqual(['initializing', 'ready'])
    expect(lifecycle.ready).toHaveLength(1)
    expect(lifecycle.ready[0]?.durationMs).toBeGreaterThanOrEqual(0)
    expect(lifecycle.errors).toEqual([])
  })

  test('documentError emits when initial JSON is invalid', () => {
    const restoreErrorLog = silenceDactyloErrorLog()

    try {
      const lifecycle = collectDocumentLifecycleNotifies(() => {
        expect(() =>
          makeEditor({ initialContent: INVALID_DOCUMENT_JSON }),
        ).toThrow(DactyloError)
      })

      expect(lifecycle.statuses).toEqual(['initializing', 'error'])
      expect(lifecycle.ready).toEqual([])
      expect(lifecycle.errors).toHaveLength(1)
      expect(lifecycle.errors[0]?.durationMs).toBeGreaterThanOrEqual(0)
      expect(lifecycle.errors[0]?.error).toBeInstanceOf(DactyloError)
      expect(lifecycle.errors[0]?.error.code).toBe(
        'DESERIALIZE_DOCUMENT_JSON_INPUT',
      )
    } finally {
      restoreErrorLog()
    }
  })

  test('waitUntilDocumentReady resolves when the document is already ready', async () => {
    const editor = makeEditor()

    expect(editor.getDocumentStatus()).toBe('ready')
    await expect(editor.waitUntilDocumentReady()).resolves.toBeUndefined()
  })
})

describe('Dactylo selection', () => {
  test('focus places a caret at document end', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()

    const context = editor.getContext()
    const block = firstInlineBlock(context)

    expect(editor.selection.tools.isFocused()).toBe(true)
    expect(editor.selection.tools.isBlockWithActiveCursor(block.id)).toBe(true)
    expect(editor.selection.tools.isBlockWithActiveRange(block.id)).toBe(false)
    expect(editor.selection.tools.isBlockWithActiveSelection(block.id)).toBe(
      true,
    )
    expect(
      editor.selection.tools.getBlockSelectionCoverageTopology(block.id),
    ).toBeNull()
    const [caretNode] = block.content
    expect(
      caretNode
        ? editor.selection.tools.getInlineNodeSelectionCoverageTopology(
            caretNode.id,
          )
        : undefined,
    ).toBeNull()
    expect(requireCursor(context)).toMatchObject({
      blockId: block.id,
      offset: 0,
    })
  })

  test('blur clears the selection', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.selection.commands.blur()

    expect(editor.getContext().selection).toBeNull()
    expect(editor.selection.tools.isFocused()).toBe(false)
  })

  test('focus after trailing divider places the caret in the last inline block', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    editor.blocks.commands.insert({ spec: { type: 'divider' } })
    typeText(editor, 'World')
    editor.blocks.commands.insert({ spec: { type: 'divider' } })

    const trailingParagraphId = editor.getContext().state.blockOrderById.at(-1)
    if (!trailingParagraphId) {
      throw new Error('Expected a trailing paragraph after divider insert')
    }
    editor.blocks.commands.delete(trailingParagraphId)

    const { state } = editor.getContext()
    const types = state.blockOrderById.map(
      (id) => state.blocks.get(id)?.__type ?? null,
    )
    expect(types).toEqual(['paragraph', 'divider', 'paragraph', 'divider'])

    const world = nthInlineBlock(editor.getContext(), 2)
    editor.selection.commands.blur()
    editor.selection.commands.focus()

    expect(requireCursor(editor.getContext())).toMatchObject({
      blockId: world.id,
      offset: 5,
    })
  })

  test('Escape via sendKeydown clears the selection', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    const handled = pressShortcut(editor, 'Escape')

    expect(handled).toBe(true)
    expect(editor.getContext().selection).toBeNull()
    expect(editor.selection.tools.isFocused()).toBe(false)
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })

  test('already-prevented Escape does not clear the selection', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    const handled = pressShortcut(editor, 'Escape', { defaultPrevented: true })

    expect(handled).toBe(false)
    expect(requireCursor(editor.getContext()).offset).toBe(5)
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })
})

describe('Dactylo composer', () => {
  test('types into the focused empty paragraph', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()

    typeText(editor, 'Hello')

    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
    expect(requireCursor(editor.getContext()).offset).toBe(5)
  })

  test('empty insertText is ignored', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const before = snapshot(editor.getContext())

    expect(sendInput(editor, 'insertText', '')).toBe(false)
    expect(snapshot(editor.getContext())).toEqual(before)
  })

  test('already-prevented insertText is a no-op', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const before = snapshot(editor.getContext())

    expect(sendInput(editor, 'insertText', 'x', null, true)).toBe(false)
    expect(snapshot(editor.getContext())).toEqual(before)
  })

  test('Enter splits into a new paragraph', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    hardBreak(editor)

    expect(blockTexts(editor.getContext())).toEqual(['Hello', ''])
    expect(editor.getContext().state.blockOrderById).toHaveLength(2)
  })

  test('Shift+Enter inserts a line break in the same block', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    softBreak(editor)

    const block = firstInlineBlock(editor.getContext())
    expect(editor.getContext().state.blockOrderById).toHaveLength(1)
    expect(block.content.some(isLineBreakNode)).toBe(true)
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })

  test('Backspace deletes the last character', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    deleteBackward(editor)

    expect(blockTexts(editor.getContext())).toEqual(['Hell'])
    expect(requireCursor(editor.getContext()).offset).toBe(4)
  })

  test('Backspace at the start of the only empty block is a no-op', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    const before = snapshot(editor.getContext())

    expect(tryDeleteBackward(editor)).toBe(false)
    expect(snapshot(editor.getContext())).toEqual(before)
  })

  test('pastes plain text at the caret', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hi')

    pastePlainText(editor, ' there')

    expect(blockTexts(editor.getContext())).toEqual(['Hi there'])
  })

  test('historyUndo and historyRedo input types are not handled', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const before = snapshot(editor.getContext())

    expect(sendInput(editor, 'historyUndo')).toBe(false)
    expect(sendInput(editor, 'historyRedo')).toBe(false)
    expect(snapshot(editor.getContext())).toEqual(before)
    expect(editor.history.tools.canUndo()).toBe(true)
  })
})

describe('Dactylo keyboard shortcuts', () => {
  test('Mod+Z undoes and Mod+Shift+Z redoes', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    expect(pressShortcut(editor, 'KeyZ', { meta: true })).toBe(true)
    expect(blockTexts(editor.getContext())).toEqual([''])
    expect(editor.history.tools.canUndo()).toBe(false)
    expect(editor.history.tools.canRedo()).toBe(true)

    expect(pressShortcut(editor, 'KeyZ', { meta: true, shift: true })).toBe(
      true,
    )
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
    expect(editor.history.tools.canUndo()).toBe(true)
    expect(editor.history.tools.canRedo()).toBe(false)
  })

  test('Mod+Y redoes after undo', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    pressShortcut(editor, 'KeyZ', { ctrl: true })

    expect(pressShortcut(editor, 'KeyY', { ctrl: true })).toBe(true)
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })

  test('Mod+A selects the current block then typing replaces it', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    const block = firstInlineBlock(editor.getContext())
    const [textNode] = block.content
    expect(pressShortcut(editor, 'KeyA', { meta: true })).toBe(true)

    const { selection } = editor.getContext()
    expect(selection?.__type).toBe('range')
    expect(editor.selection.tools.isBlockWithActiveRange(block.id)).toBe(true)
    expect(editor.selection.tools.isBlockWithActiveCursor(block.id)).toBe(false)
    expect(
      editor.selection.tools.getBlockSelectionCoverageTopology(block.id),
    ).toBe('total')
    expect(
      textNode
        ? editor.selection.tools.getInlineNodeSelectionCoverageTopology(
            textNode.id,
          )
        : undefined,
    ).toBe('total')

    typeText(editor, 'X')

    expect(blockTexts(editor.getContext())).toEqual(['X'])
    expect(requireCursor(editor.getContext()).offset).toBe(1)
  })

  test('Mod+C is not implemented and does not throw', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const before = snapshot(editor.getContext())

    expect(pressShortcut(editor, 'KeyC', { meta: true })).toBe(false)
    expect(snapshot(editor.getContext())).toEqual(before)
  })
})

describe('Dactylo marks', () => {
  test('toggling bold on a caret marks the next typed text', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()

    editor.marks.commands.toggle('bold')
    typeText(editor, 'Hi')

    const [node] = firstInlineBlock(editor.getContext()).content
    if (!node || !isInlineNodeWithEditableText(node)) {
      throw new Error('Expected a marked text node')
    }
    expect(node.text).toBe('Hi')
    expect(isMarkEnabled(node.marks, 'bold')).toBe(true)
    expect(editor.marks.tools.isActive('bold')).toBe(true)
  })

  test('toggling bold off continues with unmarked text', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.marks.commands.toggle('bold')
    typeText(editor, 'Hi')
    editor.marks.commands.toggle('bold')
    typeText(editor, '!')

    const [marked, unmarked] = firstInlineBlock(editor.getContext()).content
    if (
      !marked ||
      !unmarked ||
      !isInlineNodeWithEditableText(marked) ||
      !isInlineNodeWithEditableText(unmarked)
    ) {
      throw new Error('Expected a marked node and an unmarked continuation')
    }
    expect(marked.text).toBe('Hi')
    expect(isMarkEnabled(marked.marks, 'bold')).toBe(true)
    expect(unmarked.text).toBe('!')
    expect(isMarkEnabled(unmarked.marks, 'bold')).toBe(false)
    expect(editor.marks.tools.isActive('bold')).toBe(false)
  })

  test('toggling italic on a Mod+A range marks the selection and undo restores', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    pressShortcut(editor, 'KeyA', { meta: true })
    const before = snapshot(editor.getContext())

    editor.marks.commands.toggle('italic')

    const [node] = firstInlineBlock(editor.getContext()).content
    if (!node || !isInlineNodeWithEditableText(node)) {
      throw new Error('Expected the selected text node')
    }
    expect(isMarkEnabled(node.marks, 'italic')).toBe(true)
    expect(editor.marks.tools.isActive('italic')).toBe(true)

    editor.history.commands.undo()
    expect(snapshot(editor.getContext())).toEqual(before)
  })
})

describe('Dactylo history', () => {
  test('undo and redo restore typed content', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    editor.history.commands.undo()
    expect(blockTexts(editor.getContext())).toEqual([''])
    expect(editor.history.tools.canRedo()).toBe(true)

    editor.history.commands.redo()
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
    expect(editor.history.tools.canUndo()).toBe(true)
  })

  test('clear empties the stacks without changing content', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    editor.history.commands.undo()
    expect(editor.history.tools.canRedo()).toBe(true)

    editor.history.commands.clear()

    expect(blockTexts(editor.getContext())).toEqual([''])
    expect(editor.history.tools.canUndo()).toBe(false)
    expect(editor.history.tools.canRedo()).toBe(false)
  })

  test('events.history reports canUndo after an edit', () => {
    const editor = makeTypingEditor()
    const events: HistoryEvent[] = []
    editor.events.history.subscribe((event) => {
      events.push(event)
    })

    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    expect(events.at(-1)).toEqual({ canRedo: false, canUndo: true })
  })
})

describe('Dactylo blocks', () => {
  test('isWithEmptyInlineContent is not-empty after typing spaces', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    const block = firstInlineBlock(editor.getContext())

    expect(editor.blocks.tools.isWithEmptyInlineContent(block.id)).toBe('empty')

    typeText(editor, ' ')
    expect(editor.blocks.tools.isWithEmptyInlineContent(block.id)).toBe(
      'not-empty',
    )

    typeText(editor, ' ')
    expect(editor.blocks.tools.isWithEmptyInlineContent(block.id)).toBe(
      'not-empty',
    )
    expect(blockTexts(editor.getContext())).toEqual(['  '])
  })

  test('isWithEmptyInlineContent is never for a missing or divider block', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()

    expect(
      editor.blocks.tools.isWithEmptyInlineContent('bl_missing' as BlockId),
    ).toBe('never')

    const dividerId = editor.blocks.commands.insert({
      spec: { type: 'divider' },
    })
    if (!dividerId) {
      throw new Error('Expected an inserted divider')
    }

    expect(editor.blocks.tools.isWithEmptyInlineContent(dividerId)).toBe(
      'never',
    )
  })

  test('insert heading adds a heading after the current paragraph', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    const blockId = editor.blocks.commands.insert({
      spec: { level: 2, type: 'heading' },
    })
    if (!blockId) {
      throw new Error('Expected an inserted heading')
    }

    const context = editor.getContext()
    expect(context.state.blockOrderById).toHaveLength(2)
    expect(isParagraphBlock(nthInlineBlock(context, 0))).toBe(true)
    const heading = nthInlineBlock(context, 1)
    expect(heading.id).toBe(blockId)
    expect(isHeadingBlock(heading)).toBe(true)
    if (isHeadingBlock(heading)) {
      expect(heading.level).toBe(2)
    }
    expect(blockTexts(context)).toEqual(['Hello', ''])
    expect(editor.blocks.tools.isWithEmptyInlineContent(heading.id)).toBe(
      'empty',
    )
  })

  test('insert quote adds a quote after the current paragraph', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    const blockId = editor.blocks.commands.insert({ spec: { type: 'quote' } })
    if (!blockId) {
      throw new Error('Expected an inserted quote')
    }

    const context = editor.getContext()
    expect(context.state.blockOrderById).toHaveLength(2)
    expect(isParagraphBlock(nthInlineBlock(context, 0))).toBe(true)
    const quote = nthInlineBlock(context, 1)
    expect(quote.id).toBe(blockId)
    expect(isQuoteBlock(quote)).toBe(true)
    expect(blockTexts(context)).toEqual(['Hello', ''])
    expect(editor.blocks.tools.isWithEmptyInlineContent(quote.id)).toBe('empty')
  })

  test('insert numbered list item adds a numbered item after the current paragraph', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    const blockId = editor.blocks.commands.insert({
      spec: { type: 'numbered_list_item' },
    })
    if (!blockId) {
      throw new Error('Expected an inserted numbered list item')
    }

    const context = editor.getContext()
    expect(context.state.blockOrderById).toHaveLength(2)
    expect(isParagraphBlock(nthInlineBlock(context, 0))).toBe(true)
    const item = nthInlineBlock(context, 1)
    expect(item.id).toBe(blockId)
    expect(isNumberedListItemBlock(item)).toBe(true)
    if (isNumberedListItemBlock(item)) {
      expect(item.variant).toBe('default')
      expect(item.markerNumbering).toBe('1.')
    }
    expect(blockTexts(context)).toEqual(['Hello', ''])
    expect(editor.blocks.tools.isWithEmptyInlineContent(item.id)).toBe('empty')
  })

  test('insert uses the given spec content', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()

    const blockId = editor.blocks.commands.insert({
      spec: { content: [{ text: 'Hello', type: 'text' }], type: 'paragraph' },
    })
    if (!blockId) {
      throw new Error('Expected an inserted paragraph')
    }

    const inserted = nthInlineBlock(editor.getContext(), 1)
    const [node] = inserted.content
    if (node === undefined || !isTextNode(node)) {
      throw new Error('Expected a text node')
    }

    expect(inserted.id).toBe(blockId)
    expect(isParagraphBlock(inserted)).toBe(true)
    expect(inserted.content).toHaveLength(1)
    expect(node.text).toBe('Hello')
    expect(blockTexts(editor.getContext())).toEqual(['', 'Hello'])
    expect(requireCursor(editor.getContext())).toMatchObject({
      blockId,
      nodeId: node.id,
      offset: node.text.length,
    })
  })

  test('insert appends an empty text node when spec content ends without editable text', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()

    const blockId = editor.blocks.commands.insert({
      spec: {
        content: [{ text: 'Hello', type: 'text' }, { type: 'line_break' }],
        type: 'paragraph',
      },
    })
    if (!blockId) {
      throw new Error('Expected an inserted paragraph')
    }

    const inserted = nthInlineBlock(editor.getContext(), 1)
    const [first, second, trailing] = inserted.content

    expect(inserted.id).toBe(blockId)
    expect(inserted.content).toHaveLength(3)
    if (first === undefined || !isTextNode(first)) {
      throw new Error('Expected a leading text node')
    }
    expect(first.text).toBe('Hello')
    expect(second !== undefined && isLineBreakNode(second)).toBe(true)

    if (trailing === undefined || !isTextNode(trailing)) {
      throw new Error('Expected a trailing empty text node')
    }

    expect(isTextNode(trailing)).toBe(true)

    expect(trailing.text).toBe('')
    expect(requireCursor(editor.getContext())).toMatchObject({
      blockId,
      nodeId: trailing.id,
      offset: 0,
    })
  })

  test('insert checkbox list item respects checked', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()

    const blockId = editor.blocks.commands.insert({
      spec: { checked: true, type: 'checkbox_list_item' },
    })
    if (!blockId) {
      throw new Error('Expected an inserted checkbox list item')
    }

    const item = nthInlineBlock(editor.getContext(), 1)
    expect(item.id).toBe(blockId)
    expect(isCheckboxListItemBlock(item)).toBe(true)
    if (isCheckboxListItemBlock(item)) {
      expect(item.checked).toBe(true)
    }
  })

  test('insert numbered list item respects variant', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()

    const blockId = editor.blocks.commands.insert({
      spec: { type: 'numbered_list_item', variant: 'roman' },
    })
    if (!blockId) {
      throw new Error('Expected an inserted numbered list item')
    }

    const item = nthInlineBlock(editor.getContext(), 1)
    expect(item.id).toBe(blockId)
    expect(isNumberedListItemBlock(item)).toBe(true)
    if (isNumberedListItemBlock(item)) {
      expect(item.variant).toBe('roman')
      expect(item.markerNumbering).toBe('i.')
    }
  })

  test('insert stamps spec metadata', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()

    const blockId = editor.blocks.commands.insert({
      spec: { metadata: { source: 'import' }, type: 'quote' },
    })
    if (!blockId) {
      throw new Error('Expected an inserted quote')
    }

    const quote = nthInlineBlock(editor.getContext(), 1)
    expect(quote.id).toBe(blockId)
    expect(isQuoteBlock(quote)).toBe(true)
    expect(quote.metadata).toEqual({ source: 'import' })
  })

  test('inserts a list item, divider, and trailing paragraph', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    const bulletId = editor.blocks.commands.insert({
      spec: { type: 'bullet_list_item' },
    })
    const dividerId = editor.blocks.commands.insert({
      spec: { type: 'divider' },
    })
    const paragraphId = editor.blocks.commands.insert({
      pos: { type: 'end' },
      spec: { type: 'paragraph' },
    })
    if (!(bulletId && dividerId && paragraphId)) {
      throw new Error('Expected inserted bullet, divider, and paragraph')
    }

    // Divider insert always places a paragraph after the rule for the caret.

    const { state } = editor.getContext()
    const types = state.blockOrderById.map((id) => {
      const block = state.blocks.get(id)
      if (!block) {
        throw new Error(`Missing block ${id}`)
      }
      return block.__type
    })

    expect(types).toEqual([
      'paragraph',
      'bullet_list_item',
      'divider',
      'paragraph',
      'paragraph',
    ])
    expect(state.blocks.get(bulletId)?.__type).toBe('bullet_list_item')
    expect(state.blocks.get(dividerId)?.__type).toBe('divider')
    expect(state.blocks.get(paragraphId)?.__type).toBe('paragraph')
    expect(isBulletListItemBlock(nthInlineBlock(editor.getContext(), 1))).toBe(
      true,
    )
  })

  test('duplicate copies a block and move reorders it', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    editor.blocks.commands.insert({ spec: { level: 1, type: 'heading' } })

    const paragraphId = nthInlineBlock(editor.getContext(), 0).id
    expect(editor.blocks.commands.duplicate(paragraphId)).toBe(true)

    expect(blockTexts(editor.getContext())).toEqual(['Hello', 'Hello', ''])

    expect(editor.blocks.commands.move(paragraphId, { type: 'end' })).toBe(true)

    expect(blockTexts(editor.getContext())).toEqual(['Hello', '', 'Hello'])
    expect(nthInlineBlock(editor.getContext(), 2).id).toBe(paragraphId)
  })

  test('move reindexes a numbered run so 1. 2. 3. stays consecutive', () => {
    const editor = threeNumberedEditor()
    const lastId = nthInlineBlock(editor.getContext(), 2).id

    expect(editor.blocks.commands.move(lastId, { type: 'start' })).toBe(true)

    expect(blockTexts(editor.getContext())).toEqual(['C', 'A', 'B'])
    expect(numberedMarkers(editor)).toEqual(['1.', '2.', '3.'])
  })

  test('move compactifies leftover numbered markers after splitting a run', () => {
    const editor = threeNumberedEditor()
    const paragraphId = editor.blocks.commands.insert({
      pos: { type: 'end' },
      spec: { type: 'paragraph' },
    })
    if (!paragraphId) {
      throw new Error('Expected an inserted paragraph')
    }
    const middleId = nthInlineBlock(editor.getContext(), 1).id

    expect(
      editor.blocks.commands.move(middleId, {
        blockId: paragraphId,
        type: 'after',
      }),
    ).toBe(true)

    expect(nthInlineBlock(editor.getContext(), 2).__type).toBe('paragraph')
    expect(blockTexts(editor.getContext())).toEqual(['A', 'C', '', 'B'])
    expect(numberedMarkers(editor)).toEqual(['1.', '2.', '', '1.'])
  })

  test('move of a paragraph into a numbered run reindexes the split suffix', () => {
    const editor = threeNumberedEditor()
    const paragraphId = editor.blocks.commands.insert({
      pos: { type: 'end' },
      spec: { type: 'paragraph' },
    })
    if (!paragraphId) {
      throw new Error('Expected an inserted paragraph')
    }

    expect(
      editor.blocks.commands.move(paragraphId, {
        blockId: nthInlineBlock(editor.getContext(), 0).id,
        type: 'after',
      }),
    ).toBe(true)

    expect(nthInlineBlock(editor.getContext(), 1).__type).toBe('paragraph')
    expect(numberedMarkers(editor)).toEqual(['1.', '', '2.', '3.'])
  })

  test('delete skips the first empty block and removes a later block', () => {
    const editor = makeTypingEditor()
    const emptyId = firstInlineBlock(editor.getContext()).id
    const before = snapshot(editor.getContext())

    expect(editor.blocks.commands.delete(emptyId)).toBe(false)
    expect(snapshot(editor.getContext())).toEqual(before)

    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    editor.blocks.commands.insert({ spec: { level: 2, type: 'heading' } })
    const headingId = nthInlineBlock(editor.getContext(), 1).id

    expect(editor.blocks.commands.delete(headingId)).toBe(true)

    expect(editor.getContext().state.blockOrderById).toHaveLength(1)
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })

  test('mutate converts a paragraph to a heading and keeps id and content', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const paragraphId = firstInlineBlock(editor.getContext()).id

    expect(
      editor.blocks.commands.mutate(paragraphId, {
        kind: 'to_heading',
        level: 2,
      }),
    ).toBe(true)

    const heading = firstInlineBlock(editor.getContext())
    expect(heading.id).toBe(paragraphId)
    expect(isHeadingBlock(heading)).toBe(true)
    if (isHeadingBlock(heading)) {
      expect(heading.level).toBe(2)
    }
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })

  test('mutate converts a paragraph to quote, list, and checkbox', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const blockId = firstInlineBlock(editor.getContext()).id

    expect(editor.blocks.commands.mutate(blockId, { kind: 'to_quote' })).toBe(
      true,
    )
    expect(isQuoteBlock(firstInlineBlock(editor.getContext()))).toBe(true)

    expect(
      editor.blocks.commands.mutate(blockId, { kind: 'to_bullet_list_item' }),
    ).toBe(true)
    expect(isBulletListItemBlock(firstInlineBlock(editor.getContext()))).toBe(
      true,
    )

    expect(
      editor.blocks.commands.mutate(blockId, {
        kind: 'to_numbered_list_item',
      }),
    ).toBe(true)
    expect(isNumberedListItemBlock(firstInlineBlock(editor.getContext()))).toBe(
      true,
    )

    expect(
      editor.blocks.commands.mutate(blockId, {
        checked: true,
        kind: 'to_checkbox_list_item',
      }),
    ).toBe(true)
    const checkbox = firstInlineBlock(editor.getContext())
    expect(checkbox.id).toBe(blockId)
    expect(isCheckboxListItemBlock(checkbox)).toBe(true)
    if (isCheckboxListItemBlock(checkbox)) {
      expect(checkbox.checked).toBe(true)
    }
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })

  test('mutate of a divider is a no-op', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    const dividerId = editor.blocks.commands.insert({
      spec: { type: 'divider' },
    })
    if (!dividerId) {
      throw new Error('Expected an inserted divider')
    }
    const before = snapshot(editor.getContext())

    expect(
      editor.blocks.commands.mutate(dividerId, { kind: 'to_paragraph' }),
    ).toBe(false)
    expect(snapshot(editor.getContext())).toEqual(before)
  })

  test('patch checkbox list item sets checked and keeps the same id', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insert({ spec: { type: 'checkbox_list_item' } })

    const checkbox = nthInlineBlock(editor.getContext(), 1)
    expect(isCheckboxListItemBlock(checkbox)).toBe(true)

    expect(
      editor.blocks.commands.patch({
        blockId: checkbox.id,
        spec: { checked: true, type: 'checkbox_list_item' },
      }),
    ).toBe(true)

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(patched.id).toBe(checkbox.id)
    expect(isCheckboxListItemBlock(patched)).toBe(true)
    if (isCheckboxListItemBlock(patched)) {
      expect(patched.checked).toBe(true)
    }
  })

  test('undo restores unchecked and redo restores checked', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insert({ spec: { type: 'checkbox_list_item' } })
    const checkboxId = nthInlineBlock(editor.getContext(), 1).id

    editor.blocks.commands.patch({
      blockId: checkboxId,
      spec: { checked: true, type: 'checkbox_list_item' },
    })
    editor.history.commands.undo()

    const afterUndo = nthInlineBlock(editor.getContext(), 1)
    expect(afterUndo.id).toBe(checkboxId)
    if (isCheckboxListItemBlock(afterUndo)) {
      expect(afterUndo.checked).toBe(false)
    }

    editor.history.commands.redo()

    const afterRedo = nthInlineBlock(editor.getContext(), 1)
    expect(afterRedo.id).toBe(checkboxId)
    if (isCheckboxListItemBlock(afterRedo)) {
      expect(afterRedo.checked).toBe(true)
    }
  })

  test('patch checkbox list item metadata keeps checked', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insert({ spec: { type: 'checkbox_list_item' } })
    const checkboxId = nthInlineBlock(editor.getContext(), 1).id

    editor.blocks.commands.patch({
      blockId: checkboxId,
      spec: { checked: true, type: 'checkbox_list_item' },
    })
    expect(
      editor.blocks.commands.patch({
        blockId: checkboxId,
        spec: { metadata: { value: { a: 1 } }, type: 'checkbox_list_item' },
      }),
    ).toBe(true)

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(isCheckboxListItemBlock(patched)).toBe(true)
    if (isCheckboxListItemBlock(patched)) {
      expect(patched.checked).toBe(true)
      expect(patched.metadata).toEqual({ a: 1 })
    }
  })

  test('patch divider sets metadata', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insert({ spec: { type: 'divider' } })

    const { state } = editor.getContext()
    const dividerId = state.blockOrderById.find((id) => {
      const block = state.blocks.get(id)
      return block?.__type === 'divider'
    })
    if (!dividerId) {
      throw new Error('Expected a divider block')
    }

    expect(
      editor.blocks.commands.patch({
        blockId: dividerId,
        spec: { metadata: { value: { a: 1 } }, type: 'divider' },
      }),
    ).toBe(true)

    const patched = editor.getContext().state.blocks.get(dividerId)
    expect(patched?.__type).toBe('divider')
    expect(patched?.metadata).toEqual({ a: 1 })
  })

  test('patch checkbox list item on a paragraph is a no-op and leaves the document unchanged', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const paragraphId = firstInlineBlock(editor.getContext()).id
    const before = snapshot(editor.getContext())

    expect(
      editor.blocks.commands.patch({
        blockId: paragraphId,
        spec: { checked: true, type: 'checkbox_list_item' },
      }),
    ).toBe(false)
    expect(snapshot(editor.getContext())).toEqual(before)
  })

  test('patch heading changes level only', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    editor.blocks.commands.insert({ spec: { level: 2, type: 'heading' } })

    const heading = nthInlineBlock(editor.getContext(), 1)
    expect(isHeadingBlock(heading)).toBe(true)
    const { content } = heading

    expect(
      editor.blocks.commands.patch({
        blockId: heading.id,
        spec: { level: 3, type: 'heading' },
      }),
    ).toBe(true)

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(patched.id).toBe(heading.id)
    expect(isHeadingBlock(patched)).toBe(true)
    if (isHeadingBlock(patched)) {
      expect(patched.level).toBe(3)
      expect(patched.content).toEqual(content)
    }
  })

  test('patch heading sets metadata', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insert({ spec: { level: 2, type: 'heading' } })
    const heading = nthInlineBlock(editor.getContext(), 1)

    expect(
      editor.blocks.commands.patch({
        blockId: heading.id,
        spec: { metadata: { value: { a: 1 } }, type: 'heading' },
      }),
    ).toBe(true)

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(patched.id).toBe(heading.id)
    expect(isHeadingBlock(patched)).toBe(true)
    if (isHeadingBlock(patched)) {
      expect(patched.level).toBe(2)
      expect(patched.metadata).toEqual({ a: 1 })
    }
  })

  test('patch paragraph sets metadata', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const paragraphId = firstInlineBlock(editor.getContext()).id

    expect(
      editor.blocks.commands.patch({
        blockId: paragraphId,
        spec: { metadata: { value: { a: 1 } }, type: 'paragraph' },
      }),
    ).toBe(true)

    const patched = firstInlineBlock(editor.getContext())
    expect(patched.id).toBe(paragraphId)
    expect(isParagraphBlock(patched)).toBe(true)
    expect(patched.metadata).toEqual({ a: 1 })
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })

  test('patch quote sets metadata', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insert({ spec: { type: 'quote' } })
    const quote = nthInlineBlock(editor.getContext(), 1)

    expect(
      editor.blocks.commands.patch({
        blockId: quote.id,
        spec: { metadata: { value: { a: 1 } }, type: 'quote' },
      }),
    ).toBe(true)

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(patched.id).toBe(quote.id)
    expect(isQuoteBlock(patched)).toBe(true)
    expect(patched.metadata).toEqual({ a: 1 })
  })

  test('patch bullet list item sets metadata', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insert({ spec: { type: 'bullet_list_item' } })
    const item = nthInlineBlock(editor.getContext(), 1)

    expect(
      editor.blocks.commands.patch({
        blockId: item.id,
        spec: { metadata: { value: { a: 1 } }, type: 'bullet_list_item' },
      }),
    ).toBe(true)

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(patched.id).toBe(item.id)
    expect(isBulletListItemBlock(patched)).toBe(true)
    expect(patched.metadata).toEqual({ a: 1 })
  })

  test('patch metadata replace drops source keys', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    const blockId = editor.blocks.commands.insert({
      spec: {
        metadata: { align: 'left', source: 'import' },
        type: 'quote',
      },
    })
    if (!blockId) {
      throw new Error('Expected an inserted quote')
    }

    expect(
      editor.blocks.commands.patch({
        blockId,
        spec: { metadata: { value: { a: 1 } }, type: 'quote' },
      }),
    ).toBe(true)
    expect(nthInlineBlock(editor.getContext(), 1).metadata).toEqual({ a: 1 })

    expect(
      editor.blocks.commands.patch({
        blockId,
        spec: { metadata: { policy: 'replace', value: {} }, type: 'quote' },
      }),
    ).toBe(true)
    expect(nthInlineBlock(editor.getContext(), 1).metadata).toEqual({})
  })

  test('patch metadata merge keeps source keys and overwrites overlaps', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    const blockId = editor.blocks.commands.insert({
      spec: {
        metadata: { align: 'left', source: 'import' },
        type: 'quote',
      },
    })
    if (!blockId) {
      throw new Error('Expected an inserted quote')
    }

    expect(
      editor.blocks.commands.patch({
        blockId,
        spec: {
          metadata: {
            policy: 'merge',
            value: { align: 'center', extra: 1 },
          },
          type: 'quote',
        },
      }),
    ).toBe(true)
    expect(nthInlineBlock(editor.getContext(), 1).metadata).toEqual({
      align: 'center',
      extra: 1,
      source: 'import',
    })

    expect(
      editor.blocks.commands.patch({
        blockId,
        spec: { metadata: { policy: 'merge', value: {} }, type: 'quote' },
      }),
    ).toBe(true)
    expect(nthInlineBlock(editor.getContext(), 1).metadata).toEqual({
      align: 'center',
      extra: 1,
      source: 'import',
    })
  })

  test('patch without metadata leaves the bag unchanged', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    const blockId = editor.blocks.commands.insert({
      spec: { metadata: { source: 'import' }, type: 'quote' },
    })
    if (!blockId) {
      throw new Error('Expected an inserted quote')
    }

    expect(
      editor.blocks.commands.patch({
        blockId,
        spec: { type: 'quote' },
      }),
    ).toBe(true)
    expect(nthInlineBlock(editor.getContext(), 1).metadata).toEqual({
      source: 'import',
    })
  })

  test('patch numbered list item changes variant only', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insert({ spec: { type: 'numbered_list_item' } })

    const item = nthInlineBlock(editor.getContext(), 1)
    expect(isNumberedListItemBlock(item)).toBe(true)
    const { content } = item

    expect(
      editor.blocks.commands.patch({
        blockId: item.id,
        spec: { type: 'numbered_list_item', variant: 'alpha' },
      }),
    ).toBe(true)

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(patched.id).toBe(item.id)
    expect(isNumberedListItemBlock(patched)).toBe(true)
    if (isNumberedListItemBlock(patched)) {
      expect(patched.variant).toBe('alpha')
      expect(patched.markerNumbering).toBe('a.')
      expect(patched.content).toEqual(content)
    }
  })

  test('patch numbered list item sets metadata', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insert({ spec: { type: 'numbered_list_item' } })
    const item = nthInlineBlock(editor.getContext(), 1)

    expect(
      editor.blocks.commands.patch({
        blockId: item.id,
        spec: {
          metadata: { value: { a: 1 } },
          type: 'numbered_list_item',
        },
      }),
    ).toBe(true)

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(patched.id).toBe(item.id)
    expect(isNumberedListItemBlock(patched)).toBe(true)
    if (isNumberedListItemBlock(patched)) {
      expect(patched.variant).toBe('default')
      expect(patched.metadata).toEqual({ a: 1 })
    }
  })
})

describe('Dactylo mentions', () => {
  const entity = { data: { name: 'John Doe' }, id: 'user-123' } as const

  test('tools report no buffer before a mention is typed', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()

    expect(editor.mentions.tools.isBuffering()).toBe(false)
    expect(editor.mentions.tools.getBufferedText()).toBeNull()
  })

  test('typing the mention character starts a buffer with empty query text', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor)

    expect(editor.mentions.tools.isBuffering()).toBe(true)
    expect(editor.mentions.tools.getBufferedText()).toBe('')
    expect(blockTexts(editor.getContext())).toEqual(['@'])
  })

  test('typed characters after the opener are readable via getBufferedText', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    expect(editor.mentions.tools.isBuffering()).toBe(true)
    expect(editor.mentions.tools.getBufferedText()).toBe('john')
    expect(blockTexts(editor.getContext())).toEqual(['@john'])
  })

  test('starts a buffer at the start of a node or after whitespace, not mid-word', () => {
    const midWord = makeMentionsEditor()
    midWord.selection.commands.focus()
    typeText(midWord, 'hello')
    typeMentionQuery(midWord)

    expect(midWord.mentions.tools.isBuffering()).toBe(false)
    expect(midWord.mentions.tools.getBufferedText()).toBeNull()
    expect(blockTexts(midWord.getContext())).toEqual(['hello@'])

    const afterSpace = makeMentionsEditor()
    afterSpace.selection.commands.focus()
    typeText(afterSpace, 'hello ')
    typeMentionQuery(afterSpace, 'john')

    expect(afterSpace.mentions.tools.isBuffering()).toBe(true)
    expect(afterSpace.mentions.tools.getBufferedText()).toBe('john')
    expect(blockTexts(afterSpace.getContext())).toEqual(['hello @john'])
  })

  test('does not start a buffer by default', () => {
    const editor = makeEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    expect(editor.mentions.tools.isBuffering()).toBe(false)
    expect(editor.mentions.tools.getBufferedText()).toBeNull()
    expect(blockTexts(editor.getContext())).toEqual(['@john'])
  })

  test('does not start a buffer when mentions are disabled', () => {
    const editor = makeMentionsEditor({ mentions: { enabled: false } })
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    expect(editor.mentions.tools.isBuffering()).toBe(false)
    expect(editor.mentions.tools.getBufferedText()).toBeNull()
    expect(blockTexts(editor.getContext())).toEqual(['@john'])
  })

  test('uses the configured mention character', () => {
    const editor = makeMentionsEditor({ mentions: { character: '#' } })
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'room', '#')

    expect(editor.mentions.tools.isBuffering()).toBe(true)
    expect(editor.mentions.tools.getBufferedText()).toBe('room')
    expect(blockTexts(editor.getContext())).toEqual(['#room'])
  })

  test('confirm inserts a mention node and releases the buffer', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    expect(
      editor.mentions.commands.confirm({
        entity,
        metadata: { bgColor: 'blue' },
      }),
    ).toBe(true)

    expect(editor.mentions.tools.isBuffering()).toBe(false)
    expect(editor.mentions.tools.getBufferedText()).toBeNull()

    const mention = firstInlineBlock(editor.getContext()).content.find(
      isMentionNode,
    )
    if (!mention) {
      throw new Error('Expected a mention node')
    }
    expect(mention.entity).toEqual(entity)
    expect(mention.metadata).toEqual({ bgColor: 'blue' })
    expect(blockTexts(editor.getContext())).toEqual([' '])
  })

  test('confirm stamps initial mention metadata when none is provided', () => {
    const editor = makeMentionsEditor({
      mentions: { initialMetadata: { bgColor: 'magenta' } },
    })
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    expect(editor.mentions.commands.confirm({ entity })).toBe(true)

    const mention = firstInlineBlock(editor.getContext()).content.find(
      isMentionNode,
    )
    if (!mention) {
      throw new Error('Expected a mention node')
    }
    expect(mention.metadata).toEqual({ bgColor: 'magenta' })
  })

  test('extract returns the confirmed mention and works while read-only', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')
    expect(editor.mentions.commands.confirm({ entity })).toBe(true)

    const node = firstInlineBlock(editor.getContext()).content.find(
      isMentionNode,
    )
    if (!node) {
      throw new Error('Expected a mention node')
    }

    const extracted = editor.mentions.tools.extract(node.id)
    expect(extracted?.id).toBe(node.id)
    expect(extracted?.entity).toEqual(entity)
    expect(extracted?.neighbors).toEqual({ next: [], prev: [] })

    editor.setEditable(false)
    expect(editor.mentions.tools.extract(node.id)?.id).toBe(node.id)
    expect(editor.mentions.tools.extract(generateNodeId())).toBeNull()
  })

  test('extract includes neighboring blocks when requested', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')
    expect(editor.mentions.commands.confirm({ entity })).toBe(true)

    const node = firstInlineBlock(editor.getContext()).content.find(
      isMentionNode,
    )
    if (!node) {
      throw new Error('Expected a mention node')
    }

    hardBreak(editor)
    typeText(editor, 'after')

    const extracted = editor.mentions.tools.extract(node.id, { neighbors: 1 })
    const afterBlock = nthInlineBlock(editor.getContext(), 1)

    expect(extracted?.neighbors.prev).toEqual([])
    expect(extracted?.neighbors.next).toHaveLength(1)
    expect(extracted?.neighbors.next[0]?.id).toBe(afterBlock.id)
  })

  test('confirm and dismiss return false when no buffer is active', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()

    expect(editor.mentions.commands.confirm({ entity })).toBe(false)
    expect(editor.mentions.commands.dismiss()).toBe(false)
    expect(blockTexts(editor.getContext())).toEqual([''])
  })

  test('dismiss aborts the buffer and leaves the query as text', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    expect(editor.mentions.commands.dismiss()).toBe(true)

    expect(editor.mentions.tools.isBuffering()).toBe(false)
    expect(editor.mentions.tools.getBufferedText()).toBeNull()
    expect(blockTexts(editor.getContext())).toEqual(['@john'])
    expect(
      firstInlineBlock(editor.getContext()).content.some(isMentionNode),
    ).toBe(false)

    const block = firstInlineBlock(editor.getContext())
    const [node] = block.content
    if (!node || !isTextNode(node)) {
      throw new Error('Expected a text node')
    }
    expect(requireCursor(editor.getContext())).toMatchObject({
      blockId: block.id,
      nodeId: node.id,
      offset: 5,
    })
  })

  test('dismiss pins the caret at the query end after a prefix', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeText(editor, 'hello ')
    typeMentionQuery(editor, 'john')

    expect(editor.mentions.commands.dismiss()).toBe(true)

    expect(blockTexts(editor.getContext())).toEqual(['hello @john'])
    expect(requireCursor(editor.getContext()).offset).toBe(11)
  })

  test('dismiss pins the caret after an empty query opener', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor)

    expect(editor.mentions.commands.dismiss()).toBe(true)

    expect(blockTexts(editor.getContext())).toEqual(['@'])
    expect(editor.mentions.tools.isBuffering()).toBe(false)
    expect(requireCursor(editor.getContext()).offset).toBe(1)
  })

  test('undo after dismiss restores the last typing step without restarting the buffer', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')
    editor.mentions.commands.dismiss()

    editor.history.commands.undo()

    expect(blockTexts(editor.getContext())).toEqual(['@'])
    expect(editor.mentions.tools.isBuffering()).toBe(false)
  })

  test('undo after confirm restores the query without restarting the buffer', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')
    editor.mentions.commands.confirm({ entity })

    editor.history.commands.undo()

    expect(blockTexts(editor.getContext())).toEqual(['@john'])
    expect(editor.mentions.tools.isBuffering()).toBe(false)
    expect(
      firstInlineBlock(editor.getContext()).content.some(isMentionNode),
    ).toBe(false)
  })

  test('undo while buffering keeps the buffer when the opener remains', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    editor.history.commands.undo()

    expect(blockTexts(editor.getContext())).toEqual(['@'])
    expect(editor.mentions.tools.isBuffering()).toBe(true)
    expect(editor.mentions.tools.getBufferedText()).toBe('')
  })

  test('undo while buffering aborts when the opener is removed', () => {
    const editor = makeMentionsEditor()
    const states: string[] = []
    editor.events.mentionBuffer.subscribe((event) => {
      states.push(event.state)
    })
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    editor.history.commands.undo()
    editor.history.commands.undo()

    expect(blockTexts(editor.getContext())).toEqual([''])
    expect(editor.mentions.tools.isBuffering()).toBe(false)
    expect(editor.mentions.tools.getBufferedText()).toBeNull()
    expect(states.at(-1)).toBe('aborted')
  })

  test('undo of a coalesced opener and query aborts the buffer', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeText(editor, '@')
    for (const character of 'john') {
      typeText(editor, character)
    }

    expect(editor.mentions.tools.isBuffering()).toBe(true)
    editor.history.commands.undo()

    expect(blockTexts(editor.getContext())).toEqual([''])
    expect(editor.mentions.tools.isBuffering()).toBe(false)
  })

  test('redo after leftover-opener undo restores the query in the buffer', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')
    editor.history.commands.undo()

    editor.history.commands.redo()

    expect(blockTexts(editor.getContext())).toEqual(['@john'])
    expect(editor.mentions.tools.isBuffering()).toBe(true)
    expect(editor.mentions.tools.getBufferedText()).toBe('john')
  })

  test('Backspace trims the mention query and aborts when the opener is deleted', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    deleteBackward(editor)

    expect(blockTexts(editor.getContext())).toEqual(['@joh'])
    expect(editor.mentions.tools.isBuffering()).toBe(true)
    expect(editor.mentions.tools.getBufferedText()).toBe('joh')

    deleteBackward(editor)
    deleteBackward(editor)
    deleteBackward(editor)

    expect(blockTexts(editor.getContext())).toEqual(['@'])
    expect(editor.mentions.tools.isBuffering()).toBe(true)
    expect(editor.mentions.tools.getBufferedText()).toBe('')

    deleteBackward(editor)

    expect(blockTexts(editor.getContext())).toEqual([''])
    expect(editor.mentions.tools.isBuffering()).toBe(false)
  })

  test('Enter while buffering aborts and leaves the query as text', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    hardBreak(editor)

    expect(blockTexts(editor.getContext())).toEqual(['@john', ''])
    expect(editor.mentions.tools.isBuffering()).toBe(false)
  })

  test('Escape while buffering aborts and leaves the query as text', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    expect(pressShortcut(editor, 'Escape')).toBe(true)

    expect(blockTexts(editor.getContext())).toEqual(['@john'])
    expect(editor.mentions.tools.isBuffering()).toBe(false)
    expect(editor.getContext().selection).not.toBeNull()
    expect(requireCursor(editor.getContext()).offset).toBe(5)
  })

  test('already-prevented Escape after dismiss does not clear the caret', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')
    editor.mentions.commands.dismiss()

    const handled = pressShortcut(editor, 'Escape', { defaultPrevented: true })

    expect(handled).toBe(false)
    expect(blockTexts(editor.getContext())).toEqual(['@john'])
    expect(requireCursor(editor.getContext()).offset).toBe(5)
  })

  test('Mod+A while buffering aborts the buffer', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    expect(pressShortcut(editor, 'KeyA', { meta: true })).toBe(true)

    expect(blockTexts(editor.getContext())).toEqual(['@john'])
    expect(editor.mentions.tools.isBuffering()).toBe(false)
  })

  test('Backspace after Mod+A leaves leftover query as plain text', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    expect(pressShortcut(editor, 'KeyA', { meta: true })).toBe(true)
    deleteBackward(editor)

    expect(blockTexts(editor.getContext())).toEqual([''])
    expect(editor.mentions.tools.isBuffering()).toBe(false)
  })

  test('commands and tools emit events', () => {
    const editor = makeMentionsEditor()
    const commands: DactyloCommandEvent[] = []
    const tools: DactyloToolEvent[] = []
    editor.events.commands.subscribe((event) => {
      commands.push(event)
    })
    editor.events.tools.subscribe((event) => {
      tools.push(event)
    })

    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')
    editor.mentions.tools.isBuffering()
    editor.mentions.tools.getBufferedText()
    editor.mentions.commands.confirm({ entity }, 'ai-agent')

    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          result: true,
          status: 'success',
          tool: 'mentions/is-buffering',
        }),
        expect.objectContaining({
          result: 'john',
          status: 'success',
          tool: 'mentions/get-buffered-text',
        }),
      ]),
    )
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'mentions/confirm-buffer',
          payload: {
            entity: { data: JSON.stringify(entity.data), id: entity.id },
            metadata: undefined,
            source: 'ai-agent',
          },
          result: true,
          status: 'success',
        }),
      ]),
    )
  })

  test('events.mention tracks started, buffering, released, and aborted', () => {
    const confirmed = makeMentionsEditor()
    const confirmEvents: string[] = []
    confirmed.events.mentionBuffer.subscribe((event) => {
      confirmEvents.push(`${event.state}:${event.bufferedText ?? ''}`)
    })
    confirmed.selection.commands.focus()
    typeMentionQuery(confirmed, 'john')
    confirmed.mentions.commands.confirm({ entity })

    expect(confirmEvents).toEqual(['started:', 'buffering:john', 'released:'])

    const dismissed = makeMentionsEditor()
    const dismissEvents: string[] = []
    dismissed.events.mentionBuffer.subscribe((event) => {
      dismissEvents.push(event.state)
    })
    dismissed.selection.commands.focus()
    typeMentionQuery(dismissed, 'john')
    dismissed.mentions.commands.dismiss()

    expect(dismissEvents).toEqual(['started', 'buffering', 'aborted'])
  })

  test('events.mentionDidCreated fires after confirm with the created mention', () => {
    const editor = makeMentionsEditor()
    const events: MentionDidCreatedEvent[] = []
    editor.events.mentionDidCreated.subscribe((event) => {
      events.push(event)
    })
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')

    expect(
      editor.mentions.commands.confirm({
        entity,
        metadata: { bgColor: 'blue' },
      }),
    ).toBe(true)

    const block = firstInlineBlock(editor.getContext())
    const mention = block.content.find(isMentionNode)
    if (!mention) {
      throw new Error('Expected a mention node')
    }

    expect(events).toEqual([
      {
        blockId: block.id,
        createdAt: mention.createdAt,
        entity,
        metadata: { bgColor: 'blue' },
        nodeId: mention.id,
      },
    ])

    editor.history.commands.undo()
    expect(events).toHaveLength(1)
  })

  test('events.mentionDidCreated does not fire on dismiss or failed confirm', () => {
    const idle = makeMentionsEditor()
    const idleEvents: MentionDidCreatedEvent[] = []
    idle.events.mentionDidCreated.subscribe((event) => {
      idleEvents.push(event)
    })
    idle.selection.commands.focus()
    expect(idle.mentions.commands.confirm({ entity })).toBe(false)
    expect(idleEvents).toEqual([])

    const dismissed = makeMentionsEditor()
    const dismissEvents: MentionDidCreatedEvent[] = []
    dismissed.events.mentionDidCreated.subscribe((event) => {
      dismissEvents.push(event)
    })
    dismissed.selection.commands.focus()
    typeMentionQuery(dismissed, 'john')
    expect(dismissed.mentions.commands.dismiss()).toBe(true)
    expect(dismissEvents).toEqual([])
  })

  test('confirm records the transaction source', () => {
    const editor = makeMentionsEditor()
    const applied: Transaction[] = []
    editor.events.transactionDidApply.subscribe((transaction) => {
      applied.push(transaction)
    })

    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')
    editor.mentions.commands.confirm({ entity }, 'ai-agent')

    expect(applied.at(-1)?.policy).toEqual(
      expect.objectContaining({
        source: 'ai-agent',
      }),
    )
  })

  test('commands are no-ops and tools return fallbacks while read-only', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')
    editor.setEditable(false)

    expect(editor.mentions.tools.isBuffering()).toBe(false)
    expect(editor.mentions.tools.getBufferedText()).toBeNull()
    expect(editor.mentions.commands.confirm({ entity })).toBe(false)
    expect(editor.mentions.commands.dismiss()).toBe(false)
    expect(blockTexts(editor.getContext())).toEqual(['@john'])

    editor.setEditable(true)
    expect(editor.mentions.tools.isBuffering()).toBe(true)
    expect(editor.mentions.tools.getBufferedText()).toBe('john')
  })
})

describe('Dactylo command trigger', () => {
  test('undo while buffering keeps the buffer when the opener remains', () => {
    const editor = makeCommandTriggerEditor()
    const events: { bufferedText: string | null; state: string }[] = []
    editor.events.commandTriggerBuffer.subscribe((event) => {
      events.push({ bufferedText: event.bufferedText, state: event.state })
    })
    editor.selection.commands.focus()
    typeCommandQuery(editor, 'foo')

    editor.history.commands.undo()

    expect(blockTexts(editor.getContext())).toEqual(['/'])
    expect(events.at(-1)).toEqual({ bufferedText: '', state: 'buffering' })
  })

  test('undo while buffering aborts when the opener is removed', () => {
    const editor = makeCommandTriggerEditor()
    const states: string[] = []
    editor.events.commandTriggerBuffer.subscribe((event) => {
      states.push(event.state)
    })
    editor.selection.commands.focus()
    typeCommandQuery(editor, 'foo')

    editor.history.commands.undo()
    editor.history.commands.undo()

    expect(blockTexts(editor.getContext())).toEqual([''])
    expect(states.at(-1)).toBe('aborted')
  })

  test('Backspace trims the command trigger query', () => {
    const editor = makeCommandTriggerEditor()
    const events: { bufferedText: string | null; state: string }[] = []
    editor.events.commandTriggerBuffer.subscribe((event) => {
      events.push({ bufferedText: event.bufferedText, state: event.state })
    })
    editor.selection.commands.focus()
    typeCommandQuery(editor, 'foo')

    deleteBackward(editor)

    expect(blockTexts(editor.getContext())).toEqual(['/fo'])
    expect(events.at(-1)).toEqual({ bufferedText: 'fo', state: 'buffering' })
  })

  test('Escape while buffering aborts and pins the caret at the query end', () => {
    const editor = makeCommandTriggerEditor()
    const states: string[] = []
    editor.events.commandTriggerBuffer.subscribe((event) => {
      states.push(event.state)
    })
    editor.selection.commands.focus()
    typeCommandQuery(editor, 'foo')

    expect(pressShortcut(editor, 'Escape')).toBe(true)

    expect(blockTexts(editor.getContext())).toEqual(['/foo'])
    expect(states.at(-1)).toBe('aborted')
    expect(editor.getContext().selection).not.toBeNull()
    expect(requireCursor(editor.getContext()).offset).toBe(4)
  })

  test('confirm deletes the query and releases the buffer', () => {
    const editor = makeCommandTriggerEditor()
    editor.selection.commands.focus()
    typeCommandQuery(editor, 'foo')

    expect(editor.commandTrigger.commands.confirm()).toBe(true)

    expect(editor.commandTrigger.tools.isBuffering()).toBe(false)
    expect(editor.commandTrigger.tools.getBufferedText()).toBeNull()
    expect(blockTexts(editor.getContext())).toEqual([''])
    expect(requireCursor(editor.getContext()).offset).toBe(0)
  })

  test('confirm deletes only the opener and query after a prefix', () => {
    const editor = makeCommandTriggerEditor()
    editor.selection.commands.focus()
    typeText(editor, 'hello ')
    typeCommandQuery(editor, 'foo')

    expect(editor.commandTrigger.commands.confirm()).toBe(true)

    expect(blockTexts(editor.getContext())).toEqual(['hello '])
    expect(requireCursor(editor.getContext()).offset).toBe(6)
  })

  test('confirm deletes a bare opener', () => {
    const editor = makeCommandTriggerEditor()
    editor.selection.commands.focus()
    typeCommandQuery(editor)

    expect(editor.commandTrigger.commands.confirm()).toBe(true)

    expect(blockTexts(editor.getContext())).toEqual([''])
    expect(editor.commandTrigger.tools.isBuffering()).toBe(false)
    expect(requireCursor(editor.getContext()).offset).toBe(0)
  })

  test('confirm and dismiss return false when no buffer is active', () => {
    const editor = makeCommandTriggerEditor()
    editor.selection.commands.focus()

    expect(editor.commandTrigger.commands.confirm()).toBe(false)
    expect(editor.commandTrigger.commands.dismiss()).toBe(false)
    expect(blockTexts(editor.getContext())).toEqual([''])
  })

  test('undo after confirm restores the query without restarting the buffer', () => {
    const editor = makeCommandTriggerEditor()
    editor.selection.commands.focus()
    typeCommandQuery(editor, 'foo')
    editor.commandTrigger.commands.confirm()

    editor.history.commands.undo()

    expect(blockTexts(editor.getContext())).toEqual(['/foo'])
    expect(editor.commandTrigger.tools.isBuffering()).toBe(false)
  })

  test('events.commandTriggerBuffer fires released after confirm', () => {
    const editor = makeCommandTriggerEditor()
    const events: string[] = []
    editor.events.commandTriggerBuffer.subscribe((event) => {
      events.push(`${event.state}:${event.bufferedText ?? ''}`)
    })
    editor.selection.commands.focus()
    typeCommandQuery(editor, 'foo')
    editor.commandTrigger.commands.confirm()

    expect(events).toEqual(['started:', 'buffering:foo', 'released:'])
  })

  test('confirm records the transaction source', () => {
    const editor = makeCommandTriggerEditor()
    const applied: Transaction[] = []
    editor.events.transactionDidApply.subscribe((transaction) => {
      applied.push(transaction)
    })

    editor.selection.commands.focus()
    typeCommandQuery(editor, 'foo')
    editor.commandTrigger.commands.confirm('ai-agent')

    expect(applied.at(-1)?.policy).toEqual(
      expect.objectContaining({
        source: 'ai-agent',
      }),
    )
  })

  test('confirm is a no-op while read-only', () => {
    const editor = makeCommandTriggerEditor()
    editor.selection.commands.focus()
    typeCommandQuery(editor, 'foo')
    editor.setEditable(false)

    expect(editor.commandTrigger.tools.isBuffering()).toBe(false)
    expect(editor.commandTrigger.tools.getBufferedText()).toBeNull()
    expect(editor.commandTrigger.commands.confirm()).toBe(false)
    expect(blockTexts(editor.getContext())).toEqual(['/foo'])

    editor.setEditable(true)
    expect(editor.commandTrigger.tools.isBuffering()).toBe(true)
    expect(editor.commandTrigger.tools.getBufferedText()).toBe('foo')
  })
})

describe('Dactylo markdown and autolink', () => {
  test('markdown converts "> " into a quote', () => {
    const editor = makeEditor()
    editor.selection.commands.focus()
    typeText(editor, '>')
    typeText(editor, ' ')

    expect(firstInlineBlock(editor.getContext()).__type).toBe('quote')
    expect(blockTexts(editor.getContext())).toEqual([''])
  })

  test('markdown converts "- " into a bullet list item', () => {
    const editor = makeEditor()
    editor.selection.commands.focus()
    typeText(editor, '-')
    typeText(editor, ' ')

    expect(firstInlineBlock(editor.getContext()).__type).toBe(
      'bullet_list_item',
    )
    expect(blockTexts(editor.getContext())).toEqual([''])
  })

  test('markdown converts "[] " into a checkbox list item', () => {
    const editor = makeEditor()
    editor.selection.commands.focus()
    typeText(editor, '[]')
    typeText(editor, ' ')

    const block = firstInlineBlock(editor.getContext())
    expect(block.__type).toBe('checkbox_list_item')
    if (block.__type === 'checkbox_list_item') {
      expect(block.checked).toBe(false)
    }
    expect(blockTexts(editor.getContext())).toEqual([''])
  })

  test('markdown converts "[x] " into a checked checkbox list item', () => {
    const editor = makeEditor()
    editor.selection.commands.focus()
    typeText(editor, '[x]')
    typeText(editor, ' ')

    const block = firstInlineBlock(editor.getContext())
    expect(block.__type).toBe('checkbox_list_item')
    if (block.__type === 'checkbox_list_item') {
      expect(block.checked).toBe(true)
    }
    expect(blockTexts(editor.getContext())).toEqual([''])
  })

  test('markdown converts "1. " into a numbered list item', () => {
    const editor = makeEditor()
    editor.selection.commands.focus()
    typeText(editor, '1.')
    typeText(editor, ' ')

    const block = firstInlineBlock(editor.getContext())
    expect(block.__type).toBe('numbered_list_item')
    if (isNumberedListItemBlock(block)) {
      expect(block.variant).toBe('default')
      expect(block.markerNumbering).toBe('1.')
    }
    expect(blockTexts(editor.getContext())).toEqual([''])
  })

  test('markdown converts "# " into a heading', () => {
    const editor = makeEditor()
    editor.selection.commands.focus()
    typeText(editor, '#')
    typeText(editor, ' ')

    const block = firstInlineBlock(editor.getContext())
    expect(block.__type).toBe('heading')
    if (isHeadingBlock(block)) {
      expect(block.level).toBe(1)
    }
    expect(blockTexts(editor.getContext())).toEqual([''])
  })

  test('markdown converts "--- " into a divider', () => {
    const editor = makeEditor()
    editor.selection.commands.focus()
    typeText(editor, '---')
    typeText(editor, ' ')

    const { state } = editor.getContext()
    const types = state.blockOrderById.map(
      (id) => state.blocks.get(id)?.__type ?? null,
    )
    expect(types).toEqual(['divider', 'paragraph'])
    expect(blockTexts(editor.getContext())).toEqual(['', ''])
  })

  test('disabled markdown leaves the quote trigger characters in the paragraph', () => {
    const editor = makeEditor({
      markdown: { enabled: false },
    })
    editor.selection.commands.focus()
    typeText(editor, '>')
    typeText(editor, ' ')

    expect(firstInlineBlock(editor.getContext()).__type).toBe('paragraph')
    expect(blockTexts(editor.getContext())).toEqual(['> '])
  })

  test('disabled markdown leaves the trigger characters in the paragraph', () => {
    const editor = makeEditor({
      markdown: { enabled: false },
    })
    editor.selection.commands.focus()
    typeText(editor, '-')
    typeText(editor, ' ')

    expect(firstInlineBlock(editor.getContext()).__type).toBe('paragraph')
    expect(blockTexts(editor.getContext())).toEqual(['- '])
  })

  test('disabled markdown leaves the checkbox trigger characters in the paragraph', () => {
    const editor = makeEditor({
      markdown: { enabled: false },
    })
    editor.selection.commands.focus()
    typeText(editor, '[]')
    typeText(editor, ' ')

    expect(firstInlineBlock(editor.getContext()).__type).toBe('paragraph')
    expect(blockTexts(editor.getContext())).toEqual(['[] '])
  })

  test('disabled markdown leaves the numbered list trigger characters in the paragraph', () => {
    const editor = makeEditor({
      markdown: { enabled: false },
    })
    editor.selection.commands.focus()
    typeText(editor, '1.')
    typeText(editor, ' ')

    expect(firstInlineBlock(editor.getContext()).__type).toBe('paragraph')
    expect(blockTexts(editor.getContext())).toEqual(['1. '])
  })

  test('disabled markdown leaves the heading trigger characters in the paragraph', () => {
    const editor = makeEditor({
      markdown: { enabled: false },
    })
    editor.selection.commands.focus()
    typeText(editor, '#')
    typeText(editor, ' ')

    expect(firstInlineBlock(editor.getContext()).__type).toBe('paragraph')
    expect(blockTexts(editor.getContext())).toEqual(['# '])
  })

  test('disabled markdown leaves the divider trigger characters in the paragraph', () => {
    const editor = makeEditor({
      markdown: { enabled: false },
    })
    editor.selection.commands.focus()
    typeText(editor, '---')
    typeText(editor, ' ')

    expect(firstInlineBlock(editor.getContext()).__type).toBe('paragraph')
    expect(blockTexts(editor.getContext())).toEqual(['--- '])
  })

  test('autolink converts a URL followed by a space into a link node', () => {
    const editor = makeEditor({
      markdown: { enabled: false },
    })
    editor.selection.commands.focus()
    typeText(editor, 'https://example.com')
    typeText(editor, ' ')

    const link = firstInlineBlock(editor.getContext()).content.find(isLinkNode)
    expect(link).toBeDefined()
    if (!link || !isLinkNode(link)) {
      throw new Error('Expected a link node')
    }
    expect(link.text).toBe('https://example.com')
    expect(link.url.href).toBe('https://example.com/')
  })

  test('disabled autolink leaves the URL as plain text', () => {
    const editor = makeEditor({
      autolink: { enabled: false },
      markdown: { enabled: false },
    })
    editor.selection.commands.focus()
    typeText(editor, 'https://example.com')
    typeText(editor, ' ')

    expect(firstInlineBlock(editor.getContext()).content.some(isLinkNode)).toBe(
      false,
    )
    expect(blockTexts(editor.getContext())).toEqual(['https://example.com '])
  })
})

describe('Dactylo initial metadata', () => {
  const initials = {
    bulletedList: { initialMetadata: { k: 'b' } },
    divider: { initialMetadata: { k: 'd' } },
    heading: { initialMetadata: { k: 'h' } },
    lineBreak: { initialMetadata: { k: 'lb' } },
    link: { initialMetadata: { k: 'l' } },
    paragraph: { initialMetadata: { k: 'p' } },
    text: { initialMetadata: { k: 't' } },
  }

  test('# space mutates to heading initial metadata, not the paragraph bag', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()
    typeText(editor, '#')
    typeText(editor, ' ')

    const heading = firstInlineBlock(editor.getContext())
    expect(isHeadingBlock(heading)).toBe(true)
    expect(heading.metadata).toEqual({ k: 'h' })
  })

  test('undo of a heading shortcut restores the paragraph initial bag', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()
    typeText(editor, '#')
    typeText(editor, ' ')

    editor.history.commands.undo()

    const paragraph = firstInlineBlock(editor.getContext())
    expect(isParagraphBlock(paragraph)).toBe(true)
    expect(paragraph.metadata).toEqual({ k: 'p' })
    expect(blockTexts(editor.getContext())).toEqual(['# '])
  })

  test('--- space stamps divider and follow-up paragraph initials', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()
    typeText(editor, '---')
    typeText(editor, ' ')

    const { state } = editor.getContext()
    const [dividerId, paragraphId] = state.blockOrderById
    if (!dividerId || !paragraphId) {
      throw new Error('Expected a divider and a follow-up paragraph')
    }

    const divider = state.blocks.get(dividerId)
    const paragraph = state.blocks.get(paragraphId)
    if (!divider || !paragraph) {
      throw new Error('Expected both blocks to exist')
    }

    expect(isDividerBlock(divider)).toBe(true)
    expect(divider.metadata).toEqual({ k: 'd' })
    expect(isParagraphBlock(paragraph)).toBe(true)
    if (!isParagraphBlock(paragraph)) {
      throw new Error('Expected a follow-up paragraph')
    }
    expect(paragraph.metadata).toEqual({ k: 'p' })
    const text = paragraph.content.find(isTextNode)
    expect(text?.metadata).toEqual({ k: 't' })
  })

  test('Enter at the end of a heading creates a paragraph with paragraph initial', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()
    typeText(editor, '#')
    typeText(editor, ' ')
    typeText(editor, 'Title')

    hardBreak(editor)

    const heading = nthInlineBlock(editor.getContext(), 0)
    const paragraph = nthInlineBlock(editor.getContext(), 1)
    expect(isHeadingBlock(heading)).toBe(true)
    expect(heading.metadata).toEqual({ k: 'h' })
    expect(isParagraphBlock(paragraph)).toBe(true)
    expect(paragraph.metadata).toEqual({ k: 'p' })
  })

  test('Shift+Enter stamps line-break and text initials', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()

    softBreak(editor)

    const block = firstInlineBlock(editor.getContext())
    const lineBreak = block.content.find(isLineBreakNode)
    const emptyText = block.content.find(
      (node) => isTextNode(node) && node.text === '',
    )

    expect(lineBreak?.metadata).toEqual({ k: 'lb' })
    expect(emptyText?.metadata).toEqual({ k: 't' })
  })

  test('insert heading uses heading initial metadata', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()

    editor.blocks.commands.insert({ spec: { level: 1, type: 'heading' } })

    const heading = nthInlineBlock(editor.getContext(), 1)
    expect(isHeadingBlock(heading)).toBe(true)
    expect(heading.metadata).toEqual({ k: 'h' })
    expect(firstInlineBlock(editor.getContext()).metadata).toEqual({ k: 'p' })
  })

  test('mutate to heading stamps heading initial metadata, not the paragraph bag', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()
    const paragraphId = firstInlineBlock(editor.getContext()).id

    expect(
      editor.blocks.commands.mutate(paragraphId, {
        kind: 'to_heading',
        level: 1,
      }),
    ).toBe(true)

    const heading = firstInlineBlock(editor.getContext())
    expect(isHeadingBlock(heading)).toBe(true)
    expect(heading.metadata).toEqual({ k: 'h' })
  })

  test('undo of mutate restores the paragraph initial bag', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()
    const paragraphId = firstInlineBlock(editor.getContext()).id

    editor.blocks.commands.mutate(paragraphId, {
      kind: 'to_heading',
      level: 1,
    })
    editor.history.commands.undo()

    const paragraph = firstInlineBlock(editor.getContext())
    expect(isParagraphBlock(paragraph)).toBe(true)
    expect(paragraph.metadata).toEqual({ k: 'p' })
  })

  test('mutate metadata override wins over the target initial bag', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()
    const paragraphId = firstInlineBlock(editor.getContext()).id

    expect(
      editor.blocks.commands.mutate(paragraphId, {
        kind: 'to_heading',
        level: 1,
        metadata: { k: 'custom' },
      }),
    ).toBe(true)

    const heading = firstInlineBlock(editor.getContext())
    expect(isHeadingBlock(heading)).toBe(true)
    expect(heading.metadata).toEqual({ k: 'custom' })
  })

  test('Enter at the end of a paragraph copies the source bag', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()
    const paragraphId = firstInlineBlock(editor.getContext()).id

    editor.blocks.commands.patch({
      blockId: paragraphId,
      spec: { metadata: { value: { k: 'patched' } }, type: 'paragraph' },
    })
    typeText(editor, 'Hello')
    hardBreak(editor)

    const source = nthInlineBlock(editor.getContext(), 0)
    const successor = nthInlineBlock(editor.getContext(), 1)
    expect(isParagraphBlock(source)).toBe(true)
    expect(source.metadata).toEqual({ k: 'patched' })
    expect(isParagraphBlock(successor)).toBe(true)
    expect(successor.metadata).toEqual({ k: 'patched' })
  })

  test('Enter at the end of a list item copies the source bag', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()
    typeText(editor, '-')
    typeText(editor, ' ')

    const item = firstInlineBlock(editor.getContext())
    expect(isBulletListItemBlock(item)).toBe(true)

    editor.blocks.commands.patch({
      blockId: item.id,
      spec: { metadata: { value: { k: 'item' } }, type: 'bullet_list_item' },
    })
    typeText(editor, 'Hello')
    hardBreak(editor)

    const source = nthInlineBlock(editor.getContext(), 0)
    const successor = nthInlineBlock(editor.getContext(), 1)
    expect(isBulletListItemBlock(source)).toBe(true)
    expect(source.metadata).toEqual({ k: 'item' })
    expect(isBulletListItemBlock(successor)).toBe(true)
    expect(successor.metadata).toEqual({ k: 'item' })
  })

  test('autolink stamps link initial metadata, not the text bag', () => {
    const editor = makeEditor({
      ...initials,
      markdown: { enabled: false },
    })
    editor.selection.commands.focus()
    typeText(editor, 'https://example.com')
    typeText(editor, ' ')

    const link = firstInlineBlock(editor.getContext()).content.find(isLinkNode)
    expect(link).toBeDefined()
    if (!link || !isLinkNode(link)) {
      throw new Error('Expected a link node')
    }
    expect(link.metadata).toEqual({ k: 'l' })
  })
})

describe('Dactylo read-only mode', () => {
  test('setEditable(false) clears selection and emits editable events', () => {
    const editor = makeTypingEditor()
    const editableEvents: boolean[] = []
    editor.events.editable.subscribe((event) => {
      editableEvents.push(event.editable)
    })

    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    editor.setEditable(false)

    expect(editor.canEdit()).toBe(false)
    expect(editor.getContext().selection).toBeNull()
    expect(editableEvents).toEqual([false])

    editor.setEditable(false)
    expect(editableEvents).toEqual([false])

    editor.setEditable(true)
    expect(editor.canEdit()).toBe(true)
    expect(editableEvents).toEqual([false, true])
  })

  test('commands are no-ops and tools return fallbacks while read-only', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const paragraphId = firstInlineBlock(editor.getContext()).id
    editor.setEditable(false)
    const before = snapshot(editor.getContext())

    expect(sendInput(editor, 'insertText', 'x')).toBe(false)
    editor.marks.commands.toggle('bold')
    editor.history.commands.undo()
    expect(
      editor.blocks.commands.insert({ spec: { type: 'paragraph' } }),
    ).toBeNull()
    expect(
      editor.blocks.commands.insert({ spec: { type: 'quote' } }),
    ).toBeNull()
    expect(
      editor.blocks.commands.insert({ spec: { level: 1, type: 'heading' } }),
    ).toBeNull()
    expect(
      editor.blocks.commands.insert({ spec: { type: 'bullet_list_item' } }),
    ).toBeNull()
    expect(
      editor.blocks.commands.insert({ spec: { type: 'numbered_list_item' } }),
    ).toBeNull()
    expect(
      editor.blocks.commands.insert({ spec: { type: 'checkbox_list_item' } }),
    ).toBeNull()
    expect(
      editor.blocks.commands.insert({ spec: { type: 'divider' } }),
    ).toBeNull()
    expect(editor.blocks.commands.delete(paragraphId)).toBe(false)
    expect(editor.blocks.commands.duplicate(paragraphId)).toBe(false)
    expect(editor.blocks.commands.move(paragraphId, { type: 'end' })).toBe(
      false,
    )
    expect(
      editor.blocks.commands.mutate(paragraphId, {
        kind: 'to_heading',
        level: 1,
      }),
    ).toBe(false)
    expect(
      editor.blocks.commands.patch({
        blockId: paragraphId,
        spec: { metadata: { value: { a: 1 } }, type: 'paragraph' },
      }),
    ).toBe(false)
    expect(
      editor.blocks.commands.patch({
        blockId: paragraphId,
        spec: { metadata: { value: { a: 1 } }, type: 'quote' },
      }),
    ).toBe(false)
    expect(
      editor.blocks.commands.patch({
        blockId: paragraphId,
        spec: { level: 2, type: 'heading' },
      }),
    ).toBe(false)
    expect(
      editor.blocks.commands.patch({
        blockId: paragraphId,
        spec: { metadata: { value: { a: 1 } }, type: 'bullet_list_item' },
      }),
    ).toBe(false)
    expect(
      editor.blocks.commands.patch({
        blockId: paragraphId,
        spec: { type: 'numbered_list_item', variant: 'alpha' },
      }),
    ).toBe(false)
    expect(
      editor.blocks.commands.patch({
        blockId: paragraphId,
        spec: { checked: true, type: 'checkbox_list_item' },
      }),
    ).toBe(false)
    expect(
      editor.blocks.commands.patch({
        blockId: paragraphId,
        spec: { metadata: { value: { a: 1 } }, type: 'divider' },
      }),
    ).toBe(false)

    expect(snapshot(editor.getContext())).toEqual(before)
    expect(editor.history.tools.canUndo()).toBe(false)
    expect(editor.selection.tools.isFocused()).toBe(false)
    expect(editor.marks.tools.isActive('bold')).toBe(false)

    editor.setEditable(true)
    expect(editor.history.tools.canUndo()).toBe(true)
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })
})

describe('Dactylo DOM', () => {
  test('getActiveRange returns null when nothing is attached', () => {
    const editor = makeTypingEditor()

    expect(editor.dom.tools.getActiveRange()).toBeNull()
  })

  test('getActiveRange emits a tools event', () => {
    const editor = makeTypingEditor()
    const tools: DactyloToolEvent[] = []
    editor.events.tools.subscribe((event) => {
      tools.push(event)
    })

    editor.dom.tools.getActiveRange()

    expect(tools).toEqual([
      expect.objectContaining({
        result: null,
        status: 'success',
        tool: 'dom/get-active-range',
      }),
    ])
  })
})

describe('Dactylo subscribe and events', () => {
  test('subscribe fires after typing and unsubscribe stops further calls', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()

    const contexts: string[][] = []
    const unsubscribe = editor.subscribe((context) => {
      contexts.push(blockTexts(context))
    })

    typeText(editor, 'Hello')
    expect(contexts).toEqual([['Hello']])

    unsubscribe()
    typeText(editor, '!')
    expect(contexts).toEqual([['Hello']])
    expect(blockTexts(editor.getContext())).toEqual(['Hello!'])
  })

  test('events.commands records composer and marks commands', () => {
    const editor = makeTypingEditor()
    const commands: DactyloCommandEvent[] = []
    editor.events.commands.subscribe((event) => {
      commands.push(event)
    })

    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    editor.marks.commands.toggle('bold')

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'composer/send-input',
          result: true,
          status: 'success',
        }),
        expect.objectContaining({
          command: 'marks/toggle',
          status: 'success',
        }),
      ]),
    )
  })

  test('events.transactionDidApply fires after a successful type', () => {
    const editor = makeTypingEditor()
    const applied: Transaction[] = []
    editor.events.transactionDidApply.subscribe((transaction) => {
      applied.push(transaction)
    })

    editor.selection.commands.focus()
    const afterFocus = applied.length
    typeText(editor, 'Hello')

    expect(applied.length).toBeGreaterThan(afterFocus)
    expect(applied.at(-1)?.ops.length).toBeGreaterThan(0)
  })
})

describe('Dactylo safe-execute opts', () => {
  test('forwards command payload on success, read-only fallback, and error', () => {
    const editor = makeTypingEditor()
    const commands: DactyloCommandEvent[] = []
    const errors: DactyloErrorEvent[] = []
    editor.events.commands.subscribe((event) => {
      commands.push(event)
    })
    editor.events.errors.subscribe((event) => {
      errors.push(event)
    })

    editor.marks.commands.toggle('bold', 'ai-agent')
    expect(commands.at(-1)).toEqual(
      expect.objectContaining({
        command: 'marks/toggle',
        payload: { mark: 'bold', source: 'ai-agent' },
        status: 'success',
      }),
    )

    editor.setEditable(false)
    editor.marks.commands.toggle('italic')
    expect(commands.at(-1)).toEqual(
      expect.objectContaining({
        command: 'marks/toggle',
        payload: { mark: 'italic', source: 'user' },
        status: 'success',
      }),
    )

    editor.setEditable(true)
    const missingId = 'bl_missing' as BlockId

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* silence expected DactyloError log */
    })
    const opts = { blockId: missingId, spec: { type: 'paragraph' as const } }
    try {
      expect(() => editor.blocks.commands.patch(opts)).toThrow(DactyloError)
    } finally {
      errorSpy.mockRestore()
    }

    expect(commands.at(-1)).toEqual(
      expect.objectContaining({
        command: 'blocks/patch',
        payload: { opts, source: 'user' },
        status: 'error',
      }),
    )
    expect(errors).toEqual([
      expect.objectContaining({
        command: 'blocks/patch',
        payload: { opts, source: 'user' },
      }),
    ])
    expect(commands.at(-1)?.error).toBe(errors[0]?.error)
  })

  test('insert emits blocks/insert with the spec payload', () => {
    const editor = makeTypingEditor()
    const commands: DactyloCommandEvent[] = []
    editor.events.commands.subscribe((event) => {
      commands.push(event)
    })

    editor.selection.commands.focus()
    const opts = { spec: { type: 'paragraph' as const } }
    const blockId = editor.blocks.commands.insert(opts, 'ai-agent')
    if (!blockId) {
      throw new Error('Expected an inserted paragraph')
    }

    expect(commands.at(-1)).toEqual(
      expect.objectContaining({
        command: 'blocks/insert',
        payload: { opts, source: 'ai-agent' },
        status: 'success',
      }),
    )
  })

  test('patch emits blocks/patch with the spec payload', () => {
    const editor = makeTypingEditor()
    const commands: DactyloCommandEvent[] = []
    editor.events.commands.subscribe((event) => {
      commands.push(event)
    })

    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const blockId = firstInlineBlock(editor.getContext()).id
    const opts = {
      blockId,
      spec: { metadata: { value: { a: 1 } }, type: 'paragraph' as const },
    }

    expect(editor.blocks.commands.patch(opts, 'ai-agent')).toBe(true)

    expect(commands.at(-1)).toEqual(
      expect.objectContaining({
        command: 'blocks/patch',
        payload: { opts, source: 'ai-agent' },
        status: 'success',
      }),
    )
  })

  test('forwards tool payload on success and read-only fallback', () => {
    const editor = makeTypingEditor()
    const tools: DactyloToolEvent[] = []
    editor.events.tools.subscribe((event) => {
      tools.push(event)
    })

    expect(editor.marks.tools.isActive('bold')).toBe(false)
    expect(tools.at(-1)).toEqual(
      expect.objectContaining({
        payload: { mark: 'bold' },
        result: false,
        status: 'success',
        tool: 'marks/is-active',
      }),
    )

    editor.setEditable(false)
    expect(editor.marks.tools.isActive('italic')).toBe(false)
    expect(tools.at(-1)).toEqual(
      expect.objectContaining({
        payload: { mark: 'italic' },
        result: false,
        status: 'success',
        tool: 'marks/is-active',
      }),
    )
  })

  test('omits payload from events when the call has none', () => {
    const editor = makeTypingEditor()
    const commands: DactyloCommandEvent[] = []
    const tools: DactyloToolEvent[] = []
    editor.events.commands.subscribe((event) => {
      commands.push(event)
    })
    editor.events.tools.subscribe((event) => {
      tools.push(event)
    })

    editor.selection.commands.focus()
    expect(editor.history.tools.canUndo()).toBe(false)

    expect(commands).toEqual([
      expect.objectContaining({
        command: 'selection/focus',
        payload: undefined,
        status: 'success',
      }),
    ])
    expect(tools).toEqual([
      expect.objectContaining({
        payload: undefined,
        result: false,
        status: 'success',
        tool: 'history/can-undo',
      }),
    ])
  })

  test('client-only command falls back without DOM and still forwards payload', () => {
    const editor = makeTypingEditor()
    const commands: DactyloCommandEvent[] = []
    editor.events.commands.subscribe((event) => {
      commands.push(event)
    })
    editor.selection.commands.focus()

    withUnavailableDOM(() => {
      expect(sendInput(editor, 'insertText', 'x')).toBe(false)
    })

    expect(commands.at(-1)).toEqual(
      expect.objectContaining({
        command: 'composer/send-input',
        payload: expect.objectContaining({ event: expect.anything() }),
        result: false,
        status: 'success',
      }),
    )
    expect(blockTexts(editor.getContext())).toEqual([''])
  })

  test('client-only tool falls back without DOM', () => {
    const editor = makeMentionsEditor()
    editor.selection.commands.focus()
    typeMentionQuery(editor, 'john')
    expect(editor.mentions.tools.isBuffering()).toBe(true)
    expect(editor.mentions.tools.getBufferedText()).toBe('john')

    const tools: DactyloToolEvent[] = []
    editor.events.tools.subscribe((event) => {
      tools.push(event)
    })

    withUnavailableDOM(() => {
      expect(editor.mentions.tools.isBuffering()).toBe(false)
      expect(editor.mentions.tools.getBufferedText()).toBeNull()
    })

    expect(tools).toEqual([
      expect.objectContaining({
        result: false,
        status: 'success',
        tool: 'mentions/is-buffering',
      }),
      expect.objectContaining({
        result: null,
        status: 'success',
        tool: 'mentions/get-buffered-text',
      }),
    ])
  })

  test('client-only command still runs when DOM is available', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()

    expect(sendInput(editor, 'insertText', 'Hello')).toBe(true)
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })

  test('`alwaysExecute` tools still run while read-only', () => {
    const empty = makeTypingEditor()
    const emptyId = firstInlineBlock(empty.getContext()).id
    empty.setEditable(false)
    expect(empty.blocks.tools.isWithEmptyInlineContent(emptyId)).toBe('empty')
    expect(empty.history.tools.canUndo()).toBe(false)

    const filled = makeTypingEditor()
    filled.selection.commands.focus()
    typeText(filled, 'Hello')
    const filledId = firstInlineBlock(filled.getContext()).id
    filled.setEditable(false)
    expect(filled.blocks.tools.isWithEmptyInlineContent(filledId)).toBe(
      'not-empty',
    )
  })

  test('isWithEmptyInlineContent returns never for a missing block without emitting errors', () => {
    const editor = makeTypingEditor()
    const missingId = 'bl_missing' as BlockId

    const tools: DactyloToolEvent[] = []
    const errors: DactyloErrorEvent[] = []
    editor.events.tools.subscribe((event) => {
      tools.push(event)
    })
    editor.events.errors.subscribe((event) => {
      errors.push(event)
    })

    expect(editor.blocks.tools.isWithEmptyInlineContent(missingId)).toBe(
      'never',
    )

    expect(tools.at(-1)).toEqual(
      expect.objectContaining({
        payload: undefined,
        result: 'never',
        status: 'success',
        tool: 'blocks/is-with-empty-inline-content',
      }),
    )
    expect(errors).toEqual([])
  })
})
