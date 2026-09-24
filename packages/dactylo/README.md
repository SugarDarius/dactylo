# Dactylo

A block-based rich-text markdown editor.

## Install

```sh
npm i @sugardarius/dactylo
```

## Usage

```tsx
import { Dactylo } from '@sugardarius/dactylo'

const editor = new Dactylo({
  placeholder: 'Write something…',
})

editor.subscribe((ctx) => {
  render(ctx.state)
})
```

```tsx
import { Composer } from '@sugardarius/dactylo/react'

export function Editor() {
  return (
    <Composer.Root placeholder='Write something…'>
      <Composer.Editable autoFocus />
    </Composer.Root>
  )
}
```

## License

This project is licensed under the [MIT License](https://choosealicense.com/licenses/mit/).
