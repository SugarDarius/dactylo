# Dactylo

A headless, block-based rich-text markdown editor. The document is a list of blocks and inline nodes trees, and every edit — keyboard, UI, or an AI agent — goes through the same transactional pipeline.

Users write in a familiar editor. Underneath, Dactylo keeps a typed document you can query, mutate, undo, and render yourself. Just type™.

## How it works

- **Structured document.** Blocks (paragraph, heading, divider, …) and inline nodes (text, line break, link, mention). Marks such as bold and italic sit on text nodes.
- **Tools and commands.** Tools read the editor (`canUndo`, `isFocused`). Commands mutate it (`undo`, `toggle-mark`, `delete block`). Either can be attributed to `user` or `ai-agent` externally.
- **Headless.** Style the built-in React composer, or subscribe to context changes and render the document yourself.

### Core architecture

Every mutation goes through one **`TransactionPipeline`**. **`Dactylo`** is a thin facade: commands and keyboard handlers build operations, then dispatch a transaction. Subscribers see a full **`EditorContext`** snapshot (document, selection)—not document-only diffs.

```
┌──────────────────────────────────────────────────────────────┐
│                      EditorContext                           │
│     state (DocumentState)  │   selection                     │
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

## Performance

Performance is a design constraint: a keystroke patches one block, does not re-parse the document, and does not clone unrelated nodes.

Patterns the suite documents and enforces:

- **Structural sharing.** Updating one block clones the `Map` and sets that entry; other blocks keep the same object identity. `blockOrderById` is rebuilt only on insert, delete, or move.
- **Coalesced text nodes.** Continuous typing in a paragraph stays on one `TextNode` (until a mark boundary).
- **Fractional indexing.** Block insert is one `after()` / `between()` call; keys stay short under repeated append.
- **Operation-based history.** Undo stores ops and inverses, not document snapshots.

CPU targets:

- 10k `insert_text` ops via `applyOp` < 200ms
- 10k `after()` calls < 50ms
- 10k `between()` calls < 100ms

Memory budgets for a 10k-character document in 50 blocks (always on, 2× design ceilings):

- Blocks Map < 50 KB (design ~25 KB)
- Text content: 10 000 chars; UTF-16 payload < 24 KB
- Node overhead < 20 KB (design ~10 KB)
- History with 100 entries < 80 KB (design ~40 KB)

```sh
pnpm --filter @sugardarius/dactylo test        # unit + structural + local CPU gates
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

The same split exists on `editor.history`, `editor.marks`, `editor.blocks`, `editor.selection`, `editor.dom`, and `editor.composer`. `editor.events` reports commands, tools, errors, history, and applied or rejected transactions.

### React

```tsx
import { Composer, useHistory } from '@sugardarius/dactylo/react'

function Toolbar() {
  const { canUndo, canRedo, undo, redo } = useHistory()

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

`Composer.Root` owns the editor. `Composer.Editable` renders the blocks. Domain hooks (`useHistory`, `useBlocks`, `useMarks`, `useFocus`) flatten the core tools and commands split for React.

## Roadmap

👉🏻 The foreseen roadmap to bring live features that Dactylo needs to expose to developers.

- ✅ **Done** → Completed
- 🚧 **In Progress** → Under implementation
- 📆 **Planned** → Planned / considered for implementation

### Core (🚧 **In Progress**)

| Feature                                          | Status             | Description                                                                             |
| ------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------- |
| Transaction pipeline (validate · apply · invert) | ✅ **Done**        | Single path for keyboard, commands, and agents                                          |
| Operations Runtime, Builder, and Engine          | ✅ **Done**        | Builds operations for each blocks/inline nodes                                          |
| Blocks and inline nodes split & merge            | ✅ **Done**        | Built-in merge / and or split logic                                                     |
| History (undo / redo, typing coalescing)         | ✅ **Done**        | Build-in history                                                                        |
| Native keys for composing                        | 🚧 **In Progress** | Handling native composing keys like `Enter`, `shift+enter`, `backspace`, `ArrowLeft`, … |
| Context subscriptions                            | ✅ **Done**        | Subscribe and listen to context changes natively                                        |
| Command & tool events                            | ✅ **Done**        | Subscribe and listen to dactylo aspect changes natively                                 |
| Marks                                            | ✅ **Done**        | Apply marks in the editor (bold, code, italic, strikethrough,… )                        |
| Comment decorator                                | 🚧 **In Progress** | Apply decorator on InlineNode for adding comments                                       |
| Markdown inline shortcuts                        | 🚧 **In Progress** | Use Build-in markdown inline shortcuts for headings, divider, links, lists and marks    |
| Autolink detection                               | ✅ **Done**        | Automatically transform links from pastes into inline nodes (configurable)              |
| Mentions (`@…`)                                  | ✅ **Done**        | Enables build-in inline composition for inserting mentions (configurable)               |
| Command trigger (`/…`)                           | ✅ **Done**        | Enables build-in inline composition for triggering external commands (configurable)     |
| IME composition                                  | 🚧 **In Progress** | Build-in IME composition management                                                     |
| Clipboard (paste / cut / copy)                   | 🚧 **In Progress** | Clipboard events management                                                             |
| Browser native shortcuts                         | 🚧 **In Progress** | Shortcuts management like `mod+z`, `mod+a`                                              |
| Fractional index for blocks ordering             | ✅ **Done**        | Fast blocks ordering using a factional index                                            |
| Block / inline node metadata                     | ✅ **Done**        | Defines metadata on blocks and inline nodes for rendering and / or external operations  |
| Placeholders                                     | ✅ **Done**        | config for blocks' placeholders                                                         |
| Read-only mode                                   | ✅ **Done**        | Editor cannot be edited                                                                 |
| Locales                                          | 🚧 **In Progress** | Set the locales in the current language                                                 |
| Spellcheck config                                | 📆 **Planned**     | Enable or disable spellcheck                                                            |
| Nested blocks (parent / child)                   | 📆 **Planned**     | Manage nested blocks at level -1                                                        |
| Strings security                                 | ✅ **Done**        | Prevents scripting and injections when inserting text                                   |
| DOM sync                                         | ✅ **Done**        | Sync DOM selection with Dactylo Selection                                               |
| Dactylo owned errors                             | ✅ **Done**        | Exposes errors defined by Dactylo                                                       |
| Collaboration                                    | 📆 **Planned**     | Enables collaboration through external providers as adapters                            |
| Emojis inline trigger (`:…`)                     | 📆 **Planned**     | Enables inline composition for inserting emojis (configurable)                          |
| Hashtags (`#…`)                                  | 📆 **Planned**     | Enables built-in support for hashtags                                                   |

### Blocks (🚧 **In Progress**)

| Feature              | Status         | Description                                                                                                     |
| -------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| Paragraph            | ✅ **Done**    | Paragraph block with inline content                                                                             |
| Heading (levels 1–6) | ✅ **Done**    | Heading block with inline content                                                                               |
| Divider              | ✅ **Done**    | Block for UI rendering - no inline content                                                                      |
| Quote                | ✅ **Done**    | Quote block with inline content only (a variant of `ParagraphBlock` but with a left border )                    |
| Bullet list item     | ✅ **Done**    | Bullet list item block with inline content                                                                      |
| Numbered list item   | ✅ **Done**    | Numbered list item block with inline content with variants (lower or upper alpha, lower or upper roman)         |
| Checkbox list item   | ✅ **Done**    | Checkbox list item with block inline content                                                                    |
| Toggle list item     | 📆 **Planned** | Toggle list item block with inline content                                                                      |
| Code                 | 📆 **Planned** | Safe code block rendering code with simplified inline content                                                   |
| File                 | 📆 **Planned** | File block with no inline content for rendering files                                                           |
| Media                | 📆 **Planned** | Media block with no inline content for rendering images, videos or audios                                       |
| Web embed            | 📆 **Planned** | Web embed block with no inline content for rendering external web content like tweets, gist or any html content |
| Callout              | 📆 **Planned** | Callout parent block with icon + sub blocks                                                                     |
| Table                | 📆 **Planned** | Table block with inline content                                                                                 |
| Tabs                 | 📆 **Planned** | Tabs parent block with sub blocks inside                                                                        |
| 2 / 3 / 4 columns    | 📆 **Planned** | Columns parent block with sub blocks inside                                                                     |
| Slot                 | 📆 **Planned** | Hosting custom content and data owned by developer with no inline content                                       |

### Inline Nodes (🚧 **In Progress**)

| Feature       | Status         | Notes                                                                               |
| ------------- | -------------- | ----------------------------------------------------------------------------------- |
| TextNode      | ✅ **Done**    | Inline text with marks                                                              |
| LineBreakNode | ✅ **Done**    | Soft break using `shift+enter` keys                                                 |
| LinkNode      | ✅ **Done**    | Inline links with marks                                                             |
| MentionNode   | ✅ **Done**    | Inline mention containing artefact data                                             |
| HashtagNode   | 📆 **Planned** | Inline hashtag containing artefact data                                             |
| Isolation     | 📆 **Planned** | Apply node isolation for specific use case like UI rendering (background colors, …) |

### API (🚧 **In Progress**)

| Feature                      | Status             | Notes                                                                                           |
| ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| Events API                   | 🚧 **In Progress** | Observe events from document state, transaction pipeline, history, errors, and editor's aspects |
| Tools API                    | 🚧 **In Progress** | Exposes tools api to read document state                                                        |
| Commands API                 | 🚧 **In Progress** | Exposes commands api to mutate document state                                                   |
| Marks API                    | ✅ **Done**        | Apply marks on eligible inline nodes                                                            |
| Comments API                 | 🚧 **In Progress** | Reads and mutate comments data on comments decorator                                            |
| Document API                 | 🚧 **In Progress** | Init (with JSON ✅ or Markdown), replace, and reset document state                              |
| History API                  | ✅ **Done**        | Work with build-in history                                                                      |
| Composer API                 | 🚧 **In Progress** | Sends and reads composing events                                                                |
| Selection API                | 🚧 **In Progress** | Mutate and reads Dactylo's selection                                                            |
| DOM API                      | 🚧 **In Progress** | Sync browser DOM native selection with Dactylo's selection                                      |
| Blocks API                   | ✅ **Done**        | Mutate and reads blocks                                                                         |
| Inline nodes API             | 🚧 **In Progress** | Mutate and reads inline nodes                                                                   |
| Insert text API              | ✅ **Done**        | Insert text anywhere you can                                                                    |
| Metadata API                 | ✅ **Done**        | Mutate and reads blocks and inline nodes metadata (config for globals metadata)                 |
| Mentions API                 | 🚧 **In Progress** | Mutate and reads mentions as first-class citizen                                                |
| OnChange/OnSubmit API        | 🚧 **In Progress** | Callback when document state is changing for saving in databases                                |
| Export JSON and Markdown API | 📆 **Planned**     | Export document state as JSON and Markdown                                                      |
| Stats API                    | 📆 **Planned**     | Provides stats like total text length, # of blocks, # number of nodes, # of words & chars       |
| Batching transactions        | ✅ **Done**        | Supports for batching big number for transactions (Ai Agent use case)                           |
| Table of contents            | 📆 **Planned**     | Build-in table of content based on headings contained in the document                           |
| Find & Replace API           | 📆 **Planned**     | Build-in find and replace actions in the document                                               |

### React integration (🚧 **In Progress**)

| Feature    | Status             | Description                                            |
| ---------- | ------------------ | ------------------------------------------------------ |
| Primitives | 🚧 **In Progress** | Exposes React primitives for building a Dactylo editor |
| Hooks      | 🚧 **In Progress** | Exposes external hooks to work with Dactylo            |

### UI Libraries integration (📆 **Planned**)

| Feature                         | Status         | Description                                            |
| ------------------------------- | -------------- | ------------------------------------------------------ |
| Default CSS file                | 📆 **Planned** | Providing a default css file                           |
| Default Tailwind css file       | 📆 **Planned** | Providing a default tailwind css file                  |
| shadcn/ui like React components | 📆 **Planned** | Already made components distributed through a registry |

### DevTools extension (📆 **Planned**)

Chrome-based extension that integrates with Dactylo and local development environment.
Allowing inspect, visualize, and troubleshot.

| Feature   | Status         | Description                                                  |
| --------- | -------------- | ------------------------------------------------------------ |
| Inspect   | 📆 **Planned** | Inspect blocks and inline nodes                              |
| Highlight | 📆 **Planned** | Highlight transactions, context changes, and history changes |
| Search    | 📆 **Planned** | Search blocks and inline nodes                               |

| Potentially incoming with release of slot blocks

## License

[MIT](https://github.com/SugarDarius/dactylo/blob/main/LICENSE)

Made with ❤️ by [@SugarDarius](https://github.com/SugarDarius)
