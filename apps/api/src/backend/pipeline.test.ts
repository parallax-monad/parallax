import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it, vi } from "vitest";
import { bootstrapBackendApp } from "../bootstrap/backend.js";
import { InMemoryRunStore } from "../store.js";
import { ChainAdapterError } from "./chain-adapter.js";
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
import { PROVIDER_OWNED_GAS_ESTIMATE_CAPABILITY } from "./provider-adapter.js";
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

function createPipelineWithGasPreflightFailure(
  error: unknown,
  options: { readonly providerOwnsGasEstimate?: boolean } = {},
  fixture = fakeBackendFixture(),
) {
  const chain = {
    ...createFakeChainAdapter(fixture.chain),
    async estimateGas() {
      throw error;
    },
  };
  const routingCapabilities = options.providerOwnsGasEstimate
    ? [
        ...(fixture.provider.routingCapabilities ?? []),
        PROVIDER_OWNED_GAS_ESTIMATE_CAPABILITY,
      ]
    : fixture.provider.routingCapabilities;
  const provider = createFakeProviderAdapterHarness({
    ...fixture.provider,
    routingCapabilities,
    supports: (query) =>
      query.chainId === fixture.chain.chainId &&
      query.protocol === fixture.protocol.id,
  });
  const runtime = createBackendComposition({
    chainRegistry: new ChainRegistry([chain]),
    protocolRegistry: new ProtocolRegistry([
      {
        chainId: fixture.chain.chainId,
        protocol: fixture.protocol.id,
        adapter: createFakeProtocolAdapter(fixture.protocol),
      },
    ]),
    providerRegistry: new ProviderRegistry([provider.adapter]),
    normalization: { normalize: () => normalizedIntent },
    core: { evaluate: async () => undefined },
    decision: { decide: async () => undefined },
    runStore: new InMemoryRunStore(),
  });

  return {
    pipeline: new BackendPipeline({ runtime }),
    provider,
    fixture,
  };
}

describe("BackendPipeline", () => {
  it("evaluates supplementary evidence from the exact prepared execution without passing it to Risk seams", async () => {
    const fixture = fakeBackendFixture();
    const chain = createFakeChainAdapter(fixture.chain);
    const protocol = createFakeProtocolAdapter(fixture.protocol);
    const provider = createFakeProviderAdapterHarness({
      ...fixture.provider,
      supports: (query) =>
        query.chainId === fixture.chain.chainId &&
        query.protocol === fixture.protocol.id,
    });
    const supplementaryEvidenceEvaluator = vi.fn(
      async (input: {
        readonly preparedExecution: unknown;
        readonly providerResult: unknown;
      }) => ({
        source: "supplementary-fixture",
        runId: (input.preparedExecution as { readonly runId: string }).runId,
        primaryStatus: (input.providerResult as { readonly status: string })
          .status,
      }),
    );
    const core = vi.fn(
      async (_input: NormalizedSwapIntent, context?: unknown) => context,
    );
    const decision = vi.fn(async (input: unknown) => input);
    const runtime = createBackendComposition({
      chainRegistry: new ChainRegistry([chain]),
      protocolRegistry: new ProtocolRegistry([
        {
          chainId: fixture.chain.chainId,
          protocol: fixture.protocol.id,
          adapter: protocol,
        },
      ]),
      providerRegistry: new ProviderRegistry([provider.adapter]),
      normalization: { normalize: () => normalizedIntent },
      core: { evaluate: core },
      decision: { decide: decision },
      runStore: new InMemoryRunStore(),
      supplementaryEvidenceEvaluator,
    });
    const pipeline = new BackendPipeline({ runtime });

    const result = await pipeline.execute({
      rawInput: {},
      runId: "supplementary-run",
      chainId: fixture.chain.chainId,
      protocol: fixture.protocol.id,
    });

    expect(supplementaryEvidenceEvaluator).toHaveBeenCalledWith(
      expect.objectContaining({
        preparedExecution: expect.objectContaining({
          runId: "supplementary-run",
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
        providerResult: expect.objectContaining({ status: "success" }),
      }),
    );
    expect(result.supplementaryEvidence).toEqual({
      source: "supplementary-fixture",
      runId: "supplementary-run",
      primaryStatus: "success",
    });
    expect(core).toHaveBeenCalledWith(
      normalizedIntent,
      expect.not.objectContaining({ supplementaryEvidence: expect.anything() }),
    );
    expect(decision).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ supplementaryEvidence: expect.anything() }),
    );

    const pipelineContext = core.mock.calls[0]?.[1] as {
      readonly executeProviderPath?: (input: {
        readonly runId: string;
        readonly intent: NormalizedSwapIntent;
      }) => Promise<{ readonly supplementaryEvidence?: unknown }>;
    };
    expect(pipelineContext.executeProviderPath).toBeTypeOf("function");
    const childExecution = await pipelineContext.executeProviderPath?.({
      runId: "supplementary-child",
      intent: normalizedIntent,
    });
    expect(childExecution?.supplementaryEvidence).toBeUndefined();
    expect(supplementaryEvidenceEvaluator).toHaveBeenCalledTimes(1);
  });

  it("keeps the primary execution when supplementary evaluation rejects", async () => {
    const fixture = fakeBackendFixture();
    const chain = createFakeChainAdapter(fixture.chain);
    const protocol = createFakeProtocolAdapter(fixture.protocol);
    const provider = createFakeProviderAdapterHarness({
      ...fixture.provider,
      supports: (query) =>
        query.chainId === fixture.chain.chainId &&
        query.protocol === fixture.protocol.id,
    });
    const supplementaryEvidenceEvaluator = vi.fn(async () => {
      throw new Error("supplementary source failed");
    });
    const runtime = createBackendComposition({
      chainRegistry: new ChainRegistry([chain]),
      protocolRegistry: new ProtocolRegistry([
        {
          chainId: fixture.chain.chainId,
          protocol: fixture.protocol.id,
          adapter: protocol,
        },
      ]),
      providerRegistry: new ProviderRegistry([provider.adapter]),
      normalization: { normalize: () => normalizedIntent },
      core: { evaluate: async () => undefined },
      decision: { decide: async () => undefined },
      runStore: new InMemoryRunStore(),
      supplementaryEvidenceEvaluator,
    });

    const result = await new BackendPipeline({ runtime }).execute({
      rawInput: {},
      runId: "supplementary-rejection",
      chainId: fixture.chain.chainId,
      protocol: fixture.protocol.id,
    });

    expect(result.providerResult.status).toBe("success");
    expect(result.supplementaryEvidence).toBeUndefined();
    expect(supplementaryEvidenceEvaluator).toHaveBeenCalledTimes(1);
  });

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
    expect(protocol.calls[1]).toMatchObject({
      operation: "buildTransaction",
      options: {
        blockContext: { blockNumber: fixture.chain.blockNumber },
        quote: fixture.protocol.quote,
      },
    });
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

  it.each([
    "INSUFFICIENT_NATIVE_BALANCE",
    "UNAVAILABLE",
    "EXECUTION_REVERT",
  ] as const)(
    "continues to a provider-owned pinned gas check for %s preflight failures",
    async (code) => {
      const fixture = fakeBackendFixture();
      const error = new ChainAdapterError({
        chainId: fixture.chain.chainId,
        operation: "estimateGas",
        code,
        message: "preflight estimate unavailable",
      });
      const { pipeline, provider } = createPipelineWithGasPreflightFailure(
        error,
        { providerOwnsGasEstimate: true },
        fixture,
      );

      const result = await pipeline.execute({
        rawInput: {},
        runId: `gas-preflight-${code}`,
        chainId: fixture.chain.chainId,
        protocol: fixture.protocol.id,
      });

      expect(result.gasEstimate).toEqual({
        status: "UNAVAILABLE",
        reason: "Chain-level gas preflight was unavailable",
      });
      expect(provider.evaluations).toHaveLength(1);
      expect(result.providerResult.status).toBe("success");
      expect(provider.evaluations[0]?.input).toMatchObject({
        runId: `gas-preflight-${code}`,
        intent: normalizedIntent,
        blockContext: { blockNumber: fixture.chain.blockNumber },
        quote: fixture.protocol.quote,
        unsignedTransaction: {
          kind: "unsigned",
          payload: fixture.protocol.transaction,
        },
        gasEstimate: {
          status: "UNAVAILABLE",
          reason: "Chain-level gas preflight was unavailable",
        },
      });
    },
  );

  it.each([
    {
      label: "timeout",
      chainId: 901,
      operation: "estimateGas",
      code: "TIMEOUT",
    },
    {
      label: "cancellation",
      chainId: 901,
      operation: "estimateGas",
      code: "CANCELLED",
    },
    {
      label: "invalid request",
      chainId: 901,
      operation: "estimateGas",
      code: "INVALID_REQUEST",
    },
    {
      label: "unknown error",
      chainId: 901,
      operation: "estimateGas",
      code: "UNKNOWN",
    },
    {
      label: "wrong chain",
      chainId: 143,
      operation: "estimateGas",
      code: "UNAVAILABLE",
    },
    {
      label: "wrong operation",
      chainId: 901,
      operation: "getBlockContext",
      code: "UNAVAILABLE",
    },
  ] as const)(
    "stops before Provider evaluation for a $label gas-preflight failure",
    async ({ chainId, operation, code }) => {
      const error = new ChainAdapterError({
        chainId,
        operation,
        code,
        message: "must not be treated as a recoverable gas preflight",
      });
      const { pipeline, provider } = createPipelineWithGasPreflightFailure(
        error,
        { providerOwnsGasEstimate: true },
      );

      await expect(
        pipeline.execute({
          rawInput: {},
          runId: `gas-preflight-blocked-${code}-${operation}-${chainId}`,
          chainId: 901,
          protocol: "kuru",
        }),
      ).rejects.toBe(error);
      expect(provider.evaluations).toHaveLength(0);
    },
  );

  it("stops when the selected Provider does not own gas estimation", async () => {
    const error = new ChainAdapterError({
      chainId: 901,
      operation: "estimateGas",
      code: "UNAVAILABLE",
      message: "chain preflight unavailable",
    });
    const { pipeline, provider } = createPipelineWithGasPreflightFailure(error);

    await expect(
      pipeline.execute({
        rawInput: {},
        runId: "gas-preflight-no-provider-capability",
        chainId: 901,
        protocol: "kuru",
      }),
    ).rejects.toBe(error);
    expect(provider.evaluations).toHaveLength(0);
  });

  it("does not hand an execution revert to a Provider without pinned gas ownership", async () => {
    const error = new ChainAdapterError({
      chainId: 901,
      operation: "estimateGas",
      code: "EXECUTION_REVERT",
      message: "transaction execution reverted during gas preflight",
    });
    const { pipeline, provider } = createPipelineWithGasPreflightFailure(error);

    await expect(
      pipeline.execute({
        rawInput: {},
        runId: "gas-preflight-revert-no-provider-capability",
        chainId: 901,
        protocol: "kuru",
      }),
    ).rejects.toBe(error);
    expect(provider.evaluations).toHaveLength(0);
  });

  it("does not continue after an untyped gas-preflight exception", async () => {
    const error = new Error("unclassified preflight failure");
    const { pipeline, provider } = createPipelineWithGasPreflightFailure(
      error,
      {
        providerOwnsGasEstimate: true,
      },
    );

    await expect(
      pipeline.execute({
        rawInput: {},
        runId: "gas-preflight-untyped-error",
        chainId: 901,
        protocol: "kuru",
      }),
    ).rejects.toBe(error);
    expect(provider.evaluations).toHaveLength(0);
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
    "preserves Provider evidence status through Core and Decision for %s",
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
      const providerEvidenceMapper = vi.fn((input) => ({
        providerStatus: input.providerResult.status,
      }));
      const core = vi.fn(
        async (_intent: unknown, context?: unknown) => context,
      );
      const decision = vi.fn(
        async (_input: unknown, context?: unknown) => context,
      );
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
        decision: { decide: decision },
        runStore: new InMemoryRunStore(),
        providerEvidenceMapper,
      });
      const pipeline = new BackendPipeline({ runtime });

      const result = await pipeline.execute({
        rawInput: {},
        runId: `provider-${status}-run`,
        chainId: fixture.chain.chainId,
        protocol: fixture.protocol.id,
      });

      expect(providerEvidenceMapper).toHaveBeenCalledWith(
        expect.objectContaining({
          providerResult: expect.objectContaining({ status }),
        }),
      );
      expect(result.providerEvidence).toEqual({ providerStatus: status });
      expect(core).toHaveBeenCalledWith(
        normalizedIntent,
        expect.objectContaining({
          providerResult: expect.objectContaining({ status }),
          providerEvidence: { providerStatus: status },
        }),
      );
      expect(decision).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          providerResult: expect.objectContaining({ status }),
          providerEvidence: { providerStatus: status },
        }),
      );
      expect(evaluations).toHaveLength(1);
    },
  );

  it.each([
    ["failed", "FAILED", "failed", false],
    ["stale", "STALE", "stale", false],
    ["unknown", "UNKNOWN", "unknown", false],
    ["invalid", "FAILED", "failed", false],
    ["timeout", "TIMEOUT", "timeout", true],
    ["unsupported", "UNSUPPORTED", "unsupported", false],
  ] as const)(
    "fails closed before Core and Decision without an evidence mapper for %s",
    async (status, code, errorStatus, retryable) => {
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
      const decision = vi.fn(async () => "must-not-run");
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
        decision: { decide: decision },
        runStore: new InMemoryRunStore(),
      });
      const pipeline = new BackendPipeline({ runtime });

      await expect(
        pipeline.execute({
          rawInput: {},
          runId: `provider-${status}-without-mapper-run`,
          chainId: fixture.chain.chainId,
          protocol: fixture.protocol.id,
        }),
      ).rejects.toMatchObject({
        name: "ProviderAdapterError",
        providerId: fixture.provider.providerId,
        code,
        status: errorStatus,
        retryable,
      });
      expect(evaluations).toHaveLength(1);
      expect(core).not.toHaveBeenCalled();
      expect(decision).not.toHaveBeenCalled();
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
    expect(body.quote.runtimeVersion).toBe("stale-runtime");
    expect(body.quote.runtimeRevision).toBe("stale-revision");
  });

  it("fails closed when a composition Quote omits runtime provenance", async () => {
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
        normalize: () => ({ ...normalizedIntent, chainId: 143 }),
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

    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      reason: "QUOTE_UNAVAILABLE",
    });
  });
});
