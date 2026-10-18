import { type QuoteRequest, quoteResultSchema } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { bootstrapBackendApp } from "../bootstrap/backend.js";
import { normalizeQuoteRequestForChain } from "../normalization.js";
import type { QuoteAgentFlowPort } from "../ports.js";
import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_ONE_RUNTIME_PROFILE,
  bootstrapBackendRuntime,
} from "../runtime-config.js";
import { InMemoryRunStore } from "../store.js";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import { createArbitrumOneQuoteFlow } from "./arbitrum-one-quote.js";

const sender = "0x1111111111111111111111111111111111111111";
const blockHash = `0x${"ab".repeat(32)}`;
const sourceBlockNumber = "7";
const sourceBlockTag = "0x7";
const quoteRequest: QuoteRequest = {
  chainId: ARBITRUM_ONE_CHAIN_ID,
  protocol: "camelot-v3",
  sender,
  tokenIn: { kind: "native" },
  tokenOut: {
    kind: "erc20",
    address: ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenOut.address,
  },
  amountIn: "0.001",
};
const tokenRegistry = {
  chains: [{ chainId: ARBITRUM_ONE_CHAIN_ID, symbol: "ETH", decimals: 18 }],
  tokens: [
    {
      chainId: ARBITRUM_ONE_CHAIN_ID,
      address: ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenOut.address,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "6",
    },
  ],
};

function createRuntime(
  input: { rpcUrl?: string; tokenSymbol?: string; tokenDecimals?: number } = {},
) {
  return bootstrapBackendRuntime({
    environment: {
      MONAD_RPC_URL: "https://monad.example.test",
      ...(input.rpcUrl === undefined
        ? { ARBITRUM_ONE_RPC_URL: "https://arbitrum-one.example.test" }
        : input.rpcUrl === ""
          ? {}
          : { ARBITRUM_ONE_RPC_URL: input.rpcUrl }),
      MOSS_RUNTIME_VERSION: "test-runtime",
      MOSS_RUNTIME_REVISION: "test-revision",
    },
    tokenRegistry: {
      ...tokenRegistry,
      tokens: [
        {
          ...tokenRegistry.tokens[0],
          ...(input.tokenSymbol === undefined
            ? {}
            : { symbol: input.tokenSymbol }),
          ...(input.tokenDecimals === undefined
            ? {}
            : { decimals: input.tokenDecimals }),
        },
      ],
    },
  });
}

type RpcCall = {
  method: string;
  params: readonly unknown[];
  timeoutMs?: number;
};
type RpcResponder = (
  method: string,
  params: readonly unknown[],
  callIndex: number,
) => unknown | Promise<unknown>;

function createRpc(responder?: RpcResponder) {
  const calls: RpcCall[] = [];
  const rpcClient: ArbitrumRpcClient = {
    async request(method, params = [], options) {
      calls.push({ method, params, timeoutMs: options?.timeoutMs });
      if (responder !== undefined) {
        return responder(method, params, calls.length - 1);
      }
      return defaultRpcResponse(method, params);
    },
  };
  return { rpcClient, calls };
}

function defaultRpcResponse(
  method: string,
  params: readonly unknown[],
): unknown {
  if (method === "eth_chainId") return "0xa4b1";
  if (method === "eth_blockNumber") return sourceBlockTag;
  if (method === "eth_getBlockByNumber") {
    return {
      number: sourceBlockTag,
      hash: blockHash,
      timestamp: "0x6b1f2b5f",
    };
  }
  if (method === "eth_getCode") return "0x6000";
  if (method === "eth_call") {
    const call = params[0] as { to: string; data: string };
    const address = call.to.toLowerCase();
    const selector = call.data.slice(2, 10).toLowerCase();
    if (selector === "95d89b41") {
      return encodeString(
        address ===
          ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress.toLowerCase()
          ? "WETH"
          : "USDC",
      );
    }
    if (selector === "313ce567") {
      return `0x${encodeUint(
        address ===
          ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress.toLowerCase()
          ? 18n
          : 6n,
      )}`;
    }
    if (selector === "0dfe1681") {
      return encodeAddress(
        ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress,
      );
    }
    if (selector === "d21220a7") {
      return encodeAddress(
        ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress,
      );
    }
    if (selector === "1a686502") return `0x${encodeUint(100n)}`;
    if (selector === "2d9ebd1d")
      return `0x${encodeUint(2_413_423n)}${encodeUint(500n)}`;
  }
  throw new Error(`Unexpected RPC method ${method}`);
}

function encodeUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function encodeAddress(value: string): string {
  return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
}

function encodeString(value: string): string {
  const hex = Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const paddedLength = Math.ceil(hex.length / 64) * 64;
  return `0x${encodeUint(32n)}${encodeUint(BigInt(value.length))}${hex.padEnd(paddedLength, "0")}`;
}

function createQuoteInput(runtime = createRuntime()) {
  const normalized = normalizeQuoteRequestForChain(
    quoteRequest,
    runtime.tokenRegistry,
    ARBITRUM_ONE_CHAIN_ID,
  );
  if (!normalized.success)
    throw new Error("Test quote request did not normalize");
  return {
    runId: "quote-test",
    intent: normalized.intent,
    tokenInDecimals: 18,
    tokenOutDecimals: 6,
    moss: runtime.config.moss,
  };
}

function createQuoteApp(arbitrumOneQuoteFlow: QuoteAgentFlowPort) {
  return bootstrapBackendApp({
    environment: {
      MONAD_RPC_URL: "https://monad.example.test",
      ARBITRUM_ONE_RPC_URL: "https://arbitrum-one.example.test",
      MOSS_RUNTIME_VERSION: "test-runtime",
      MOSS_RUNTIME_REVISION: "test-revision",
    },
    tokenRegistry,
    store: new InMemoryRunStore(),
    arbitrumOneQuoteFlow,
  });
}

describe("Arbitrum One Camelot pinned quote flow", () => {
  it("returns the exact ETH-to-USDC quote with complete source provenance", async () => {
    const runtime = createRuntime();
    const { rpcClient } = createRpc();
    const flow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient,
      now: () => new Date("2026-10-17T19:17:33.990Z"),
    });

    const result = quoteResultSchema.parse(
      await flow.quote(createQuoteInput(runtime)),
    );

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.quote).toMatchObject({
      estimatedAmountOut: "2.413423",
      blockNumber: sourceBlockNumber,
      fetchedAt: "2026-10-17T19:17:33.990Z",
      provenance: {
        version: 1,
        profileId: "arbitrum-one-camelot-v3",
        sourceChainId: ARBITRUM_ONE_CHAIN_ID,
        sourceBlock: {
          number: sourceBlockNumber,
          hash: blockHash,
          timestamp: BigInt("0x6b1f2b5f").toString(),
          observedAt: "2026-10-17T19:17:33.990Z",
        },
        amountInAtomic: "1000000000000000",
        amountOutAtomic: "2413423",
        route: {
          kind: "direct",
          protocol: "camelot-v3",
          poolAddress: ARBITRUM_ONE_RUNTIME_PROFILE.route.poolAddress,
          tokenPath: [
            ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress,
            ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress,
          ],
        },
        quoteSource: {
          kind: "quoter",
          protocol: "camelot-v3",
          address: ARBITRUM_ONE_RUNTIME_PROFILE.deployments.quoterAddress,
        },
      },
    });
    expect(result.quote.provenance?.inputAsset).toMatchObject({
      symbol: "ETH",
      decimals: 18,
    });
    expect(result.quote.provenance?.outputAsset).toMatchObject({
      symbol: "USDC",
      decimals: 6,
    });
  });

  it("routes API Quote through the One profile while Check remains unavailable", async () => {
    const runtime = createRuntime();
    const { rpcClient } = createRpc();
    const app = createQuoteApp(
      createArbitrumOneQuoteFlow(runtime, {
        rpcClient,
        now: () => new Date("2026-10-17T19:17:33.990Z"),
      }),
    );

    try {
      const quoteResponse = await app.fetch(
        new Request("https://api.example.test/api/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(quoteRequest),
        }),
      );
      const quoteBody = (await quoteResponse.json()) as {
        status: string;
        quote?: { provenance?: { profileId?: string } };
      };
      expect(quoteResponse.status).toBe(200);
      expect(quoteBody).toMatchObject({
        status: "available",
        quote: { provenance: { profileId: "arbitrum-one-camelot-v3" } },
      });

      const checkResponse = await app.fetch(
        new Request("https://api.example.test/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...quoteRequest,
            economicBoundary: {
              availability: "unavailable",
              source: "unavailable",
            },
          }),
        }),
      );
      expect(checkResponse.status).toBe(400);
      await expect(checkResponse.json()).resolves.toMatchObject({
        error: { code: "NORMALIZATION_FAILED" },
      });
    } finally {
      await app.close();
    }
  });

  it("rejects an available One API quote without complete provenance", async () => {
    const incompleteQuoteFlow: QuoteAgentFlowPort = {
      async quote() {
        return {
          status: "available",
          quote: {
            estimatedAmountOut: "2.413423",
            source: "quote",
            blockNumber: sourceBlockNumber,
            fetchedAt: "2026-10-17T19:17:33.990Z",
            runtimeVersion: "arbitrum-one-camelot-v3",
            runtimeRevision: "native-rpc",
          },
        };
      },
    };
    const app = createQuoteApp(incompleteQuoteFlow);

    try {
      const response = await app.fetch(
        new Request("https://api.example.test/api/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(quoteRequest),
        }),
      );
      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "QUOTE_ERROR" },
      });
    } finally {
      await app.close();
    }
  });

  it("reproduces the same atomic quote and direct route at the same pinned block", async () => {
    const runtime = createRuntime();
    const { rpcClient, calls } = createRpc();
    const flow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient,
      now: () => new Date("2026-10-17T19:17:33.990Z"),
    });
    const input = createQuoteInput(runtime);

    const first = quoteResultSchema.parse(await flow.quote(input));
    const second = quoteResultSchema.parse(await flow.quote(input));

    expect(first).toEqual(second);
    expect(first.status).toBe("available");
    expect(calls.filter((call) => call.method === "eth_getCode")).toHaveLength(
      12,
    );
    const pinnedStateCalls = calls.filter(
      (call) => call.method === "eth_getCode" || call.method === "eth_call",
    );
    expect(
      pinnedStateCalls.every((call) => call.params[1] === sourceBlockTag),
    ).toBe(true);
    expect(
      calls
        .filter((call) => call.method === "eth_getBlockByNumber")
        .every((call) => call.params[0] === sourceBlockTag),
    ).toBe(true);
    expect(calls.some((call) => call.params.includes("latest"))).toBe(false);
    expect(calls.some((call) => call.method === "eth_estimateGas")).toBe(false);
  });

  it("returns NO_ROUTE without RPC calls for unsupported assets", async () => {
    const runtime = createRuntime();
    const { rpcClient, calls } = createRpc();
    const flow = createArbitrumOneQuoteFlow(runtime, { rpcClient });
    const input = createQuoteInput(runtime);

    const result = await flow.quote({
      ...input,
      intent: {
        ...input.intent,
        tokenOut: {
          kind: "erc20",
          address: "0x1111111111111111111111111111111111111111",
        },
      },
    });

    expect(result).toEqual({ status: "unavailable", reason: "NO_ROUTE" });
    expect(calls).toEqual([]);
  });

  it("fails unavailable for chain mismatch, absent endpoint, or wrong trusted metadata", async () => {
    const cases: Array<{
      name: string;
      runtime: ReturnType<typeof createRuntime>;
      responder?: RpcResponder;
    }> = [
      {
        name: "chain mismatch",
        runtime: createRuntime(),
        responder: (method) =>
          method === "eth_chainId" ? "0x66eee" : defaultRpcResponse(method, []),
      },
      { name: "absent endpoint", runtime: createRuntime({ rpcUrl: "" }) },
      {
        name: "wrong trusted symbol",
        runtime: createRuntime({ tokenSymbol: "USDC.e" }),
      },
      {
        name: "wrong trusted decimals",
        runtime: createRuntime({ tokenDecimals: 18 }),
      },
    ];

    for (const testCase of cases) {
      const rpc = createRpc(testCase.responder);
      const flow = createArbitrumOneQuoteFlow(testCase.runtime, {
        rpcClient: rpc.rpcClient,
      });
      await expect(
        flow.quote(createQuoteInput(testCase.runtime)),
      ).resolves.toMatchObject({
        status: "unavailable",
      });
      if (
        testCase.name === "absent endpoint" ||
        testCase.name.startsWith("wrong trusted")
      ) {
        expect(rpc.calls).toEqual([]);
      }
    }
  });

  it("fails unavailable for missing code and wrong onchain token metadata", async () => {
    const runtime = createRuntime();
    const missingCode = createRpc((method, params) => {
      if (
        method === "eth_getCode" &&
        params[0] === ARBITRUM_ONE_RUNTIME_PROFILE.deployments.quoterAddress
      ) {
        return "0x";
      }
      return defaultRpcResponse(method, params);
    });
    const missingCodeFlow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient: missingCode.rpcClient,
    });
    await expect(
      missingCodeFlow.quote(createQuoteInput(runtime)),
    ).resolves.toMatchObject({ status: "unavailable" });

    const wrongSymbol = createRpc((method, params) => {
      if (method === "eth_call") {
        const call = params[0] as { to: string; data: string };
        if (
          call.to.toLowerCase() ===
            ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress.toLowerCase() &&
          call.data.startsWith("0x95d89b41")
        ) {
          return encodeString("USDC.e");
        }
      }
      return defaultRpcResponse(method, params);
    });
    const wrongSymbolFlow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient: wrongSymbol.rpcClient,
    });
    await expect(
      wrongSymbolFlow.quote(createQuoteInput(runtime)),
    ).resolves.toMatchObject({ status: "unavailable" });
  });

  it("fails unavailable for historical-state errors and missing block hash", async () => {
    const runtime = createRuntime();
    for (const responder of [
      (method: string, params: readonly unknown[]) =>
        method === "eth_getBlockByNumber"
          ? null
          : defaultRpcResponse(method, params),
      (method: string, params: readonly unknown[]) => {
        if (method === "eth_getBlockByNumber") {
          return { number: sourceBlockTag, timestamp: "0x6b1f2b5f" };
        }
        return defaultRpcResponse(method, params);
      },
    ]) {
      const { rpcClient } = createRpc(responder);
      const flow = createArbitrumOneQuoteFlow(runtime, { rpcClient });
      await expect(
        flow.quote(createQuoteInput(runtime)),
      ).resolves.toMatchObject({
        status: "unavailable",
      });
    }
  });

  it("fails unavailable for malformed Quoter ABI output and timeout", async () => {
    const runtime = createRuntime();
    const malformed = createRpc((method, params) => {
      if (method === "eth_call") {
        const call = params[0] as { data: string };
        if (call.data.startsWith("0x2d9ebd1d"))
          return `0x${encodeUint(2413423n)}`;
      }
      return defaultRpcResponse(method, params);
    });
    const malformedFlow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient: malformed.rpcClient,
    });
    await expect(
      malformedFlow.quote(createQuoteInput(runtime)),
    ).resolves.toMatchObject({ status: "unavailable" });

    const timeout = createRpc((method, params) => {
      if (method === "eth_call") {
        const call = params[0] as { data: string };
        if (call.data.startsWith("0x2d9ebd1d")) throw new Error("timed out");
      }
      return defaultRpcResponse(method, params);
    });
    const timeoutFlow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient: timeout.rpcClient,
    });
    await expect(
      timeoutFlow.quote(createQuoteInput(runtime)),
    ).resolves.toMatchObject({ status: "unavailable" });
  });
});
