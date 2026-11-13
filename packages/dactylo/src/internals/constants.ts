/** Default placeholder text for empty {@link ParagraphBlock}. */
export const DEFAULT_PARAGRAPH_PLACEHOLDER = 'Write something…' as const

/** Default placeholder text for empty {@link QuoteBlock}. */
export const DEFAULT_QUOTE_PLACEHOLDER = 'Empty quote' as const

/** The replacer for the heading level in the placeholder. */
export const HEADING_LEVEL_REPLACER = '%level%' as const

/** Default placeholder text for empty {@link HeadingBlock}. */
export const DEFAULT_HEADING_PLACEHOLDER =
  `Heading ${HEADING_LEVEL_REPLACER}` as const

/** Default placeholder text for empty {@link BulletListItemBlock}. */
export const DEFAULT_BULLET_LIST_ITEM_PLACEHOLDER = 'List' as const

/** Default placeholder text for empty {@link NumberedListItemBlock}. */
export const DEFAULT_NUMBERED_LIST_ITEM_PLACEHOLDER = 'List' as const

/** Default placeholder text for empty {@link CheckboxListItemBlock}. */
export const DEFAULT_CHECKBOX_LIST_ITEM_PLACEHOLDER = 'Task'

/** Default link open on click enabled. */
export const DEFAULT_LINK_OPEN_ON_CLICK_ENABLED = true as const

/** Default mentions enabled. */
export const DEFAULT_MENTIONS_ENABLED = true as const

/** Default mention character. */
export const DEFAULT_MENTION_CHARACTER = '@' as const

/** Default slash command enabled. */
export const DEFAULT_INLINE_COMMAND_TRIGGER_ENABLED = true as const

/** Default slash command character. */
export const DEFAULT_INLINE_COMMAND_TRIGGER_CHARACTER = '/' as const

/** Default autolink detection enabled. */
export const DEFAULT_AUTOLINK_ENABLED = true as const

/** Default markdown shortcuts enabled. */
export const DEFAULT_MARKDOWN_SHORTCUTS_ENABLED = true as const

/** Default max size for a batch of operations. */
export const DEFAULT_BATCH_MAX_SIZE = 512 as const

/** Default max depth for the history stack. */
export const DEFAULT_HISTORY_STACK_MAX_DEPTH = 100 as const

/** Default typing burst controller options. */
export const DEFAULT_TYPING_BURST_PAUSE_MS = 1000 as const

/** Default exponential moving average (EMA) for latest inter-key interval (0-1). */
export const DEFAULT_EMA_ALPHA = 0.35 as const

/** Default user inter-key internal (IKI) between commits at or below this (fast). */
export const DEFAULT_FAST_IKI_MS = 120 as const

/** Default user inter-key internal (IKI) between commits above this (slow). */
export const DEFAULT_SLOW_IKI_MS = 400 as const

/** Default maximum number of characters to type when in fast mode. */
export const DEFAULT_MAX_CHAR_WHEN_FAST = 20 as const

/** Default maximum number of characters to type when in slow mode. */
export const DEFAULT_MAX_CHAR_WHEN_SLOW = 5 as const

/** Default locales to use when handling text operations. */
export const DEFAULT_LOCALES = 'en-US' as const

/** Default DOM attributes for HTML elements rendered by UI libraries and used for DOM operations. */
export const ROOT_ATTR_NAME = 'dactylo-root' as const

/** Editable attribute name. */
export const EDITABLE_ATTR_NAME = 'dactylo-editable' as const

/** Blocks attribute name. */
export const BLOCKS_ATTR_NAME = 'dactylo-blocks' as const

/** Block attribute name. */
export const BLOCK_ATTR_NAME = 'dactylo-block' as const
/** Block ID data name. */
export const BLOCK_ID_DATA_NAME = 'data-dactylo-block-id' as const
/** Block index of rendering data name. */
export const BLOCK_INDEX_DATA_NAME = 'data-dactylo-block-index' as const
/** Block placeholder attribute name. */
export const BLOCK_PLACEHOLDER_ATTR_NAME = 'dactylo-block-placeholder' as const
/** Block content attribute name. */
export const BLOCK_CONTENT_ATTR_NAME = 'dactylo-block-content' as const
/** Block content editable data name. */
export const BLOCK_CONTENT_EDITABLE_DATA_NAME =
  'data-dactylo-block-content-editable' as const

/** {@link ParagraphBlock} attribute name. */
export const PARAGRAPH_BLOCK_ATTR_NAME = 'dactylo-paragraph-block' as const

/** {@link QuoteBlock} attribute name. */
export const QUOTE_BLOCK_ATTR_NAME = 'dactylo-quote-block' as const
/** {@link QuoteBlock} marker attribute name. */
export const QUOTE_BLOCK_MARKER_ATTR_NAME =
  'dactylo-quote-block-marker' as const
/** {@link QuoteBlock} marker border attribute name. */
export const QUOTE_BLOCK_MARKER_BORDER_ATTR_NAME =
  'dactylo-quote-block-marker-border' as const

/** {@link DividerBlock} attribute name. */
export const DIVIDER_BLOCK_ATTR_NAME = 'dactylo-divider-block' as const
/** Divider separator attribute name. */
export const DIVIDER_SEPARATOR_ATTR_NAME = 'dactylo-divider-separator' as const

/** {@link HeadingBlock} attribute name. */
export const HEADING_BLOCK_ATTR_NAME = 'dactylo-heading-block' as const
/** Heading block level data name. */
export const HEADING_BLOCK_LEVEL_DATA_NAME =
  'data-dactylo-heading-block-level' as const

/** {@link BulletListItemBlock} attribute name. */
export const BULLET_LIST_ITEM_BLOCK_ATTR_NAME =
  'dactylo-bullet-list-item-block' as const
/** Bullet list item marker attribute name. */
export const BULLET_LIST_ITEM_MARKER_ATTR_NAME =
  'dactylo-bullet-list-item-marker' as const
/** Bullet list item marker dot attribute name. */
export const BULLET_LIST_ITEM_MARKER_DOT_ATTR_NAME =
  'dactylo-bullet-list-item-marker-dot' as const

/** {@link NumberedListItemBlock} attribute name. */
export const NUMBERED_LIST_ITEM_BLOCK_ATTR_NAME =
  'dactylo-numbered-list-item-block' as const
/** Numbered list item variant data name. */
export const NUMBERED_LIST_ITEM_VARIANT_DATA_NAME =
  'data-dactylo-numbered-list-item-variant' as const
/** Numbered list item marker attribute name. */
export const NUMBERED_LIST_ITEM_MARKER_ATTR_NAME =
  'dactylo-numbered-list-item-marker' as const
/** Numbered list item marker number attribute name. */
export const NUMBERED_LIST_ITEM_MARKER_INDEX_ATTR_NAME =
  'dactylo-numbered-list-item-marker-index' as const

/** {@link CheckboxListItemBlock} attribute name. */
export const CHECKBOX_LIST_ITEM_BLOCK_ATTR_NAME =
  'dactylo-checkbox-list-item-block' as const
export const CHECKBOX_LIST_ITEM_MARKER_ATTR_NAME =
  'dactylo-checkbox-list-item-marker' as const
/** {@link CheckboxListItemBlock} input attribute name. */
export const CHECKBOX_LIST_ITEM_MARKER_INPUT_ATTR_NAME =
  'dactylo-checkbox-list-item-marker-input' as const

/** {@link CheckboxListItemBlock} checked data name. */
export const CHECKBOX_LIST_ITEM_CHECKED_DATA_NAME =
  'data-dactylo-checkbox-list-item-checked' as const

/** {@link InlineNode} attribute name. */
export const NODE_ATTR_NAME = 'dactylo-node' as const
/** {@link InlineNode} ID data name. */
export const NODE_ID_DATA_NAME = 'data-dactylo-node-id' as const

/** {@link InlineNodeWithEditableText} empty data attribute name. */
export const EDITABLE_NODE_EMPTY_DATA_NAME =
  'data-dactylo-editable-node-empty' as const

/** {@link InlineNodeWithEditableText} marks data attributes names. */
export const EDITABLE_NODE_BOLD_MARK_DATA_NAME =
  'data-dactylo-bold-mark' as const
export const EDITABLE_NODE_ITALIC_MARK_DATA_NAME =
  'data-dactylo-italic-mark' as const
export const EDITABLE_NODE_STRIKETHROUGH_MARK_DATA_NAME =
  'data-dactylo-strikethrough-mark' as const
export const EDITABLE_NODE_UNDERLINE_MARK_DATA_NAME =
  'data-dactylo-underline-mark' as const
export const EDITABLE_NODE_CODE_MARK_DATA_NAME =
  'data-dactylo-code-mark' as const

/** Text node attribute name. */
export const TEXT_NODE_ATTR_NAME = 'dactylo-text-node' as const

/** Link node attribute name. */
export const LINK_NODE_ATTR_NAME = 'dactylo-link-node' as const
/** Link node clickable attribute name. */
export const LINK_NODE_CLICKABLE_ATTR_NAME =
  'data-dactylo-link-clickable' as const

/** Line break node attribute name. */
export const LINE_BREAK_NODE_ATTR_NAME = 'dactylo-line-break-node' as const

/** Mention node attribute name. */
export const MENTION_NODE_ATTR_NAME = 'dactylo-mention-node' as const

/** DOM paint space character. */
export const DOM_SPACE_UNICODE_CODEPOINT = '\u00A0' as const
/** DOM pain zero width space character. */
export const DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT = '\u200B' as const

/** Clipboard data type name. */
export const CLIPBOARD_DATA_TYPE_NAME = 'application/x-dactylo-data' as const

/** URL scheme prefix pattern. */
export const URL_SCHEME_PREFIX_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u

/** Markdown link pattern. */
export const MARKDOWN_LINK_PATTERN =
  /(?<link>\[(?<text>(?:\[[^\]]*\]|[^[\]])*)\]\([ \t]*<?(?<url>(?:\([^)]*\)|[^()\s])*?)>?[ \t]*(?:(?<quote>['"])(?<title>.*?)\k<quote>[ \t]*)?\))/u

/** Plain text lines split pattern. */
export const PLAIN_TEXT_LINES_SPLIT_PATTERN = /\r?\n/u

/** Plain text link pattern. */
export const PLAIN_TEXT_LINK_PATTERN =
  /(?:https?:\/\/(?:www\.)?localhost(?::\d{1,5})?(?:\/[-a-zA-Z0-9().@:%_+~#?&//=]*)?|localhost(?::\d{1,5})?(?:\/[-a-zA-Z0-9().@:%_+~#?&//=]*)?|(?:https?:\/\/(?:www\.)?|www\.)[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9().@:%_+~#?&//=]*|(?<![\w@])[-a-zA-Z0-9]{1,256}\.[a-zA-Z0-9()]{2,6}\b[-a-zA-Z0-9().@:%_+~#?&//=]*)/iu

/**
 * Character to use to trigger:
 *  - autolink detection
 *  - markdown shortcut detection
 **/
export const INLINE_DETECTOR_TRIGGER_CHARACTER = ' ' as const

/**
 * ATX markdown heading with trigger space pattern.
 * Matched after the user types {@link INLINE_DETECTOR_TRIGGER_CHARACTER}.
 *
 * @example
 * ```txt
 * User type: #<space>
 * Node text: "# "
 * ```
 */
export const ATX_MARKDOWN_HEADING_WITH_TRIGGER_SPACE_PATTERN =
  /^(?<level>#{1,6}) $/u

/**
 * Bullet list item markdown shortcut with trigger pattern.
 * Matched after the user types {@link INLINE_DETECTOR_TRIGGER_CHARACTER}.
 * Exactly one hyphen so `---` still matches the horizontal-rule shortcut.
 *
 * @example
 * ```txt
 * User type: -<space>
 * Node text: "- "
 * ```
 */
export const BULLET_LIST_ITEM_MARKDOWN_SHORTCUT_WITH_TRIGGER_PATTERN = /^- $/u

/**
 * Numbered list item markdown shortcut with trigger pattern.
 * Matched after the user types {@link INLINE_DETECTOR_TRIGGER_CHARACTER}.
 *
 * Digits (`1. `), a single letter (`a. `), or a roman numeral (`ii. `).
 *
 * @example
 * ```txt
 * User type: 2.<space>
 * Node text: "2. "
 * ```
 */
export const NUMBERED_LIST_ITEM_MARKDOWN_SHORTCUT_WITH_TRIGGER_PATTERN =
  /^(?:\d+|[a-z]+)\. $/u

/**
 * Captures the token before `. ` in a numbered-list markdown shortcut
 * (`2. ` → `2`, `ii. ` → `ii`).
 */
export const NUMBERED_LIST_ITEM_MARKDOWN_SHORTCUT_TOKEN_PATTERN =
  /^(?<token>.+)\. $/u

/**
 * Quote block markdown shortcut with trigger pattern.
 * Matched after the user types {@link INLINE_DETECTOR_TRIGGER_CHARACTER}.
 *
 * @example
 * ```txt
 * User type: ><space>
 * Node text: "> "
 * ```
 */
export const QUOTE_BLOCK_MARKDOWN_SHORTCUT_WITH_TRIGGER_PATTERN = /^> $/u

/**
 * Checkbox list item markdown shortcut with trigger pattern.
 * Matched after the user types {@link INLINE_DETECTOR_TRIGGER_CHARACTER}.
 *
 * Empty `[]` is unchecked; `[x]` / `[X]` is checked.
 *
 * @example
 * ```txt
 * User type: []<space>
 * Node text: "[] "
 * User type: [x]<space>
 * Node text: "[x] "
 * User type: [X]<space>
 * Node text: "[X] "
 * ```
 */
export const CHECKBOX_LIST_ITEM_MARKDOWN_SHORTCUT_WITH_TRIGGER_PATTERN =
  /^\[(?<marker>x|X)?\] $/u

/**
 * Horizontal rule markdown shortcut with trigger pattern.
 * Matched after the user types {@link INLINE_DETECTOR_TRIGGER_CHARACTER}.
 *
 * @example
 * ```txt
 * User type: ----<space>
 * Node text: "---- "
 * ```
 */
export const HORIZONTAL_RULE_MARKDOWN_SHORTCUT_WITH_TRIGGER_PATTERN =
  /^(?<separator>-{3,}) $/u

/**
 * Bold markdown shortcut with closing delimiter typed.
 * Trailing CommonMark delimiter run of exactly `**` (not part of `***`).
 * Interior cannot include `*` or start/end with whitespace.
 *
 * @example
 * ```txt
 * User types: * (second closing asterisk)
 * Node text: "**hello**"           ✓ (whole node)
 * Node text: "Hello **world**"     ✓ (space before opening delimiter)
 * Node text: "Hello**world**"      ✗ (no boundary before `**`)
 * Node text: "***hello**"          ✗ (opening run is longer than `**`)
 * ```
 */
export const BOLD_MARKDOWN_ASTERISK_SHORTCUT_PATTERN =
  /(?<![*])\*\*(?<word>[^*\s](?:[^*]*[^*\s])?)\*\*$/u

/**
 * Bold markdown shortcut with closing delimiter typed.
 * Trailing CommonMark delimiter run of exactly `__` (not part of `___`).
 *
 * @example
 * ```txt
 * Node text: "__hello__"           ✓
 * Node text: "Hello __world__"     ✓
 * Node text: "Hello__world__"      ✗
 * Node text: "___hello__"          ✗
 * ```
 */
export const BOLD_MARKDOWN_UNDERSCORE_SHORTCUT_PATTERN =
  /(?<![_])__(?<word>[^_\s](?:[^_]*[^_\s])?)__$/u

/**
 * Italic markdown shortcut with closing delimiter typed.
 * Trailing CommonMark delimiter run of a single `*` — a leftover `*` from a
 * longer opening run (`**word*`) must stay literal, not become italic.
 *
 * @example
 * ```txt
 * Node text: "*hello*"             ✓
 * Node text: "Hello *world*"       ✓
 * Node text: "Hello*world*"        ✗ (no boundary before `*`)
 * Node text: "**hello*"            ✗ (opening run is `**`, not italic)
 * Node text: "*hello**"            ✗ (closing run is `**`, not italic)
 * ```
 */
export const ITALIC_MARKDOWN_ASTERISK_SHORTCUT_PATTERN =
  /(?<![*])\*(?<word>[^*\s](?:[^*]*[^*\s])?)\*$/u

/**
 * Italic markdown shortcut with closing delimiter typed.
 * Trailing CommonMark delimiter run of a single `_` — `__word_` stays literal.
 *
 * @example
 * ```txt
 * Node text: "_hello_"             ✓
 * Node text: "Hello _world_"       ✓
 * Node text: "Hello_world_"        ✗ (no boundary before `_`)
 * Node text: "__hello_"            ✗ (opening run is `__`, not italic)
 * Node text: "_hello__"            ✗ (closing run is `__`, not italic)
 * ```
 */
export const ITALIC_MARKDOWN_UNDERSCORE_SHORTCUT_PATTERN =
  /(?<![_])_(?<word>[^_\s](?:[^_]*[^_\s])?)_$/u

/** Allowed closing delimiters for bold markdown shortcut. */
export const MARKDOWN_BOLD_ITALIC_MARK_SHORTCUT_CLOSING_DELIMITERS = ['*', '_']

/**
 * Strikethrough markdown shortcut with closing delimiter typed.
 * Trailing CommonMark delimiter run of a single `~` — `~~word~` stays literal.
 *
 * @example
 * ```txt
 * Node text: "~~hello~~"           ✓
 * Node text: "Hello ~~world~~"     ✓
 * Node text: "Hello~world~"        ✗ (no boundary before `~`)
 * Node text: "~~hello~"            ✗ (opening run is `~~`, not strikethrough)
 * Node text: "~hello~~"            ✗ (closing run is `~~`, not strikethrough)
 * ```
 */
export const STRIKETHROUGH_MARKDOWN_TILDE_SHORTCUT_PATTERN =
  /(?<![_])~~(?<word>[^_\s](?:[^_]*[^_\s])?)~~$/u

/** Allowed closing delimiters for strikethrough markdown shortcut. */
export const MARKDOWN_STRIKETHROUGH_MARK_SHORTCUT_CLOSING_DELIMITERS = ['~']

/**
 * Inline code markdown shortcut with closing delimiter typed.
 * Trailing CommonMark delimiter run of a single `'` — `'word'` stays literal.
 *
 * @example
 * ```txt
 * Node text: "`hello`"             ✓
 * Node text: "Hello `world`"       ✓
 * Node text: "Hello`world`"        ✗ (no boundary before `'`)
 * Node text: "`hello'`"            ✗ (closing run is `'`, not inline code)
 * Node text: "`hello`'"            ✗ (opening run is `'`, not inline code)
 * ```
 */
export const MARKDOWN_INLINE_CODE_MARK_SHORTCUT_PATTERN =
  /(?<![_])`(?<word>[^_\s](?:[^_]*[^_\s])?)`$/u

/** Allowed closing delimiters for inline code markdown shortcut. */
export const MARKDOWN_INLINE_CODE_MARK_SHORTCUT_CLOSING_DELIMITERS = ['`']

/**
 * Markdown link shortcut with closing delimiter typed.
 * Trailing {@link MARKDOWN_LINK_PATTERN} immediately before the cursor.
 *
 * @example
 * ```txt
 * User types: )
 * Node text: "[Liveblocks](https://liveblocks.io)"        ✓ (whole node)
 * Node text: "Hello [Liveblocks](https://liveblocks.io)"  ✓ (space before `[`)
 * Node text: "Hello[Liveblocks](https://liveblocks.io)"   ✗ (no boundary before `[`)
 * Node text: "[](https://liveblocks.io)"                  ✗ (empty text)
 * Node text: "[Liveblocks]()"                             ✗ (empty url)
 * ```
 */
export const MARKDOWN_LINK_SHORTCUT_PATTERN = new RegExp(
  `${MARKDOWN_LINK_PATTERN.source}$`,
  'u',
)

/** Allowed closing delimiters for markdown link shortcut. */
export const MARKDOWN_LINK_SHORTCUT_CLOSING_DELIMITERS = [')']

/**
 * Character class for “safe” text before an opening mark delimiter when the
 * shortcut is not at the start of the node. A single ASCII/Unicode whitespace
 * satisfies CommonMark-style “left-flanking” typing UX (`Hello **there**`).
 */
export const MARKDOWN_MARK_SHORTCUT_REQUIRED_CHAR_BEFORE_OPEN_DELIMITER = /\s/u

/** Single-letter tokens that are roman, not alpha (`i.`, `v.`, `x.`). */
export const ROMAN_SINGLE_LETTER = new Set(['i', 'v', 'x'])

/** Lowercase roman numeral token (`i`, `iv`, `xii`). */
export const ROMAN_NUMERAL_TOKEN_PATTERN = /^[ivxlcdm]+$/u

/** Roman numeral table. */
export const ROMAN_TABLE = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
] as const
