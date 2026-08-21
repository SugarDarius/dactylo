import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**'],
    globals: true,
    projects: [
      'packages/*',
      {
        extends: true,
        test: {
          environment: 'happy-dom',
          include: ['tests/**/*.browser.test.{ts,tsx}'],
          name: { label: 'dactylo/browser', color: 'blue' },
        },
      },
    ],
  },
})
