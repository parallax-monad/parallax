import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { bootstrapBackendRuntime } from "../runtime-config.js";
import { InMemoryRunStore } from "../store.js";

import {
  type ArbitrumProductionCompositionOptions,
  bootstrapArbitrumBackend,
  createArbitrumProductionComposition,
} from "./arbitrum-composition.js";
import {
  createFakeChainAdapter,
  createFakeProviderAdapter,
} from "./fake-harness.js";

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
});
