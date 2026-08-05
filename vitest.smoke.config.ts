import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/chain-smoke/kuru-live.ts"],
    passWithNoTests: false,
    // Outer test-runner deadline. The adapter's internal stage (30s) and
    // whole-chain (90s) deadlines are deliberately shorter, so a timeout is
    // captured, logged, and persisted to .smoke-live before this fires.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
