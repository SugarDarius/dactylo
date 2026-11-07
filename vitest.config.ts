import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
    globals: true,
    projects: [
      'packages/*',
      {
        extends: true,
        test: {
          environment: 'happy-dom',
          include: ['tests/**/*.browser.test.{ts,tsx}'],
          name: { color: 'blue', label: 'dactylo/browser' },
        },
      },
      {
        extends: true,
        test: {
          environment: 'node',
          include: ['tests/**/*.perf.test.ts'],
          name: { color: 'green', label: 'dactylo/perf' },
        },
      },
    ],
  },
})
