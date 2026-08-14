import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  });

  beforeEach(async () => {
    if (pool === undefined) return;
    await pool.query("TRUNCATE TABLE check_runs RESTART IDENTITY CASCADE");
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
    await firstStore.start(runId, intent);
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
        status: "failed",
        failure: "AGENT_FLOW_ERROR",
      });
    } finally {
      await secondPool.end();
    }
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
