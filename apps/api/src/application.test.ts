import type { NormalizedSwapIntent, RunResult } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { CheckApplicationService } from "./application.js";
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

function publicRequest(overrides: Record<string, unknown> = {}) {
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

  const routeEvidenceRef = {
    key: routeEvidence.key,
    source: routeEvidence.source,
    stage: routeEvidence.stage,
    blockNumber: routeEvidence.blockNumber,
    runtimeVersion: routeEvidence.runtimeVersion,
    runtimeRevision: routeEvidence.runtimeRevision,
    reproducibility: routeEvidence.reproducibility,
    isReplay: routeEvidence.isReplay,
    isMock: routeEvidence.isMock,
  };

  return {
    runId,
    replayMode: false,
    intent,
    status: "completed",
    systemStatus: "OK",
    verdict: "UNKNOWN",
    summary: "The economic boundary was not provided.",
    ruleResults: [
      {
        ruleId: "P0-ECONOMIC-001",
        status: "NOT_APPLICABLE",
        applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
        evidenceRefs: [],
        actionEvaluations: [],
      },
    ],
    recommendedActions: [],
    irrelevantActions: [],
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
      evidenceRef: routeEvidenceRef,
    },
  };
}

function createService(
  agentFlow: AgentFlowPort,
  store: RunStore = new InMemoryRunStore(),
) {
  return new CheckApplicationService({
    runtime,
    agentFlow,
    store,
    createRunId: () => "run-1",
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

    expect(response).toEqual({
      status: 502,
      body: {
        error: {
          code: "AGENT_FLOW_ERROR",
          message: "Agent Flow could not complete the check",
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("secret RPC credential");
    expect(store.get("run-1")).toMatchObject({
      status: "failed",
      failure: "AGENT_FLOW_ERROR",
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
