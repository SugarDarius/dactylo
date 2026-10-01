import { warnOnce } from './console'

/** Warns about history input type not handled. */
export function warnHistoryInputType(
  inputType: 'historyUndo' | 'historyRedo',
): void {
  warnOnce(
    `\`${inputType}\` input type is not handled Dactylo. Please use \`Dactylo.history.commands.${inputType === 'historyUndo' ? 'undo' : 'redo'}()\` instead.`,
  )
}
