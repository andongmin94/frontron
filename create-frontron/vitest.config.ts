import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 85,
        lines: 85,
      },
    },
  },
})
