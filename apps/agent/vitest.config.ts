import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/services/', 'src/agents/'],
      exclude: ['src/index.ts', 'src/test-agent.ts'],
    },
  },
})
