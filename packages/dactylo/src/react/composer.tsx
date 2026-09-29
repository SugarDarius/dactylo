import { useEffect, useSyncExternalStore } from 'react'

import type {
  Dactylo,
  DactyloCommandEvent,
  DactyloStaticConfig,
  DactyloToolEvent,
} from '../dactylo'
import type { BlockId } from '../internals/blocks'
import type { DocumentState } from '../internals/document'
import type { Selection } from '../internals/selection'
import type { TransactionSource } from '../internals/transaction'
import { COMPOSER_ROOT_NAME } from './internals/constants'
import { createSafeContext } from './internals/context'
import { useStableCallback, useStableValue } from './internals/hooks'

// --- Main Context ─────────────────────────────────────────--------

/** Main Dactylo context. */
export interface DactyloContext {
  /** The {@link Dactylo} editor instance. */
  editor: Dactylo
}

export const { Provider: DactyloProvider, useContext: useDactylo } =
  createSafeContext<DactyloContext>({
    errorMsg: `\`<${COMPOSER_ROOT_NAME} />\` is missing. Did you forget to wrap your component within it?`,
  })

// --- Editor ─────────────────────────────────────────--------------

/**
 * Returns the editor {@link DactyloStaticConfig}.
 *
 * @example
 * ```tsx
 * const config = useEditorConfig()
 * console.log(config)
 * ```
 */
export function useEditorConfig(): DactyloStaticConfig {
  const { editor } = useDactylo()
  const config = useStableValue(editor.config)

  return config
}

/**
 * Returns whether the editor is editable.
 *
 * @example
 * ```tsx
 * const canEdit = useCanEdit()
 * ```
 */
export function useCanEdit(): boolean {
  const { editor } = useDactylo()

  const subscribe = useStableCallback(
    editor.events.editable.subscribe.bind(editor),
  )
  const getSnapshot = useStableCallback(() => editor.canEdit())

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Returns a function to set the editor to editable or not.
 *
 * @example
 * ```tsx
 * const setEditable = useSetEditable()
 * setEditable(true)
 * setEditable(false, 'ai-agent')
 * ```
 */
export function useSetEditable() {
  const { editor } = useDactylo()
  return useStableCallback(
    (
      next: boolean,
      source?: Extract<TransactionSource, 'user' | 'ai-agent'>,
    ): void => {
      editor.setEditable(next, source)
    },
  )
}

// --- Document State ─────────────────────────────────────────------

/**
 * Returns the {@link DocumentState} from the {@link EditorContext}.
 *
 * @example
 * ```tsx
 * const state = useDocumentState()
 * console.log(state)
 * ```
 */
export function useDocumentState(): DocumentState {
  const { editor } = useDactylo()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() => {
    const { state } = editor.getContext()

    return state
  })

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// --- Selection ─────────────────────────────────────────-----------

/**
 * Returns the {@link Selection} or `null`from the {@link EditorContext}.
 *
 * @example
 * ```tsx
 * const selection = useSelection()
 * console.log(selection)
 * ```
 */
export function useSelection(): Selection | null {
  const { editor } = useDactylo()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() => {
    const { selection } = editor.getContext()

    return selection
  })

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Returns whether the block with the given ID is with
 * an active text cursor in it.
 *
 * @example
 * ```tsx
 * const withActiveCursor = useIsWithActiveCursor(blockId)
 * console.log(withActiveCursor)
 * ```
 */
export function useIsWithActiveCursor(blockId: BlockId): boolean {
  const { editor } = useDactylo()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() =>
    editor.selection.tools.isBlockWithActiveCursor(blockId),
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Returns whether the editor is focused.
 *
 * @example
 * ```tsx
 * const isFocused = useIsFocused()
 * console.log(isFocused)
 * ```
 */
export function useIsFocused(): boolean {
  const { editor } = useDactylo()

  const subscribe = useStableCallback(editor.subscribe.bind(editor))
  const getSnapshot = useStableCallback(() =>
    editor.selection.tools.isFocused(),
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// --- Commands ------─────────────────────────────────────────------

/**
 * Returns the selection focus command.
 *
 * @example
 * ```tsx
 * const { focus } = useSelectionCommands()
 *
 * useLayoutEffect(() => {
 *  focus()
 * }, [])
 * ```
 */
export function useSelectionCommands() {
  const { editor } = useDactylo()
  const focus = useStableCallback(
    (source?: Extract<TransactionSource, 'user' | 'ai-agent'>) =>
      editor.selection.commands.focus(source),
  )

  const blur = useStableCallback(
    (source?: Extract<TransactionSource, 'user' | 'ai-agent'>) =>
      editor.selection.commands.blur(source),
  )

  return { blur, focus } as const
}

// --- Listeners ------─────────────────────────────────────────-----

/**
 * Get informed when a tool is executed successfully or not.
 *
 * @example
 * ```tsx
 * useToolsListener(({ tool, status }) => {
 *   console.log(tool, status)
 * })
 * ```
 */
export function useToolsListener(
  listener: (event: DactyloToolEvent) => void,
): void {
  const { editor } = useDactylo()
  const stableListener = useStableCallback(listener)

  useEffect(
    () => editor.events.tools.subscribe(stableListener),
    [editor, stableListener],
  )
}

/**
 * Get informed when a command is executed successfully or not.
 *
 * @example
 * ```tsx
 * useCommandsListener(({ command, status }) => {
 *   console.log(command, status)
 * })
 * ```
 */
export function useCommandsListener(
  listener: (event: DactyloCommandEvent) => void,
): void {
  const { editor } = useDactylo()
  const stableListener = useStableCallback(listener)

  useEffect(
    () => editor.events.commands.subscribe(stableListener),
    [editor, stableListener],
  )
}
