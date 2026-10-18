# Dactylo

A headless, block-based rich-text markdown editor. The document is a list of blocks and inline nodes trees, and every edit — keyboard, UI, or an AI agent — goes through the same transactional pipeline.

Users write in a familiar editor. Underneath, Dactylo keeps a typed document you can query, mutate, undo, and render yourself. Just type™.

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

| Delegate             | Role                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **OperationsEngine** | Turns intent into `Operation[]`, validates each op against the current context, applies them immutably, and produces **inverse** ops for undo. |
| **HistoryStack**     | Stores forward + inverse op batches; **undo/redo** re-run `applyOps` with `pushToHistory: false`. Coalesces rapid typing into one undo step.   |

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

const unsubscribe = editor.subscribe(({ state, selection, activeMarks }) => {
  render({
    /** The written content. */
    state,
    /** Where the user is editing. */
    selection,
    /** Which active marks are enabled. */
    activeMarks,
  })
})

editor.marks.commands.toggle('bold')
editor.history.commands.undo()
```

`subscribe` fires after each context update. The snapshot holds the document (`state`), and the selection.

The same split exists on `editor.history`, `editor.marks`, `editor.blocks`, `editor.selection`, `editor.dom`, and `editor.composer`. `editor.events` reports commands, tools, errors, history, and applied or rejected transactions.

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

## Roadmap

👉🏻 The foreseen roadmap to bring live features that Dactylo needs to exposes to developers.

- ✅ **Done** → Completed
- 🚧 **In Progress** → Under implementation
- 📆 **Planned** → Planned / considered for implementation

### Core

| Feature                                          | Status             | Description                                                                             |
| ------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------- |
| Transaction pipeline (validate · apply · invert) | 🚧 **In Progress** | Single path for keyboard, commands, and agents                                          |
| Operations Engine                                | 🚧 **In Progress** | Builds operations for each blocks/inline nodes                                          |
| Blocks and inline nodes split & merge            | 🚧 **In Progress** | Built-in merge / and or split logic                                                     |
| History (undo / redo, typing coalescing)         | ✅ **Done**        | Build-in history                                                                        |
| Native keys for composing                        | 🚧 **In Progress** | Handling native composing keys like `Enter`, `shift+enter`, `backspace`, `ArrowLeft`, … |
| Context subscriptions                            | ✅ **Done**        | Subscribe and listen to context changes natively                                        |
| Command & tool events                            | ✅ **Done**        | Subscribe and listen to dactylo aspect changes natively                                 |
| Marks                                            | 🚧 **In Progress** | Apply marks in the editor (bold, code, italic, strikethrough,… )                        |
| Markdown inline shortcuts                        | 🚧 **In Progress** | Use Build-in markdown inline shortcuts for headings, divider, links, lists and marks    |
| Autolink detection                               | 🚧 **In Progress** | Automatically transform links from pastes into inline nodes (configurable)              |
| Mentions (`@…`)                                  | 🚧 **In Progress** | Enables build-in inline composition for inserting mentions (configurable)               |
| Inline command trigger (`/…`)                    | 🚧 **In Progress** | Enables build-in inline composition for triggering external commands (configurable)     |
| IME composition                                  | 🚧 **In Progress** | Build-in IME composition management                                                     |
| Clipboard (paste / cut / copy)                   | 🚧 **In Progress** | Clipboard events management                                                             |
| Browser native shortcuts                         | 🚧 **In Progress** | Shortcuts management like `mod+z`, `mod+a`                                              |
| Fractional index for blocks ordering             | ✅ **Done**        | Fast blocks ordering using a factional index                                            |
| Block / inline node metadata                     | 🚧 **In Progress** | Defines metadata on blocks and inline nodes for rendering and / or external operations  |
| Placeholders                                     | 🚧 **In Progress** | config for blocks' placeholders                                                         |
| Locales                                          | 🚧 **In Progress** | Set the locales in the current language                                                 |
| Read-only mode                                   | ✅ **Done**        | Editor cannot be edited                                                                 |
| Nested blocks (parent / child)                   | 🚧 **In Progress** | Manage nested blocks at level -1                                                        |
| Strings security                                 | 🚧 **In Progress** | Prevents scripting and injections when inserting text                                   |
| DOM sync                                         | 🚧 **In Progress** | Sync DOM selection with Dactylo Selection                                               |
| Dactylo owned errors                             | 🚧 **In Progress** | Exposes errors defined by Dactylo                                                       |
| Collaboration                                    | 📆 **Planned**     | Enables collaboration through external providers                                        |
| Emojis inline trigger (`:…`)                     | 📆 **Planned**     | Enables inline composition for inserting emojis (configurable)                          |
| Hashtags (`#…`)                                  | 📆 **Planned**     | Enables built-in support for hashtags                                                   |

### Blocks

| Feature              | Status             | Description                                                                                                     |
| -------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Paragraph            | ✅ **Done**        | Paragraph block with inline content                                                                             |
| Heading (levels 1–6) | 🚧 **In Progress** | Heading block with inline content                                                                               |
| Divider              | 🚧 **In Progress** | Block for UI rendering - no inline content                                                                      |
| Bullet list item     | 📆 **Planned**     | Bullet list item block with inline content                                                                      |
| Numbered list item   | 📆 **Planned**     | Numbered list item block with inline content                                                                    |
| Todo list item       | 📆 **Planned**     | Todo list item with block inline content                                                                        |
| Toggle list item     | 📆 **Planned**     | Toggle list item block with inline content                                                                      |
| Callout              | 📆 **Planned**     | Callout block with icon + sub blocks                                                                            |
| Quote                | 📆 **Planned**     | Quote block with inline content only (maybe a sub-kind of ParagraphBlock?)                                      |
| Table                | 📆 **Planned**     | Table block with inline content                                                                                 |
| Code                 | 📆 **Planned**     | Safe code block rendering code with inline content                                                              |
| Media                | 📆 **Planned**     | Media block with no inline content for rendering images, videos or audios                                       |
| Web embed            | 📆 **Planned**     | Web embed block with no inline content for rendering external web content like tweets, gist or any html content |
| Tabs                 | 📆 **Planned**     | Tabs block with sub blocks inside                                                                               |
| 2 / 3 / 4 columns    | 📆 **Planned**     | Columns block with sub blocks inside                                                                            |
| Slot                 | 📆 **Planned**     | Hosting custom content owned by user with custom data inside and no online content                              |

### Inline Nodes

| Feature       | Status             | Notes                                                                                    |
| ------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| TextNode      | ✅ **Done**        | Inline text with marks                                                                   |
| LineBreakNode | ✅ **Done**        | Soft break using `shift+enter` keys                                                      |
| LinkNode      | 🚧 **In Progress** | Inline links with marks                                                                  |
| MentionNode   | 🚧 **In Progress** | Inline mention containing artefact data                                                  |
| HashtagNode   | 📆 **Planned**     | Inline hashtag containing artefact data                                                  |
| Isolation     | 📆 **Planned**     | Apply isolation for specific use case like UI rendering (commands, background colors, …) |

### API

| Feature                      | Status             | Notes                                                                                           |
| ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| Events API                   | 🚧 **In Progress** | Observe events from document state, transaction pipeline, history, errors, and editor's aspects |
| Tools API                    | 🚧 **In Progress** | Exposes tools api to read document state                                                        |
| Commands API                 | 🚧 **In Progress** | Exposes commands api to mutate document state                                                   |
| Marks API                    | 🚧 **In Progress** | Apply marks on eligible inline nodes                                                            |
| Document API                 | 🚧 **In Progress** | Init (with JSON or Markdown), replace, and reset document state                                 |
| History API                  | 🚧 **In Progress** | Work with build-in history                                                                      |
| Composer API                 | 🚧 **In Progress** | Sends and reads composing events                                                                |
| Selection API                | 🚧 **In Progress** | Mutate and reads Dactylo's selection                                                            |
| DOM API                      | 🚧 **In Progress** | Sync browser DOM native selection with Dactylo's selection                                      |
| Blocks API                   | 🚧 **In Progress** | Mutate and reads blocks                                                                         |
| Inline nodes API             | 🚧 **In Progress** | Mutate and reads inline nodes                                                                   |
| Mentions API                 | 📆 **Planned**     | Mutate and reads mentions as first-class citizen                                                |
| Export JSON and Markdown API | 📆 **Planned**     | Export document state as JSON and Markdown                                                      |
| Batching transactions        | 🚧 **In Progress** | Supports for batching big number for transactions (Ai Agent use case)                           |
| Table of contents            | 📆 **Planned**     | Build-in table of content based on headings contained in the document                           |

### React integration

| Feature    | Status             | Description                                            |
| ---------- | ------------------ | ------------------------------------------------------ |
| Primitives | 🚧 **In Progress** | Exposes React primitives for building a Dactylo editor |
| Hooks      | 🚧 **In Progress** | Exposes external hooks to work with Dactylo            |

## License

[MIT](https://github.com/SugarDarius/dactylo/blob/main/LICENSE)

Made with ❤️ by [@SugarDarius](https://github.com/SugarDarius)
