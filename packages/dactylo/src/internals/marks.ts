/**
 * {@link Marks} defines how the available marks in Dactylo are applied to text nodes.
 *
 * It allows to enable/disable inline marks (bold first, then italic, ...) from UI buttons or shortcuts
 * from the keyboard pipeline.
 *
 * Two user-facing behaviors:
 * | Scenario                        | Behavior                                                      |
 * |---------------------------------|---------------------------------------------------------------|
 * | Collapsed cursor (no selection) | Split at the caret and insert a node with the toggled mark    |
 * | Range selection                 | Toggle mark on selected text via `set_marks`                  |
 *
 * Architecture:
 * ```
 * UI button `onClick`
 *      |
 *      ▼
 * Dactylo.marks.toggle('bold')
 *      |
 *      ├─ selection.__type === 'cursor'
 *      |     └─ empty node: set_marks; otherwise split and insert a marked node
 *      |
 *      └─ selection.__type === 'range'
 *            └─ set_marks on normalized range (history)
 * ```
 *
 * Formatting is document content. Inline marks live on {@link TextNode} inside {@link DocumentState}
 * and are exported like any other text:
 *
 * | Export   | What carries marks                                                   |
 * |----------|----------------------------------------------------------------------|
 * | JSON     | `content[].marks` on each text node (lossless)                       |
 * | Markdown | `**bold**`, `*italic*`, `` `code` `` wrappers from markdown exporter |
 *
 * Typing inherits `TextNode.marks` of the node under the caret. Soft break copies those
 * marks onto the new empty inline. Hard break inserts an unmarked paragraph.
 * Emptying a block via delete resets marks.
 *
 * ```
 * toggle('bold') at cursor inside "Hello"
 *         │
 *         ▼
 * split at caret, insert empty TextNode { bold: true, ... }
 *         │
 *         ▼
 * keydown handler ('A')
 *         │
 *         ▼
 * insert_text into the new node
 *         │
 *         ▼
 * markdown exporter → "**A**" / JSON exporter → marks on text node
 * ```
 */

export interface Marks {
  /** Whether the text  is bold. */
  bold: boolean

  /** Whether the text  is italic. */
  italic: boolean

  /** Whether the text  is strikethrough. */
  strikethrough: boolean

  /** Whether the text  is underlined. */
  underline: boolean

  /** Whether the text  is code. */
  code: boolean
}

/** Keys that can be toggled from {@link Dactylo}. */
export type MarkKey = keyof Marks

/** Create a base marks with every marks off. */
export function createBaseMarks(): Marks {
  return {
    bold: false,
    code: false,
    italic: false,
    strikethrough: false,
    underline: false,
  }
}

/** Returns whether two mark objects are equivalent for coalescing purposes. */
export function isMarksEqual(a: Readonly<Marks>, b: Readonly<Marks>): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strikethrough === b.strikethrough &&
    a.underline === b.underline &&
    a.code === b.code
  )
}

/** Returns whether a mark flag is enabled (strict `true`). */
export function isMarkEnabled(marks: Marks, mark: MarkKey): boolean {
  return marks[mark] === true
}

/** Toggles one mark flag on a marks object (immutable copy). */
export function toggleMarkFlag(marks: Marks, mark: MarkKey): Marks {
  return {
    ...marks,
    [mark]: !isMarkEnabled(marks, mark),
  }
}
