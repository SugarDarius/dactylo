/** Default placeholder text for empty paragraph block. */
export const DEFAULT_PARAGRAPH_PLACEHOLDER = 'Write something…'

/** Default placeholder text for the editor when no content is written. */
export const DEFAULT_HEADING_PLACEHOLDER = 'Heading'

/** Default mentions enabled. */
export const DEFAULT_MENTIONS_ENABLED = true

/** Default mention character. */
export const DEFAULT_MENTION_CHARACTER = '@'

/** Default slash command enabled. */
export const DEFAULT_INLINE_COMMAND_TRIGGER_ENABLED = true

/** Default slash command character. */
export const DEFAULT_INLINE_COMMAND_TRIGGER_CHARACTER = '/'

/** Default autolink detection enabled. */
export const DEFAULT_AUTOLINK_ENABLED = true

/** Default max size for a batch of operations. */
export const DEFAULT_BATCH_MAX_SIZE = 512

/** Default max depth for the history stack. */
export const DEFAULT_HISTORY_STACK_MAX_DEPTH = 100

/** Default typing burst controller options. */
export const DEFAULT_TYPING_BURST_PAUSE_MS = 1000

/** Default exponential moving average (EMA) for latest inter-key interval (0-1). */
export const DEFAULT_EMA_ALPHA = 0.35

/** Default user inter-key internal (IKI) between commits at or below this (fast). */
export const DEFAULT_FAST_IKI_MS = 120

/** Default user inter-key internal (IKI) between commits above this (slow). */
export const DEFAULT_SLOW_IKI_MS = 400

/** Default maximum number of characters to type when in fast mode. */
export const DEFAULT_MAX_CHAR_WHEN_FAST = 20

/** Default maximum number of characters to type when in slow mode. */
export const DEFAULT_MAX_CHAR_WHEN_SLOW = 5

/** Default locales to use when handling text operations. */
export const DEFAULT_LOCALES = 'en-US'

/** Default DOM attributes for HTML elements rendered by UI libraries and used for DOM operations. */
export const ROOT_ATTR_NAME = 'dactylo-root'

/** Editable attribute name. */
export const EDITABLE_ATTR_NAME = 'dactylo-editable'

/** Blocks attribute name. */
export const BLOCKS_ATTR_NAME = 'dactylo-blocks'

/** Block attribute name. */
export const BLOCK_ATTR_NAME = 'dactylo-block'
/** Block ID data name. */
export const BLOCK_ID_DATA_NAME = 'data-dactylo-block-id'
/** Block placeholder attribute name. */
export const BLOCK_PLACEHOLDER_ATTR_NAME = 'dactylo-block-placeholder'
/** Block content attribute name. */
export const BLOCK_CONTENT_ATTR_NAME = 'dactylo-block-content'
/** Block content editable data name. */
export const BLOCK_CONTENT_EDITABLE_DATA_NAME =
  'data-dactylo-block-content-editable'

/** Paragraph block attribute name. */
export const PARAGRAPH_BLOCK_ATTR_NAME = 'dactylo-paragraph-block'

/** Node attribute name. */
export const NODE_ATTR_NAME = 'dactylo-node'
/** Node ID data name. */
export const NODE_ID_DATA_NAME = 'data-dactylo-node-id'

/** Editable node empty data attribute name. */
export const EDITABLE_NODE_EMPTY_DATA_NAME = 'data-dactylo-editable-node-empty'

/** Editable node marks data attributes names. */
export const EDITABLE_NODE_BOLD_MARK_DATA_NAME = 'data-dactylo-bold-mark'
export const EDITABLE_NODE_ITALIC_MARK_DATA_NAME = 'data-dactylo-italic-mark'
export const EDITABLE_NODE_STRIKETHROUGH_MARK_DATA_NAME =
  'data-dactylo-strikethrough-mark'
export const EDITABLE_NODE_UNDERLINE_MARK_DATA_NAME =
  'data-dactylo-underline-mark'
export const EDITABLE_NODE_CODE_MARK_DATA_NAME = 'data-dactylo-code-mark'

/** Text node attribute name. */
export const TEXT_NODE_ATTR_NAME = 'dactylo-text-node'
/** Link node attribute name. */
export const LINK_NODE_ATTR_NAME = 'dactylo-link-node'
/** Line break node attribute name. */
export const LINE_BREAK_NODE_ATTR_NAME = 'dactylo-line-break-node'

/** DOM paint space character. */
export const DOM_SPACE_UNICODE_CODEPOINT = '\u00A0'
/** DOM pain zero width space character. */
export const DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT = '\u200B'

/** Clipboard data type name. */
export const CLIPBOARD_DATA_TYPE_NAME = 'application/x-dactylo-data'

/** Markdown link pattern. */
export const MARKDOWN_LINK_PATTERN =
  /(?<link>\[(?<text>(?:\[[^\]]*\]|[^[\]])*)\]\([ \t]*<?(?<url>(?:\([^)]*\)|[^()\s])*?)>?[ \t]*(?:(?<quote>['"])(?<title>.*?)\k<quote>[ \t]*)?\))/u

/** Plain text lines split pattern. */
export const PLAIN_TEXT_LINES_SPLIT_PATTERN = /\r?\n/u

/** Plain text link pattern. */
export const PLAIN_TEXT_LINK_PATTERN =
  /(?:https?:\/\/(?:www\.)?localhost(?::\d{1,5})?(?:\/[-a-zA-Z0-9().@:%_+~#?&//=]*)?|localhost(?::\d{1,5})?(?:\/[-a-zA-Z0-9().@:%_+~#?&//=]*)?|(?:https?:\/\/(?:www\.)?|www\.)[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9().@:%_+~#?&//=]*)/iu

/**
 * Character to use to trigger:
 *  - autolink detection
 *  - link finished
 *  - markdown shortcut detection
 **/
export const INLINE_DETECTOR_TRIGGER_CHARACTER = ' '
