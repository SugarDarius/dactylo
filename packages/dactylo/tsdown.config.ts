import { defineConfig } from 'tsdown'

export default defineConfig({
  attw: true,
  clean: true,
  dts: true,
  entry: [
    /** main package entry point. */
    'src/index.ts',
    /** React entry point. */
    'src/react/index.ts',
  ],
  format: ['esm', 'cjs'],
  minify: true,
  outputOptions: {
    banner: '"use client";',
    comments: { legal: true },
  },
  platform: 'neutral',
  publint: true,
  sourcemap: true,
  target: false,
})
