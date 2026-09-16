import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import * as api from "../index.js";
import { InMemoryRunStore } from "../store.js";

describe("Backend foundation public entry", () => {
  it("exports the Arbitrum × Camelot foundation from the package entry", () => {
    expect(api.ARBITRUM_SEPOLIA_CHAIN_ID).toBe(421614);
    expect(api.CAMELOT_V3_PROTOCOL_ID).toBe("camelot-v3");
    expect(api.ArbitrumChainAdapter).toBeTypeOf("function");
    expect(api.createArbitrumChainAdapter).toBeTypeOf("function");
    expect(api.CamelotV3ProtocolAdapter).toBeTypeOf("function");
    expect(api.createCamelotV3ProtocolAdapter).toBeTypeOf("function");
    expect(api.createCamelotV3FeasibilityEntryPoint).toBeTypeOf("function");
    expect(api.createNativeRpcProvider).toBeTypeOf("function");
    expect(api.NATIVE_RPC_ARBITRUM_PROVIDER_ID).toBe("native-rpc-arbitrum");
    expect(api.createArbitrumProductionComposition).toBeTypeOf("function");
    expect(api.bootstrapArbitrumBackend).toBeTypeOf("function");
  });

  it("exports and composes the replaceable backend foundation from the package entry", () => {
    expect(api.createBackendComposition).toBeTypeOf("function");
    expect(api.createBackendRuntime).toBeTypeOf("function");
    expect(api.createFakeChainAdapter).toBeTypeOf("function");
    expect(api.createFakeProtocolAdapter).toBeTypeOf("function");
    expect(api.createFakeProviderAdapter).toBeTypeOf("function");
    expect(api.fakeBackendFixture).toBeTypeOf("function");

    const fixture = api.fakeBackendFixture();
    const chain = api.createFakeChainAdapter(fixture.chain);
    const protocol = api.createFakeProtocolAdapter(fixture.protocol);
    const provider = api.createFakeProviderAdapter(fixture.provider);
    const runtime = api.createBackendRuntime({
      chainRegistry: new api.ChainRegistry([chain]),
      protocolRegistry: new api.ProtocolRegistry([
        {
          chainId: fixture.chain.chainId,
          protocol: fixture.protocol.id,
          adapter: protocol,
        },
      ]),
      providerRegistry: new api.ProviderRegistry([provider]),
      normalization: { normalize: (input: unknown) => input },
      core: { evaluate: async (input: unknown) => input },
      decision: { decide: async (input: unknown) => input },
      runStore: new InMemoryRunStore(),
    });

    expect(runtime.resolveChain(fixture.chain.chainId)).toBe(chain);
    expect(
      runtime.resolveProtocol(fixture.chain.chainId, fixture.protocol.id),
    ).toBe(protocol);
    expect(
      runtime.resolveProvider({
        intent: fixture.provider.intent,
        chainId: fixture.provider.chainId,
        protocol: fixture.provider.protocol,
        capability: "simulate",
      }),
    ).toBe(provider);
  });

  it("keeps a Camelot feasibility entry point replaceable at the public boundary", () => {
    const protocolAdapter = api.createCamelotV3ProtocolAdapter({
      quote: async (intent: NormalizedSwapIntent) => ({
        scenarioId: "public-entry",
        amountInAtomic: intent.amountInAtomic,
      }),
    });
    const entryPoint = api.createCamelotV3FeasibilityEntryPoint({
      quote: protocolAdapter.quote.bind(protocolAdapter),
    });

    expect(entryPoint.protocolAdapter).toBeInstanceOf(
      api.CamelotV3ProtocolAdapter,
    );
    expect(entryPoint.protocolAdapter.protocolId).toBe("camelot-v3");
    expect(entryPoint.scenarios[0]?.classification).toBe("CONTROLLED_FIXTURE");
  });
});
