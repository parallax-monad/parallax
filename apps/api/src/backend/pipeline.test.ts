import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it, vi } from "vitest";
import { bootstrapBackendApp } from "../bootstrap/backend.js";
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

  it("binds Provider evaluation input to the exact Protocol preparation", async () => {
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
      normalization: { normalize: () => normalizedIntent },
      core: { evaluate: async () => "core" },
      decision: { decide: async () => "decision" },
      runStore: new InMemoryRunStore(),
    });
    const buildProviderInput = vi.fn((prepared) => ({
      runId: prepared.runId,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      quote: prepared.quote,
      unsignedTransaction: prepared.unsignedTransaction,
      blockContext: prepared.blockContext,
    }));
    const pipeline = new BackendPipeline({ runtime, buildProviderInput });

    await pipeline.execute({
      rawInput: {},
      runId: "prepared-execution-run",
      chainId: fixture.chain.chainId,
      protocol: fixture.protocol.id,
    });

    expect(buildProviderInput).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "prepared-execution-run",
        chainId: fixture.chain.chainId,
        protocol: fixture.protocol.id,
        quote: fixture.protocol.quote,
        unsignedTransaction: {
          kind: "unsigned",
          payload: fixture.protocol.transaction,
        },
        blockContext: expect.objectContaining({
          blockNumber: fixture.chain.blockNumber,
        }),
      }),
    );
    expect(evaluations[0]?.input).toEqual({
      runId: "prepared-execution-run",
      chainId: fixture.chain.chainId,
      protocol: fixture.protocol.id,
      quote: fixture.protocol.quote,
      unsignedTransaction: {
        kind: "unsigned",
        payload: fixture.protocol.transaction,
      },
      blockContext: expect.objectContaining({
        blockNumber: fixture.chain.blockNumber,
      }),
    });
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

  it("keeps composition Quote provenance anchored to the current Chain context", async () => {
    const fixture = fakeBackendFixture();
    const chain = createFakeChainAdapter({ ...fixture.chain, chainId: 143 });
    const protocol = createFakeProtocolAdapter({
      ...fixture.protocol,
      quote: {
        status: "available",
        quote: {
          estimatedAmountOut: "42",
          source: "quote",
          blockNumber: "999",
          runtimeVersion: "stale-runtime",
          runtimeRevision: "stale-revision",
        },
      },
    });
    const tokenRegistry = {
      chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
      tokens: [
        {
          chainId: 143,
          address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          symbol: "USDC",
          decimals: 6,
          decimalsSource: "onchain_verified" as const,
          verifiedAtBlock: "90000000",
        },
      ],
    };
    const environment = {
      MONAD_RPC_URL: "https://rpc.example.test",
      MOSS_RUNTIME_VERSION: "current-runtime",
      MOSS_RUNTIME_REVISION: "current-revision",
    };
    const runtime = createBackendComposition({
      chainRegistry: new ChainRegistry([chain]),
      protocolRegistry: new ProtocolRegistry([
        { chainId: 143, protocol: "kuru", adapter: protocol },
      ]),
      providerRegistry: new ProviderRegistry(),
      normalization: {
        normalize: () => ({
          ...normalizedIntent,
          chainId: 143,
        }),
      },
      core: { evaluate: async () => "unused" },
      decision: { decide: async () => "unused" },
      runStore: new InMemoryRunStore(),
    });
    const app = bootstrapBackendApp({
      environment,
      tokenRegistry,
      composition: runtime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 143,
          protocol: "kuru",
          sender: "0x1111111111111111111111111111111111111111",
          tokenIn: { kind: "native" },
          tokenOut: {
            kind: "erc20",
            address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          },
          amountIn: "1.5",
        }),
      }),
    );

    const body = await response.json();
    expect(body.status).toBe("available");
    expect(body.quote.blockNumber).toBe(fixture.chain.blockNumber);
    expect(body.quote.runtimeVersion).toBe(environment.MOSS_RUNTIME_VERSION);
    expect(body.quote.runtimeRevision).toBe(environment.MOSS_RUNTIME_REVISION);
  });
});
