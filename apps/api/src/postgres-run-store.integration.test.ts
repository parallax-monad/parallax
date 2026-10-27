import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { economicFailStopResult } from "@parallax/orchestrator/application/action-gate-fixtures";
import { runner } from "node-pg-migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accountStateSnapshotSchema } from "./account-state-model.js";
import { CAMELOT_V3_ROUTER_ADDRESS } from "./backend/camelot-v3-binding.js";
import {
  CAMELOT_SEPOLIA_USDC,
  CAMELOT_SEPOLIA_WETH,
} from "./backend/camelot-v3-protocol-adapter.js";
import { CAMELOT_V3_ALLOWANCE_SPENDER_QUALIFICATION_REF } from "./backend/camelot-v3-qualified-spender.js";
import { createBackendApp } from "./bootstrap/backend.js";
import type { AgentFlowCheckInput } from "./ports.js";
import { createPostgresPool, PostgresRunStore } from "./postgres-run-store.js";
import { bootstrapBackendRuntime } from "./runtime-config.js";
import { migratePostgres } from "./storage/migrations.js";
import { runStoreContract } from "./store.contract.js";
import { CHECK_RUN_FAILURE_CODES } from "./store.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
const integration = describe.skipIf(databaseUrl === undefined);
const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const legacyFailureCodes = [
  "UNSUPPORTED",
  "AGENT_FLOW_ERROR",
  "INVALID_AGENT_FLOW_RESPONSE",
] as const;

async function runMigrationsInSchema(
  schema: string,
  direction: "up" | "down",
  count?: number,
): Promise<void> {
  if (databaseUrl === undefined) {
    throw new Error(
      "DATABASE_URL is required for PostgreSQL integration tests",
    );
  }

  await runner({
    databaseUrl: {
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
    },
    dir: migrationsDirectory,
    direction,
    ...(count === undefined ? {} : { count }),
    migrationsTable: "pgmigrations",
    migrationsSchema: schema,
    schema,
    createSchema: true,
    createMigrationsSchema: true,
    advisoryLockMode: "wait",
    singleTransaction: true,
    verbose: false,
    log: () => undefined,
  });
}

async function getDatabaseFailureCodes(
  targetPool: ReturnType<typeof createPostgresPool>,
): Promise<string[]> {
  const constraints = await targetPool.query<{ definition: string }>(
    `
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'check_runs'::regclass
        AND conname = 'check_runs_failure_code_check'
    `,
  );
  if (constraints.rows.length !== 1) {
    throw new Error("expected exactly one check-run failure-code constraint");
  }
  const definition = constraints.rows[0]?.definition;
  if (definition === undefined) {
    throw new Error("missing failure-code constraint definition");
  }
  return [...definition.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

async function insertFailureCodeRow(
  targetPool: ReturnType<typeof createPostgresPool>,
  runId: string,
  failureCode: string,
): Promise<void> {
  await targetPool.query(
    `
      INSERT INTO check_runs (
        run_id,
        lifecycle_state,
        failure_code,
        intent,
        result
      )
      VALUES ($1, 'failed', $2, '{}'::jsonb, '{}'::jsonb)
    `,
    [runId, failureCode],
  );
}

function rememberRunIds(runIds: Set<string>, body: unknown): void {
  if (typeof body !== "object" || body === null) return;

  if ("parentRunId" in body && typeof body.parentRunId === "string") {
    runIds.add(body.parentRunId);
  }
  if ("runId" in body && typeof body.runId === "string") {
    runIds.add(body.runId);
  }
}

function assertTeardownSucceeded(
  results: readonly PromiseSettledResult<void>[],
): void {
  const errors = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "Failed to tear down fresh-app Run test resources",
    );
  }
}

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

  it("recovers a posted Check through a fresh API app and re-checks its persisted parent", async () => {
    if (databaseUrl === undefined) return;

    const tokenAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const sender = "0x1111111111111111111111111111111111111111";
    const runtime = bootstrapBackendRuntime({
      environment: {
        MONAD_RPC_URL: "https://rpc.example.test",
        MOSS_RUNTIME_VERSION: "fixture-runtime",
        MOSS_RUNTIME_REVISION: "fixture-revision",
      },
      tokenRegistry: {
        chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
        tokens: [
          {
            chainId: 143,
            address: tokenAddress,
            symbol: "USDC",
            decimals: 6,
            decimalsSource: "onchain_verified",
            verifiedAtBlock: "90000000",
          },
        ],
      },
    });
    const requestBody = {
      chainId: 143,
      protocol: "kuru",
      sender,
      tokenIn: { kind: "native" },
      tokenOut: { kind: "erc20", address: tokenAddress },
      amountIn: "1.5",
      economicBoundary: {
        availability: "available",
        minimumReceived: "0.02",
        source: "user_declared",
      },
    };
    const createAgentFlow = (calls: { count: number }) => ({
      async check(input: AgentFlowCheckInput): Promise<unknown> {
        calls.count += 1;
        if (
          input.intent.tokenIn.kind !== "native" ||
          input.intent.tokenOut.kind !== "erc20"
        ) {
          throw new Error("Expected the fixed native-to-USDC test Intent");
        }
        return economicFailStopResult(
          {
            sender: input.intent.sender,
            mon: input.intent.tokenIn,
            usdc: input.intent.tokenOut,
            simulatorPinnedBlock: "42",
            runtimeVersion: runtime.config.moss.runtimeVersion,
            runtimeRevision: runtime.config.moss.runtimeRevision,
          },
          input.runId,
          input.intent,
        );
      },
    });

    let firstPool: ReturnType<typeof createPostgresPool> | undefined =
      createPostgresPool(databaseUrl);
    let secondPool: ReturnType<typeof createPostgresPool> | undefined;
    let firstApp: ReturnType<typeof createBackendApp> | undefined;
    let secondApp: ReturnType<typeof createBackendApp> | undefined;
    const createdRunIds = new Set<string>();
    try {
      const firstCalls = { count: 0 };
      const firstStore = new PostgresRunStore({
        pool: firstPool,
        poolOwnership: "borrowed",
      });
      firstApp = createBackendApp({
        runtime,
        store: firstStore,
        agentFlow: createAgentFlow(firstCalls),
      });
      const checkResponse = await firstApp.fetch(
        new Request("https://api.example.test/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requestBody),
        }),
      );
      const checkBody: unknown = await checkResponse.json();
      rememberRunIds(createdRunIds, checkBody);
      expect(checkResponse.status).toBe(200);
      const postedRun = checkBody as {
        runId: string;
        status: string;
        createdAt: string;
      };
      expect(postedRun.status).toBe("completed");
      expect(firstCalls.count).toBeGreaterThan(0);

      await firstApp.close();
      firstApp = undefined;
      await firstPool.end();
      firstPool = undefined;

      secondPool = createPostgresPool(databaseUrl);
      const secondCalls = { count: 0 };
      const secondStore = new PostgresRunStore({
        pool: secondPool,
        poolOwnership: "borrowed",
      });
      secondApp = createBackendApp({
        runtime,
        store: secondStore,
        agentFlow: createAgentFlow(secondCalls),
      });
      const getResponse = await secondApp.fetch(
        new Request(
          `https://api.example.test/api/runs/${encodeURIComponent(postedRun.runId)}`,
        ),
      );
      expect(getResponse.status).toBe(200);
      const recoveredRecord = (await getResponse.json()) as {
        runId: string;
        status: string;
        createdAt: string;
        result: unknown;
      };
      expect(recoveredRecord).toMatchObject({
        runId: postedRun.runId,
        status: "completed",
        createdAt: postedRun.createdAt,
      });
      expect(recoveredRecord.result).toEqual(postedRun);
      expect(secondCalls.count).toBe(0);

      const rerunResponse = await secondApp.fetch(
        new Request("https://api.example.test/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...requestBody,
            amountIn: "2",
            parentRunId: postedRun.runId,
          }),
        }),
      );
      const rerunBody: unknown = await rerunResponse.json();
      rememberRunIds(createdRunIds, rerunBody);
      expect(rerunResponse.status).toBe(200);
      const childRun = rerunBody as {
        runId: string;
        status: string;
        parentRunId?: string;
        diff?: {
          previousRunId: string;
          changedFields: readonly {
            field: string;
            before: string;
            after: string;
          }[];
        };
      };
      expect(childRun).toMatchObject({
        status: "completed",
        parentRunId: postedRun.runId,
        diff: {
          previousRunId: postedRun.runId,
          changedFields: [
            {
              field: "amountInAtomic",
              before: "1500000000000000000",
              after: "2000000000000000000",
            },
          ],
        },
      });
      expect(childRun.runId).not.toBe(postedRun.runId);
      const callsAfterRerun = secondCalls.count;
      expect(callsAfterRerun).toBeGreaterThan(0);

      const [parentReadAfterRerun, childRead] = await Promise.all([
        secondApp.fetch(
          new Request(
            `https://api.example.test/api/runs/${encodeURIComponent(postedRun.runId)}`,
          ),
        ),
        secondApp.fetch(
          new Request(
            `https://api.example.test/api/runs/${encodeURIComponent(childRun.runId)}`,
          ),
        ),
      ]);
      expect(parentReadAfterRerun.status).toBe(200);
      const parentRecordAfterRerun = (await parentReadAfterRerun.json()) as {
        result: unknown;
      };
      expect(parentRecordAfterRerun.result).toEqual(postedRun);
      expect(childRead.status).toBe(200);
      const childRecord = (await childRead.json()) as { result: unknown };
      expect(childRecord.result).toEqual(childRun);
      expect(secondCalls.count).toBe(callsAfterRerun);
    } finally {
      const appTeardown = await Promise.allSettled(
        [firstApp?.close(), secondApp?.close()].filter(
          (operation): operation is Promise<void> => operation !== undefined,
        ),
      );
      const poolTeardown = await Promise.allSettled(
        [firstPool?.end(), secondPool?.end()].filter(
          (operation): operation is Promise<void> => operation !== undefined,
        ),
      );
      try {
        if (createdRunIds.size > 0) {
          const cleanupPool = createPostgresPool(databaseUrl);
          try {
            // The schema has a RESTRICT self-reference; delete the child before its parent.
            for (const runId of [...createdRunIds].reverse()) {
              await cleanupPool.query(
                "DELETE FROM check_runs WHERE run_id = $1",
                [runId],
              );
            }
          } finally {
            await cleanupPool.end();
          }
        }
      } finally {
        assertTeardownSucceeded([...appTeardown, ...poolTeardown]);
      }
    }
  }, 30_000);

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

  it("persists the qualified spender in a reverse USDC to WETH snapshot", async () => {
    if (pool === undefined) return;
    const store = new PostgresRunStore({ pool, poolOwnership: "borrowed" });
    const sender = "0x01bb7b44cc398aaa2b76ac6253f0f5634279db9d";
    const recipient = "0x2222222222222222222222222222222222222222";
    const blockNumber = "313328152";
    const snapshot = accountStateSnapshotSchema.parse({
      snapshotId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status: "AVAILABLE",
      context: {
        chainId: 421614,
        protocol: "camelot-v3",
        sender,
        recipient,
        tokenIn: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
        tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_WETH },
        amountInAtomic: "1000000000000000",
      },
      block: {
        status: "VERIFIED",
        chainId: 421614,
        blockNumber,
        blockHash: `0x${"b".repeat(64)}`,
        observedAt: "2026-09-30T10:00:00.000Z",
      },
      balances: {
        inputToken: {
          account: sender,
          asset: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
          metadata: {
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified",
            verifiedAtBlock: "100",
          },
          explorerUrls: {},
          status: "AVAILABLE",
          amountAtomic: "2000000000000000",
        },
        outputToken: {
          account: recipient,
          asset: { kind: "erc20", address: CAMELOT_SEPOLIA_WETH },
          metadata: {
            symbol: "WETH",
            decimals: 18,
            decimalsSource: "onchain_verified",
            verifiedAtBlock: "100",
          },
          explorerUrls: {},
          status: "AVAILABLE",
          amountAtomic: "0",
        },
        native: {
          account: sender,
          asset: { kind: "native" },
          metadata: {
            symbol: "ETH",
            decimals: 18,
            decimalsSource: "chain_config",
          },
          explorerUrls: {},
          status: "AVAILABLE",
          amountAtomic: "1000000000000000000",
        },
      },
      allowance: {
        status: "SUFFICIENT",
        owner: sender,
        tokenAddress: CAMELOT_SEPOLIA_USDC,
        spender: {
          status: "QUALIFIED",
          address: CAMELOT_V3_ROUTER_ADDRESS,
          qualificationRef: CAMELOT_V3_ALLOWANCE_SPENDER_QUALIFICATION_REF,
        },
        requiredAmountAtomic: "1000000000000000",
        allowanceAtomic: "1000000000000000",
        blockNumber,
      },
    });

    await store.saveAccountState(snapshot);

    const restored = await store.getAccountState(snapshot.snapshotId);
    expect(restored).toEqual(snapshot);
    expect(restored?.allowance).toMatchObject({
      status: "SUFFICIENT",
      tokenAddress: CAMELOT_SEPOLIA_USDC,
      spender: {
        status: "QUALIFIED",
        address: CAMELOT_V3_ROUTER_ADDRESS,
        qualificationRef: CAMELOT_V3_ALLOWANCE_SPENDER_QUALIFICATION_REF,
      },
      requiredAmountAtomic: "1000000000000000",
      allowanceAtomic: "1000000000000000",
      blockNumber,
    });
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
    const databaseCodes = await getDatabaseFailureCodes(pool);
    expect(databaseCodes).toEqual([...CHECK_RUN_FAILURE_CODES]);
  });

  it("keeps fresh and upgraded schemas aligned without losing existing rows", async () => {
    if (pool === undefined || databaseUrl === undefined) return;

    const freshSchema = `failure_code_fresh_${randomUUID().replaceAll("-", "")}`;
    const upgradedSchema = `failure_code_upgrade_${randomUUID().replaceAll("-", "")}`;
    let freshPool: ReturnType<typeof createPostgresPool> | undefined;
    let upgradedPool: ReturnType<typeof createPostgresPool> | undefined;

    try {
      await runMigrationsInSchema(freshSchema, "up");
      freshPool = createPostgresPool(databaseUrl, {
        options: `-c search_path=${freshSchema}`,
      });
      expect(await getDatabaseFailureCodes(freshPool)).toEqual([
        ...CHECK_RUN_FAILURE_CODES,
      ]);
      for (const [index, code] of CHECK_RUN_FAILURE_CODES.entries()) {
        await insertFailureCodeRow(freshPool, `fresh-valid-${index}`, code);
      }
      await expect(
        insertFailureCodeRow(freshPool, "fresh-unknown", "UNKNOWN_FAILURE"),
      ).rejects.toMatchObject({ code: "23514" });

      await runMigrationsInSchema(upgradedSchema, "up", 1);
      upgradedPool = createPostgresPool(databaseUrl, {
        options: `-c search_path=${upgradedSchema}`,
      });
      await insertFailureCodeRow(
        upgradedPool,
        "preserved-before-upgrade",
        "AGENT_FLOW_ERROR",
      );

      await runMigrationsInSchema(upgradedSchema, "up");
      expect(await getDatabaseFailureCodes(upgradedPool)).toEqual([
        ...CHECK_RUN_FAILURE_CODES,
      ]);
      await expect(
        upgradedPool.query(
          `
            SELECT run_id, failure_code
            FROM check_runs
            WHERE run_id = 'preserved-before-upgrade'
          `,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            run_id: "preserved-before-upgrade",
            failure_code: "AGENT_FLOW_ERROR",
          },
        ],
      });
      for (const [index, code] of CHECK_RUN_FAILURE_CODES.entries()) {
        await insertFailureCodeRow(
          upgradedPool,
          `upgrade-valid-${index}`,
          code,
        );
      }
      await expect(
        insertFailureCodeRow(
          upgradedPool,
          "upgrade-unknown",
          "UNKNOWN_FAILURE",
        ),
      ).rejects.toMatchObject({ code: "23514" });

      await expect(
        runMigrationsInSchema(upgradedSchema, "down", 1),
      ).rejects.toThrow(
        "Cannot roll back failure-code constraint while newer failure codes are present",
      );
      expect(await getDatabaseFailureCodes(upgradedPool)).toEqual([
        ...CHECK_RUN_FAILURE_CODES,
      ]);

      await upgradedPool.query(
        `
          DELETE FROM check_runs
          WHERE failure_code IN ('SOURCE_MISMATCH', 'FORK_STATE_CHANGED')
        `,
      );
      await runMigrationsInSchema(upgradedSchema, "down", 1);
      expect(await getDatabaseFailureCodes(upgradedPool)).toEqual([
        ...legacyFailureCodes,
      ]);
      await expect(
        insertFailureCodeRow(
          upgradedPool,
          "rejected-after-down",
          "SOURCE_MISMATCH",
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        upgradedPool.query(
          `
            SELECT run_id, failure_code
            FROM check_runs
            WHERE run_id = 'preserved-before-upgrade'
          `,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            run_id: "preserved-before-upgrade",
            failure_code: "AGENT_FLOW_ERROR",
          },
        ],
      });

      await runMigrationsInSchema(upgradedSchema, "up", 1);
      expect(await getDatabaseFailureCodes(upgradedPool)).toEqual([
        ...CHECK_RUN_FAILURE_CODES,
      ]);
    } finally {
      await freshPool?.end();
      await upgradedPool?.end();
      await pool.query(`DROP SCHEMA IF EXISTS ${freshSchema} CASCADE`);
      await pool.query(`DROP SCHEMA IF EXISTS ${upgradedSchema} CASCADE`);
    }
  });
});
