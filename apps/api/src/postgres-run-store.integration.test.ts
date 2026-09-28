import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accountStateSnapshotSchema } from "./account-state-model.js";
import { createPostgresPool, PostgresRunStore } from "./postgres-run-store.js";
import { migratePostgres } from "./storage/migrations.js";
import { runStoreContract } from "./store.contract.js";
import { CHECK_RUN_FAILURE_CODES } from "./store.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
const integration = describe.skipIf(databaseUrl === undefined);

integration("PostgresRunStore", () => {
  let pool: ReturnType<typeof createPostgresPool>;

  beforeAll(async () => {
    if (databaseUrl === undefined) return;
    await migratePostgres(databaseUrl);
    pool = createPostgresPool(databaseUrl);
    await pool.query("TRUNCATE TABLE check_runs RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE TABLE account_state_snapshots");
  });

  beforeEach(async () => {
    if (pool === undefined) return;
    await pool.query("TRUNCATE TABLE check_runs RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE TABLE account_state_snapshots");
  });

  afterAll(async () => {
    await pool?.end();
  });

  runStoreContract(
    "PostgresRunStore",
    () => new PostgresRunStore({ pool, poolOwnership: "borrowed" }),
    {
      skip: databaseUrl === undefined,
    },
  );

  it("retains a terminal Run after the pool is recreated", async () => {
    if (databaseUrl === undefined) return;
    const firstPool = createPostgresPool(databaseUrl);
    const firstStore = new PostgresRunStore({
      pool: firstPool,
      poolOwnership: "borrowed",
    });
    const runId = "restart-persistence-run";
    const createdAt = "2026-08-15T08:00:00.000Z";
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
    await firstStore.start(runId, intent, undefined, createdAt);
    await firstStore.fail(runId, "AGENT_FLOW_ERROR", {
      runId,
      replayMode: false,
      intent,
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "Agent Flow failed",
      error: {
        code: "MOSS_UNAVAILABLE",
        stage: "unknown",
        message: "Agent Flow failed",
        retryable: true,
      },
      ruleResults: [],
      recommendedActions: [],
      irrelevantActions: [],
      evidence: [],
      scope: [
        {
          key: "P0-CHECK-SIMULATION-001",
          label: "Moss simulation",
          status: "unknown",
          reason: "REQUIRED_CHECK_INTERRUPTED",
        },
      ],
    });
    await firstPool.end();

    const secondPool = createPostgresPool(databaseUrl);
    try {
      const secondStore = new PostgresRunStore({
        pool: secondPool,
        poolOwnership: "borrowed",
      });
      await expect(secondStore.get(runId)).resolves.toMatchObject({
        runId,
        createdAt,
        status: "failed",
        failure: "AGENT_FLOW_ERROR",
        result: { createdAt },
      });
    } finally {
      await secondPool.end();
    }
  });

  it("persists and round-trips block-bound account-state snapshots", async () => {
    if (pool === undefined) return;
    const store = new PostgresRunStore({ pool, poolOwnership: "borrowed" });
    const snapshot = accountStateSnapshotSchema.parse({
      snapshotId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "AVAILABLE",
      context: {
        chainId: 421614,
        protocol: "camelot-v3",
        sender: "0x1111111111111111111111111111111111111111",
        recipient: "0x1111111111111111111111111111111111111111",
        tokenIn: { kind: "native" },
        tokenOut: {
          kind: "erc20",
          address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        },
        amountInAtomic: "10000000000000000",
      },
      block: {
        status: "VERIFIED",
        chainId: 421614,
        blockNumber: "313328152",
        blockHash: `0x${"a".repeat(64)}`,
        observedAt: "2026-09-28T10:00:00.000Z",
      },
      balances: {
        inputToken: {
          account: "0x1111111111111111111111111111111111111111",
          asset: { kind: "native" },
          metadata: {
            symbol: "ETH",
            decimals: 18,
            decimalsSource: "chain_config",
          },
          explorerUrls: {},
          status: "AVAILABLE",
          amountAtomic: "0",
        },
        outputToken: {
          account: "0x1111111111111111111111111111111111111111",
          asset: {
            kind: "erc20",
            address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          },
          metadata: {
            symbol: "USDC",
            decimals: 6,
            decimalsSource: "onchain_verified",
            verifiedAtBlock: "100",
          },
          explorerUrls: {},
          status: "AVAILABLE",
          amountAtomic: "0",
        },
        native: {
          account: "0x1111111111111111111111111111111111111111",
          asset: { kind: "native" },
          metadata: {
            symbol: "ETH",
            decimals: 18,
            decimalsSource: "chain_config",
          },
          explorerUrls: {},
          status: "AVAILABLE",
          amountAtomic: "0",
        },
      },
      allowance: {
        status: "NOT_APPLICABLE",
        owner: "0x1111111111111111111111111111111111111111",
        spender: { status: "NOT_APPLICABLE" },
        reason: "NATIVE_INPUT",
        blockNumber: "313328152",
      },
    });

    await store.saveAccountState(snapshot);

    await expect(
      store.getAccountState("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
    ).resolves.toEqual(snapshot);
  });

  it("surfaces database errors instead of falling back to memory", async () => {
    if (databaseUrl === undefined) return;
    const failingPool = {
      query: async () => {
        throw new Error("database unavailable");
      },
      end: async () => undefined,
    };
    const store = new PostgresRunStore({
      pool: failingPool,
      poolOwnership: "borrowed",
    });

    await expect(store.get("database-error-run")).rejects.toThrow(
      "database unavailable",
    );
  });

  it("keeps the database failure-code constraint aligned with the code tuple", async () => {
    if (pool === undefined) return;

    const constraints = await pool.query<{ definition: string }>(
      `
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'check_runs'::regclass
          AND conname = 'check_runs_failure_code_check'
      `,
    );

    expect(constraints.rows).toHaveLength(1);
    const definition = constraints.rows[0]?.definition;
    if (definition === undefined)
      throw new Error("missing failure-code constraint");

    const databaseCodes = [...definition.matchAll(/'([^']+)'/g)].map(
      (match) => match[1],
    );
    expect(databaseCodes).toEqual([...CHECK_RUN_FAILURE_CODES]);
  });
});
