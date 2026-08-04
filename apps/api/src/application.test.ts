import type {
  CheckSwapRequest,
  EvidenceItem,
  EvidenceRef,
  NormalizedSwapIntent,
  RunResult,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { CheckApplicationService } from "./application.js";
import { normalizeCheckSwapRequest } from "./normalization.js";
import type { AgentFlowPort } from "./ports.js";
import type { BackendRuntime } from "./runtime-config.js";
import { InMemoryRunStore, type RunStore } from "./store.js";
import { createTrustedTokenRegistry } from "./trusted-token-registry.js";

const sender = "0x1111111111111111111111111111111111111111";
const usdcAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const mon = { kind: "native" as const };
const usdc = { kind: "erc20" as const, address: usdcAddress };

const tokenRegistryConfig = {
  chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
  tokens: [
    {
      chainId: 143,
      address: usdcAddress,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "90000000",
    },
  ],
};

const runtime: BackendRuntime = {
  config: {
    tokenRegistry: tokenRegistryConfig,
    moss: {
      rpcUrl: "https://rpc.example.test",
      runtimeVersion: "moss-0.1.0",
      runtimeRevision: "revision-1",
    },
  },
  tokenRegistry: createTrustedTokenRegistry(tokenRegistryConfig),
};

type CompletedRunResult = Extract<RunResult, { status: "completed" }>;

function publicRequest(
  overrides: Partial<CheckSwapRequest> = {},
): CheckSwapRequest {
  return {
    chainId: 143,
    protocol: "kuru",
    sender,
    tokenIn: mon,
    tokenOut: usdc,
    amountIn: "1.5",
    economicBoundary: {
      availability: "unavailable",
      source: "unavailable",
    },
    ...overrides,
  };
}

function integrationErrorResult(
  runId: string,
  intent: NormalizedSwapIntent,
  replayMode = false,
): RunResult {
  return {
    runId,
    replayMode,
    intent,
    status: "integration_error",
    systemStatus: "INTEGRATION_ERROR",
    verdict: "UNKNOWN",
    summary: "Moss is unavailable",
    error: {
      code: "MOSS_UNAVAILABLE",
      stage: "unknown",
      message: "Moss runtime is not connected",
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
  };
}

function evidenceRef(evidence: EvidenceItem): EvidenceRef {
  return {
    key: evidence.key,
    source: evidence.source,
    stage: evidence.stage,
    blockNumber: evidence.blockNumber,
    runtimeVersion: evidence.runtimeVersion,
    runtimeRevision: evidence.runtimeRevision,
    fixtureId: evidence.fixtureId,
    reproducibility: evidence.reproducibility,
    isReplay: evidence.isReplay,
    isMock: evidence.isMock,
  };
}

function completedRunResult(
  runId: string,
  intent: NormalizedSwapIntent,
  overrides: Pick<
    CompletedRunResult,
    "ruleResults" | "evidence" | "scope" | "route"
  >,
): CompletedRunResult {
  return {
    runId,
    replayMode: false,
    intent,
    status: "completed",
    systemStatus: "OK",
    verdict: "UNKNOWN",
    summary: "The test completed without a blocking verdict.",
    recommendedActions: [],
    irrelevantActions: [],
    ...overrides,
  };
}

function completedRouteResult(
  runId: string,
  intent: NormalizedSwapIntent,
  runtimeVersion = runtime.config.moss.runtimeVersion,
  runtimeRevision = runtime.config.moss.runtimeRevision,
): RunResult {
  const routeEvidence = {
    kind: "generic" as const,
    key: "route-quote",
    status: "confirmed" as const,
    summary: "Moss returned a route for the checked Intent",
    source: "quote" as const,
    stage: "QUOTE" as const,
    blockNumber: "12345",
    runtimeVersion,
    runtimeRevision,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
    routeInputRole: "ROUTE_QUOTE" as const,
  };

  return completedRunResult(runId, intent, {
    ruleResults: [
      {
        ruleId: "P0-ECONOMIC-001",
        status: "NOT_APPLICABLE",
        applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
        evidenceRefs: [],
        actionEvaluations: [],
      },
    ],
    evidence: [routeEvidence],
    scope: [
      {
        key: "P0-ECONOMIC-001",
        label: "Economic result",
        status: "not_checked",
        reason: "PRECONDITION_ABSENT",
      },
      {
        key: "OUTSIDE_P0_SCOPE",
        label: "Complete protocol security",
        status: "not_checked",
        reason: "OUTSIDE_P0_SCOPE",
      },
    ],
    route: {
      availability: "available",
      protocol: "kuru",
      path: [mon, usdc],
      source: "quote",
      blockNumber: "12345",
      evidenceRef: evidenceRef(routeEvidence),
    },
  });
}

function completedEvidenceResult(
  runId: string,
  intent: NormalizedSwapIntent,
  runtimeVersion: string,
  runtimeRevision: string,
): CompletedRunResult {
  const evidence = {
    kind: "generic" as const,
    key: "evidence-completeness",
    status: "confirmed" as const,
    summary: "P0 Evidence completeness is verified",
    source: "derived" as const,
    stage: "SIMULATE" as const,
    blockNumber: "12345",
    runtimeVersion,
    runtimeRevision,
    coreRole: "EVIDENCE_COMPLETENESS" as const,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
  };

  return completedRunResult(runId, intent, {
    ruleResults: [
      {
        ruleId: "P0-EVIDENCE-001",
        status: "PASS",
        evidenceRefs: [evidenceRef(evidence)],
        actionEvaluations: [],
      },
      {
        ruleId: "P0-ECONOMIC-001",
        status: "NOT_APPLICABLE",
        applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
        evidenceRefs: [],
        actionEvaluations: [],
      },
    ],
    evidence: [evidence],
    scope: [
      {
        key: "P0-EVIDENCE-001",
        label: "Evidence result",
        status: "checked",
      },
      {
        key: "P0-ECONOMIC-001",
        label: "Economic result",
        status: "not_checked",
        reason: "PRECONDITION_ABSENT",
      },
      {
        key: "OUTSIDE_P0_SCOPE",
        label: "Complete protocol security",
        status: "not_checked",
        reason: "OUTSIDE_P0_SCOPE",
      },
    ],
    route: {
      availability: "unavailable",
      reason: "No route in test fixture",
    },
  });
}

function completedEconomicResult(
  runId: string,
  intent: NormalizedSwapIntent,
  runtimeVersion: string,
  runtimeRevision: string,
): CompletedRunResult {
  const simulationInput = {
    kind: "generic" as const,
    key: "simulation-receipt",
    status: "confirmed" as const,
    summary: "Simulation receipt is available",
    source: "moss" as const,
    stage: "SIMULATE" as const,
    blockNumber: "12345",
    runtimeVersion,
    runtimeRevision,
    simulationInputRole: "SIMULATION_RECEIPT" as const,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
  };
  const simulationOutput = {
    kind: "simulated_token_out" as const,
    key: "simulated-token-out",
    status: "confirmed" as const,
    summary: "Recipient tokenOut balance delta",
    source: "derived" as const,
    stage: "SIMULATE" as const,
    blockNumber: "12345",
    runtimeVersion,
    runtimeRevision,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
    tokenOut: usdc,
    recipient: sender,
    amountReceivedAtomic: "20000",
    derivation: "recipient_balance_delta" as const,
    derivationVersion: "recipient-balance-delta/v1",
    inputEvidenceRefs: [evidenceRef(simulationInput)],
  };

  return completedRunResult(runId, intent, {
    ruleResults: [
      {
        ruleId: "P0-ECONOMIC-001",
        status: "PASS",
        evidenceRefs: [evidenceRef(simulationOutput)],
        actionEvaluations: [],
      },
    ],
    evidence: [simulationInput, simulationOutput],
    scope: [
      {
        key: "P0-ECONOMIC-001",
        label: "Economic result",
        status: "checked",
      },
      {
        key: "OUTSIDE_P0_SCOPE",
        label: "Complete protocol security",
        status: "not_checked",
        reason: "OUTSIDE_P0_SCOPE",
      },
    ],
    route: {
      availability: "unavailable",
      reason: "No route in test fixture",
    },
  });
}

function createService(
  agentFlow: AgentFlowPort,
  store: RunStore = new InMemoryRunStore(),
  createRunId: () => string = () => "run-1",
) {
  return new CheckApplicationService({
    runtime,
    agentFlow,
    store,
    createRunId,
  });
}

describe("CheckApplicationService", () => {
  it("normalizes the request, calls Agent Flow, validates, and stores the result", async () => {
    const store = new InMemoryRunStore();
    let receivedIntent: NormalizedSwapIntent | undefined;
    let receivedMoss: unknown;
    const service = createService(
      {
        async check(input) {
          expect(store.get(input.runId)).toMatchObject({ status: "started" });
          receivedIntent = input.intent;
          receivedMoss = input.moss;
          return integrationErrorResult(input.runId, input.intent);
        },
      },
      store,
    );

    const response = await service.check(publicRequest());

    expect(response.status).toBe(200);
    expect(receivedIntent).toMatchObject({
      amountInAtomic: "1500000000000000000",
      recipient: sender,
      recipientSource: "defaulted_from_sender",
    });
    expect(receivedMoss).toEqual(runtime.config.moss);
    expect(store.get("run-1")).toMatchObject({
      runId: "run-1",
      status: "completed",
      intent: receivedIntent,
      result: response.body,
    });
  });

  it("creates an immutable child Run and Diff for a Re-run", async () => {
    const store = new InMemoryRunStore();
    const baseline = createService(
      {
        async check(input) {
          return completedRouteResult(input.runId, input.intent);
        },
      },
      store,
    );
    const baselineResponse = await baseline.check(publicRequest());
    expect(baselineResponse.status).toBe(200);

    const rerun = createService(
      {
        async check(input) {
          return completedRouteResult(input.runId, input.intent);
        },
      },
      store,
      () => "run-2",
    );

    const response = await rerun.check(
      publicRequest({ parentRunId: "run-1", amountIn: "2" }),
    );

    expect(response).toMatchObject({
      status: 200,
      body: {
        runId: "run-2",
        parentRunId: "run-1",
        diff: {
          previousRunId: "run-1",
          previousVerdict: "UNKNOWN",
          changedFields: [
            {
              field: "amountInAtomic",
              before: "1500000000000000000",
              after: "2000000000000000000",
            },
          ],
        },
      },
    });
    expect(store.get("run-1")).toMatchObject({
      status: "completed",
      parentRunId: undefined,
      result: baselineResponse.body,
    });
    expect(store.get("run-2")).toMatchObject({
      status: "completed",
      parentRunId: "run-1",
      result: response.body,
    });
  });

  it("rejects a Re-run without a completed baseline or a changed Intent", async () => {
    const store = new InMemoryRunStore();
    const service = createService(
      {
        async check() {
          throw new Error("must not run");
        },
      },
      store,
    );

    await expect(
      service.check(publicRequest({ parentRunId: "missing" })),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "INVALID_RERUN",
          reason: "PARENT_NOT_FOUND",
        },
      },
    });

    const baseline = createService(
      {
        async check(input) {
          return completedRouteResult(input.runId, input.intent);
        },
      },
      store,
    );
    await baseline.check(publicRequest());

    const unchangedRerun = createService(
      {
        async check() {
          throw new Error("must not run");
        },
      },
      store,
      () => "run-2",
    );
    await expect(
      unchangedRerun.check(publicRequest({ parentRunId: "run-1" })),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "INVALID_RERUN" } },
    });
    expect(store.get("run-2")).toBeUndefined();

    const provenanceOnlyRerun = createService(
      {
        async check() {
          throw new Error("must not run");
        },
      },
      store,
      () => "run-3",
    );
    await expect(
      provenanceOnlyRerun.check(
        publicRequest({ parentRunId: "run-1", recipient: sender }),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "INVALID_RERUN",
          reason: "NOT_EXACTLY_ONE_CHANGE",
          message: "A Re-run must change exactly one supported Intent field",
        },
      },
    });
    expect(store.get("run-3")).toBeUndefined();

    const recipientRerun = createService(
      {
        async check(input) {
          return completedRouteResult(input.runId, input.intent);
        },
      },
      store,
      () => "run-4",
    );
    await expect(
      recipientRerun.check(
        publicRequest({
          parentRunId: "run-1",
          recipient: "0x2222222222222222222222222222222222222222",
        }),
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        parentRunId: "run-1",
        diff: {
          changedFields: [
            {
              field: "recipient",
              before: sender,
              after: "0x2222222222222222222222222222222222222222",
            },
          ],
        },
      },
    });
  });

  it("rejects a Re-run that changes more than one Intent condition", async () => {
    const store = new InMemoryRunStore();
    const baseline = createService(
      {
        async check(input) {
          return completedRouteResult(input.runId, input.intent);
        },
      },
      store,
    );
    await baseline.check(publicRequest());

    let agentFlowCalled = false;
    const rerun = createService(
      {
        async check() {
          agentFlowCalled = true;
          throw new Error("must not run");
        },
      },
      store,
      () => "run-2",
    );

    await expect(
      rerun.check(
        publicRequest({
          parentRunId: "run-1",
          amountIn: "2",
          protocol: "pancake",
        }),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "INVALID_RERUN",
          message: "A Re-run must change exactly one supported Intent field",
        },
      },
    });

    expect(agentFlowCalled).toBe(false);
    expect(store.get("run-2")).toBeUndefined();
  });

  it("preserves baseline ownership and Economic Boundary during a Re-run", async () => {
    const store = new InMemoryRunStore();
    const baseline = createService(
      {
        async check(input) {
          return completedRouteResult(input.runId, input.intent);
        },
      },
      store,
    );
    await baseline.check(publicRequest());

    const rerun = createService(
      {
        async check() {
          throw new Error("must not run");
        },
      },
      store,
      () => "run-2",
    );

    await expect(
      rerun.check(
        publicRequest({
          parentRunId: "run-1",
          sender: "0x2222222222222222222222222222222222222222",
          amountIn: "2",
        }),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "INVALID_RERUN",
          reason: "CHAIN_OR_SENDER_CHANGED",
        },
      },
    });

    await expect(
      rerun.check(
        publicRequest({
          parentRunId: "run-1",
          amountIn: "2",
          economicBoundary: {
            availability: "available",
            minimumReceived: "0.01",
            source: "user_declared",
          },
        }),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "INVALID_RERUN",
          reason: "BOUNDARY_CHANGED",
        },
      },
    });

    expect(store.get("run-2")).toBeUndefined();
  });

  it("preserves the Diff on a failed child and rejects nested Re-runs", async () => {
    const store = new InMemoryRunStore();
    const baseline = createService(
      {
        async check(input) {
          return completedRouteResult(input.runId, input.intent);
        },
      },
      store,
    );
    await baseline.check(publicRequest());

    const child = createService(
      {
        async check(input) {
          return integrationErrorResult(input.runId, input.intent);
        },
      },
      store,
      () => "run-2",
    );
    const childResponse = await child.check(
      publicRequest({ parentRunId: "run-1", amountIn: "2" }),
    );

    expect(childResponse).toMatchObject({
      status: 200,
      body: {
        status: "integration_error",
        parentRunId: "run-1",
        diff: {
          previousRunId: "run-1",
          changedFields: [{ field: "amountInAtomic" }],
        },
      },
    });

    const nested = createService(
      {
        async check() {
          throw new Error("must not run");
        },
      },
      store,
      () => "run-3",
    );
    await expect(
      nested.check(publicRequest({ parentRunId: "run-2", amountIn: "3" })),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "INVALID_RERUN",
          reason: "PARENT_NOT_COMPLETED",
        },
      },
    });
    expect(store.get("run-3")).toBeUndefined();
  });

  it("preserves parent and Diff when Agent Flow throws during a Re-run", async () => {
    const store = new InMemoryRunStore();
    const baseline = createService(
      {
        async check(input) {
          return completedRouteResult(input.runId, input.intent);
        },
      },
      store,
    );
    await baseline.check(publicRequest());

    const child = createService(
      {
        async check() {
          throw new Error("secret RPC credential appeared here");
        },
      },
      store,
      () => "run-2",
    );

    const response = await child.check(
      publicRequest({ parentRunId: "run-1", amountIn: "2" }),
    );

    expect(response).toMatchObject({
      status: 502,
      body: {
        error: { code: "AGENT_FLOW_ERROR" },
        run: {
          status: "integration_error",
          systemStatus: "INTEGRATION_ERROR",
          verdict: "UNKNOWN",
          parentRunId: "run-1",
          diff: {
            previousRunId: "run-1",
            changedFields: [{ field: "amountInAtomic" }],
          },
        },
      },
    });
    expect(store.get("run-2")).toMatchObject({
      status: "failed",
      failure: "AGENT_FLOW_ERROR",
      parentRunId: "run-1",
      result: {
        status: "integration_error",
        systemStatus: "INTEGRATION_ERROR",
        verdict: "UNKNOWN",
        parentRunId: "run-1",
        diff: {
          previousRunId: "run-1",
          changedFields: [{ field: "amountInAtomic" }],
        },
      },
    });
  });

  it("preserves parent and Diff when Agent Flow returns an invalid child result", async () => {
    const store = new InMemoryRunStore();
    const baseline = createService(
      {
        async check(input) {
          return completedRouteResult(input.runId, input.intent);
        },
      },
      store,
    );
    await baseline.check(publicRequest());

    const child = createService(
      {
        async check() {
          return { invalid: true };
        },
      },
      store,
      () => "run-2",
    );

    const response = await child.check(
      publicRequest({ parentRunId: "run-1", amountIn: "2" }),
    );

    expect(response).toMatchObject({
      status: 502,
      body: {
        error: { code: "INVALID_AGENT_FLOW_RESPONSE" },
        run: {
          status: "integration_error",
          systemStatus: "INTEGRATION_ERROR",
          verdict: "UNKNOWN",
          parentRunId: "run-1",
          diff: {
            previousRunId: "run-1",
            changedFields: [{ field: "amountInAtomic" }],
          },
        },
      },
    });
    expect(store.get("run-2")).toMatchObject({
      status: "failed",
      failure: "INVALID_AGENT_FLOW_RESPONSE",
      parentRunId: "run-1",
      result: {
        status: "integration_error",
        systemStatus: "INTEGRATION_ERROR",
        verdict: "UNKNOWN",
        parentRunId: "run-1",
        diff: {
          previousRunId: "run-1",
          changedFields: [{ field: "amountInAtomic" }],
        },
      },
    });
  });

  it("does not allow a Recorded Replay Run to become a Re-run baseline", async () => {
    const store = new InMemoryRunStore();
    const replayIntent = runtime.tokenRegistry
      ? normalizeCheckSwapRequest(publicRequest(), runtime.tokenRegistry)
      : undefined;
    if (!replayIntent?.success) {
      throw new Error("missing normalized replay intent");
    }
    await store.start("run-1", replayIntent.intent);
    await store.complete({
      ...completedRouteResult("run-1", replayIntent.intent),
      replayMode: true,
      evidence: completedRouteResult("run-1", replayIntent.intent).evidence.map(
        (evidence) => ({
          ...evidence,
          isReplay: true,
        }),
      ),
    });

    const rerun = createService(
      {
        async check() {
          throw new Error("must not run");
        },
      },
      store,
      () => "run-2",
    );
    await expect(
      rerun.check(publicRequest({ parentRunId: "run-1", amountIn: "2" })),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "INVALID_RERUN",
          reason: "PARENT_IS_REPLAY",
        },
      },
    });
  });

  it.each([
    {
      name: "runtime version",
      runtimeVersion: "moss-0.0.9",
      runtimeRevision: runtime.config.moss.runtimeRevision,
    },
    {
      name: "runtime revision",
      runtimeVersion: runtime.config.moss.runtimeVersion,
      runtimeRevision: "revision-0",
    },
  ])(
    "rejects a schema-valid result with mismatched $name",
    async (testCase) => {
      const store = new InMemoryRunStore();
      const service = createService(
        {
          async check(input) {
            return completedRouteResult(
              input.runId,
              input.intent,
              testCase.runtimeVersion,
              testCase.runtimeRevision,
            );
          },
        },
        store,
      );

      const response = await service.check(publicRequest());

      expect(response).toMatchObject({
        status: 502,
        body: { error: { code: "INVALID_AGENT_FLOW_RESPONSE" } },
      });
      expect(store.get("run-1")).toMatchObject({
        status: "failed",
        failure: "INVALID_AGENT_FLOW_RESPONSE",
      });
    },
  );

  it("accepts a schema-valid result with the current Moss runtime identity", async () => {
    const store = new InMemoryRunStore();
    const service = createService(
      {
        async check(input) {
          return completedRouteResult(input.runId, input.intent);
        },
      },
      store,
    );

    const response = await service.check(publicRequest());

    expect(response.status).toBe(200);
    expect(store.get("run-1")).toMatchObject({
      status: "completed",
      result: response.body,
    });
  });

  it("rejects stale runtime identity on core Rule Evidence", async () => {
    const store = new InMemoryRunStore();
    const service = createService(
      {
        async check(input) {
          return completedEvidenceResult(
            input.runId,
            input.intent,
            runtime.config.moss.runtimeVersion,
            "revision-stale",
          );
        },
      },
      store,
    );

    const response = await service.check(publicRequest());

    expect(response).toMatchObject({
      status: 502,
      body: { error: { code: "INVALID_AGENT_FLOW_RESPONSE" } },
    });
    expect(store.get("run-1")).toMatchObject({
      status: "failed",
      failure: "INVALID_AGENT_FLOW_RESPONSE",
    });
  });

  it("rejects stale runtime identity on Economic simulation Evidence", async () => {
    const store = new InMemoryRunStore();
    const service = createService(
      {
        async check(input) {
          return completedEconomicResult(
            input.runId,
            input.intent,
            "moss-stale",
            runtime.config.moss.runtimeRevision,
          );
        },
      },
      store,
    );

    const response = await service.check(
      publicRequest({
        economicBoundary: {
          availability: "available",
          minimumReceived: "0.01",
          source: "user_declared",
        },
      }),
    );

    expect(response).toMatchObject({
      status: 502,
      body: { error: { code: "INVALID_AGENT_FLOW_RESPONSE" } },
    });
    expect(store.get("run-1")).toMatchObject({
      status: "failed",
      failure: "INVALID_AGENT_FLOW_RESPONSE",
    });
  });

  it("rejects malformed public input before calling Agent Flow", async () => {
    let called = false;
    const service = createService({
      async check() {
        called = true;
        throw new Error("must not run");
      },
    });

    const response = await service.check({ amountIn: "not-a-number" });

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "INVALID_REQUEST" } },
    });
    expect(called).toBe(false);
  });

  it("rejects values that cannot be normalized against trusted metadata", async () => {
    let called = false;
    const service = createService({
      async check() {
        called = true;
        throw new Error("must not run");
      },
    });

    const response = await service.check(
      publicRequest({
        tokenOut: {
          kind: "erc20",
          address: "0x3333333333333333333333333333333333333333",
        },
      }),
    );

    expect(response).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "NORMALIZATION_FAILED",
          issues: { code: "UNSUPPORTED_TOKEN", field: "tokenOut" },
        },
      },
    });
    expect(called).toBe(false);
  });

  it("isolates thrown Agent Flow failures without exposing their message", async () => {
    const store = new InMemoryRunStore();
    const service = createService(
      {
        async check() {
          throw new Error("secret RPC credential appeared here");
        },
      },
      store,
    );

    const response = await service.check(publicRequest());

    expect(response).toMatchObject({
      status: 502,
      body: {
        error: {
          code: "AGENT_FLOW_ERROR",
          message: "Agent Flow could not complete the check",
        },
        run: {
          runId: "run-1",
          status: "integration_error",
          systemStatus: "INTEGRATION_ERROR",
          verdict: "UNKNOWN",
          error: {
            code: "INTERNAL_ERROR",
            stage: "unknown",
            retryable: false,
          },
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("secret RPC credential");
    expect(store.get("run-1")).toMatchObject({
      status: "failed",
      failure: "AGENT_FLOW_ERROR",
    });
  });

  it.each([
    {
      name: "structured timeout",
      cause: {
        code: "TIMEOUT",
        stage: "SIMULATE",
        integrationStatus: "TIMEOUT",
      },
      expected: {
        code: "TIMEOUT",
        stage: "simulation",
        retryable: true,
      },
    },
    {
      name: "RPC unavailability",
      cause: {
        code: "UNAVAILABLE",
        stage: "QUOTE",
        integrationStatus: "UNAVAILABLE",
        source: "rpc",
      },
      expected: {
        code: "RPC_UNAVAILABLE",
        stage: "quote",
        retryable: true,
      },
    },
  ])("maps $name from a structured Agent Flow failure", async (testCase) => {
    const service = createService({
      async check() {
        throw testCase.cause;
      },
    });

    const response = await service.check(publicRequest());

    expect(response).toMatchObject({
      status: 502,
      body: { run: { error: testCase.expected } },
    });
  });

  it("rejects an invalid Agent Flow response before storing it", async () => {
    const store = new InMemoryRunStore();
    const service = createService(
      {
        async check() {
          return { unsupported: true };
        },
      },
      store,
    );

    const response = await service.check(publicRequest());

    expect(response).toMatchObject({
      status: 502,
      body: { error: { code: "INVALID_AGENT_FLOW_RESPONSE" } },
    });
    expect(store.get("run-1")).toMatchObject({
      status: "failed",
      failure: "INVALID_AGENT_FLOW_RESPONSE",
    });
  });

  it("rejects a schema-valid result for a different normalized intent", async () => {
    const store = new InMemoryRunStore();
    const service = createService(
      {
        async check(input) {
          return integrationErrorResult(input.runId, {
            ...input.intent,
            amountInAtomic: "2000000000000000000",
          });
        },
      },
      store,
    );

    const response = await service.check(publicRequest());

    expect(response).toMatchObject({
      status: 502,
      body: { error: { code: "INVALID_AGENT_FLOW_RESPONSE" } },
    });
    expect(store.get("run-1")).toMatchObject({
      status: "failed",
      failure: "INVALID_AGENT_FLOW_RESPONSE",
    });
  });

  it.each([
    { name: "wrong run ID", returnedRunId: "run-2", replayMode: false },
    { name: "replay result", returnedRunId: "run-1", replayMode: true },
  ])("rejects a $name at the live Check boundary", async (testCase) => {
    const service = createService({
      async check(input) {
        return integrationErrorResult(
          testCase.returnedRunId,
          input.intent,
          testCase.replayMode,
        );
      },
    });

    const response = await service.check(publicRequest());

    expect(response).toMatchObject({
      status: 502,
      body: { error: { code: "INVALID_AGENT_FLOW_RESPONSE" } },
    });
  });

  it("isolates storage failures after validating the RunResult", async () => {
    const service = createService(
      {
        async check(input) {
          return integrationErrorResult(input.runId, input.intent);
        },
      },
      {
        async start() {},
        async complete() {
          throw new Error("database connection details");
        },
        async fail() {},
        get() {
          return undefined;
        },
      },
    );

    const response = await service.check(publicRequest());

    expect(response).toEqual({
      status: 500,
      body: {
        error: {
          code: "RUN_STORE_ERROR",
          message: "The check run lifecycle could not be stored",
        },
      },
    });
  });
});
