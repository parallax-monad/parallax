import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it, vi } from "vitest";
import { InMemoryRunStore } from "../store.js";
import { ChainRegistry } from "./chain-registry.js";
import { createBackendComposition } from "./composition.js";
import {
  createFakeChainAdapter,
  createFakeProtocolAdapter,
  createFakeProviderAdapterHarness,
  fakeBackendFixture,
} from "./fake-harness.js";
import { BackendPipeline } from "./pipeline.js";
import { ProtocolRegistry } from "./protocol-registry.js";
import { isProviderAdapterError } from "./provider-adapter.js";
import { ProviderRegistry } from "./provider-registry.js";

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

describe("BackendPipeline", () => {
  it("executes the injected Chain, Protocol, Provider, Core, and Decision seams", async () => {
    const fixture = fakeBackendFixture();
    const chain = createFakeChainAdapter(fixture.chain);
    const protocol = createFakeProtocolAdapter(fixture.protocol);
    const { adapter: provider, evaluations } = createFakeProviderAdapterHarness(
      {
        ...fixture.provider,
        supports: (query) =>
          query.chainId === fixture.chain.chainId &&
          query.protocol === fixture.protocol.id,
      },
    );
    const core = {
      evaluate: vi.fn(
        async (intent: NormalizedSwapIntent, context?: unknown) => ({
          intent,
          context,
        }),
      ),
    };
    const decision = {
      decide: vi.fn(async (input: unknown, context?: unknown) => ({
        input,
        context,
      })),
    };
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
      normalization: { normalize: vi.fn(() => normalizedIntent) },
      core,
      decision,
      runStore: new InMemoryRunStore(),
    });
    const pipeline = new BackendPipeline({
      runtime,
      buildDecisionInput: ({ coreOutput }) => coreOutput,
    });

    const result = await pipeline.execute({
      rawInput: { untrusted: true },
      runId: "pipeline-run",
      chainId: fixture.chain.chainId,
      protocol: fixture.protocol.id,
      providerInput: { prepared: "fixture" },
    });

    expect(result.decisionOutput).toMatchObject({
      input: { intent: normalizedIntent },
    });
    expect(result.providerResult).toMatchObject({
      provider: { providerId: fixture.provider.providerId },
      status: "success",
    });
    expect(evaluations).toHaveLength(1);
    expect(chain.calls.map((call) => call.operation)).toEqual([
      "connect",
      "getBlockContext",
      "estimateGas",
      "getFinality",
    ]);
    expect(protocol.calls.map((call) => call.operation)).toEqual([
      "quote",
      "buildTransaction",
    ]);
    expect(core.evaluate).toHaveBeenCalledWith(
      normalizedIntent,
      expect.objectContaining({
        providerResult: expect.objectContaining({ status: "success" }),
      }),
    );
    expect(decision.decide).toHaveBeenCalledWith(
      expect.objectContaining({ intent: normalizedIntent }),
      expect.objectContaining({
        providerResult: expect.objectContaining({ status: "success" }),
      }),
    );
  });

  it("does not invoke a Provider when exact selection fails", async () => {
    const fixture = fakeBackendFixture();
    const provider = createFakeProviderAdapterHarness(fixture.provider);
    const runtime = createBackendComposition({
      chainRegistry: new ChainRegistry([createFakeChainAdapter(fixture.chain)]),
      protocolRegistry: new ProtocolRegistry([
        {
          chainId: fixture.chain.chainId,
          protocol: fixture.protocol.id,
          adapter: createFakeProtocolAdapter(fixture.protocol),
        },
      ]),
      providerRegistry: new ProviderRegistry([provider.adapter]),
      normalization: { normalize: () => normalizedIntent },
      core: { evaluate: async () => "core" },
      decision: { decide: async () => "decision" },
      runStore: new InMemoryRunStore(),
    });
    const pipeline = new BackendPipeline({ runtime });

    await expect(
      pipeline.execute({
        rawInput: {},
        runId: "unsupported-provider-run",
        chainId: fixture.chain.chainId,
        protocol: fixture.protocol.id,
        capability: "unsupported-capability",
        providerInput: {},
      }),
    ).rejects.toThrow("no registered provider supports");
    expect(provider.evaluations).toHaveLength(0);
  });

  it.each([
    "failed",
    "stale",
    "unknown",
    "invalid",
    "timeout",
    "unsupported",
  ] as const)(
    "fails closed before Core when Provider evidence is %s",
    async (status) => {
      const fixture = fakeBackendFixture();
      const { adapter: provider, evaluations } =
        createFakeProviderAdapterHarness({
          ...fixture.provider,
          supports: (query) =>
            query.chainId === fixture.chain.chainId &&
            query.protocol === fixture.protocol.id,
          result: {
            provider: {
              providerId: fixture.provider.providerId,
              observedAt: "2026-09-01T00:00:00.000Z",
            },
            status,
            responseEvidence: {
              kind: "reference",
              reference: `fixture://${fixture.provider.providerId}/${status}`,
            },
            candidateFields: [],
          },
        });
      const core = vi.fn(async () => "must-not-run");
      const runtime = createBackendComposition({
        chainRegistry: new ChainRegistry([
          createFakeChainAdapter(fixture.chain),
        ]),
        protocolRegistry: new ProtocolRegistry([
          {
            chainId: fixture.chain.chainId,
            protocol: fixture.protocol.id,
            adapter: createFakeProtocolAdapter(fixture.protocol),
          },
        ]),
        providerRegistry: new ProviderRegistry([provider]),
        normalization: { normalize: () => normalizedIntent },
        core: { evaluate: core },
        decision: { decide: async () => "decision" },
        runStore: new InMemoryRunStore(),
      });
      const pipeline = new BackendPipeline({ runtime });

      await expect(
        pipeline.execute({
          rawInput: {},
          runId: `provider-${status}-run`,
          chainId: fixture.chain.chainId,
          protocol: fixture.protocol.id,
          providerInput: {},
        }),
      ).rejects.toSatisfy((received: unknown) => {
        const expectedCode =
          status === "failed" || status === "invalid"
            ? "FAILED"
            : status === "stale"
              ? "STALE"
              : status === "timeout"
                ? "TIMEOUT"
                : status === "unsupported"
                  ? "UNSUPPORTED"
                  : "UNKNOWN";
        return (
          isProviderAdapterError(received) &&
          received.providerId === fixture.provider.providerId &&
          received.code === expectedCode &&
          received.message.includes(`returned ${status}`)
        );
      });
      expect(evaluations).toHaveLength(1);
      expect(core).not.toHaveBeenCalled();
    },
  );
});
