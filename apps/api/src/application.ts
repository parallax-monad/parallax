import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  checkSwapRequestSchema,
  completedRunResultSchema,
  type EvidenceRef,
  type FailedRunResult,
  failedRunResultSchema,
  type RerunRejectionReason,
  type RunResult,
  runResultSchema,
} from "@parallax/contracts";
import {
  actionGateVerificationRunIds,
  buildRunDiff,
  buildVerifiedAdjustBaseline,
  childRunPassesActionGate,
  closeUnverifiedAdjust,
  isActionGateCandidate,
  proposeAmountInAdjustment,
  type RerunContext,
  resolveRerun,
} from "@parallax/orchestrator/application";
import { normalizeCheckSwapRequest } from "./normalization.js";
import { type AgentFlowPort, isUnsupportedAgentFlowError } from "./ports.js";
import type { BackendRuntime } from "./runtime-config.js";
import type { CheckRunFailureCode, CheckRunRecord, RunStore } from "./store.js";
import { tokenDecimals } from "./token-decimals.js";

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

    let parentRecord: Awaited<ReturnType<RunStore["get"]>>;
    try {
      parentRecord =
        parsedRequest.data.parentRunId === undefined
          ? undefined
          : await this.dependencies.store.get(parsedRequest.data.parentRunId);
    } catch {
      return storeErrorResponse();
    }

    const rerun = resolveRerun(
      parsedRequest.data.parentRunId,
      normalized.intent,
      parentRecord,
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

    const invoked = await this.invokeAgentFlowCheck(runId, normalized.intent);
    if (!invoked.ok) {
      const unsupported = isUnsupportedAgentFlowError(invoked.error);
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
        invoked.error,
        partialRunResultFrom(invoked.error),
      );
    }

    const interpreted = interpretAgentFlowCandidate(invoked.candidate, {
      runId,
      intent: normalized.intent,
      moss: this.dependencies.runtime.config.moss,
      applyFailClosedAdjust: true,
    });
    if (!interpreted.ok) {
      return this.recordFailure(
        runId,
        "INVALID_AGENT_FLOW_RESPONSE",
        normalized.intent,
        childFields,
        {
          code: "INVALID_AGENT_FLOW_RESPONSE",
          message: interpreted.message,
        },
      );
    }

    const resultWithRerun = runResultSchema.parse({
      ...interpreted.result,
      ...childFields,
    });
    if (resultWithRerun.status === "completed") {
      const gated = await this.maybeApplyVerifiedActionGate(resultWithRerun);
      if (gated.kind === "blocked") {
        return storeErrorResponse();
      }
      let verificationChildren: ReadonlyMap<string, CheckRunRecord | undefined>;
      try {
        verificationChildren = await loadVerificationChildren(
          gated.result,
          this.dependencies.store,
        );
      } catch {
        return storeErrorResponse();
      }
      const gatedResult = closeUnverifiedAdjust(
        gated.result,
        verificationChildren,
      );
      try {
        await this.dependencies.store.complete(gatedResult);
      } catch {
        return storeErrorResponse();
      }
      return { status: 200, body: gatedResult };
    }

    try {
      await this.dependencies.store.complete(resultWithRerun);
    } catch {
      return storeErrorResponse();
    }

    return { status: 200, body: resultWithRerun };
  }

  private async maybeApplyVerifiedActionGate(
    baseline: Extract<RunResult, { status: "completed" }>,
  ): Promise<
    | { kind: "result"; result: Extract<RunResult, { status: "completed" }> }
    | { kind: "blocked" }
  > {
    if (!isActionGateCandidate(baseline)) {
      return { kind: "result", result: baseline };
    }

    let adjustment: ReturnType<typeof proposeAmountInAdjustment>;
    try {
      adjustment = proposeAmountInAdjustment(baseline.intent);
    } catch {
      return { kind: "result", result: baseline };
    }

    const diff = buildRunDiff(baseline, adjustment.nextIntent);
    if (!diff.success) {
      return { kind: "result", result: baseline };
    }

    const childRunId = this.createRunId();
    const childFields: ChildRunFields = {
      parentRunId: baseline.runId,
      diff: diff.value,
    };

    try {
      await this.dependencies.store.start(
        childRunId,
        adjustment.nextIntent,
        childFields.parentRunId,
      );
    } catch {
      return { kind: "blocked" };
    }

    const invoked = await this.invokeAgentFlowCheck(
      childRunId,
      adjustment.nextIntent,
    );
    if (!invoked.ok) {
      const persisted = await this.persistVerificationChildFailure(
        childRunId,
        adjustment.nextIntent,
        childFields,
        "AGENT_FLOW_ERROR",
        invoked.error,
      );
      return persisted === "non_terminal"
        ? { kind: "blocked" }
        : { kind: "result", result: baseline };
    }

    const interpreted = interpretAgentFlowCandidate(invoked.candidate, {
      runId: childRunId,
      intent: adjustment.nextIntent,
      moss: this.dependencies.runtime.config.moss,
      applyFailClosedAdjust: false,
    });
    if (!interpreted.ok) {
      const persisted = await this.persistVerificationChildFailure(
        childRunId,
        adjustment.nextIntent,
        childFields,
        "INVALID_AGENT_FLOW_RESPONSE",
      );
      return persisted === "non_terminal"
        ? { kind: "blocked" }
        : { kind: "result", result: baseline };
    }

    const child = interpreted.result;
    if (child.status === "integration_error") {
      const persisted = await this.persistVerificationChildResult(
        childRunId,
        adjustment.nextIntent,
        failedRunResultSchema.parse({
          ...child,
          ...childFields,
        }),
      );
      return persisted === "non_terminal"
        ? { kind: "blocked" }
        : { kind: "result", result: baseline };
    }

    if (child.status !== "completed") {
      const persisted = await this.persistVerificationChildFailure(
        childRunId,
        adjustment.nextIntent,
        childFields,
        "INVALID_AGENT_FLOW_RESPONSE",
      );
      return persisted === "non_terminal"
        ? { kind: "blocked" }
        : { kind: "result", result: baseline };
    }

    const childWithParent = completedRunResultSchema.parse({
      ...child,
      ...childFields,
    });
    const persisted = await this.persistVerificationChildResult(
      childRunId,
      adjustment.nextIntent,
      childWithParent,
    );
    if (persisted === "non_terminal") {
      return { kind: "blocked" };
    }
    if (persisted !== "stored") {
      return { kind: "result", result: baseline };
    }

    if (!childRunPassesActionGate(childWithParent, baseline.runId)) {
      return { kind: "result", result: baseline };
    }

    try {
      return {
        kind: "result",
        result: buildVerifiedAdjustBaseline(
          baseline,
          childWithParent,
          adjustment,
        ),
      };
    } catch {
      return { kind: "result", result: baseline };
    }
  }

  private async invokeAgentFlowCheck(
    runId: string,
    intent: Parameters<AgentFlowPort["check"]>[0]["intent"],
  ): Promise<{ ok: true; candidate: unknown } | { ok: false; error: unknown }> {
    try {
      const candidate = await this.dependencies.agentFlow.check({
        runId,
        intent,
        tokenInDecimals: tokenDecimals(
          this.dependencies.runtime,
          intent.tokenIn,
          intent.chainId,
        ),
        tokenOutDecimals: tokenDecimals(
          this.dependencies.runtime,
          intent.tokenOut,
          intent.chainId,
        ),
        moss: this.dependencies.runtime.config.moss,
      });
      return { ok: true, candidate };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Terminalize a verification child that was stored before Agent Flow.
   * - `stored`: child completed as provided
   * - `terminal_error`: child was failed after a failed complete
   * - `non_terminal`: child left in `started` (baseline must not become a public Receipt)
   */
  private async persistVerificationChildResult(
    childRunId: string,
    intent: Parameters<AgentFlowPort["check"]>[0]["intent"],
    result: RunResult,
  ): Promise<"stored" | "terminal_error" | "non_terminal"> {
    try {
      await this.dependencies.store.complete(result);
      return "stored";
    } catch {
      if (result.parentRunId === undefined || result.diff === undefined) {
        return "non_terminal";
      }
      const failed = createIntegrationErrorResult(
        childRunId,
        intent,
        "INVALID_AGENT_FLOW_RESPONSE",
        {
          parentRunId: result.parentRunId,
          diff: result.diff,
        },
      );
      try {
        await this.dependencies.store.fail(
          childRunId,
          "INVALID_AGENT_FLOW_RESPONSE",
          failed,
        );
        return "terminal_error";
      } catch {
        return "non_terminal";
      }
    }
  }

  private async persistVerificationChildFailure(
    childRunId: string,
    intent: Parameters<AgentFlowPort["check"]>[0]["intent"],
    childFields: ChildRunFields,
    failure: CheckRunFailureCode,
    cause?: unknown,
  ): Promise<"terminal_error" | "non_terminal"> {
    const result = createIntegrationErrorResult(
      childRunId,
      intent,
      failure,
      childFields,
      cause,
    );
    try {
      await this.dependencies.store.fail(childRunId, failure, result);
      return "terminal_error";
    } catch {
      return "non_terminal";
    }
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

function partialRunResultFrom(error: unknown): FailedRunResult | undefined {
  const candidate = asRecord(error)?.partialRunResult;
  const parsed = failedRunResultSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

type InterpretAgentFlowOptions = {
  runId: string;
  intent: Parameters<AgentFlowPort["check"]>[0]["intent"];
  moss: BackendRuntime["config"]["moss"];
  applyFailClosedAdjust: boolean;
};

/**
 * Shared parse + identity validation for primary checks and Action Gate
 * verification children. Fail-closed ADJUST stripping applies only to the
 * primary path (children must stay raw so Gate attestation can evaluate them).
 */
function interpretAgentFlowCandidate(
  candidate: unknown,
  options: InterpretAgentFlowOptions,
): { ok: true; result: RunResult } | { ok: false; message: string } {
  let parsedResult = runResultSchema.safeParse(candidate);
  if (!parsedResult.success && options.applyFailClosedAdjust) {
    const failClosedCandidate = failClosedAdjustCandidate(candidate);
    if (failClosedCandidate !== undefined) {
      parsedResult = runResultSchema.safeParse(failClosedCandidate);
    }
  }
  if (!parsedResult.success) {
    return {
      ok: false,
      message: "Agent Flow returned an invalid RunResult",
    };
  }

  const result = parsedResult.data;
  if (
    result.runId !== options.runId ||
    result.replayMode ||
    !isDeepStrictEqual(result.intent, options.intent) ||
    result.parentRunId !== undefined ||
    result.diff !== undefined
  ) {
    return {
      ok: false,
      message:
        "Agent Flow returned a result for the wrong run ID, mode, or intent",
    };
  }

  if (hasMismatchedAuthoritativeRuntime(result, options.moss)) {
    return {
      ok: false,
      message: "Agent Flow returned Evidence from a different Moss runtime",
    };
  }

  return { ok: true, result };
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
    !isBlockNumber(result.simulatorPinnedBlock) &&
    !isCompletedNoRoute(result)
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

function isCompletedNoRoute(
  result: Extract<RunResult, { status: "completed" }>,
): boolean {
  return (
    result.route.availability === "unavailable" &&
    result.ruleResults.some(
      (rule) =>
        rule.ruleId === "P0-EXECUTION-001" &&
        rule.status === "FAIL" &&
        rule.reasonCode === "NO_ROUTE_FOUND",
    )
  );
}

function isBlockNumber(value: string | undefined): boolean {
  return /^\d+$/.test(value ?? "");
}

async function loadVerificationChildren(
  result: Extract<RunResult, { status: "completed" }>,
  store: RunStore,
): Promise<ReadonlyMap<string, CheckRunRecord | undefined>> {
  const records = await Promise.all(
    actionGateVerificationRunIds(result).map(
      async (runId) => [runId, await store.get(runId)] as const,
    ),
  );
  return new Map(records);
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
