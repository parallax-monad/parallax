import { describe, expect, it, vi } from "vitest";
import { type PostgresPool, PostgresRunStore } from "./postgres-run-store.js";

const intent = {
  chainId: 143,
  protocol: "kuru" as const,
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender" as const,
  tokenIn: { kind: "native" as const },
  tokenOut: {
    kind: "erc20" as const,
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  amountInAtomic: "1",
  economicBoundary: {
    availability: "unavailable" as const,
    source: "unavailable" as const,
  },
};

describe("PostgresRunStore persisted-record validation", () => {
  it("rejects a started row that contains terminal data", async () => {
    const end = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const pool = {
      async query() {
        return {
          rows: [
            {
              run_id: "malformed-run",
              parent_run_id: null,
              lifecycle_state: "started",
              failure_code: null,
              intent,
              result: { unexpected: true },
              schema_version: 1,
            },
          ],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: [],
        };
      },
      end,
    } as PostgresPool;
    const store = new PostgresRunStore({
      pool,
      poolOwnership: "borrowed",
    });

    await expect(store.get("malformed-run")).rejects.toThrow(
      "Started Run malformed-run contains terminal data",
    );
  });

  it("does not close a borrowed pool", async () => {
    const end = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const pool = {
      query: async () => ({
        rows: [],
        rowCount: 0,
        command: "SELECT",
        oid: 0,
        fields: [],
      }),
      end,
    } as PostgresPool;
    const store = new PostgresRunStore({
      pool,
      poolOwnership: "borrowed",
    });

    await store.close();

    expect(end).not.toHaveBeenCalled();
  });

  it("probes PostgreSQL readiness with a bounded SELECT 1 query", async () => {
    const query = vi.fn<PostgresPool["query"]>().mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: "SELECT",
      oid: 0,
      fields: [],
    });
    const pool = {
      query,
      end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as PostgresPool;
    const store = new PostgresRunStore({
      pool,
      poolOwnership: "borrowed",
    });

    await store.checkReady();

    expect(query).toHaveBeenCalledWith("SELECT 1");
  });

  it("propagates PostgreSQL readiness failures to the caller", async () => {
    const error = new Error("database unavailable");
    const pool = {
      query: vi.fn<PostgresPool["query"]>().mockRejectedValue(error),
      end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as PostgresPool;
    const store = new PostgresRunStore({
      pool,
      poolOwnership: "borrowed",
    });

    await expect(store.checkReady()).rejects.toBe(error);
  });
});
