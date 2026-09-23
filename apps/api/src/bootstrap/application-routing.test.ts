import type { CheckSwapRequest } from "@parallax/contracts";
import { describe, expect, it, vi } from "vitest";
import type { BackendApplicationRoute } from "../backend/application-routing.js";
import { createArbitrumProductionComposition } from "../backend/arbitrum-composition.js";
import { createCamelotV3ProtocolAdapter } from "../backend/camelot-v3-protocol-adapter.js";
import { createFakeChainAdapter } from "../backend/fake-harness.js";
import { UnsupportedAgentFlowError } from "../ports.js";
import { bootstrapBackendRuntime } from "../runtime-config.js";
import { InMemoryRunStore } from "../store.js";
import { bootstrapBackendApp, createBackendApp } from "./backend.js";

const sender = "0x1111111111111111111111111111111111111111";
const tokenOut = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const environment = {
  MONAD_RPC_URL: "https://monad.example.test",
  MOSS_RUNTIME_VERSION: "runtime",
  MOSS_RUNTIME_REVISION: "revision",
};
const tokenRegistry = {
  chains: [
    { chainId: 143, symbol: "MON", decimals: 18 },
    { chainId: 421614, symbol: "ETH", decimals: 18 },
  ],
  tokens: [
    {
      chainId: 421614,
      address: tokenOut,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "42",
    },
  ],
};

function arbitrumRequest(): CheckSwapRequest {
  return {
    chainId: 421614,
    protocol: "camelot-v3",
    sender,
    tokenIn: { kind: "native" },
    tokenOut: { kind: "erc20", address: tokenOut },
    amountIn: "1",
    economicBoundary: {
      availability: "unavailable",
      source: "unavailable",
    },
  };
}

describe("Backend chain application routing", () => {
  it("uses the Arbitrum composition and flows for Arbitrum requests", async () => {
    const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
    const store = new InMemoryRunStore();
    const normalize = vi.fn(() => ({
      chainId: 421614,
      protocol: "camelot-v3",
      sender,
      recipient: sender,
      recipientSource: "defaulted_from_sender" as const,
      tokenIn: { kind: "native" as const },
      tokenOut: { kind: "erc20" as const, address: tokenOut },
      amountInAtomic: "1000000000000000000",
      economicBoundary: {
        availability: "unavailable" as const,
        source: "unavailable" as const,
      },
    }));
    const check = vi.fn(async () => {
      throw new UnsupportedAgentFlowError();
    });
    const quote = vi.fn(async () => ({
      status: "available" as const,
      quote: {
        estimatedAmountOut: "0.2",
        source: "quote" as const,
        blockNumber: "42",
        runtimeVersion: "runtime",
        runtimeRevision: "revision",
      },
    }));
    const route: BackendApplicationRoute = {
      chainId: 421614,
      composition: { runStore: store, normalize },
      agentFlow: { check },
      quoteFlow: { quote },
    };
    const app = createBackendApp({ runtime, store, routes: [route] });

    const checkResponse = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(arbitrumRequest()),
      }),
    );
    expect(checkResponse.status).toBe(502);
    expect(normalize).toHaveBeenCalledWith(arbitrumRequest());
    expect(check).toHaveBeenCalledOnce();

    const quoteResponse = await app.fetch(
      new Request("https://api.example.test/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender,
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: tokenOut },
          amountIn: "1",
        }),
      }),
    );
    expect(quoteResponse.status).toBe(200);
    expect(quote).toHaveBeenCalledOnce();
  });

  it("bootstraps an injected Arbitrum composition as the production route", async () => {
    const runtime = bootstrapBackendRuntime({
      environment: {
        ...environment,
        ARBITRUM_RPC_URL: "https://arbitrum.example.test",
      },
      tokenRegistry,
    });
    const store = new InMemoryRunStore();
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: store,
      chainAdapter: createFakeChainAdapter({
        chainId: 421614,
        blockNumber: "42",
        gasUnits: "21000",
        finality: { status: "finalized" },
      }),
      protocolAdapter: createCamelotV3ProtocolAdapter({
        quote: async () => ({
          estimatedAmountOut: "0.2",
          source: "quote",
          runtimeVersion: "runtime",
          runtimeRevision: "revision",
        }),
        buildTransaction: async () => ({
          to: sender,
          data: "0x1234",
          value: "0x0",
        }),
      }),
      providers: [],
      core: { evaluate: async () => undefined },
      decision: { decide: async () => undefined },
    });
    const app = bootstrapBackendApp({
      environment: {
        ...environment,
        ARBITRUM_RPC_URL: "https://arbitrum.example.test",
      },
      tokenRegistry,
      arbitrumComposition: composition,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender,
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: tokenOut },
          amountIn: "1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "available",
      quote: {
        estimatedAmountOut: "0.2",
        blockNumber: "42",
      },
    });
  });
});
