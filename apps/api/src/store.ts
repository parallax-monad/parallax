import type { NormalizedSwapIntent, RunResult } from "@parallax/contracts";

export type CheckRunFailureCode =
  | "AGENT_FLOW_ERROR"
  | "INVALID_AGENT_FLOW_RESPONSE";

export type CheckRunRecord =
  | {
      runId: string;
      intent: NormalizedSwapIntent;
      status: "started";
    }
  | {
      runId: string;
      intent: NormalizedSwapIntent;
      status: "failed";
      failure: CheckRunFailureCode;
    }
  | {
      runId: string;
      intent: NormalizedSwapIntent;
      status: "completed";
      result: RunResult;
    };

export interface RunStore {
  start(runId: string, intent: NormalizedSwapIntent): Promise<void>;
  complete(result: RunResult): Promise<void>;
  fail(runId: string, failure: CheckRunFailureCode): Promise<void>;
}

/** Process-local placeholder; production persistence remains undecided. */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, CheckRunRecord>();

  public async start(
    runId: string,
    intent: NormalizedSwapIntent,
  ): Promise<void> {
    if (this.runs.has(runId)) {
      throw new Error(`Run ${runId} already exists`);
    }

    this.runs.set(runId, clone({ runId, intent, status: "started" }));
  }

  public async complete(result: RunResult): Promise<void> {
    const current = this.requireStarted(result.runId);
    this.runs.set(
      result.runId,
      clone({
        runId: result.runId,
        intent: current.intent,
        status: "completed",
        result,
      }),
    );
  }

  public async fail(
    runId: string,
    failure: CheckRunFailureCode,
  ): Promise<void> {
    const current = this.requireStarted(runId);
    this.runs.set(
      runId,
      clone({ runId, intent: current.intent, status: "failed", failure }),
    );
  }

  public get(runId: string): CheckRunRecord | undefined {
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
