# Dactylo

A headless, block-based rich-text markdown editor. The document is a list of blocks and inline nodes trees, and every edit — keyboard, UI, or an AI agent — goes through the same transactional pipeline.

Users write in a familiar editor. Underneath, Dactylo keeps a typed document you can query, mutate, undo, and render yourself.

## How it works

- **Structured document.** Content lives in blocks (paragraph, heading, divider, …) and inline nodes (text, line break, link, mention). Marks such as bold and italic sit on text nodes.
- **Transactions.** An edit is a batch of operations. The pipeline validates the batch, applies it, then commits history and events. A rejected transaction leaves the document unchanged.
- **Tools and commands.** Tools read the editor (`canUndo`, `isFocused`). Commands mutates it (`undo`, `toggle-mark`, `delete block`). Either can be attributed to `user` or `ai-agent` externally.
- **Headless.** Style the built-in React composer, or subscribe to the editor changes and render the document yourself.

## Packages

| Import                       | What it is               |
| ---------------------------- | ------------------------ |
| `@sugardarius/dactylo`       | Editor runtime           |
| `@sugardarius/dactylo/react` | React composer and hooks |
| `@sugardarius/dactylo/dom`   | DOM helpers              |

React 19 is an optional peer dependency, required only for the React entry.

## Install

```sh
npm i @sugardarius/dactylo
```

## Usage

### Core

```ts
import { Dactylo } from '@sugardarius/dactylo'
import { render } from 'ui-library-of-my-choice'

const editor = new Dactylo({
  placeholder: 'Write something…',
})

const unsubscribe = editor.subscribe(({ state, selection }) => {
  render({
    /** The written content. */
    state,
    /** Where the user is editing. */
    selection,
  })
})

editor.marks.commands.toggle('bold')
editor.history.commands.undo()
```

`subscribe` fires after each context update. The snapshot holds the document (`state`), and the selection.

The same split exists on `editor.history`, `editor.marks`, `editor.blocks`, `editor.selection`, and `editor.composer`. `editor.events` reports commands, tools, errors, history, and applied or rejected transactions.

### React

```tsx
import {
  Composer,
  useHistoryCommands,
  useHistoryTools,
} from '@sugardarius/dactylo/react'

function Toolbar() {
  const { canUndo, canRedo } = useHistoryTools()
  const { undo, redo } = useHistoryCommands()

  return (
    <>
      <button type='button' disabled={!canUndo} onClick={undo}>
        Undo
      </button>
      <button type='button' disabled={!canRedo} onClick={redo}>
        Redo
      </button>
    </>
  )
}

export function Editor() {
  return (
    <Composer.Root placeholder='Write something…'>
      <Toolbar />
      <Composer.Editable autoFocus />
    </Composer.Root>
  )
}
```

`Composer.Root` owns the editor. `Composer.Editable` renders the blocks. Hooks mirror the core API: history, blocks, selection, the document, and listeners for commands and tools.

## License

[MIT](https://github.com/SugarDarius/dactylo/blob/main/LICENSE)
