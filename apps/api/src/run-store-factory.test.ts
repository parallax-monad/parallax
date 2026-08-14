import { describe, expect, it } from "vitest";
import { PostgresRunStore } from "./postgres-run-store.js";
import { createConfiguredRunStore } from "./run-store-factory.js";
import { InMemoryRunStore } from "./store.js";

describe("configured RunStore", () => {
  it("uses the process-local backend by default", () => {
    expect(createConfiguredRunStore({})).toBeInstanceOf(InMemoryRunStore);
  });

  it("selects PostgreSQL explicitly without falling back to memory", () => {
    expect(
      createConfiguredRunStore({
        RUN_STORE_BACKEND: "postgres",
        DATABASE_URL: "postgres://user:pass@localhost:5432/parallax",
      }),
    ).toBeInstanceOf(PostgresRunStore);
  });
});
