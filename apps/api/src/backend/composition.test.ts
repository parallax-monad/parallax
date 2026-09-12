import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it, vi } from "vitest";
import { InMemoryRunStore } from "../store.js";
import { ChainRegistry } from "./chain-registry.js";
import {
  createBackendComposition,
  type DecisionPort,
  type NormalizationBoundary,
} from "./composition.js";
import {
  createFakeChainAdapter,
  createFakeProtocolAdapter,
  createFakeProviderAdapter,
  fakeBackendFixture,
} from "./fake-harness.js";
import { ProtocolRegistry } from "./protocol-registry.js";
import { ProviderRegistry } from "./provider-registry.js";
import type { ReceiptAnchorer, ReceiptSigner } from "./receipt-ports.js";

const normalizedIntent = {
  chainId: 901,
  protocol: "kuru",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: {
    kind: "erc20",
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  amountInAtomic: "1000000000000000000",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
} as NormalizedSwapIntent;

describe("Backend composition", () => {
  it("keeps replaceable adapters and domain dependencies behind one runtime", async () => {
    const fixture = fakeBackendFixture();
    const chain = createFakeChainAdapter(fixture.chain);
    const protocol = createFakeProtocolAdapter(fixture.protocol);
    const provider = createFakeProviderAdapter(fixture.provider);
    const normalize: NormalizationBoundary<unknown, NormalizedSwapIntent> = {
      normalize: vi.fn(() => normalizedIntent),
    };
    const core = {
      evaluate: vi.fn(async (intent: NormalizedSwapIntent) => ({
        intent,
        verdict: "PROCEED" as const,
      })),
    };
    const decision: DecisionPort = {
      decide: vi.fn(async (evaluation) => ({ decision: evaluation })),
    };
    const signer: ReceiptSigner = {
      sign: vi.fn(async () => "opaque-signature"),
    };
    const anchorer: ReceiptAnchorer = {
      anchor: vi.fn(async () => "opaque-anchor"),
    };
    const runStore = new InMemoryRunStore();
    const runtime = createBackendComposition({
      chainRegistry: new ChainRegistry([chain]),
      protocolRegistry: new ProtocolRegistry([
        {
          chainId: fixture.chain.chainId,
          protocol: fixture.protocol.id,
          adapter: protocol,
        },
      ]),
      providerRegistry: new ProviderRegistry([provider]),
      normalization: normalize,
      core,
      decision,
      runStore,
      receiptSigner: signer,
      receiptAnchorer: anchorer,
    });

    expect(runtime.resolveChain(fixture.chain.chainId)).toBe(chain);
    expect(
      runtime.resolveProtocol(fixture.chain.chainId, fixture.protocol.id),
    ).toBe(protocol);
    expect(
      runtime.resolveProvider({
        intent: fixture.provider.intent,
        chainId: fixture.chain.chainId,
        protocol: fixture.protocol.id,
        capability: "simulate",
      }),
    ).toBe(provider);
    expect(runtime.normalize("untrusted-input")).toBe(normalizedIntent);
    await expect(runtime.evaluate(normalizedIntent)).resolves.toEqual({
      intent: normalizedIntent,
      verdict: "PROCEED",
    });
    await expect(runtime.decide({ verdict: "PROCEED" })).resolves.toEqual({
      decision: { verdict: "PROCEED" },
    });
    expect(runtime.runStore).toBe(runStore);
    expect(runtime.receiptSigner).toBe(signer);
    expect(runtime.receiptAnchorer).toBe(anchorer);
    expect(core.evaluate).toHaveBeenCalledWith(normalizedIntent);
    expect(decision.decide).toHaveBeenCalledWith({ verdict: "PROCEED" });
  });

  it("allows a different adapter implementation without changing core dependencies", async () => {
    const fixture = fakeBackendFixture();
    const first = createFakeChainAdapter(fixture.chain);
    const replacement = createFakeChainAdapter({
      ...fixture.chain,
      blockNumber: "99",
    });
    const runtime = createBackendComposition({
      chainRegistry: new ChainRegistry([replacement]),
      protocolRegistry: new ProtocolRegistry(),
      providerRegistry: new ProviderRegistry(),
      normalization: { normalize: () => normalizedIntent },
      core: { evaluate: async () => "core-result" },
      decision: { decide: async () => "decision-result" },
      runStore: new InMemoryRunStore(),
    });

    expect(runtime.resolveChain(replacement.chainId)).toBe(replacement);
    await expect(runtime.evaluate(normalizedIntent)).resolves.toBe(
      "core-result",
    );
    expect(first).not.toBe(runtime.resolveChain(replacement.chainId));
  });

  it("accepts a function normalization boundary and validates required ports", () => {
    const fixture = fakeBackendFixture();
    const dependencies = {
      chainRegistry: new ChainRegistry([createFakeChainAdapter(fixture.chain)]),
      protocolRegistry: new ProtocolRegistry(),
      providerRegistry: new ProviderRegistry(),
      normalization: () => normalizedIntent,
      core: { evaluate: () => "core-result" },
      decision: { decide: () => "decision-result" },
      runStore: new InMemoryRunStore(),
    };
    const runtime = createBackendComposition(dependencies);

    expect(runtime.normalize("untrusted-input")).toBe(normalizedIntent);
    expect(() =>
      createBackendComposition({
        ...dependencies,
        core: {} as never,
      }),
    ).toThrow("core.evaluate must be a function");
  });
});
