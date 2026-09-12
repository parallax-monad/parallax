import { describe, expect, it } from "vitest";
import * as api from "../index.js";
import { InMemoryRunStore } from "../store.js";

describe("Backend foundation public entry", () => {
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
});
