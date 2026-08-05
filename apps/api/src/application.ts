import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  type ActionVerificationEvidence,
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
import { type AgentFlowPort, isUnsupportedAgentFlowError } from "./ports.js";
import type { BackendRuntime } from "./runtime-config.js";
import type { CheckRunFailureCode, RunStore } from "./store.js";

export type CheckApiErrorCode =
  | "INVALID_REQUEST"
  | "NORMALIZATION_FAILED"
  | "INVALID_RERUN"
  | "UNSUPPORTED"
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
        tokenInDecimals: tokenDecimals(
          this.dependencies.runtime,
          normalized.intent.tokenIn,
          normalized.intent.chainId,
        ),
        tokenOutDecimals: tokenDecimals(
          this.dependencies.runtime,
          normalized.intent.tokenOut,
          normalized.intent.chainId,
        ),
        moss: this.dependencies.runtime.config.moss,
      });
    } catch (error) {
      const unsupported = isUnsupportedAgentFlowError(error);
      return this.recordFailure(
        runId,
        unsupported ? "UNSUPPORTED" : "AGENT_FLOW_ERROR",
        normalized.intent,
        childFields,
        {
          code: unsupported ? "UNSUPPORTED" : "AGENT_FLOW_ERROR",
          message: unsupported
            ? "Live Agent Flow is not available in this runtime"
            : "Agent Flow could not complete the check",
        },
        error,
        partialRunResultFrom(error),
      );
    }

    let parsedResult = runResultSchema.safeParse(candidate);
    if (!parsedResult.success) {
      const failClosedCandidate = failClosedAdjustCandidate(candidate);
      if (failClosedCandidate !== undefined) {
        parsedResult = runResultSchema.safeParse(failClosedCandidate);
      }
    }
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
    const gatedResult = closeUnverifiedAdjust(
      resultWithRerun,
      this.dependencies.store,
    );

    try {
      await this.dependencies.store.complete(gatedResult);
    } catch {
      return storeErrorResponse();
    }

    return { status: 200, body: gatedResult };
  }

  private async recordFailure(
    runId: string,
    failure: CheckRunFailureCode,
    intent: Parameters<AgentFlowPort["check"]>[0]["intent"],
    childFields: ChildRunFields | undefined,
    apiError: CheckApiErrorBody["error"],
    cause?: unknown,
    partialRunResult?: FailedRunResult,
  ): Promise<CheckApplicationResponse> {
    const result =
      partialRunResult === undefined
        ? createIntegrationErrorResult(
            runId,
            intent,
            failure,
            childFields,
            cause,
          )
        : failedRunResultSchema.parse({
            ...partialRunResult,
            runId,
            intent,
            ...(childFields ?? {}),
          });
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

function tokenDecimals(
  runtime: BackendRuntime,
  asset: Parameters<BackendRuntime["tokenRegistry"]["resolve"]>[1],
  chainId: number,
): number {
  const metadata = runtime.tokenRegistry.resolve(chainId, asset);
  if (metadata === undefined) {
    throw new Error("Normalized Intent token metadata is no longer available");
  }
  return metadata.decimals;
}

function partialRunResultFrom(error: unknown): FailedRunResult | undefined {
  const candidate = asRecord(error)?.partialRunResult;
  const parsed = failedRunResultSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function failClosedAdjustCandidate(candidate: unknown): unknown | undefined {
  const value = asRecord(candidate);
  if (
    value?.status !== "completed" ||
    value.verdict !== "ADJUST" ||
    !Array.isArray(value.recommendedActions) ||
    value.recommendedActions.length === 0 ||
    !value.recommendedActions.every(isTransactionAdjustmentCandidate)
  ) {
    return undefined;
  }

  return {
    ...value,
    verdict: "STOP",
    summary: "No verified child Run and Action Gate attestation is available",
    recommendedActions: [],
  };
}

function isTransactionAdjustmentCandidate(value: unknown): boolean {
  const action = asRecord(asRecord(value)?.action);
  return action?.kind === "TRANSACTION_ADJUSTMENT";
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
  if (failure === "UNSUPPORTED") {
    return {
      code: "UNSUPPORTED",
      stage: "unknown",
      message: "Live Agent Flow is not available in this runtime",
      retryable: false,
    };
  }

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
      ruleResult.actionEvaluations.forEach((evaluation) => {
        evaluation.evidenceRefs.forEach(addReference);
      });
    }
  });

  result.recommendedActions.forEach((evaluation) => {
    evaluation.evidenceRefs.forEach(addReference);
  });
  result.irrelevantActions.forEach((evaluation) => {
    evaluation.evidenceRefs.forEach(addReference);
  });
  if (result.status === "completed") {
    result.evidence.forEach((evidence) => {
      addReference(evidence);
    });
  }

  if (
    result.status === "completed" &&
    result.route.availability === "available"
  ) {
    addReference(result.route.evidenceRef);
    result.route.inputEvidenceRefs?.forEach(addReference);
  }

  if (
    result.status === "completed" &&
    !isBlockNumber(result.simulatorPinnedBlock)
  ) {
    return true;
  }

  const visited = new Set<string>();
  const visit = (key: string): boolean => {
    if (visited.has(key)) return false;
    visited.add(key);

    const evidence = evidenceByKey.get(key);
    if (
      evidence === undefined ||
      evidence.runtimeVersion !== runtime.runtimeVersion ||
      evidence.runtimeRevision !== runtime.runtimeRevision
    ) {
      return true;
    }

    if (
      result.status === "completed" &&
      evidence.source !== "external" &&
      evidence.simulatorPinnedBlock !== result.simulatorPinnedBlock
    ) {
      return true;
    }

    if (evidence.kind === "simulated_token_out") {
      return evidence.inputEvidenceRefs.some((reference) => {
        addReference(reference);
        return visit(reference.key);
      });
    }

    return false;
  };

  return [...authoritativeKeys].some((key) => visit(key));
}

function isBlockNumber(value: string | undefined): boolean {
  return /^\d+$/.test(value ?? "");
}

function closeUnverifiedAdjust(result: RunResult, store: RunStore): RunResult {
  if (
    result.status !== "completed" ||
    result.verdict !== "ADJUST" ||
    hasVerifiedActionGate(result, store)
  ) {
    return result;
  }

  return runResultSchema.parse({
    ...result,
    verdict: "STOP",
    summary: "No verified child Run and Action Gate attestation is available",
    recommendedActions: [],
  });
}

function hasVerifiedActionGate(
  result: Extract<RunResult, { status: "completed" }>,
  store: RunStore,
): boolean {
  if (result.recommendedActions.length === 0) return false;

  return result.recommendedActions.every((evaluation) => {
    if (
      evaluation.action.kind !== "TRANSACTION_ADJUSTMENT" ||
      evaluation.proposedChange === undefined
    ) {
      return false;
    }

    const field = evaluation.action.field;
    const attestation = result.evidence.find(
      (evidence): evidence is ActionVerificationEvidence =>
        evidence.kind === "action_verification" &&
        evidence.baselineRunId === result.runId &&
        evidence.verificationRunId !== result.runId &&
        evidence.field === field &&
        evidence.actionReasonCode === evaluation.actionReasonCode &&
        evidence.beforeValue === evaluation.proposedChange?.before &&
        evidence.afterValue === evaluation.proposedChange?.after &&
        evaluation.evidenceRefs.some(
          (reference) => reference.key === evidence.key,
        ),
    );
    if (attestation === undefined) return false;

    const childRecord = store.get(attestation.verificationRunId);
    if (
      childRecord?.status !== "completed" ||
      childRecord.result.status !== "completed" ||
      childRecord.result.parentRunId !== result.runId ||
      childRecord.result.replayMode ||
      childRecord.result.systemStatus !== "OK" ||
      childRecord.result.scope.some((item) => item.status === "unknown")
    ) {
      return false;
    }

    return ["P0-EVIDENCE-001", "P0-EXECUTION-001", "P0-ECONOMIC-001"].every(
      (ruleId) =>
        childRecord.result.ruleResults.some(
          (rule) => rule.ruleId === ruleId && rule.status === "PASS",
        ),
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
