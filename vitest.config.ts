import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    expect: { requireAssertions: true },
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // VS Code host glue is exercised by the real-editor smoke test.
      exclude: ['src/__tests__/**', 'src/extension.ts'],
      thresholds: {
        perFile: true,
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
})
