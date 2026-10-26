import { defineConfig } from 'tsdown'

export default defineConfig({
  attw: true,
  clean: true,
  dts: true,
  entry: [
    /** Main package entry point. */
    'src/index.ts',
    /** React sub-module entry point. */
    'src/react/index.ts',
  ],
  format: ['esm', 'cjs'],
  minify: true,
  platform: 'neutral',
  publint: true,
  sourcemap: true,
  target: false,
})
