# Dactylo

A headless, block-based rich-text markdown editor. The document is a list of blocks and inline nodes trees, and every edit — keyboard, UI, or an AI agent — goes through the same transactional pipeline.

Users write in a familiar editor. Underneath, Dactylo keeps a typed document you can query, mutate, undo, and render yourself.

## How it works

- **Structured document.** Blocks (paragraph, heading, divider, …) and inline nodes (text, line break, link, mention). Marks such as bold and italic sit on text nodes.
- **Tools and commands.** Tools read the editor (`canUndo`, `isFocused`). Commands mutate it (`undo`, `toggle-mark`, `delete block`). Either can be attributed to `user` or `ai-agent` externally.
- **Headless.** Style the built-in React composer, or subscribe to context changes and render the document yourself.

### Core architecture

Every mutation goes through one **`TransactionPipeline`**. **`Dactylo`** is a thin facade: commands and keyboard handlers build operations, then dispatch a transaction. Subscribers see a full **`EditorContext`** snapshot (document, selection, active marks)—not document-only diffs.

```
┌──────────────────────────────────────────────────────────────┐
│                      EditorContext                           │
│  state (DocumentState)  │  selection  │  activeMarks         │
└──────────────────────────────────────────────────────────────┘
         ▲                           │
         │                           ▼
      applyOps                   validateOps
         │                           │
         └──── Operations Engine ---─┘
          (validate · apply · invert)
```

**Transaction lifecycle** (keyboard, toolbar, or agent—same path):

```
Command / key handler
        |
        ▼
Transaction { ops, policy? }  ──►  validateOps  ──► fail ──► reject (context unchanged)
        |                              |
        |                              ▼
        |                         applyOps  ──►  next EditorContext
        |                              |
        ▼                              ▼
commitEffects ◄──────────────── inverseOps (for history)
        |
        ├── HistoryStack.push (unless policy.pushToHistory === false)
        └── notify: context · history · transactionDidApply
```

**Pipeline delegates** (owned by the pipeline, not reimplemented in `Dactylo`):

| Delegate | Role |
| --- | --- |
| **OperationsEngine** | Turns intent into `Operation[]`, validates each op against the current context, applies them immutably, and produces **inverse** ops for undo. |
| **HistoryStack** | Stores forward + inverse op batches; **undo/redo** re-run `applyOps` with `pushToHistory: false`. Coalesces rapid typing into one undo step. |

End-to-end example (same shape as the in-code docs):

```
User presses "A"
       |
       ▼
EditorContext  ──►  buildKeyOps  ──►  [ insert_text, set_selection ]
       |                                      |
       ▼                                      ▼
TransactionPipeline  ──►  applyOps  ──►  new EditorContext
       |
       ▼
editor.getContext() / subscribe  ──►  UI re-renders blocks and caret
```

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
