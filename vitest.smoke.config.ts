import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/chain-smoke/kuru-live.ts"],
    passWithNoTests: false,
  },
});
