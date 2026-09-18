import type { NormalizedSwapIntent } from "@parallax/contracts";
import { economicFailStopResult } from "@parallax/orchestrator/application/action-gate-fixtures";
import { describe, expect, it } from "vitest";
import { createBackendApp } from "../bootstrap/backend.js";
import { UnsupportedAgentFlowError } from "../ports.js";
import { bootstrapBackendRuntime } from "../runtime-config.js";
import { InMemoryRunStore } from "../store.js";

import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import {
  type ArbitrumProductionCompositionOptions,
  bootstrapArbitrumBackend,
  createArbitrumProductionComposition,
} from "./arbitrum-composition.js";
import {
  CAMELOT_SEPOLIA_QUOTER,
  CAMELOT_SEPOLIA_ROUTER,
  CAMELOT_SEPOLIA_USDC,
  createCamelotV3ProtocolAdapter,
} from "./camelot-v3-protocol-adapter.js";
import type { BackendCompositionRuntime } from "./composition.js";
import {
  createFakeChainAdapter,
  createFakeProviderAdapter,
} from "./fake-harness.js";
import { NATIVE_RPC_ARBITRUM_PROVIDER_ID } from "./native-rpc-evidence.js";
import { BackendPipeline } from "./pipeline.js";

const normalizedIntent: NormalizedSwapIntent = {
  chainId: 421614,
  protocol: "camelot-v3",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: {
    kind: "erc20",
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  amountInAtomic: "1000",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

function options(): ArbitrumProductionCompositionOptions {
  const runtime = bootstrapBackendRuntime({
    environment: {
      MONAD_RPC_URL: "https://monad.example.test",
      ARBITRUM_RPC_URL: "https://arbitrum.example.test",
      MOSS_RUNTIME_VERSION: "fixture-runtime",
      MOSS_RUNTIME_REVISION: "fixture-revision",
    },
    tokenRegistry: {
      chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
      tokens: [],
    },
  });
  return {
    runtime,
    runStore: new InMemoryRunStore(),
    chainAdapter: createFakeChainAdapter({
      chainId: 421614,
      blockNumber: "42",
      gasUnits: "21000",
      finality: { status: "finalized" },
    }),
    providers: [
      createFakeProviderAdapter<NormalizedSwapIntent>({
        providerId: "controlled-arbitrum-provider",
        intent: normalizedIntent,
        chainId: 421614,
        protocol: "camelot-v3",
        capabilities: ["simulate"],
      }),
    ],
    core: { evaluate: async (input) => input },
    decision: { decide: async (input) => input },
  };
}

const arbitrumTokenAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const arbitrumTokenRegistry = {
  chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
  tokens: [
    {
      chainId: 421614,
      address: arbitrumTokenAddress,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "42",
    },
  ],
};
const arbitrumEnvironment = {
  MONAD_RPC_URL: "https://monad.example.test",
  ARBITRUM_RPC_URL: "https://arbitrum.example.test",
  MOSS_RUNTIME_VERSION: "fixture-runtime",
  MOSS_RUNTIME_REVISION: "fixture-revision",
};

function arbitrumRuntime() {
  return bootstrapBackendRuntime({
    environment: arbitrumEnvironment,
    tokenRegistry: arbitrumTokenRegistry,
  });
}

function arbitrumCompositionOptions(
  runtime: ReturnType<typeof arbitrumRuntime>,
  protocolAdapter?: ArbitrumProductionCompositionOptions["protocolAdapter"],
): ArbitrumProductionCompositionOptions {
  return {
    runtime,
    runStore: new InMemoryRunStore(),
    chainAdapter: createFakeChainAdapter({
      chainId: 421614,
      blockNumber: "42",
      gasUnits: "21000",
      finality: { status: "finalized" },
    }),
    ...(protocolAdapter === undefined ? {} : { protocolAdapter }),
    core: { evaluate: async (input) => input },
    decision: { decide: async (input) => input },
  };
}

describe("Arbitrum production composition skeleton", () => {
  it("bootstraps runtime and composition without starting a server", () => {
    const input = options();
    const { runtime: _runtime, ...compositionOptions } = input;
    const bootstrapped = bootstrapArbitrumBackend({
      ...compositionOptions,
      environment: {
        MONAD_RPC_URL: "https://monad.example.test",
        ARBITRUM_RPC_URL: "https://arbitrum.example.test",
        MOSS_RUNTIME_VERSION: "fixture-runtime",
        MOSS_RUNTIME_REVISION: "fixture-revision",
      },
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [],
      },
    });

    expect(bootstrapped.runtime.config.arbitrum?.protocolId).toBe("camelot-v3");
    expect(bootstrapped.composition.resolveChain(421614).chainId).toBe(421614);
  });

  it("selects the exact Arbitrum chain, Camelot protocol, and injected provider", () => {
    const composition = createArbitrumProductionComposition(options());

    expect(composition.resolveChain(421614).chainId).toBe(421614);
    expect(composition.resolveProtocol(421614, "camelot-v3").protocolId).toBe(
      "camelot-v3",
    );
    expect(
      composition.resolveProvider({
        intent: normalizedIntent,
        chainId: 421614,
        protocol: "camelot-v3",
        capability: "simulate",
      }).providerId,
    ).toBe("controlled-arbitrum-provider");
  });

  it("projects non-success Native RPC evidence through the public check response", async () => {
    const runtime = arbitrumRuntime();
    const provider = createFakeProviderAdapter<NormalizedSwapIntent>({
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      intent: normalizedIntent,
      chainId: 421614,
      protocol: "camelot-v3",
      capabilities: ["simulate", "eth_call", "estimateGas", "pinned-block"],
      supports: () => true,
      result: {
        provider: {
          providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
          observedAt: "2026-09-10T00:01:00.000Z",
        },
        status: "unknown",
        responseEvidence: {
          kind: "reference",
          reference: "fixture://native-rpc/public-check",
        },
        candidateFields: [
          {
            candidatePath: "nativeRpc.ethCall.returnData",
            observedShape: "hex_string",
            status: "observed",
            nullable: false,
            confidence: "high",
            value: "0xabcdef",
          },
          {
            candidatePath: "nativeRpc.estimateGas.gasUnits",
            observedShape: "decimal_string",
            status: "observed",
            nullable: false,
            confidence: "high",
            value: "21000",
          },
        ],
      },
    });
    const composition = createArbitrumProductionComposition({
      ...arbitrumCompositionOptions(runtime),
      providers: [provider],
      protocolAdapter: createCamelotV3ProtocolAdapter({
        quote: async () => ({
          estimatedAmountOut: "0.5",
          minimumAmountOut: "0.4",
        }),
        buildTransaction: async () => ({
          to: "0x2222222222222222222222222222222222222222",
          data: "0x1234",
          value: "0x0",
        }),
      }),
      core: { evaluate: async (input) => input },
      decision: {
        decide: async (_input, context) => {
          const pipelineContext = context as {
            runId: string;
            intent: NormalizedSwapIntent;
          };
          const result = economicFailStopResult(
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
          return {
            ...result,
            route: {
              ...result.route,
              protocol: pipelineContext.intent.protocol,
            },
          };
        },
      },
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: { kind: "native" },
          tokenOut: {
            kind: "erc20",
            address: arbitrumTokenAddress,
          },
          amountIn: "1",
          economicBoundary: {
            availability: "available",
            minimumReceived: "0.02",
            source: "user_declared",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      providerEvidence: {
        provider: {
          providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
          status: "UNKNOWN",
        },
        provenance: {
          source: "mock",
          mode: "MOCK",
          simulationBlock: "42",
        },
        checkedScope: ["native-rpc.eth_call", "native-rpc.estimateGas"],
        providerData: {
          nativeRpc: {
            status: "unknown",
            freshness: { status: "not_checked" },
            notChecked: expect.arrayContaining([
              "receipt",
              "outcome",
              "assetChanges",
            ]),
          },
        },
      },
    });
  });

  it("does not label a Native RPC provider failure as Moss simulation", async () => {
    const runtime = arbitrumRuntime();
    const provider = createFakeProviderAdapter<NormalizedSwapIntent>({
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      intent: normalizedIntent,
      chainId: 421614,
      protocol: "camelot-v3",
      capabilities: ["simulate"],
      supports: () => false,
    });
    const composition = createArbitrumProductionComposition({
      ...arbitrumCompositionOptions(runtime),
      providers: [provider],
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: { kind: "native" },
          tokenOut: {
            kind: "erc20",
            address: arbitrumTokenAddress,
          },
          amountIn: "1",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: {
        code: "UNSUPPORTED",
        message: "Provider evaluation is not available in this runtime",
      },
      run: {
        status: "integration_error",
        scope: [
          {
            key: "P0-CHECK-SIMULATION-001",
            label: "Provider evaluation",
            status: "unknown",
            reason: "REQUIRED_CHECK_INTERRUPTED",
          },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain("Moss simulation");
  });

  it("requires an explicit Arbitrum endpoint when no controlled chain seam is supplied", () => {
    const input = options();
    const { chainAdapter: _chainAdapter, ...withoutChain } = input;
    const runtimeWithoutRpc = bootstrapBackendRuntime({
      environment: {
        MONAD_RPC_URL: "https://monad.example.test",
        MOSS_RUNTIME_VERSION: "fixture-runtime",
        MOSS_RUNTIME_REVISION: "fixture-revision",
      },
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [],
      },
    });
    expect(() =>
      createArbitrumProductionComposition({
        ...withoutChain,
        runtime: runtimeWithoutRpc,
      }),
    ).toThrow("Arbitrum RPC URL is required");
  });

  it("wires a configured Arbitrum RPC through Camelot and NativeRpcProvider", async () => {
    const blockHash = `0x${"ab".repeat(32)}`;
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    const rpcClient: ArbitrumRpcClient = {
      async request(method, params = []) {
        calls.push({ method, params });
        if (method === "eth_chainId") return "0x66eee";
        if (method === "eth_getBlockByNumber") {
          return { number: "0x2a", hash: blockHash };
        }
        if (method === "eth_estimateGas") return "0x5208";
        if (method === "eth_call") {
          const transaction = params[0] as { to?: string } | undefined;
          if (
            transaction?.to?.toLowerCase() ===
            CAMELOT_SEPOLIA_QUOTER.toLowerCase()
          ) {
            return `0x${(2n * 10n ** 18n).toString(16).padStart(64, "0")}${"0".repeat(64)}`;
          }
          return "0x";
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
    };
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [
          {
            chainId: 421614,
            address: CAMELOT_SEPOLIA_USDC,
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: "42",
          },
        ],
      },
    });
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: new InMemoryRunStore(),
      rpcClient,
      core: {
        evaluate: async (_input, context) => {
          const pipelineContext = context as {
            readonly providerResult: { readonly status: string };
            readonly providerEvidence?: unknown;
          };
          return {
            providerStatus: pipelineContext.providerResult.status,
            evidence: pipelineContext.providerEvidence,
          };
        },
      },
      decision: { decide: async (input) => input },
    });
    const pipeline = new BackendPipeline({ runtime: composition });
    const execution = await pipeline.executeNormalized(
      {
        ...normalizedIntent,
        tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
        amountInAtomic: "1000000000000000",
      },
      {
        rawInput: normalizedIntent as never,
        runId: "arbitrum-golden-path",
        chainId: 421614,
        protocol: "camelot-v3",
        capability: "simulate",
      },
    );

    expect(execution.providerResult).toMatchObject({
      status: "success",
      provider: { providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID },
    });
    expect(execution.providerEvidence).toMatchObject({
      provider: {
        providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
        status: "UNKNOWN",
      },
      provenance: { mode: "LIVE", source: "rpc" },
      unknownScope: expect.arrayContaining(["receipt", "simulation"]),
    });
    expect(execution.unsignedTransaction.payload).toMatchObject({
      to: CAMELOT_SEPOLIA_ROUTER,
      chainId: "0x66eee",
    });
    expect(calls[2]).toMatchObject({
      method: "eth_call",
      params: [expect.anything(), "0x2a"],
    });
    expect(calls.map(({ method }) => method)).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_call",
      "eth_estimateGas",
      "eth_getBlockByNumber",
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_call",
      "eth_estimateGas",
    ]);
  });

  it("normalizes Arbitrum quotes through the public app and reaches Camelot", async () => {
    const runtime = arbitrumRuntime();
    let receivedIntent: NormalizedSwapIntent | undefined;
    const protocolAdapter = createCamelotV3ProtocolAdapter({
      quote: async (intent) => {
        receivedIntent = intent;
        return {
          status: "available",
          quote: {
            estimatedAmountOut: "0.5",
            source: "quote",
            blockNumber: "42",
            runtimeVersion: "camelot-fixture-runtime",
            runtimeRevision: "camelot-fixture-revision",
          },
        };
      },
    });
    const composition = createArbitrumProductionComposition(
      arbitrumCompositionOptions(runtime, protocolAdapter),
    );
    const app = createBackendApp({
      runtime,
      // createBackendApp predates specialized composition input unions.
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: "0x1111111111111111111111111111111111111111",
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
          amountIn: "1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "available",
      quote: {
        estimatedAmountOut: "0.5",
        blockNumber: "42",
        runtimeVersion: "camelot-fixture-runtime",
        runtimeRevision: "camelot-fixture-revision",
      },
    });
    expect(receivedIntent).toMatchObject({
      chainId: 421614,
      protocol: "camelot-v3",
      amountInAtomic: "1000000000000000000",
      economicBoundary: { availability: "unavailable" },
    });
  });

  it("continues to normalize Arbitrum checks at the public app boundary", async () => {
    const runtime = arbitrumRuntime();
    let receivedIntent: NormalizedSwapIntent | undefined;
    const composition = createArbitrumProductionComposition(
      arbitrumCompositionOptions(runtime),
    );
    const app = createBackendApp({
      runtime,
      // createBackendApp predates specialized composition input unions.
      composition: composition as unknown as BackendCompositionRuntime,
      agentFlow: {
        async check(input) {
          receivedIntent = input.intent;
          throw new UnsupportedAgentFlowError();
        },
      },
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: "0x1111111111111111111111111111111111111111",
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
          amountIn: "1",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED" },
    });
    expect(receivedIntent).toMatchObject({
      chainId: 421614,
      protocol: "camelot-v3",
      amountInAtomic: "1000000000000000000",
      economicBoundary: { availability: "unavailable" },
    });
  });
});
