import { describe, expect, it } from "vitest";
import { ChainRegistry } from "./chain-registry.js";
import {
  createFakeChainAdapter,
  createFakeProtocolAdapter,
  createFakeProviderAdapterHarness,
  fakeBackendFixture,
} from "./fake-harness.js";
import { ProtocolRegistry } from "./protocol-registry.js";
import { evaluateProviderAdapter } from "./provider-adapter.js";
import { ProviderRegistry } from "./provider-registry.js";

describe("Backend adapter and registry contract matrix", () => {
  it("gives Chain adapters a stable register, resolve, and unsupported contract", async () => {
    const fixture = fakeBackendFixture();
    const adapter = createFakeChainAdapter(fixture.chain);
    const registry = new ChainRegistry([adapter]);

    expect(registry.size).toBe(1);
    expect(registry.has(fixture.chain.chainId)).toBe(true);
    expect(registry.resolve(fixture.chain.chainId)).toBe(adapter);
    await expect(adapter.getBlockContext()).resolves.toMatchObject({
      blockNumber: fixture.chain.blockNumber,
    });
    expect(() => registry.resolve(fixture.chain.chainId + 1)).toThrow(
      "is not registered",
    );
  });

  it("gives Protocol adapters an exact chain/protocol lookup contract", async () => {
    const fixture = fakeBackendFixture();
    const adapter = createFakeProtocolAdapter(fixture.protocol);
    const registry = new ProtocolRegistry([
      {
        chainId: fixture.chain.chainId,
        protocol: fixture.protocol.id,
        adapter,
      },
    ]);

    expect(registry.size).toBe(1);
    expect(registry.resolve(fixture.chain.chainId, fixture.protocol.id)).toBe(
      adapter,
    );
    await expect(adapter.quote({})).resolves.toEqual({ amountOut: "42" });
    expect(() => registry.resolve(fixture.chain.chainId, "pancake")).toThrow(
      "not registered",
    );
  });

  it("gives Provider adapters a single-match, factory-provenance contract", async () => {
    const fixture = fakeBackendFixture();
    const { adapter, evaluations } = createFakeProviderAdapterHarness(
      fixture.provider,
    );
    const registry = new ProviderRegistry([adapter]);
    const query = {
      intent: fixture.provider.intent,
      chainId: fixture.provider.chainId,
      protocol: fixture.provider.protocol,
      capability: "simulate",
    };

    expect(registry.size).toBe(1);
    expect(registry.resolve(query)).toBe(adapter);
    expect(evaluations).toHaveLength(0);
    await expect(
      evaluateProviderAdapter(adapter, {
        runId: "contract-run",
        ...query,
        input: {},
      }),
    ).resolves.toMatchObject({ status: "success" });
    expect(evaluations).toHaveLength(1);
    expect(() => registry.resolve({ ...query, chainId: 902 })).toThrow(
      "no registered provider supports",
    );
  });
});
