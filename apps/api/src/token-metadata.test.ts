import {
  type AssetReference,
  type NormalizedSwapIntent,
  runResultSchema,
} from "@parallax/contracts";
import { economicFailStopResult } from "@parallax/orchestrator/application/action-gate-fixtures";
import { describe, expect, it, vi } from "vitest";
import { CAMELOT_SEPOLIA_USDC } from "./backend/camelot-v3-protocol-adapter.js";
import { ChainRegistry } from "./backend/chain-registry.js";
import { createBackendComposition } from "./backend/composition.js";
import {
  createFakeChainAdapter,
  createFakeProtocolAdapter,
} from "./backend/fake-harness.js";
import { ProtocolRegistry } from "./backend/protocol-registry.js";
import { ProviderRegistry } from "./backend/provider-registry.js";
import { bootstrapBackendApp, createBackendApp } from "./bootstrap/backend.js";
import type { AgentFlowCheckInput } from "./ports.js";
import { QuoteApplicationService } from "./quote-application.js";
import { createP0ConfigApp } from "./routes/p0-config.js";
import type { BackendRuntime } from "./runtime-config.js";
import { InMemoryRunStore } from "./store.js";
import { resolveTokenMetadata } from "./token-metadata.js";
import { createTrustedTokenRegistry } from "./trusted-token-registry.js";

const address = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const sender = "0x1111111111111111111111111111111111111111";
const config = {
  chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
  tokens: [
    {
      chainId: 143,
      address,
      symbol: "TEST",
      decimals: 7,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "42",
    },
  ],
};
function runtime(): BackendRuntime {
  return {
    config: {
      tokenRegistry: config,
      moss: {
        rpcUrl: "https://private.example.test/secret",
        runtimeVersion: "v1",
        runtimeRevision: "rev1",
      },
    },
    tokenRegistry: createTrustedTokenRegistry(config),
  };
}
const request = {
  chainId: 143,
  protocol: "kuru",
  sender,
  tokenIn: { kind: "native" },
  tokenOut: { kind: "erc20", address },
  amountIn: "1.5",
  economicBoundary: {
    availability: "available",
    minimumReceived: "0.002",
    source: "user_declared",
  },
};
function completed(runId: string, intent: NormalizedSwapIntent) {
  return economicFailStopResult(
    {
      sender,
      mon: { kind: "native" },
      usdc: { kind: "erc20", address },
      simulatorPinnedBlock: "42",
      runtimeVersion: "v1",
      runtimeRevision: "rev1",
    },
    runId,
    intent,
  );
}

describe("Backend trusted token metadata", () => {
  it("discovers P0 through production routes and a direct composition without executing adapters", async () => {
    const tokenRegistry = {
      chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
      tokens: [
        { ...config.tokens[0], chainId: 421614, address: CAMELOT_SEPOLIA_USDC },
      ],
    };
    const app = bootstrapBackendApp({
      environment: {
        MONAD_RPC_URL: "https://rpc.example.test",
        ARBITRUM_RPC_URL: "https://rpc.example.test",
        MOSS_RUNTIME_VERSION: "v1",
        MOSS_RUNTIME_REVISION: "rev1",
      },
      tokenRegistry,
    });
    expect(await (await app.request("/api/p0-config")).json()).toMatchObject({
      status: "AVAILABLE",
      chainId: 421614,
    });
    await app.close();
    const chain = createFakeChainAdapter({
      chainId: 421614,
      blockNumber: "42",
      gasUnits: "21000",
      finality: { status: "unknown" },
    });
    const protocol = createFakeProtocolAdapter();
    const composition = createBackendComposition({
      chainRegistry: new ChainRegistry([chain]),
      protocolRegistry: new ProtocolRegistry([
        { chainId: 421614, protocol: "camelot-v3", adapter: protocol },
      ]),
      providerRegistry: new ProviderRegistry(),
      normalization: {
        normalize: () => {
          throw new Error("must not normalize for config");
        },
      },
      core: { evaluate: () => "unused" },
      decision: { decide: () => "unused" },
      runStore: new InMemoryRunStore(),
    });
    const rt = runtime();
    rt.tokenRegistry = createTrustedTokenRegistry(tokenRegistry);
    const directApp = createBackendApp({ runtime: rt, composition });
    expect(
      await (await directApp.request("/api/p0-config")).json(),
    ).toMatchObject({ status: "AVAILABLE", chainId: 421614 });
    expect(chain.calls).toEqual([]);
    expect(protocol.calls).toEqual([]);
    await directApp.close();

    const overridingRouteApp = createBackendApp({
      runtime: rt,
      composition,
      routes: [
        {
          chainId: 421614,
          composition: {
            runStore: composition.runStore,
            normalize: () => {
              throw new Error("selected route is unsupported");
            },
          },
          agentFlow: {
            check: async () => {
              throw new Error("unsupported");
            },
          },
          quoteFlow: {
            quote: async () => ({ status: "unavailable", reason: "NO_ROUTE" }),
          },
        },
      ],
    });
    expect(
      await (await overridingRouteApp.request("/api/p0-config")).json(),
    ).toEqual({
      status: "UNAVAILABLE",
      reason: "ROUTE_NOT_CONFIGURED",
    });
    await overridingRouteApp.close();
  });
  it("publishes the configured P0 identity without an RPC or account-state query", async () => {
    const registry = createTrustedTokenRegistry({
      chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
      tokens: [
        {
          ...config.tokens[0],
          chainId: 421614,
          address: CAMELOT_SEPOLIA_USDC,
          symbol: "USDC",
          decimals: 18,
        },
      ],
    });
    const app = createP0ConfigApp(registry, true);
    const response = await app.request("/api/p0-config");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: "AVAILABLE",
      chainId: 421614,
      protocol: "camelot-v3",
      tokenMetadata: {
        tokenIn: {
          asset: { kind: "native" },
          symbol: "ETH",
          decimalsSource: "chain_config",
        },
        tokenOut: {
          asset: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
          decimals: 18,
          decimalsSource: "onchain_verified",
          verifiedAtBlock: "42",
        },
      },
    });
    expect(
      (await app.request("/api/p0-config", { method: "POST" })).status,
    ).toBe(405);
  });

  it("fails closed for absent P0 route or metadata", async () => {
    expect(
      await (
        await createP0ConfigApp(runtime().tokenRegistry, false).request(
          "/api/p0-config",
        )
      ).json(),
    ).toEqual({ status: "UNAVAILABLE", reason: "ROUTE_NOT_CONFIGURED" });
    expect(
      await (
        await createP0ConfigApp(runtime().tokenRegistry, true).request(
          "/api/p0-config",
        )
      ).json(),
    ).toEqual({ status: "UNAVAILABLE", reason: "TOKEN_METADATA_UNAVAILABLE" });
  });

  it("preserves the execution-time snapshot through check and recovery after registry changes", async () => {
    const rt = runtime();
    let registry = rt.tokenRegistry;
    const resolve = vi.fn((chainId: number, asset: AssetReference) =>
      registry.resolve(chainId, asset),
    );
    rt.tokenRegistry = { hasChain: (id) => registry.hasChain(id), resolve };
    const flow = vi.fn(async ({ runId, intent }: AgentFlowCheckInput) => {
      registry = createTrustedTokenRegistry({
        ...config,
        tokens: [{ ...config.tokens[0], symbol: "CHANGED", decimals: 6 }],
      });
      return completed(runId, intent);
    });
    const app = createBackendApp({ runtime: rt, agentFlow: { check: flow } });
    const response = await app.request("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.tokenMetadata.tokenOut).toMatchObject({
      symbol: "TEST",
      decimals: 7,
      asset: { kind: "erc20", address },
    });
    expect(result.verdict).toBe("STOP");
    resolve.mockClear();
    flow.mockClear();
    const recovered = await (
      await app.request(`/api/runs/${result.runId}`)
    ).json();
    expect(recovered.result).toEqual(result);
    expect(resolve).not.toHaveBeenCalled();
    expect(flow).not.toHaveBeenCalled();
    expect(JSON.stringify(recovered)).not.toContain("private.example");
  });

  it("snapshots metadata for interrupted checks and rejects client metadata", async () => {
    const app = createBackendApp({
      runtime: runtime(),
      agentFlow: {
        check: async () => {
          throw new Error("private provider failure");
        },
      },
    });
    const send = (body: unknown) =>
      app.request("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await send({ ...request, tokenMetadata: {} })).status).toBe(400);
    const response = await send(request);
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.run.tokenMetadata.tokenOut.decimals).toBe(7);
    expect(
      (await (await app.request(`/api/runs/${body.run.runId}`)).json()).result
        .tokenMetadata,
    ).toEqual(body.run.tokenMetadata);
  });

  it("replaces mismatched metadata on an otherwise valid partial result", async () => {
    const foreignAddress = "0x1234567890123456789012345678901234567890";
    const app = createBackendApp({
      runtime: runtime(),
      agentFlow: {
        check: async ({ runId, intent }) => {
          const partialRunResult = runResultSchema.parse({
            runId,
            replayMode: false,
            intent,
            status: "integration_error",
            systemStatus: "INTEGRATION_ERROR",
            verdict: "UNKNOWN",
            summary: "Partial execution facts retained",
            error: {
              code: "MOSS_UNAVAILABLE",
              stage: "unknown",
              message: "Unavailable",
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
          });
          throw Object.assign(new Error("provider failure"), {
            partialRunResult: {
              ...partialRunResult,
              tokenMetadata: {
                tokenIn: {
                  chainId: 143,
                  asset: { kind: "native" },
                  symbol: "MON",
                  decimals: 18,
                  decimalsSource: "chain_config",
                },
                tokenOut: {
                  chainId: 143,
                  asset: { kind: "erc20", address: foreignAddress },
                  symbol: "FOREIGN",
                  decimals: 6,
                  decimalsSource: "onchain_verified",
                  verifiedAtBlock: "42",
                },
              },
            },
          });
        },
      },
    });
    const response = await app.request("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.run.summary).toBe("Partial execution facts retained");
    expect(body.run.tokenMetadata.tokenOut.asset).toEqual({
      kind: "erc20",
      address,
    });
    const recovered = await (
      await app.request(`/api/runs/${body.run.runId}`)
    ).json();
    expect(recovered.status).toBe("failed");
    expect(recovered.result.summary).toBe("Partial execution facts retained");
    await app.close();
  });

  it("discards a partial failure from another Intent and terminally records the current Run", async () => {
    const foreignIntent = {
      chainId: 143,
      protocol: "kuru",
      sender,
      recipient: sender,
      recipientSource: "defaulted_from_sender" as const,
      tokenIn: { kind: "native" as const },
      tokenOut: {
        kind: "erc20" as const,
        address: "0x1234567890123456789012345678901234567890",
      },
      amountInAtomic: "1500000000000000000",
      economicBoundary: {
        availability: "unavailable" as const,
        source: "unavailable" as const,
      },
    } satisfies NormalizedSwapIntent;
    const partialRunResult = runResultSchema.parse({
      runId: "placeholder-run-id",
      replayMode: false,
      intent: foreignIntent,
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "Foreign partial result",
      error: {
        code: "MOSS_UNAVAILABLE",
        stage: "unknown",
        message: "Unavailable",
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
      tokenMetadata: {
        tokenIn: {
          chainId: 143,
          asset: { kind: "native" },
          symbol: "MON",
          decimals: 18,
          decimalsSource: "chain_config",
        },
        tokenOut: {
          chainId: 143,
          asset: { kind: "erc20", address: foreignIntent.tokenOut.address },
          symbol: "FOREIGN",
          decimals: 6,
          decimalsSource: "onchain_verified",
          verifiedAtBlock: "42",
        },
      },
    });
    const app = createBackendApp({
      runtime: runtime(),
      agentFlow: {
        check: async ({ runId }) => {
          throw Object.assign(new Error("provider failure"), {
            partialRunResult: { ...partialRunResult, runId },
          });
        },
      },
    });
    const response = await app.request("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.run.intent.tokenOut).toEqual({ kind: "erc20", address });
    expect(body.run.tokenMetadata.tokenOut.asset).toEqual({
      kind: "erc20",
      address,
    });
    const recovered = await (
      await app.request(`/api/runs/${body.run.runId}`)
    ).json();
    expect(recovered.status).toBe("failed");
    expect(recovered.result.intent.tokenOut).toEqual({
      kind: "erc20",
      address,
    });
    await app.close();
  });

  it("returns quote metadata captured before the quote flow", async () => {
    const rt = runtime();
    const service = new QuoteApplicationService({
      runtime: rt,
      quoteFlow: {
        quote: async () => {
          rt.tokenRegistry = createTrustedTokenRegistry({
            ...config,
            tokens: [{ ...config.tokens[0], decimals: 6 }],
          });
          return { status: "unavailable", reason: "NO_ROUTE" };
        },
      },
    });
    const { economicBoundary: _boundary, ...quoteRequest } = request;
    expect(await service.quote(quoteRequest)).toMatchObject({
      status: 200,
      body: {
        status: "unavailable",
        tokenMetadata: { tokenOut: { decimals: 7 } },
      },
    });
  });

  it("accepts legacy Runs while rejecting metadata bound to another asset or chain", () => {
    const intent: NormalizedSwapIntent = {
      chainId: 143,
      sender,
      protocol: "kuru",
      tokenIn: { kind: "native" },
      tokenOut: { kind: "erc20", address },
      recipient: sender,
      recipientSource: "defaulted_from_sender",
      amountInAtomic: "1500000000000000000",
      economicBoundary: {
        availability: "available",
        minimumReceivedAtomic: "20000",
        source: "user_declared",
      },
    };
    const result = completed("legacy", intent);
    expect(runResultSchema.safeParse(result).success).toBe(true);
    const metadata = resolveTokenMetadata(runtime().tokenRegistry, intent);
    expect(
      runResultSchema.safeParse({ ...result, tokenMetadata: metadata }).success,
    ).toBe(true);
    metadata.tokenOut.asset = { kind: "erc20", address: sender };
    expect(
      runResultSchema.safeParse({ ...result, tokenMetadata: metadata }).success,
    ).toBe(false);
    metadata.tokenOut.chainId = 421614;
    expect(
      runResultSchema.safeParse({ ...result, tokenMetadata: metadata }).success,
    ).toBe(false);
  });
});
