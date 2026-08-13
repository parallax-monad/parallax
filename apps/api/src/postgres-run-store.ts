import { isDeepStrictEqual } from "node:util";
import {
  type FailedRunResult,
  failedRunResultSchema,
  type NormalizedSwapIntent,
  normalizedSwapIntentSchema,
  type RunResult,
  runIdSchema,
  runResultSchema,
} from "@parallax/contracts";
import {
  Pool,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { z } from "zod";
import {
  CHECK_RUN_FAILURE_CODES,
  type CheckRunFailureCode,
  type CheckRunRecord,
  type RunStore,
} from "./store.js";

export const POSTGRES_RUN_STORE_SCHEMA_VERSION = 1;

export const postgresPoolDefaults = {
  max: 5,
  connectionTimeoutMillis: 3_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 5_000,
  query_timeout: 5_000,
} as const satisfies Pick<
  PoolConfig,
  | "max"
  | "connectionTimeoutMillis"
  | "idleTimeoutMillis"
  | "statement_timeout"
  | "query_timeout"
>;

export type PostgresPool = {
  query<Row extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
};

export type PostgresRunStoreOptions = {
  pool: PostgresPool;
};

const failureCodeSchema = z.enum(CHECK_RUN_FAILURE_CODES);

const lifecycleStateSchema = z.enum(["started", "completed", "failed"]);

const rawCheckRunRowSchema = z
  .object({
    run_id: z.unknown(),
    parent_run_id: z.unknown(),
    lifecycle_state: z.unknown(),
    failure_code: z.unknown(),
    intent: z.unknown(),
    result: z.unknown(),
    schema_version: z.unknown(),
  })
  .passthrough();

type RawCheckRunRow = z.infer<typeof rawCheckRunRowSchema>;

/** PostgreSQL-backed RunStore with atomic terminal state transitions. */
export class PostgresRunStore implements RunStore {
  public constructor(private readonly options: PostgresRunStoreOptions) {}

  public async start(
    runId: string,
    intent: NormalizedSwapIntent,
    parentRunId?: string,
  ): Promise<void> {
    const parsedRunId = runIdSchema.parse(runId);
    const parsedIntent = normalizedSwapIntentSchema.parse(intent);
    const parsedParentRunId =
      parentRunId === undefined ? undefined : runIdSchema.parse(parentRunId);

    if (parsedParentRunId === parsedRunId) {
      throw new Error(`Run ${parsedRunId} cannot be its own parent`);
    }

    try {
      await this.options.pool.query(
        `
          INSERT INTO check_runs (
            run_id,
            parent_run_id,
            lifecycle_state,
            intent,
            schema_version
          )
          VALUES ($1, $2, 'started', $3::jsonb, $4)
        `,
        [
          parsedRunId,
          parsedParentRunId ?? null,
          JSON.stringify(parsedIntent),
          POSTGRES_RUN_STORE_SCHEMA_VERSION,
        ],
      );
    } catch (error) {
      if (isPgErrorCode(error, "23505")) {
        throw new Error(`Run ${parsedRunId} already exists`, { cause: error });
      }
      if (isPgErrorCode(error, "23503")) {
        throw new Error(`Run ${parsedRunId} parent does not exist`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  public async complete(result: RunResult): Promise<void> {
    const parsedResult = runResultSchema.parse(result);
    const current = await this.readStartedRecord(parsedResult.runId);

    if (parsedResult.parentRunId !== current.parentRunId) {
      throw new Error(
        `Run ${parsedResult.runId} parent does not match its start`,
      );
    }
    if (!isDeepStrictEqual(parsedResult.intent, current.intent)) {
      throw new Error(
        `Run ${parsedResult.runId} result does not match its start`,
      );
    }

    const updated = await this.options.pool.query(
      `
        UPDATE check_runs
        SET lifecycle_state = 'completed',
            failure_code = NULL,
            result = $2::jsonb,
            finished_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE run_id = $1
          AND lifecycle_state = 'started'
        RETURNING run_id
      `,
      [parsedResult.runId, JSON.stringify(parsedResult)],
    );

    if (updated.rowCount !== 1) {
      throw notStartedError(parsedResult.runId);
    }
  }

  public async fail(
    runId: string,
    failure: CheckRunFailureCode,
    result: FailedRunResult,
  ): Promise<void> {
    const parsedRunId = runIdSchema.parse(runId);
    const parsedFailure = failureCodeSchema.parse(failure);
    const parsedResult = failedRunResultSchema.parse(result);
    const current = await this.readStartedRecord(parsedRunId);

    if (
      parsedResult.runId !== parsedRunId ||
      parsedResult.parentRunId !== current.parentRunId ||
      !isDeepStrictEqual(parsedResult.intent, current.intent)
    ) {
      throw new Error(
        `Run ${parsedRunId} failure result does not match its start`,
      );
    }

    const updated = await this.options.pool.query(
      `
        UPDATE check_runs
        SET lifecycle_state = 'failed',
            failure_code = $2,
            result = $3::jsonb,
            finished_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE run_id = $1
          AND lifecycle_state = 'started'
        RETURNING run_id
      `,
      [parsedRunId, parsedFailure, JSON.stringify(parsedResult)],
    );

    if (updated.rowCount !== 1) {
      throw notStartedError(parsedRunId);
    }
  }

  public async get(runId: string): Promise<CheckRunRecord | undefined> {
    const parsedRunId = runIdSchema.parse(runId);
    const queryResult = await this.options.pool.query<RawCheckRunRow>(
      `
        SELECT
          run_id,
          parent_run_id,
          lifecycle_state,
          failure_code,
          intent,
          result,
          schema_version
        FROM check_runs
        WHERE run_id = $1
      `,
      [parsedRunId],
    );

    const row = queryResult.rows[0];
    return row === undefined ? undefined : deserializeCheckRun(row);
  }

  private async readStartedRecord(
    runId: string,
  ): Promise<Extract<CheckRunRecord, { status: "started" }>> {
    const record = await this.get(runId);
    if (record?.status !== "started") {
      throw notStartedError(runId);
    }
    return record;
  }
}

/** Creates a pool with bounded connection and query wait times. */
export function createPostgresPool(
  connectionString: string,
  overrides: Omit<PoolConfig, "connectionString"> = {},
): Pool {
  return new Pool({
    connectionString,
    ...postgresPoolDefaults,
    ...overrides,
  });
}

function deserializeCheckRun(row: RawCheckRunRow): CheckRunRecord {
  const parsedRow = rawCheckRunRowSchema.parse(row);
  const runId = runIdSchema.parse(parsedRow.run_id);
  const parentRunId = nullableRunId(parsedRow.parent_run_id);
  const intent = normalizedSwapIntentSchema.parse(parsedRow.intent);
  const lifecycleState = lifecycleStateSchema.parse(parsedRow.lifecycle_state);
  const schemaVersion = z.number().int().parse(parsedRow.schema_version);

  if (schemaVersion !== POSTGRES_RUN_STORE_SCHEMA_VERSION) {
    throw new Error(
      `Run ${runId} uses unsupported schema version ${schemaVersion}`,
    );
  }

  if (lifecycleState === "started") {
    if (parsedRow.result !== null || parsedRow.failure_code !== null) {
      throw new Error(`Started Run ${runId} contains terminal data`);
    }
    return {
      runId,
      intent,
      ...(parentRunId === undefined ? {} : { parentRunId }),
      status: "started",
    };
  }

  if (parsedRow.result === null) {
    throw new Error(`Terminal Run ${runId} is missing its result`);
  }

  if (lifecycleState === "completed") {
    if (parsedRow.failure_code !== null) {
      throw new Error(`Completed Run ${runId} contains a failure code`);
    }
    const result = normalizeStoredResult(
      runResultSchema.parse(parsedRow.result),
    );
    if (
      result.runId !== runId ||
      result.parentRunId !== parentRunId ||
      !isDeepStrictEqual(result.intent, intent)
    ) {
      throw new Error(
        `Completed Run ${runId} does not match its stored identity`,
      );
    }
    return {
      runId,
      intent,
      ...(parentRunId === undefined ? {} : { parentRunId }),
      status: "completed",
      result,
    };
  }

  const failure = failureCodeSchema.parse(parsedRow.failure_code);
  const result = normalizeStoredResult(
    failedRunResultSchema.parse(parsedRow.result),
  );
  if (
    result.runId !== runId ||
    result.parentRunId !== parentRunId ||
    !isDeepStrictEqual(result.intent, intent)
  ) {
    throw new Error(`Failed Run ${runId} does not match its stored identity`);
  }
  return {
    runId,
    intent,
    ...(parentRunId === undefined ? {} : { parentRunId }),
    status: "failed",
    failure,
    result,
  };
}

function normalizeStoredResult<T extends RunResult>(result: T): T {
  return result.parentRunId === undefined
    ? { ...result, parentRunId: undefined }
    : result;
}

function nullableRunId(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return runIdSchema.parse(value);
}

function notStartedError(runId: string): Error {
  return new Error(`Run ${runId} is not in the started state`);
}

function isPgErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
