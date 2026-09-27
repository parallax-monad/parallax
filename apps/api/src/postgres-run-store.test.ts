import type { NormalizedSwapIntent } from "@parallax/contracts";
import { economicFailStopResult } from "@parallax/orchestrator/application/action-gate-fixtures";
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
  it("round-trips a completed Run through PostgreSQL storage", async () => {
    type StoredRow = {
      run_id: string;
      parent_run_id: string | null;
      lifecycle_state: "started" | "completed" | "failed";
      failure_code: string | null;
      intent: unknown;
      result: unknown;
      schema_version: number;
      started_at: string;
    };
    const rows = new Map<string, StoredRow>();
    const query = vi.fn(async (queryText: string, values: unknown[] = []) => {
      if (queryText.includes("INSERT INTO check_runs")) {
        const [runId, parentRunId, serializedIntent, schemaVersion, startedAt] =
          values;
        const row: StoredRow = {
          run_id: String(runId),
          parent_run_id: parentRunId === null ? null : String(parentRunId),
          lifecycle_state: "started",
          failure_code: null,
          intent: JSON.parse(String(serializedIntent)),
          result: null,
          schema_version: Number(schemaVersion),
          started_at: String(startedAt),
        };
        rows.set(row.run_id, row);
        return { rows: [], rowCount: 1 };
      }

      if (queryText.includes("UPDATE check_runs")) {
        const [runId, serializedResult] = values;
        const row = rows.get(String(runId));
        if (row === undefined || row.lifecycle_state !== "started") {
          return { rows: [], rowCount: 0 };
        }
        row.lifecycle_state = "completed";
        row.result = JSON.parse(String(serializedResult));
        return { rows: [], rowCount: 1 };
      }

      if (queryText.includes("SELECT")) {
        const row = rows.get(String(values[0]));
        return { rows: row === undefined ? [] : [row], rowCount: row ? 1 : 0 };
      }

      throw new Error(`Unexpected PostgreSQL query: ${queryText}`);
    });
    const pool = {
      query,
      end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as unknown as PostgresPool;
    const store = new PostgresRunStore({
      pool,
      poolOwnership: "borrowed",
    });
    const createdAt = "2026-09-27T12:00:00.000Z";
    const roundtripIntent: NormalizedSwapIntent = {
      ...intent,
      economicBoundary: {
        availability: "available",
        minimumReceivedAtomic: "20000",
        source: "user_declared",
      },
    };
    const result = economicFailStopResult(
      {
        sender: roundtripIntent.sender,
        mon: roundtripIntent.tokenIn as Extract<
          NormalizedSwapIntent["tokenIn"],
          { kind: "native" }
        >,
        usdc: roundtripIntent.tokenOut as Extract<
          NormalizedSwapIntent["tokenOut"],
          { kind: "erc20" }
        >,
        simulatorPinnedBlock: "42",
        runtimeVersion: "runtime",
        runtimeRevision: "revision",
      },
      "roundtrip-run",
      roundtripIntent,
    );

    await store.start("roundtrip-run", roundtripIntent, undefined, createdAt);
    await store.complete(result);

    const record = await store.get("roundtrip-run");

    expect(record).toMatchObject({
      runId: "roundtrip-run",
      createdAt,
      intent: roundtripIntent,
      status: "completed",
    });
    if (record?.status !== "completed") {
      throw new Error("expected a completed round-tripped Run");
    }
    expect(record.result).toEqual(
      JSON.parse(JSON.stringify({ ...result, createdAt })),
    );
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("reads an older completed row without fabricating basicSimulation", async () => {
    const legacyIntent: NormalizedSwapIntent = {
      ...intent,
      economicBoundary: {
        availability: "available",
        minimumReceivedAtomic: "20000",
        source: "user_declared",
      },
    };
    const result = economicFailStopResult(
      {
        sender: intent.sender,
        mon: intent.tokenIn as Extract<
          NormalizedSwapIntent["tokenIn"],
          { kind: "native" }
        >,
        usdc: intent.tokenOut as Extract<
          NormalizedSwapIntent["tokenOut"],
          { kind: "erc20" }
        >,
        simulatorPinnedBlock: "42",
        runtimeVersion: "legacy-runtime",
        runtimeRevision: "legacy-revision",
      },
      "legacy-run",
      legacyIntent,
    );
    const pool = {
      async query() {
        return {
          rows: [
            {
              run_id: "legacy-run",
              parent_run_id: null,
              lifecycle_state: "completed",
              failure_code: null,
              intent: legacyIntent,
              result,
              schema_version: 1,
              started_at: "2026-08-15T08:00:00.000Z",
            },
          ],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: [],
        };
      },
      end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as PostgresPool;
    const store = new PostgresRunStore({
      pool,
      poolOwnership: "borrowed",
    });

    const record = await store.get("legacy-run");

    expect(record).toMatchObject({
      runId: "legacy-run",
      status: "completed",
      result: {
        status: "completed",
        createdAt: "2026-08-15T08:00:00.000Z",
      },
    });
    expect(
      record?.status === "completed" ? record.result.p0 : undefined,
    ).toBeUndefined();
  });

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
              started_at: "2026-08-15T08:00:00.000Z",
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
