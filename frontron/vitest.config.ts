import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Windows CI의 fsync 기반 통합 테스트가 일시적인 디스크 부하에도 완료될 여유를 둔다.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 95,
        lines: 90,
      },
    },
  },
})
