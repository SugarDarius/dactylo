import { defineConfig } from 'tsup'

export default defineConfig({
  clean: true,
  entry: [
    /** main package entry point */
    'src/index.ts',
  ],
  format: ['esm', 'cjs'],
  minify: true,
  sourcemap: true,
  splitting: true,
})
