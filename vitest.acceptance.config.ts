import { defineConfig } from "vitest/config";

/**
 * Delivery-facing backend P0 acceptance gate.
 * See docs/integration/backend-p0-acceptance.md.
 */
export default defineConfig({
  test: {
    include: ["apps/api/src/p0-acceptance.test.ts"],
    passWithNoTests: false,
  },
});
