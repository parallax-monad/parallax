import { createPostgresPool, PostgresRunStore } from "./postgres-run-store.js";
import { parseRunStoreEnvironment } from "./runtime-config.js";
import { InMemoryRunStore, type RunStore } from "./store.js";

export type CloseableRunStore = RunStore & {
  close(): Promise<void>;
};

/** Selects the configured backend without silently falling back on failure. */
export function createConfiguredRunStore(
  environment: unknown,
): CloseableRunStore {
  const config = parseRunStoreEnvironment(environment);
  if (config.RUN_STORE_BACKEND === "memory") {
    return new InMemoryRunStore();
  }

  if (config.DATABASE_URL === undefined) {
    throw new Error("DATABASE_URL is required when RUN_STORE_BACKEND=postgres");
  }

  return new PostgresRunStore({
    pool: createPostgresPool(config.DATABASE_URL),
    poolOwnership: "owned",
  });
}
