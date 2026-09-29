import { type CheckSwapRequest, runResultSchema } from "@parallax/contracts";
import { describe, expect, it, vi } from "vitest";
import type { BackendApplicationRoute } from "../backend/application-routing.js";
import {
  type ArbitrumRpcClient,
  createArbitrumChainAdapter,
  createArbitrumRpcClient,
} from "../backend/arbitrum-chain-adapter.js";
import { createArbitrumProductionComposition } from "../backend/arbitrum-composition.js";
import { createCamelotV3ProtocolAdapter } from "../backend/camelot-v3-protocol-adapter.js";
import { createFakeChainAdapter } from "../backend/fake-harness.js";
import { createNativeRpcProviderAdapter } from "../backend/native-rpc-provider.js";
import { PROVIDER_OWNED_GAS_ESTIMATE_CAPABILITY } from "../backend/provider-adapter.js";
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

function createNativeRpcIntegrationApp(rpcClient: ArbitrumRpcClient) {
  const rpcEnvironment = {
    ...environment,
    ARBITRUM_RPC_URL: "https://arbitrum.example.test",
  };
  const runtime = bootstrapBackendRuntime({
    environment: rpcEnvironment,
    tokenRegistry,
  });
  const composition = createArbitrumProductionComposition({
    runtime,
    runStore: new InMemoryRunStore(),
    chainAdapter: createArbitrumChainAdapter({ client: rpcClient }),
    protocolAdapter: createCamelotV3ProtocolAdapter({
      rpcClient,
      tokenOutDecimals: 6,
      quote: async () => ({
        estimatedAmountOut: "0.2",
        amountOutAtomic: "200000",
        source: "quote",
        blockNumber: "42",
        runtimeVersion: "runtime",
        runtimeRevision: "revision",
      }),
    }),
    providers: [
      createNativeRpcProviderAdapter({ client: rpcClient, mode: "LIVE" }),
    ],
  });

  return bootstrapBackendApp({
    environment: rpcEnvironment,
    tokenRegistry,
    arbitrumComposition: composition,
  });
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
        observedAt: "2026-09-29T07:00:00.000Z",
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
        fetchedAt: "2026-09-29T07:00:00.000Z",
      },
    });
  });

  it("lets Native RPC preserve partial simulation facts when the unpinned gas preflight cannot fund the transaction", async () => {
    const rawBalanceError =
      "failed with 50003829 gas: insufficient funds for gas * price + value: address 0x1111111111111111111111111111111111111111 have 50883771891842106 want 100000000000000000000";
    const blockHash = `0x${"11".repeat(32)}`;
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    const rpcClient: ArbitrumRpcClient = {
      async request(method, params = []) {
        calls.push({ method, params });
        switch (method) {
          case "eth_chainId":
            return "0x66eee";
          case "eth_getBlockByNumber":
            return params[0] === "finalized"
              ? null
              : { number: "0x2a", hash: blockHash };
          case "eth_call":
            return "0xabcdef";
          case "eth_estimateGas":
            throw new Error(rawBalanceError);
          default:
            throw new Error(`unexpected RPC method ${method}`);
        }
      },
    };
    const app = createNativeRpcIntegrationApp(rpcClient);

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...arbitrumRequest(), amountIn: "100" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = runResultSchema.parse(await response.json());
    expect(body).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      p0: {
        basicSimulation: {
          call: { status: "SUCCEEDED" },
          gasEstimate: { status: "UNAVAILABLE" },
          blockNumber: "42",
          validityAtExecution: "UNKNOWN",
          failureStage: "GAS_ESTIMATE",
        },
      },
      providerEvidence: {
        quote: { value: { estimatedAmountOut: "0.2" }, blockNumber: "42" },
      },
    });
    expect(body.providerEvidence?.capabilities).not.toContain(
      PROVIDER_OWNED_GAS_ESTIMATE_CAPABILITY,
    );
    expect(JSON.stringify(body)).not.toContain(rawBalanceError);
    expect(body.p0?.basicSimulation?.preparedTransactionFingerprint).toMatch(
      /^sha256:/,
    );
    expect(
      calls
        .filter(({ method }) => method === "eth_estimateGas")
        .map(({ params }) => params.length),
    ).toEqual([1, 2]);

    const historyResponse = await app.fetch(
      new Request(
        `https://api.example.test/api/runs/${encodeURIComponent(body.runId)}`,
      ),
    );
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json();
    expect(history).toMatchObject({
      status: "completed",
      result: { status: "completed", verdict: "UNKNOWN" },
    });
    expect(JSON.stringify(history)).not.toContain(
      PROVIDER_OWNED_GAS_ESTIMATE_CAPABILITY,
    );
    expect(JSON.stringify(history)).not.toContain(rawBalanceError);
    expect((history as { result?: { p0?: unknown } }).result?.p0).toMatchObject(
      {
        basicSimulation: {
          gasEstimate: { status: "UNAVAILABLE" },
        },
      },
    );
    await app.close();
  });

  it.each([400, 422])(
    "stops on an RPC HTTP %s without falling back to the Native RPC Provider",
    async (httpStatus) => {
      const methods: string[] = [];
      const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
        };
        methods.push(request.method);
        if (request.method === "eth_estimateGas") {
          return new Response("bad request", { status: httpStatus });
        }

        const result =
          request.method === "eth_chainId"
            ? "0x66eee"
            : { number: "0x2a", hash: `0x${"11".repeat(32)}` };
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
      const rpcClient = createArbitrumRpcClient(
        "https://arbitrum.example.test",
        fetchImplementation,
      );
      const app = createNativeRpcIntegrationApp(rpcClient);

      const response = await app.fetch(
        new Request("https://api.example.test/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(arbitrumRequest()),
        }),
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        error: { code: "AGENT_FLOW_ERROR" },
        run: {
          error: { code: "INTERNAL_ERROR" },
        },
      });
      expect(methods).toEqual([
        "eth_chainId",
        "eth_getBlockByNumber",
        "eth_estimateGas",
      ]);
      await app.close();
    },
  );

  it("uses Native RPC's pinned gas result after an unpinned insufficient-balance preflight", async () => {
    const rawBalanceError =
      "insufficient funds for gas * price + value: address 0x1111111111111111111111111111111111111111";
    const blockHash = `0x${"11".repeat(32)}`;
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    const rpcClient: ArbitrumRpcClient = {
      async request(method, params = []) {
        calls.push({ method, params });
        switch (method) {
          case "eth_chainId":
            return "0x66eee";
          case "eth_getBlockByNumber":
            return params[0] === "finalized"
              ? null
              : { number: "0x2a", hash: blockHash };
          case "eth_call":
            return "0xabcdef";
          case "eth_estimateGas":
            if (params.length === 1) throw new Error(rawBalanceError);
            return "0xc350";
          default:
            throw new Error(`unexpected RPC method ${method}`);
        }
      },
    };
    const app = createNativeRpcIntegrationApp(rpcClient);

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...arbitrumRequest(), amountIn: "100" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = runResultSchema.parse(await response.json());
    expect(body).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      p0: {
        basicSimulation: {
          call: { status: "SUCCEEDED" },
          gasEstimate: { status: "AVAILABLE", gasUnits: "50000" },
          blockNumber: "42",
          validityAtExecution: "VALID",
        },
      },
    });
    expect(body.p0?.basicSimulation).not.toHaveProperty("failureStage");
    expect(JSON.stringify(body)).not.toContain(rawBalanceError);
    expect(
      calls
        .filter(({ method }) => method === "eth_estimateGas")
        .map(({ params }) => params.length),
    ).toEqual([1, 2]);

    const rpcCallsBeforeHistoryRead = calls.length;
    const historyResponse = await app.fetch(
      new Request(
        `https://api.example.test/api/runs/${encodeURIComponent(body.runId)}`,
      ),
    );
    const history = await historyResponse.json();
    expect(historyResponse.status).toBe(200);
    expect(history).toMatchObject({
      status: "completed",
      result: { status: "completed", verdict: "UNKNOWN" },
    });
    expect((history as { result?: { p0?: unknown } }).result?.p0).toMatchObject(
      {
        basicSimulation: {
          gasEstimate: { status: "AVAILABLE", gasUnits: "50000" },
          validityAtExecution: "VALID",
        },
      },
    );
    expect(calls).toHaveLength(rpcCallsBeforeHistoryRead);
    await app.close();
  });
});
