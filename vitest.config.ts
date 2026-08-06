import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // The web app addresses its own modules through `@/`, so the root runner
    // needs the same alias Vite uses. Anchored to `@/` rather than `@` because
    // a bare `@` prefix-matches the `@parallax/*` workspace packages too.
    alias: [
      {
        find: /^@\//,
        replacement: `${path.resolve(rootDir, "apps/web/src")}/`,
      },
    ],
  },
  test: {
    passWithNoTests: false,
    exclude: ["**/node_modules/**", "**/.git/**", "**/*.integration.test.ts"],
  },
});
