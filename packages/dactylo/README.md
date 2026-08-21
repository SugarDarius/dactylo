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
  placeholder: 'Write something...',
})

editor.subscribe((ctx) => {
  render(ctx.state)
})
```

## License

This project is licensed under the [MIT License](https://choosealicense.com/licenses/mit/).
