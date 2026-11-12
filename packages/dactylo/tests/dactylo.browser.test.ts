// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'

import type { DactyloCommandEvent, DactyloToolEvent } from '../src/dactylo'
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
  DEFAULT_HEADING_PLACEHOLDER,
  DEFAULT_INLINE_COMMAND_TRIGGER_CHARACTER,
  DEFAULT_INLINE_COMMAND_TRIGGER_ENABLED,
  DEFAULT_LINK_OPEN_ON_CLICK_ENABLED,
  DEFAULT_LOCALES,
  DEFAULT_MARKDOWN_SHORTCUTS_ENABLED,
  DEFAULT_MENTION_CHARACTER,
  DEFAULT_MENTIONS_ENABLED,
  DEFAULT_NUMBERED_LIST_ITEM_PLACEHOLDER,
  DEFAULT_PARAGRAPH_PLACEHOLDER,
  DEFAULT_QUOTE_PLACEHOLDER,
} from '../src/internals/constants'
import type { HistoryEvent } from '../src/internals/history'
import { isMarkEnabled } from '../src/internals/marks'
import {
  isInlineNodeWithEditableText,
  isLineBreakNode,
  isLinkNode,
  isTextNode,
} from '../src/internals/nodes'
import type { Transaction } from '../src/internals/transaction'
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
  firstInlineBlock,
  nthInlineBlock,
  requireCursor,
  snapshot,
} from './utils/pipeline'

describe('Dactylo construction', () => {
  test('starts as an empty editable paragraph with no selection', () => {
    const editor = makeEditor()
    const context = editor.getContext()
    const block = firstInlineBlock(context)

    expect(context.state.schemaVersion).toBe(1)
    expect(context.state.blockOrderById).toHaveLength(1)
    expect(context.selection).toBeNull()
    expect(editor.canEdit()).toBe(true)
    expect(isParagraphBlock(block)).toBe(true)
    expect(editor.blocks.tools.isWithEmptyInlineContent(block.id)).toBe(true)
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
      divider: { initialMetadata: {} },
      heading: {
        initialMetadata: {},
        placeholder: DEFAULT_HEADING_PLACEHOLDER,
      },
      inlineCommandTrigger: {
        character: DEFAULT_INLINE_COMMAND_TRIGGER_CHARACTER,
        enabled: DEFAULT_INLINE_COMMAND_TRIGGER_ENABLED,
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
      heading: { placeholder: 'Title' },
      inlineCommandTrigger: { character: '!', enabled: false },
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
      divider: { initialMetadata: {} },
      heading: { initialMetadata: {}, placeholder: 'Title' },
      inlineCommandTrigger: { character: '!', enabled: false },
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
    editor.blocks.commands.insertDivider()
    typeText(editor, 'World')
    editor.blocks.commands.insertDivider()

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

    const blockId = firstInlineBlock(editor.getContext()).id
    expect(pressShortcut(editor, 'KeyA', { meta: true })).toBe(true)

    const { selection } = editor.getContext()
    expect(selection?.__type).toBe('range')
    expect(editor.selection.tools.isBlockWithActiveRange(blockId)).toBe(true)
    expect(editor.selection.tools.isBlockWithActiveCursor(blockId)).toBe(false)

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
  test('isWithEmptyInlineContent is false after typing spaces', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    const block = firstInlineBlock(editor.getContext())

    expect(editor.blocks.tools.isWithEmptyInlineContent(block.id)).toBe(true)

    typeText(editor, ' ')
    expect(editor.blocks.tools.isWithEmptyInlineContent(block.id)).toBe(false)

    typeText(editor, ' ')
    expect(editor.blocks.tools.isWithEmptyInlineContent(block.id)).toBe(false)
    expect(blockTexts(editor.getContext())).toEqual(['  '])
  })

  test('insertHeading adds a heading after the current paragraph', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    const blockId = editor.blocks.commands.insertHeading(2)
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
    expect(editor.blocks.tools.isWithEmptyInlineContent(heading.id)).toBe(true)
  })

  test('insertQuote adds a quote after the current paragraph', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    const blockId = editor.blocks.commands.insertQuote()
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
    expect(editor.blocks.tools.isWithEmptyInlineContent(quote.id)).toBe(true)
  })

  test('insertNumberedListItem adds a numbered item after the current paragraph', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    const blockId = editor.blocks.commands.insertNumberedListItem()
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
    expect(editor.blocks.tools.isWithEmptyInlineContent(item.id)).toBe(true)
  })

  test('inserts a list item, divider, and trailing paragraph', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')

    const bulletId = editor.blocks.commands.insertBulletListItem()
    const dividerId = editor.blocks.commands.insertDivider()
    const paragraphId = editor.blocks.commands.insertParagraph({
      pos: { type: 'end' },
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
    editor.blocks.commands.insertHeading(1)

    const paragraphId = nthInlineBlock(editor.getContext(), 0).id
    editor.blocks.commands.duplicate(paragraphId)

    expect(blockTexts(editor.getContext())).toEqual(['Hello', 'Hello', ''])

    editor.blocks.commands.move(paragraphId, { type: 'end' })

    expect(blockTexts(editor.getContext())).toEqual(['Hello', '', 'Hello'])
    expect(nthInlineBlock(editor.getContext(), 2).id).toBe(paragraphId)
  })

  test('delete skips the first empty block and removes a later block', () => {
    const editor = makeTypingEditor()
    const emptyId = firstInlineBlock(editor.getContext()).id
    const before = snapshot(editor.getContext())

    editor.blocks.commands.delete(emptyId)
    expect(snapshot(editor.getContext())).toEqual(before)

    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    editor.blocks.commands.insertHeading(2)
    const headingId = nthInlineBlock(editor.getContext(), 1).id

    editor.blocks.commands.delete(headingId)

    expect(editor.getContext().state.blockOrderById).toHaveLength(1)
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })

  test('patchCheckboxListItem sets checked and keeps the same id', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insertCheckboxListItem()

    const checkbox = nthInlineBlock(editor.getContext(), 1)
    expect(isCheckboxListItemBlock(checkbox)).toBe(true)

    editor.blocks.commands.patchCheckboxListItem(checkbox.id, { checked: true })

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
    editor.blocks.commands.insertCheckboxListItem()
    const checkboxId = nthInlineBlock(editor.getContext(), 1).id

    editor.blocks.commands.patchCheckboxListItem(checkboxId, { checked: true })
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

  test('patchCheckboxListItem metadata keeps checked', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insertCheckboxListItem()
    const checkboxId = nthInlineBlock(editor.getContext(), 1).id

    editor.blocks.commands.patchCheckboxListItem(checkboxId, { checked: true })
    editor.blocks.commands.patchCheckboxListItem(checkboxId, {
      metadata: { a: 1 },
    })

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(isCheckboxListItemBlock(patched)).toBe(true)
    if (isCheckboxListItemBlock(patched)) {
      expect(patched.checked).toBe(true)
      expect(patched.metadata).toEqual({ a: 1 })
    }
  })

  test('patchDivider sets metadata', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insertDivider()

    const { state } = editor.getContext()
    const dividerId = state.blockOrderById.find((id) => {
      const block = state.blocks.get(id)
      return block?.__type === 'divider'
    })
    if (!dividerId) {
      throw new Error('Expected a divider block')
    }

    editor.blocks.commands.patchDivider(dividerId, { metadata: { a: 1 } })

    const patched = editor.getContext().state.blocks.get(dividerId)
    expect(patched?.__type).toBe('divider')
    expect(patched?.metadata).toEqual({ a: 1 })
  })

  test('patchCheckboxListItem on a paragraph is a no-op and leaves the document unchanged', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const paragraphId = firstInlineBlock(editor.getContext()).id
    const before = snapshot(editor.getContext())

    editor.blocks.commands.patchCheckboxListItem(paragraphId, {
      checked: true,
    })
    expect(snapshot(editor.getContext())).toEqual(before)
  })

  test('patchHeading changes level only', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    editor.blocks.commands.insertHeading(2)

    const heading = nthInlineBlock(editor.getContext(), 1)
    expect(isHeadingBlock(heading)).toBe(true)
    const { content } = heading

    editor.blocks.commands.patchHeading(heading.id, { level: 3 })

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(patched.id).toBe(heading.id)
    expect(isHeadingBlock(patched)).toBe(true)
    if (isHeadingBlock(patched)) {
      expect(patched.level).toBe(3)
      expect(patched.content).toEqual(content)
    }
  })

  test('patchParagraph sets metadata', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    typeText(editor, 'Hello')
    const paragraphId = firstInlineBlock(editor.getContext()).id

    editor.blocks.commands.patchParagraph(paragraphId, { metadata: { a: 1 } })

    const patched = firstInlineBlock(editor.getContext())
    expect(patched.id).toBe(paragraphId)
    expect(isParagraphBlock(patched)).toBe(true)
    expect(patched.metadata).toEqual({ a: 1 })
    expect(blockTexts(editor.getContext())).toEqual(['Hello'])
  })

  test('patchQuote sets metadata', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insertQuote()
    const quote = nthInlineBlock(editor.getContext(), 1)

    editor.blocks.commands.patchQuote(quote.id, { metadata: { a: 1 } })

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(patched.id).toBe(quote.id)
    expect(isQuoteBlock(patched)).toBe(true)
    expect(patched.metadata).toEqual({ a: 1 })
  })

  test('patchBulletListItem sets metadata', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insertBulletListItem()
    const item = nthInlineBlock(editor.getContext(), 1)

    editor.blocks.commands.patchBulletListItem(item.id, {
      metadata: { a: 1 },
    })

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(patched.id).toBe(item.id)
    expect(isBulletListItemBlock(patched)).toBe(true)
    expect(patched.metadata).toEqual({ a: 1 })
  })

  test('patchNumberedListItem changes variant only', () => {
    const editor = makeTypingEditor()
    editor.selection.commands.focus()
    editor.blocks.commands.insertNumberedListItem()

    const item = nthInlineBlock(editor.getContext(), 1)
    expect(isNumberedListItemBlock(item)).toBe(true)
    const { content } = item

    editor.blocks.commands.patchNumberedListItem(item.id, { variant: 'alpha' })

    const patched = nthInlineBlock(editor.getContext(), 1)
    expect(patched.id).toBe(item.id)
    expect(isNumberedListItemBlock(patched)).toBe(true)
    if (isNumberedListItemBlock(patched)) {
      expect(patched.variant).toBe('alpha')
      expect(patched.markerNumbering).toBe('a.')
      expect(patched.content).toEqual(content)
    }
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

  test('insertHeading uses heading initial metadata', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()

    editor.blocks.commands.insertHeading(1)

    const heading = nthInlineBlock(editor.getContext(), 1)
    expect(isHeadingBlock(heading)).toBe(true)
    expect(heading.metadata).toEqual({ k: 'h' })
    expect(firstInlineBlock(editor.getContext()).metadata).toEqual({ k: 'p' })
  })

  test('Enter at the end of a paragraph copies the source bag', () => {
    const editor = makeEditor(initials)
    editor.selection.commands.focus()
    const paragraphId = firstInlineBlock(editor.getContext()).id

    editor.blocks.commands.patchParagraph(paragraphId, {
      metadata: { k: 'patched' },
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

    editor.blocks.commands.patchBulletListItem(item.id, {
      metadata: { k: 'item' },
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
    editor.setEditable(false)
    const before = snapshot(editor.getContext())

    expect(sendInput(editor, 'insertText', 'x')).toBe(false)
    editor.marks.commands.toggle('bold')
    editor.history.commands.undo()
    expect(editor.blocks.commands.insertParagraph()).toBeNull()
    expect(editor.blocks.commands.insertQuote()).toBeNull()
    expect(editor.blocks.commands.insertHeading(1)).toBeNull()
    expect(editor.blocks.commands.insertBulletListItem()).toBeNull()
    expect(editor.blocks.commands.insertNumberedListItem()).toBeNull()
    expect(editor.blocks.commands.insertCheckboxListItem()).toBeNull()
    expect(editor.blocks.commands.insertDivider()).toBeNull()

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
