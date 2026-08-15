import { isDeepStrictEqual } from "node:util";
import type {
  FailedRunResult,
  NormalizedSwapIntent,
  RunResult,
} from "@parallax/contracts";

export const CHECK_RUN_FAILURE_CODES = [
  "UNSUPPORTED",
  "AGENT_FLOW_ERROR",
  "INVALID_AGENT_FLOW_RESPONSE",
] as const;

export type CheckRunFailureCode = (typeof CHECK_RUN_FAILURE_CODES)[number];

export type CheckRunRecord =
  | {
      runId: string;
      createdAt: string;
      intent: NormalizedSwapIntent;
      parentRunId?: string;
      status: "started";
    }
  | {
      runId: string;
      createdAt: string;
      intent: NormalizedSwapIntent;
      parentRunId?: string;
      status: "failed";
      failure: CheckRunFailureCode;
      result: FailedRunResult;
    }
  | {
      runId: string;
      createdAt: string;
      intent: NormalizedSwapIntent;
      parentRunId?: string;
      status: "completed";
      result: RunResult;
    };

export interface RunStore {
  start(
    runId: string,
    intent: NormalizedSwapIntent,
    parentRunId?: string,
    createdAt?: string,
  ): Promise<void>;
  complete(result: RunResult): Promise<void>;
  fail(
    runId: string,
    failure: CheckRunFailureCode,
    result: FailedRunResult,
  ): Promise<void>;
  get(runId: string): Promise<CheckRunRecord | undefined>;
}

/** Process-local backend for local/demo operation; PostgreSQL is configurable for production. */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, CheckRunRecord>();

  /** In-memory storage is ready as long as the process is running. */
  public checkReady(): Promise<void> {
    return Promise.resolve();
  }

  /** No-op disposer for the app-owned in-memory lifecycle. */
  public close(): Promise<void> {
    return Promise.resolve();
  }

  public async start(
    runId: string,
    intent: NormalizedSwapIntent,
    parentRunId?: string,
    createdAt?: string,
  ): Promise<void> {
    if (this.runs.has(runId)) {
      throw new Error(`Run ${runId} already exists`);
    }

    this.runs.set(
      runId,
      clone({
        runId,
        createdAt: createdAt ?? new Date().toISOString(),
        intent,
        parentRunId,
        status: "started",
      }),
    );
  }

  public async complete(result: RunResult): Promise<void> {
    const current = this.requireStarted(result.runId);
    const persistedResult = withCreatedAt(result, current.createdAt);
    if (result.parentRunId !== current.parentRunId) {
      throw new Error(`Run ${result.runId} parent does not match its start`);
    }

    this.runs.set(
      result.runId,
      clone({
        runId: result.runId,
        createdAt: current.createdAt,
        intent: current.intent,
        parentRunId: current.parentRunId,
        status: "completed",
        result: persistedResult,
      }),
    );
  }

  public async fail(
    runId: string,
    failure: CheckRunFailureCode,
    result: FailedRunResult,
  ): Promise<void> {
    const current = this.requireStarted(runId);
    const persistedResult = withCreatedAt(result, current.createdAt);
    if (
      result.runId !== runId ||
      result.parentRunId !== current.parentRunId ||
      !isDeepStrictEqual(result.intent, current.intent)
    ) {
      throw new Error(`Run ${runId} failure result does not match its start`);
    }

    this.runs.set(
      runId,
      clone({
        runId,
        createdAt: current.createdAt,
        intent: current.intent,
        parentRunId: current.parentRunId,
        status: "failed",
        failure,
        result: persistedResult,
      }),
    );
  }

  public async get(runId: string): Promise<CheckRunRecord | undefined> {
    const record = this.runs.get(runId);
    return record === undefined ? undefined : clone(record);
  }

  private requireStarted(
    runId: string,
  ): Extract<CheckRunRecord, { status: "started" }> {
    const record = this.runs.get(runId);
    if (record?.status !== "started") {
      throw new Error(`Run ${runId} is not in the started state`);
    }
    return record;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function withCreatedAt<T extends RunResult>(result: T, createdAt: string): T {
  if (result.createdAt === undefined) {
    return { ...result, createdAt };
  }
  if (result.createdAt !== createdAt) {
    throw new Error(`Run ${result.runId} createdAt does not match its start`);
  }
  return result;
}
