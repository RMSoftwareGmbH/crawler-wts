import { defineConfig } from "vitest/config";

export default defineConfig({
  root: process.cwd(),
  test: {
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
