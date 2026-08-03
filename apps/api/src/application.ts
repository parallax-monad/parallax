import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  checkSwapRequestSchema,
  type EvidenceRef,
  type NormalizedSwapIntent,
  type RunDiff,
  type RunResult,
  runDiffSchema,
  runResultSchema,
} from "@parallax/contracts";
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

export type CheckApiErrorBody = {
  error: {
    code: CheckApiErrorCode;
    message: string;
    issues?: unknown;
  };
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
        message: rerun.message,
      });
    }

    const runId = this.createRunId();
    try {
      await this.dependencies.store.start(
        runId,
        normalized.intent,
        rerun.parentRunId,
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
    } catch {
      const storeFailure = await this.recordFailure(runId, "AGENT_FLOW_ERROR");
      if (storeFailure !== undefined) return storeFailure;
      return errorResponse(502, {
        code: "AGENT_FLOW_ERROR",
        message: "Agent Flow could not complete the check",
      });
    }

    const parsedResult = runResultSchema.safeParse(candidate);
    if (!parsedResult.success) {
      const storeFailure = await this.recordFailure(
        runId,
        "INVALID_AGENT_FLOW_RESPONSE",
      );
      if (storeFailure !== undefined) return storeFailure;
      return errorResponse(502, {
        code: "INVALID_AGENT_FLOW_RESPONSE",
        message: "Agent Flow returned an invalid RunResult",
      });
    }

    const result = parsedResult.data;
    if (
      result.runId !== runId ||
      result.replayMode ||
      !isDeepStrictEqual(result.intent, normalized.intent) ||
      result.parentRunId !== undefined ||
      result.diff !== undefined
    ) {
      const storeFailure = await this.recordFailure(
        runId,
        "INVALID_AGENT_FLOW_RESPONSE",
      );
      if (storeFailure !== undefined) return storeFailure;
      return errorResponse(502, {
        code: "INVALID_AGENT_FLOW_RESPONSE",
        message:
          "Agent Flow returned a result for the wrong run ID, mode, or intent",
      });
    }

    if (
      hasMismatchedAuthoritativeRuntime(
        result,
        this.dependencies.runtime.config.moss,
      )
    ) {
      const storeFailure = await this.recordFailure(
        runId,
        "INVALID_AGENT_FLOW_RESPONSE",
      );
      if (storeFailure !== undefined) return storeFailure;
      return errorResponse(502, {
        code: "INVALID_AGENT_FLOW_RESPONSE",
        message: "Agent Flow returned Evidence from a different Moss runtime",
      });
    }

    const resultWithRerun = runResultSchema.parse({
      ...result,
      ...(rerun.parentRunId === undefined
        ? {}
        : {
            parentRunId: rerun.parentRunId,
            diff: rerun.diff,
          }),
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
  ): Promise<CheckApplicationResponse | undefined> {
    try {
      await this.dependencies.store.fail(runId, failure);
      return undefined;
    } catch {
      return storeErrorResponse();
    }
  }
}

type RerunResolution =
  | { success: true; parentRunId?: string; diff?: RunDiff }
  | { success: false; message: string };

function resolveRerun(
  parentRunId: string | undefined,
  intent: NormalizedSwapIntent,
  store: RunStore,
): RerunResolution {
  if (parentRunId === undefined) {
    return { success: true };
  }

  const parent = store.get(parentRunId);
  if (parent?.status !== "completed" || parent.result.status !== "completed") {
    return {
      success: false,
      message: "The parent Run does not exist or is not completed",
    };
  }

  if (parent.result.replayMode) {
    return {
      success: false,
      message: "Recorded Replay Runs cannot be re-run",
    };
  }

  if (parent.result.parentRunId !== undefined) {
    return {
      success: false,
      message: "Only one Re-run is supported for a baseline Run",
    };
  }

  if (
    parent.result.intent.chainId !== intent.chainId ||
    parent.result.intent.sender.toLowerCase() !== intent.sender.toLowerCase()
  ) {
    return {
      success: false,
      message: "A Re-run must preserve the baseline chain and sender",
    };
  }

  if (
    !isDeepStrictEqual(
      parent.result.intent.economicBoundary,
      intent.economicBoundary,
    )
  ) {
    return {
      success: false,
      message:
        "A verification Re-run must preserve the baseline Economic Boundary",
    };
  }

  const diff = buildRunDiff(parent.result, intent);
  if (diff === undefined) {
    return {
      success: false,
      message: "A Re-run must change at least one supported Intent field",
    };
  }

  return { success: true, parentRunId, diff };
}

function buildRunDiff(
  previous: RunResult,
  nextIntent: NormalizedSwapIntent,
): RunDiff | undefined {
  const changedFields: RunDiff["changedFields"] = [];
  const addChange = (
    field: RunDiff["changedFields"][number]["field"],
    before: string,
    after: string,
  ) => {
    if (before !== after) {
      changedFields.push({ field, before, after });
    }
  };

  addChange(
    "amountInAtomic",
    previous.intent.amountInAtomic,
    nextIntent.amountInAtomic,
  );
  addChange("protocol", previous.intent.protocol, nextIntent.protocol);
  addChange(
    "recipient",
    previous.intent.recipient.toLowerCase(),
    nextIntent.recipient.toLowerCase(),
  );
  addChange(
    "recipientSource",
    previous.intent.recipientSource,
    nextIntent.recipientSource,
  );
  addChange(
    "tokenIn",
    assetDiffValue(previous.intent.tokenIn),
    assetDiffValue(nextIntent.tokenIn),
  );
  addChange(
    "tokenOut",
    assetDiffValue(previous.intent.tokenOut),
    assetDiffValue(nextIntent.tokenOut),
  );
  addChange(
    "economicBoundary",
    boundaryDiffValue(previous.intent.economicBoundary),
    boundaryDiffValue(nextIntent.economicBoundary),
  );

  if (changedFields.length === 0) {
    return undefined;
  }

  return runDiffSchema.parse({
    previousRunId: previous.runId,
    previousVerdict: previous.verdict,
    changedFields,
  });
}

function assetDiffValue(asset: NormalizedSwapIntent["tokenIn"]): string {
  return asset.kind === "native"
    ? "native"
    : `erc20:${asset.address.toLowerCase()}`;
}

function boundaryDiffValue(
  boundary: NormalizedSwapIntent["economicBoundary"],
): string {
  return boundary.availability === "available"
    ? `available:${boundary.source}:${boundary.minimumReceivedAtomic}`
    : "unavailable";
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
