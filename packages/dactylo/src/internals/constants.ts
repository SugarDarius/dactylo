/** Default placeholder text for empty paragraph block. */
export const DEFAULT_PARAGRAPH_PLACEHOLDER = 'Write something…'

/** Default placeholder text for the editor when no content is written. */
export const DEFAULT_HEADING_PLACEHOLDER = 'Heading'

/** Default mention character. */
export const DEFAULT_MENTION_CHARACTER = '@'

/** Default slash command character. */
export const DEFAULT_SLASH_COMMAND_CHARACTER = '/'

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

/** Default DOM attributes for HTML elements rendered by UI libraries and used for DOM operations. */
export const ROOT_ATTR_NAME = 'dactylo-root'
export const EDITABLE_ATTR_NAME = 'dactylo-editable'

export const BLOCKS_ATTR_NAME = 'dactylo-blocks'

export const BLOCK_ID_DATA_NAME = 'data-dactylo-block-id'
export const BLOCK_PLACEHOLDER_ATTR_NAME = 'dactylo-block-placeholder'
export const BLOCK_CONTENT_ATTR_NAME = 'dactylo-block-content'
export const BLOCK_CONTENT_EDITABLE_DATA_NAME =
  'data-dactylo-block-content-editable'

export const PARAGRAPH_BLOCK_ATTR_NAME = 'dactylo-paragraph-block'

export const NODE_ATTR_NAME = 'dactylo-node'
export const NODE_ID_DATA_NAME = 'data-dactylo-node-id'

export const TEXT_NODE_ATTR_NAME = 'dactylo-text-node'
export const LINE_BREAK_NODE_ATTR_NAME = 'dactylo-line-break-node'

/** DOM paint space character. */
export const DOM_SPACE_UNICODE_CODEPOINT = '\u00A0'
/** DOM pain zero width space character. */
export const DOM_ZERO_WIDTH_SPACE_UNICODE_CODEPOINT = '\u200B'
