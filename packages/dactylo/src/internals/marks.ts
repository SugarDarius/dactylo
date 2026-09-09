/**
 * {@link Marks} defines how the available marks in Dactylo are applied to text nodes.
 *
 * It allows to enable/disable inline marks (bold first, then italic, ...) from UI buttons or shortcuts
 * from the keyboard pipeline.
 *
 * Two user-facing behaviors:
 * | Scenario                        | Behavior                                                      |
 * |---------------------------------|---------------------------------------------------------------|
 * | Collapsed cursor (no selection) | Toggle active marks — next typed characters use bold (or not) |
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
 *      |     └─ set_active_marks (no history) → context.activeMarks
 *      |
 *      └─ selection.__type === 'range'
 *            └─ set_marks on normalized range (history)
 *                     |
 *                     ▼
 *             buildTypeOps uses context.activeMarks → insert_text.marks
 *
 * Document content against typing mode:
 *
 * Formatting is document content. Inline marks live on {@link TextNode} inside {@link DocumentState}
 * and are exported like any other text:
 *
 * | Export   | What carries marks                                                   |
 * |----------|----------------------------------------------------------------------|
 * | JSON     | `content[].marks` on each text node (lossless)                       |
 * | Markdown | `**bold**`, `*italic*`, `` `code` `` wrappers from markdown exporter |
 *
 * When the user types with bold mark on, `activeMarks` in the {@link EditorContext} is copied
 * onto `insert_text` operation, applied to the new run, and stored as `TextNode.marks` in the {@link DocumentState}.
 * From that point on it's normale document content and round-trips through export.
 *
 * ```
 * toggle('bold') at cursor
 *         │
 *         ▼
 * context.activeMarks = { bold: true, italic: false, ... } ← typing mode (not yet on a node)
 *         │
 *         ▼
 * keydown handler ('A')
 *         │
 *         ▼
 * insert_text { text: 'A', marks: { bold: true, ... } }
 *         │
 *         ▼
 * TextNode { text: 'A', marks: { bold: true, ... } } ← document content
 *         │
 *         ▼
 * markdown exporter → "**A**" / JSON exporter → marks on text node
 * ```
 *
 * Range toggles skip the buffer: `set_marks` writes `TextNode.marks` directly to the document.
 */
export interface Marks {
  /** Whether the text  is bold. */
  bold?: boolean

  /** Whether the text  is italic. */
  italic?: boolean

  /** Whether the text  is strikethrough. */
  strikethrough?: boolean

  /** Whether the text  is underlined. */
  underline?: boolean

  /** Whether the text  is code. */
  code?: boolean
}

/** Keys that can be toggled from {@link Dactylo}. */
export type MarkKey = keyof Marks

/** Create the initial active marks when loading a document. */
export function createInitialActiveMarks(): Marks {
  return {
    bold: false,
    code: false,
    italic: false,
    strikethrough: false,
    underline: false,
  }
}

/** Returns whether a mark flag is enabled (strict `true`). */
export function isMarkEnabled(marks: Marks, mark: MarkKey): boolean {
  return marks[mark] === true
}
