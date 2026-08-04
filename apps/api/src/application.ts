import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  checkSwapRequestSchema,
  type EvidenceRef,
  type FailedRunResult,
  failedRunResultSchema,
  type RerunRejectionReason,
  type RunResult,
  runResultSchema,
} from "@parallax/contracts";
import {
  type RerunContext,
  resolveRerun,
} from "@parallax/orchestrator/application";
import { normalizeCheckSwapRequest } from "./normalization.js";
import type { AgentFlowPort } from "./ports.js";
import type { BackendRuntime } from "./runtime-config.js";
import type { CheckRunFailureCode, RunStore } from "./store.js";

export type CheckApiErrorCode =
  | "INVALID_REQUEST"
  | "NORMALIZATION_FAILED"
  | "INVALID_RERUN"
  | "AGENT_FLOW_ERROR"
  | "INVALID_AGENT_FLOW_RESPONSE"
  | "RUN_STORE_ERROR";

export type CheckApiError =
  | {
      code: "INVALID_RERUN";
      reason: RerunRejectionReason;
      message: string;
      issues?: unknown;
    }
  | {
      code: Exclude<CheckApiErrorCode, "INVALID_RERUN">;
      message: string;
      issues?: unknown;
    };

export type CheckApiErrorBody = {
  error: CheckApiError;
  run?: FailedRunResult;
};

export type CheckApplicationResponse =
  | { status: 200; body: RunResult }
  | { status: 400 | 500 | 502; body: CheckApiErrorBody };

export type CheckApplicationServiceDependencies = {
  runtime: BackendRuntime;
  store: RunStore;
  agentFlow: AgentFlowPort;
  createRunId?: () => string;
};

/** Backend-owned application boundary for POST /api/check. */
export class CheckApplicationService {
  private readonly createRunId: () => string;

  public constructor(
    private readonly dependencies: CheckApplicationServiceDependencies,
  ) {
    this.createRunId = dependencies.createRunId ?? randomUUID;
  }

  public async check(request: unknown): Promise<CheckApplicationResponse> {
    const parsedRequest = checkSwapRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      return errorResponse(400, {
        code: "INVALID_REQUEST",
        message: "The check request does not match the public API contract",
        issues: parsedRequest.error.issues,
      });
    }

    const normalized = normalizeCheckSwapRequest(
      parsedRequest.data,
      this.dependencies.runtime.tokenRegistry,
    );
    if (!normalized.success) {
      return errorResponse(400, {
        code: "NORMALIZATION_FAILED",
        message: "The check request could not be normalized",
        issues: normalized.error,
      });
    }

    const rerun = resolveRerun(
      parsedRequest.data.parentRunId,
      normalized.intent,
      this.dependencies.store,
    );
    if (!rerun.success) {
      return errorResponse(400, {
        code: "INVALID_RERUN",
        reason: rerun.reason,
        message: rerun.message,
      });
    }

    const childFields = childRunFields(rerun.context);

    const runId = this.createRunId();
    try {
      await this.dependencies.store.start(
        runId,
        normalized.intent,
        childFields?.parentRunId,
      );
    } catch {
      return storeErrorResponse();
    }

    let candidate: unknown;
    try {
      candidate = await this.dependencies.agentFlow.check({
        runId,
        intent: normalized.intent,
        moss: this.dependencies.runtime.config.moss,
      });
    } catch (error) {
      return this.recordFailure(
        runId,
        "AGENT_FLOW_ERROR",
        normalized.intent,
        childFields,
        {
          code: "AGENT_FLOW_ERROR",
          message: "Agent Flow could not complete the check",
        },
        error,
      );
    }

    const parsedResult = runResultSchema.safeParse(candidate);
    if (!parsedResult.success) {
      return this.recordFailure(
        runId,
        "INVALID_AGENT_FLOW_RESPONSE",
        normalized.intent,
        childFields,
        {
          code: "INVALID_AGENT_FLOW_RESPONSE",
          message: "Agent Flow returned an invalid RunResult",
        },
      );
    }

    const result = parsedResult.data;
    if (
      result.runId !== runId ||
      result.replayMode ||
      !isDeepStrictEqual(result.intent, normalized.intent) ||
      result.parentRunId !== undefined ||
      result.diff !== undefined
    ) {
      return this.recordFailure(
        runId,
        "INVALID_AGENT_FLOW_RESPONSE",
        normalized.intent,
        childFields,
        {
          code: "INVALID_AGENT_FLOW_RESPONSE",
          message:
            "Agent Flow returned a result for the wrong run ID, mode, or intent",
        },
      );
    }

    if (
      hasMismatchedAuthoritativeRuntime(
        result,
        this.dependencies.runtime.config.moss,
      )
    ) {
      return this.recordFailure(
        runId,
        "INVALID_AGENT_FLOW_RESPONSE",
        normalized.intent,
        childFields,
        {
          code: "INVALID_AGENT_FLOW_RESPONSE",
          message: "Agent Flow returned Evidence from a different Moss runtime",
        },
      );
    }

    const resultWithRerun = runResultSchema.parse({
      ...result,
      ...childFields,
    });

    try {
      await this.dependencies.store.complete(resultWithRerun);
    } catch {
      return storeErrorResponse();
    }

    return { status: 200, body: resultWithRerun };
  }

  private async recordFailure(
    runId: string,
    failure: CheckRunFailureCode,
    intent: Parameters<AgentFlowPort["check"]>[0]["intent"],
    childFields: ChildRunFields | undefined,
    apiError: CheckApiErrorBody["error"],
    cause?: unknown,
  ): Promise<CheckApplicationResponse> {
    const result = createIntegrationErrorResult(
      runId,
      intent,
      failure,
      childFields,
      cause,
    );
    try {
      await this.dependencies.store.fail(runId, failure, result);
    } catch {
      return storeErrorResponse();
    }

    return {
      status: 502,
      body: { error: apiError, run: result },
    };
  }
}

type ChildRunFields = {
  parentRunId: string;
  diff: Extract<RerunContext, { kind: "child" }>["diff"];
};

function childRunFields(context: RerunContext): ChildRunFields | undefined {
  return context.kind === "child"
    ? { parentRunId: context.parentRunId, diff: context.diff }
    : undefined;
}

function createIntegrationErrorResult(
  runId: string,
  intent: Parameters<AgentFlowPort["check"]>[0]["intent"],
  failure: CheckRunFailureCode,
  childFields: ChildRunFields | undefined,
  cause?: unknown,
): FailedRunResult {
  return failedRunResultSchema.parse({
    runId,
    replayMode: false,
    intent,
    ...(childFields ?? {}),
    status: "integration_error",
    systemStatus: "INTEGRATION_ERROR",
    verdict: "UNKNOWN",
    summary: "The check could not be completed",
    error: integrationErrorForFailure(failure, cause),
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
}

type IntegrationError = FailedRunResult["error"];

function integrationErrorForFailure(
  failure: CheckRunFailureCode,
  cause: unknown,
): IntegrationError {
  if (failure === "INVALID_AGENT_FLOW_RESPONSE") {
    return {
      code: "INVALID_RESPONSE",
      stage: "unknown",
      message: "Agent Flow returned an invalid RunResult",
      retryable: false,
    };
  }

  const fields = asRecord(cause);
  const rawCode = stringField(fields, "code");
  const rawStatus = stringField(fields, "integrationStatus");
  const source = stringField(fields, "source");
  const stage = integrationErrorStage(stringField(fields, "stage"));

  if (rawCode === "TIMEOUT" || rawStatus === "TIMEOUT") {
    return {
      code: "TIMEOUT",
      stage,
      message: "Agent Flow timed out",
      retryable: true,
    };
  }

  if (
    rawCode === "RPC_UNAVAILABLE" ||
    (rawStatus === "UNAVAILABLE" && source === "rpc")
  ) {
    return {
      code: "RPC_UNAVAILABLE",
      stage,
      message: "The RPC dependency was unavailable",
      retryable: true,
    };
  }

  if (
    rawCode === "MOSS_UNAVAILABLE" ||
    (rawStatus === "UNAVAILABLE" && source === "moss")
  ) {
    return {
      code: "MOSS_UNAVAILABLE",
      stage,
      message: "The Moss runtime was unavailable",
      retryable: true,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    stage,
    message: "Agent Flow failed internally",
    retryable: false,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(
  value: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const candidate = value?.[field];
  return typeof candidate === "string" ? candidate : undefined;
}

function integrationErrorStage(
  value: string | undefined,
): IntegrationError["stage"] {
  switch (value?.toUpperCase()) {
    case "QUOTE":
      return "quote";
    case "ACTION":
      return "action";
    case "SIMULATE":
    case "SIMULATION":
      return "simulation";
    case "NORMALIZATION":
      return "normalization";
    default:
      return "unknown";
  }
}

/**
 * Checks the Evidence that can establish a live core outcome against the
 * immutable runtime identity used for this request. Action-only and
 * supplementary Evidence remain outside this boundary until their ownership
 * is explicitly settled.
 */
function hasMismatchedAuthoritativeRuntime(
  result: RunResult,
  runtime: BackendRuntime["config"]["moss"],
): boolean {
  const evidenceByKey = new Map(
    result.evidence.map((evidence) => [evidence.key, evidence]),
  );
  const authoritativeKeys = new Set<string>();

  const addReference = (reference: Pick<EvidenceRef, "key" | "source">) => {
    if (reference.source !== "external") {
      authoritativeKeys.add(reference.key);
    }
  };

  result.ruleResults.forEach((ruleResult) => {
    if (ruleResult.status === "PASS" || ruleResult.status === "FAIL") {
      ruleResult.evidenceRefs.forEach(addReference);
    }
  });

  if (
    result.status === "completed" &&
    result.route.availability === "available"
  ) {
    addReference(result.route.evidenceRef);
    result.route.inputEvidenceRefs?.forEach(addReference);
  }

  for (const key of authoritativeKeys) {
    const evidence = evidenceByKey.get(key);
    if (evidence?.kind === "simulated_token_out") {
      evidence.inputEvidenceRefs.forEach(addReference);
    }
  }

  return [...authoritativeKeys].some((key) => {
    const evidence = evidenceByKey.get(key);
    return (
      evidence === undefined ||
      evidence.runtimeVersion !== runtime.runtimeVersion ||
      evidence.runtimeRevision !== runtime.runtimeRevision
    );
  });
}

function storeErrorResponse(): CheckApplicationResponse {
  return errorResponse(500, {
    code: "RUN_STORE_ERROR",
    message: "The check run lifecycle could not be stored",
  });
}

function errorResponse(
  status: 400 | 500 | 502,
  error: CheckApiErrorBody["error"],
): CheckApplicationResponse {
  return { status, body: { error } };
}
