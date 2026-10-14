import { CLIPBOARD_DATA_TYPE_NAME } from './constants'
import type { Relax } from './types'

/** Data type for plain text from the clipboard. */
export interface TextPlainData {
  readonly __type: 'text/plain'

  /** The plain text from the clipboard. */
  readonly text: string
}

/** Data type for HTML content from the clipboard. */
export interface TextHtmlData {
  readonly __type: 'text/html'

  /** The HTML content from the clipboard. */
  readonly content: string
}

export interface DactyloData {
  readonly __type: 'dactylo'

  /** The data from the clipboard. */
  // @todo: handle structured dactylo data
  readonly data: Record<string, unknown>
}

/** Discriminated union of all possible clipboard data types handled by {@link Dactylo}. */
export type TransferredData = Relax<TextPlainData | TextHtmlData | DactyloData>

/**
 * Reads payload from a data transfer object.
 * Returns `null` if the data transfer object is not available or not handled.
 */
export function readTransferredData(
  dataTransfer: DataTransfer | null,
): TransferredData | null {
  if (!dataTransfer) {
    return null
  }

  const { types } = dataTransfer
  if (types.includes('text/plain')) {
    return {
      __type: 'text/plain',
      text: dataTransfer.getData('text/plain'),
    }
  }

  if (types.includes('text/html')) {
    return {
      __type: 'text/html',
      content: dataTransfer.getData('text/html'),
    }
  }

  if (types.includes(CLIPBOARD_DATA_TYPE_NAME)) {
    return {
      __type: 'dactylo',
      // @todo: handle structured dactylo data
      data: JSON.parse(dataTransfer.getData(CLIPBOARD_DATA_TYPE_NAME)),
    }
  }

  return null
}
