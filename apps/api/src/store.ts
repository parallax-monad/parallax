import { isDeepStrictEqual } from "node:util";
import type {
  FailedRunResult,
  NormalizedSwapIntent,
  RunResult,
} from "@parallax/contracts";

export type CheckRunFailureCode =
  | "UNSUPPORTED"
  | "AGENT_FLOW_ERROR"
  | "INVALID_AGENT_FLOW_RESPONSE";

export type CheckRunRecord =
  | {
      runId: string;
      intent: NormalizedSwapIntent;
      parentRunId?: string;
      status: "started";
    }
  | {
      runId: string;
      intent: NormalizedSwapIntent;
      parentRunId?: string;
      status: "failed";
      failure: CheckRunFailureCode;
      result: FailedRunResult;
    }
  | {
      runId: string;
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
  ): Promise<void>;
  complete(result: RunResult): Promise<void>;
  fail(
    runId: string,
    failure: CheckRunFailureCode,
    result: FailedRunResult,
  ): Promise<void>;
  get(runId: string): Promise<CheckRunRecord | undefined>;
}

/** Process-local placeholder; production persistence remains undecided. */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, CheckRunRecord>();

  public async start(
    runId: string,
    intent: NormalizedSwapIntent,
    parentRunId?: string,
  ): Promise<void> {
    if (this.runs.has(runId)) {
      throw new Error(`Run ${runId} already exists`);
    }

    this.runs.set(
      runId,
      clone({ runId, intent, parentRunId, status: "started" }),
    );
  }

  public async complete(result: RunResult): Promise<void> {
    const current = this.requireStarted(result.runId);
    if (result.parentRunId !== current.parentRunId) {
      throw new Error(`Run ${result.runId} parent does not match its start`);
    }

    this.runs.set(
      result.runId,
      clone({
        runId: result.runId,
        intent: current.intent,
        parentRunId: current.parentRunId,
        status: "completed",
        result,
      }),
    );
  }

  public async fail(
    runId: string,
    failure: CheckRunFailureCode,
    result: FailedRunResult,
  ): Promise<void> {
    const current = this.requireStarted(runId);
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
        intent: current.intent,
        parentRunId: current.parentRunId,
        status: "failed",
        failure,
        result,
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
