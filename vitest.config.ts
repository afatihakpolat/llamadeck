import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/main/commandsSchema*.ts', 'src/main/schemas.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 }
    }
  }
})
