import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    exclude: ["**/node_modules/**", "**/.git/**", "**/*.integration.test.ts"],
  },
});
