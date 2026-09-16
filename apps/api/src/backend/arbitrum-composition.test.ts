import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { createBackendApp } from "../bootstrap/backend.js";
import { UnsupportedAgentFlowError } from "../ports.js";
import { bootstrapBackendRuntime } from "../runtime-config.js";
import { InMemoryRunStore } from "../store.js";

import {
  type ArbitrumNormalizationInput,
  type ArbitrumProductionCompositionOptions,
  bootstrapArbitrumBackend,
  createArbitrumProductionComposition,
} from "./arbitrum-composition.js";
import { createCamelotV3ProtocolAdapter } from "./camelot-v3-protocol-adapter.js";
import type { BackendCompositionRuntime } from "./composition.js";
import {
  createFakeChainAdapter,
  createFakeProviderAdapter,
} from "./fake-harness.js";
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

  it("registers the controlled native-rpc-arbitrum provider through composition", () => {
    const runtime = arbitrumRuntime();
    const composition = createArbitrumProductionComposition({
      ...arbitrumCompositionOptions(runtime),
      nativeRpc: {
        client: {
          request: async () => undefined,
        },
      },
    });

    expect(
      composition.resolveProvider({
        intent: normalizedIntent,
        chainId: 421614,
        protocol: "camelot-v3",
        capability: "simulate",
      }).providerId,
    ).toBe("native-rpc-arbitrum");
  });

  it("routes quote and prepared transaction through the Native RPC provider and pipeline", async () => {
    const calls: string[] = [];
    let coreContext: unknown;
    let decisionContext: unknown;
    const composition = createArbitrumProductionComposition({
      ...arbitrumCompositionOptions(
        arbitrumRuntime(),
        createCamelotV3ProtocolAdapter({
          quote: async () => ({
            status: "available",
            quote: { estimatedAmountOut: "0.5", minimumAmountOut: "0.4" },
          }),
          buildTransaction: async () => ({
            from: normalizedIntent.sender,
            to: "0x2222222222222222222222222222222222222222",
            data: "0x1234",
            value: "0x0",
          }),
        }),
      ),
      nativeRpc: {
        mode: "MOCK",
        client: {
          request: async (method) => {
            calls.push(method);
            if (method === "eth_getBlockByNumber") {
              return { number: "0x2a", hash: `0x${"a".repeat(64)}` };
            }
            return method === "eth_call" ? "0xabcdef" : "0x5208";
          },
        },
      },
      core: {
        evaluate: async (input, context) => {
          coreContext = context;
          return input;
        },
      },
      decision: {
        decide: async (input, context) => {
          decisionContext = context;
          return input;
        },
      },
    });
    const pipeline = new BackendPipeline({ runtime: composition });

    const execution = await pipeline.executeNormalized(normalizedIntent, {
      rawInput: {} as ArbitrumNormalizationInput,
      runId: "run-native-rpc-composition",
      chainId: 421614,
      protocol: "camelot-v3",
      capability: "simulate",
    });

    expect(execution.providerResult).toMatchObject({
      provider: { providerId: "native-rpc-arbitrum" },
      status: "success",
    });
    expect(execution.providerEvidence).toMatchObject({
      provider: { providerId: "native-rpc-arbitrum", status: "UNKNOWN" },
      provenance: { mode: "MOCK", source: "mock", simulationBlock: "42" },
      checkedScope: expect.arrayContaining([
        "native-rpc.eth_call",
        "native-rpc.estimateGas",
      ]),
      unknownScope: expect.arrayContaining([
        "receipt",
        "outcome",
        "assetChanges",
      ]),
      providerData: {
        nativeRpc: expect.objectContaining({
          freshness: { status: "not_checked" },
        }),
      },
    });
    expect(coreContext).toMatchObject({
      providerEvidence: {
        provider: { status: "UNKNOWN" },
      },
    });
    expect(decisionContext).toMatchObject({
      providerEvidence: {
        provenance: { source: "mock" },
      },
    });
    expect(calls).toEqual([
      "eth_getBlockByNumber",
      "eth_call",
      "eth_estimateGas",
    ]);
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
