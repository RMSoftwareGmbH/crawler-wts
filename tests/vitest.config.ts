import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: process.cwd(),
  test: {
    include: ['packages/connectors/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**']
  }
});
