import type {
  CheckSwapRequest,
  NormalizedSwapIntent,
} from "@parallax/contracts";
import { economicFailStopResult } from "@parallax/orchestrator/application/action-gate-fixtures";
import { describe, expect, it, vi } from "vitest";
import { ChainRegistry } from "../backend/chain-registry.js";
import { createBackendComposition } from "../backend/composition.js";
import {
  createFakeChainAdapter,
  createFakeProtocolAdapter,
  createFakeProviderAdapterHarness,
  fakeBackendFixture,
} from "../backend/fake-harness.js";
import {
  BackendPipeline,
  createBackendCheckFlow,
  createBackendQuoteFlow,
} from "../backend/pipeline.js";
import { ProtocolRegistry } from "../backend/protocol-registry.js";
import { ProviderRegistry } from "../backend/provider-registry.js";
import { bootstrapBackendApp, createBackendApp } from "../bootstrap/backend.js";
import {
  normalizeCheckSwapRequest,
  normalizeQuoteRequest,
} from "../normalization.js";
import { UnsupportedAgentFlowError } from "../ports.js";
import { bootstrapBackendRuntime } from "../runtime-config.js";
import { InMemoryRunStore } from "../store.js";

const sender = "0x1111111111111111111111111111111111111111";
const usdcAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const tokenRegistry = {
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
const environment = {
  MONAD_RPC_URL: "https://rpc.example.test",
  MOSS_RUNTIME_VERSION: "confirmed-portable-baseline",
  MOSS_RUNTIME_REVISION: "moss-commit-123",
};

function checkRequest(): CheckSwapRequest {
  return {
    chainId: 143,
    protocol: "kuru",
    sender,
    tokenIn: { kind: "native" },
    tokenOut: { kind: "erc20", address: usdcAddress },
    amountIn: "1.5",
    economicBoundary: {
      availability: "unavailable",
      source: "unavailable",
    },
  };
}

function economicCheckRequest(): CheckSwapRequest {
  return {
    ...checkRequest(),
    economicBoundary: {
      availability: "available",
      minimumReceived: "0.02",
      source: "user_declared",
    },
  };
}

describe("Backend composition application boundary", () => {
  it("uses composition normalization and RunStore without a second runtime", async () => {
    const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
    const store = new InMemoryRunStore();
    const fixture = fakeBackendFixture();
    const normalize = vi.fn((request: unknown) => {
      const result = normalizeCheckSwapRequest(
        request as CheckSwapRequest,
        runtime.tokenRegistry,
      );
      if (!result.success) throw new Error(result.error.message);
      return result.intent;
    });
    const composition = createBackendComposition({
      chainRegistry: new ChainRegistry([
        createFakeChainAdapter({ ...fixture.chain, chainId: 143 }),
      ]),
      protocolRegistry: new ProtocolRegistry(),
      providerRegistry: new ProviderRegistry(),
      normalization: { normalize },
      core: { evaluate: async () => "unused" },
      decision: { decide: async () => "unused" },
      runStore: store,
    });
    const app = createBackendApp({
      runtime,
      composition,
      agentFlow: {
        async check() {
          throw new UnsupportedAgentFlowError();
        },
      },
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkRequest()),
      }),
    );
    const body = await response.json();
    const runId = (body as { run?: { runId?: string } }).run?.runId;

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: { code: "UNSUPPORTED" },
      run: { status: "integration_error" },
    });
    expect(normalize).toHaveBeenCalledWith(checkRequest());
    expect(runId).toEqual(expect.any(String));
    await expect(store.get(runId as string)).resolves.toMatchObject({
      status: "failed",
      result: { status: "integration_error", runId },
    });
  });

  it("bootstraps with the composition RunStore instead of creating a second store", async () => {
    const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
    const fixture = fakeBackendFixture();
    const store = new InMemoryRunStore();
    const composition = createBackendComposition({
      chainRegistry: new ChainRegistry([
        createFakeChainAdapter({ ...fixture.chain, chainId: 143 }),
      ]),
      protocolRegistry: new ProtocolRegistry(),
      providerRegistry: new ProviderRegistry(),
      normalization: {
        normalize: (request: unknown) => {
          const result = normalizeCheckSwapRequest(
            request as CheckSwapRequest,
            runtime.tokenRegistry,
          );
          if (!result.success) throw new Error(result.error.message);
          return result.intent;
        },
      },
      core: { evaluate: async () => "unused" },
      decision: { decide: async () => "unused" },
      runStore: store,
    });

    const app = bootstrapBackendApp({
      environment,
      tokenRegistry,
      composition,
    });
    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkRequest()),
      }),
    );
    const body = await response.json();
    const runId = (body as { run?: { runId?: string } }).run?.runId;

    expect(response.status).toBe(502);
    expect(runId).toEqual(expect.any(String));
    await expect(store.get(runId as string)).resolves.toMatchObject({
      status: "failed",
      result: { status: "integration_error", runId },
    });
  });

  it("runs Check through fake Chain, Protocol, Provider, and Core seams", async () => {
    const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
    const request = economicCheckRequest();
    const fixture = fakeBackendFixture();
    const chain = createFakeChainAdapter({ ...fixture.chain, chainId: 143 });
    const protocol = createFakeProtocolAdapter(fixture.protocol);
    const { adapter: provider, evaluations } = createFakeProviderAdapterHarness(
      {
        ...fixture.provider,
        supports: (query) => query.chainId === 143 && query.protocol === "kuru",
      },
    );
    const store = new InMemoryRunStore();
    const composition = createBackendComposition({
      chainRegistry: new ChainRegistry([chain]),
      protocolRegistry: new ProtocolRegistry([
        { chainId: 143, protocol: "kuru", adapter: protocol },
      ]),
      providerRegistry: new ProviderRegistry([provider]),
      normalization: {
        normalize: (request: unknown) => {
          const result = normalizeCheckSwapRequest(
            request as CheckSwapRequest,
            runtime.tokenRegistry,
          );
          if (!result.success) throw new Error(result.error.message);
          return result.intent;
        },
      },
      core: {
        evaluate: async (intent: NormalizedSwapIntent) => intent,
      },
      decision: {
        decide: async (_intent: NormalizedSwapIntent, context?: unknown) => {
          const pipelineContext = context as {
            runId: string;
            intent: NormalizedSwapIntent;
          };
          return economicFailStopResult(
            {
              sender: pipelineContext.intent.sender,
              mon: { kind: "native" },
              usdc: pipelineContext.intent.tokenOut as {
                kind: "erc20";
                address: string;
              },
              simulatorPinnedBlock: "42",
              runtimeVersion: runtime.config.moss.runtimeVersion,
              runtimeRevision: runtime.config.moss.runtimeRevision,
            },
            pipelineContext.runId,
            pipelineContext.intent,
          );
        },
      },
      runStore: store,
    });
    const pipeline = new BackendPipeline({ runtime: composition });
    const app = createBackendApp({
      runtime,
      composition,
      agentFlow: createBackendCheckFlow({
        pipeline,
        project: (execution) => execution.decisionOutput,
        capability: "simulate",
      }),
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      verdict: "STOP",
      intent: { amountInAtomic: "1500000000000000000" },
    });
    expect(chain.calls.map((call) => call.operation)).toEqual([
      "connect",
      "getBlockContext",
      "estimateGas",
      "getFinality",
      "connect",
      "getBlockContext",
      "estimateGas",
      "getFinality",
    ]);
    expect(protocol.calls.map((call) => call.operation)).toEqual([
      "quote",
      "buildTransaction",
      "quote",
      "buildTransaction",
    ]);
    expect(evaluations).toHaveLength(2);
  });

  it("maps an unsupported injected Provider to a fail-closed Run", async () => {
    const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
    const fixture = fakeBackendFixture();
    const chain = createFakeChainAdapter({ ...fixture.chain, chainId: 143 });
    const protocol = createFakeProtocolAdapter(fixture.protocol);
    const { adapter: provider, evaluations } = createFakeProviderAdapterHarness(
      {
        ...fixture.provider,
        supports: () => false,
      },
    );
    const core = vi.fn(async () => "must-not-run");
    const store = new InMemoryRunStore();
    const composition = createBackendComposition({
      chainRegistry: new ChainRegistry([chain]),
      protocolRegistry: new ProtocolRegistry([
        { chainId: 143, protocol: "kuru", adapter: protocol },
      ]),
      providerRegistry: new ProviderRegistry([provider]),
      normalization: {
        normalize: (request: unknown) => {
          const result = normalizeCheckSwapRequest(
            request as CheckSwapRequest,
            runtime.tokenRegistry,
          );
          if (!result.success) throw new Error(result.error.message);
          return result.intent;
        },
      },
      core: { evaluate: core },
      decision: { decide: async () => "must-not-run" },
      runStore: store,
    });
    const pipeline = new BackendPipeline({ runtime: composition });
    const app = createBackendApp({
      runtime,
      composition,
      agentFlow: createBackendCheckFlow({
        pipeline,
        project: (execution) => execution.decisionOutput,
        capability: "simulate",
      }),
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkRequest()),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: { code: "UNSUPPORTED" },
      run: {
        status: "integration_error",
        error: { code: "UNSUPPORTED", retryable: false },
      },
    });
    expect(evaluations).toHaveLength(0);
    expect(core).not.toHaveBeenCalled();
  });

  it("runs Quote through the injected Chain and Protocol seams", async () => {
    const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
    const fixture = fakeBackendFixture();
    const chain = createFakeChainAdapter({ ...fixture.chain, chainId: 143 });
    const protocol = createFakeProtocolAdapter(fixture.protocol);
    const store = new InMemoryRunStore();
    const composition = createBackendComposition({
      chainRegistry: new ChainRegistry([chain]),
      protocolRegistry: new ProtocolRegistry([
        { chainId: 143, protocol: "kuru", adapter: protocol },
      ]),
      providerRegistry: new ProviderRegistry(),
      normalization: {
        normalize: (request: unknown) => {
          const result = normalizeQuoteRequest(
            request as Omit<CheckSwapRequest, "economicBoundary">,
            runtime.tokenRegistry,
          );
          if (!result.success) throw new Error(result.error.message);
          return result.intent;
        },
      },
      core: { evaluate: async () => "unused" },
      decision: { decide: async () => "unused" },
      runStore: store,
    });
    const app = createBackendApp({
      runtime,
      composition,
      quoteFlow: createBackendQuoteFlow({
        runtime: composition,
        project: ({ blockContext, quote }) => ({
          status: "available",
          quote: {
            estimatedAmountOut: (quote as { amountOut: string }).amountOut,
            source: "quote",
            blockNumber: blockContext.blockNumber,
            runtimeVersion: runtime.config.moss.runtimeVersion,
            runtimeRevision: runtime.config.moss.runtimeRevision,
          },
        }),
      }),
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 143,
          protocol: "kuru",
          sender,
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: usdcAddress },
          amountIn: "1.5",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "available",
      quote: { estimatedAmountOut: "42", blockNumber: "42" },
    });
    expect(chain.calls.map((call) => call.operation)).toEqual([
      "connect",
      "getBlockContext",
    ]);
    expect(protocol.calls.map((call) => call.operation)).toEqual(["quote"]);
  });

  it.each([
    "failed",
    "stale",
    "unknown",
    "invalid",
    "timeout",
    "unsupported",
  ] as const)(
    "fails closed at the public Check boundary for Provider evidence %s",
    async (status) => {
      const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
      const fixture = fakeBackendFixture();
      const chain = createFakeChainAdapter({ ...fixture.chain, chainId: 143 });
      const protocol = createFakeProtocolAdapter(fixture.protocol);
      const { adapter: provider, evaluations } =
        createFakeProviderAdapterHarness({
          ...fixture.provider,
          supports: (query) =>
            query.chainId === 143 && query.protocol === "kuru",
          result: {
            provider: {
              providerId: fixture.provider.providerId,
              observedAt: "2026-09-01T00:00:00.000Z",
            },
            status,
            responseEvidence: {
              kind: "reference",
              reference: `fixture://${fixture.provider.providerId}/${status}`,
            },
            candidateFields: [],
          },
        });
      const core = vi.fn(async () => "must-not-run");
      const decision = vi.fn(async () => "must-not-run");
      const store = new InMemoryRunStore();
      const composition = createBackendComposition({
        chainRegistry: new ChainRegistry([chain]),
        protocolRegistry: new ProtocolRegistry([
          { chainId: 143, protocol: "kuru", adapter: protocol },
        ]),
        providerRegistry: new ProviderRegistry([provider]),
        normalization: {
          normalize: (request: unknown) => {
            const result = normalizeCheckSwapRequest(
              request as CheckSwapRequest,
              runtime.tokenRegistry,
            );
            if (!result.success) throw new Error(result.error.message);
            return result.intent;
          },
        },
        core: { evaluate: core },
        decision: { decide: decision },
        runStore: store,
      });
      const pipeline = new BackendPipeline({ runtime: composition });
      const app = createBackendApp({
        runtime,
        composition,
        agentFlow: createBackendCheckFlow({
          pipeline,
          project: (execution) => execution.decisionOutput,
          capability: "simulate",
        }),
      });

      const response = await app.fetch(
        new Request("https://api.example.test/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(checkRequest()),
        }),
      );
      const body = await response.json();
      const unsupported = status === "unsupported";
      const expectedRunErrorCode =
        unsupported
          ? "UNSUPPORTED"
          : status === "timeout"
            ? "TIMEOUT"
            : "INTERNAL_ERROR";

      expect(response.status).toBe(502);
      expect(body).toMatchObject({
        error: { code: unsupported ? "UNSUPPORTED" : "AGENT_FLOW_ERROR" },
        run: {
          status: "integration_error",
          systemStatus: "INTEGRATION_ERROR",
          verdict: "UNKNOWN",
          error: {
            code: expectedRunErrorCode,
            stage: "unknown",
            retryable: status === "timeout",
          },
        },
      });
      expect(evaluations).toHaveLength(1);
      expect(core).not.toHaveBeenCalled();
      expect(decision).not.toHaveBeenCalled();
    },
  );

  it("keeps recorded Replay separate from composition-backed live Check Runs", async () => {
    const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
    const fixture = fakeBackendFixture();
    const store = new InMemoryRunStore();
    const composition = createBackendComposition({
      chainRegistry: new ChainRegistry([
        createFakeChainAdapter({ ...fixture.chain, chainId: 143 }),
      ]),
      protocolRegistry: new ProtocolRegistry(),
      providerRegistry: new ProviderRegistry(),
      normalization: {
        normalize: (request: unknown) => {
          const result = normalizeCheckSwapRequest(
            request as CheckSwapRequest,
            runtime.tokenRegistry,
          );
          if (!result.success) throw new Error(result.error.message);
          return result.intent;
        },
      },
      core: { evaluate: async () => "must-not-run" },
      decision: { decide: async () => "must-not-run" },
      runStore: store,
    });
    let liveAgentFlowCalls = 0;
    const app = createBackendApp({
      runtime,
      composition,
      agentFlow: {
        async check() {
          liveAgentFlowCalls += 1;
          throw new UnsupportedAgentFlowError();
        },
      },
    });

    const replayResponse = await app.fetch(
      new Request("https://api.example.test/api/replay/mon-to-usdc"),
    );
    const replayBody = await replayResponse.json();
    const replayRunId = (replayBody as { runId: string }).runId;

    expect(replayResponse.status).toBe(200);
    expect(replayBody).toMatchObject({
      runId: "recorded-kuru-mon-to-usdc-91383505",
      replayMode: true,
      status: "completed",
    });
    expect(
      (
        replayBody as {
          evidence: Array<{
            fixtureId: string;
            isReplay: boolean;
            isMock: boolean;
          }>;
        }
      ).evidence.every(
        (item) =>
          item.fixtureId === "mon-to-usdc" &&
          item.isReplay === true &&
          item.isMock === false,
      ),
    ).toBe(true);
    await expect(store.get(replayRunId)).resolves.toBeUndefined();

    const liveResponse = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkRequest()),
      }),
    );
    const liveBody = await liveResponse.json();

    expect(liveResponse.status).toBe(502);
    expect(liveBody).toMatchObject({
      error: { code: "UNSUPPORTED" },
      run: {
        replayMode: false,
        status: "integration_error",
        verdict: "UNKNOWN",
      },
    });
    expect(liveAgentFlowCalls).toBe(1);
  });

  it("preserves parentRunId and Diff through a composition-backed public Check Re-run", async () => {
    const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
    const fixture = fakeBackendFixture();
    const chain = createFakeChainAdapter({ ...fixture.chain, chainId: 143 });
    const protocol = createFakeProtocolAdapter(fixture.protocol);
    const { adapter: provider, evaluations } = createFakeProviderAdapterHarness(
      {
        ...fixture.provider,
        supports: (query) => query.chainId === 143 && query.protocol === "kuru",
      },
    );
    const store = new InMemoryRunStore();
    const core = vi.fn(async (intent: NormalizedSwapIntent) => intent);
    const decision = vi.fn(async (_input: unknown, context?: unknown) => {
      const pipelineContext = context as {
        runId: string;
        intent: NormalizedSwapIntent;
      };
      return {
        runId: pipelineContext.runId,
        replayMode: false,
        intent: pipelineContext.intent,
        status: "integration_error" as const,
        systemStatus: "INTEGRATION_ERROR" as const,
        verdict: "UNKNOWN" as const,
        summary: "The composition fixture completed with an integration error",
        error: {
          code: "INTERNAL_ERROR" as const,
          stage: "unknown" as const,
          message: "The composition fixture failed closed",
          retryable: false,
        },
        ruleResults: [],
        recommendedActions: [],
        irrelevantActions: [],
        evidence: [],
        scope: [
          {
            key: "P0-CHECK-SIMULATION-001",
            label: "Moss simulation",
            status: "unknown" as const,
            reason: "REQUIRED_CHECK_INTERRUPTED" as const,
          },
        ],
      };
    });
    const composition = createBackendComposition({
      chainRegistry: new ChainRegistry([chain]),
      protocolRegistry: new ProtocolRegistry([
        { chainId: 143, protocol: "kuru", adapter: protocol },
      ]),
      providerRegistry: new ProviderRegistry([provider]),
      normalization: {
        normalize: (request: unknown) => {
          const result = normalizeCheckSwapRequest(
            request as CheckSwapRequest,
            runtime.tokenRegistry,
          );
          if (!result.success) throw new Error(result.error.message);
          return result.intent;
        },
      },
      core: { evaluate: core },
      decision: { decide: decision },
      runStore: store,
    });
    const pipeline = new BackendPipeline({ runtime: composition });
    const app = createBackendApp({
      runtime,
      composition,
      agentFlow: createBackendCheckFlow({
        pipeline,
        project: (execution) => execution.decisionOutput,
        capability: "simulate",
      }),
    });

    const baselineResponse = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkRequest()),
      }),
    );
    const baselineBody = await baselineResponse.json();
    const baselineRunId = (baselineBody as { runId: string }).runId;

    const rerunResponse = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...checkRequest(),
          amountIn: "2",
          parentRunId: baselineRunId,
        }),
      }),
    );
    const rerunBody = await rerunResponse.json();
    const rerunRunId = (rerunBody as { runId: string }).runId;

    expect(baselineResponse.status).toBe(200);
    expect(baselineRunId).toEqual(expect.any(String));
    expect(rerunResponse.status).toBe(200);
    expect(rerunBody).toMatchObject({
      status: "integration_error",
      parentRunId: baselineRunId,
      diff: {
        previousRunId: baselineRunId,
        previousVerdict: "UNKNOWN",
        changedFields: [
          {
            field: "amountInAtomic",
            before: "1500000000000000000",
            after: "2000000000000000000",
          },
        ],
      },
    });
    expect(rerunRunId).toEqual(expect.any(String));
    await expect(store.get(baselineRunId)).resolves.toMatchObject({
      status: "completed",
      parentRunId: undefined,
      result: baselineBody,
    });
    await expect(store.get(rerunRunId)).resolves.toMatchObject({
      status: "completed",
      parentRunId: baselineRunId,
      result: rerunBody,
    });
    expect(evaluations).toHaveLength(2);
    expect(core).toHaveBeenCalledTimes(2);
    expect(decision).toHaveBeenCalledTimes(2);
  });
});
