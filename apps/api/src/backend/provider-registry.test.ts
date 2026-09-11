import { describe, expect, it, vi } from "vitest";
import { isBackendControlError } from "./control-boundary.js";
import {
  createProviderAdapter,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderSupportQuery,
} from "./provider-adapter.js";
import {
  isProviderRegistryError,
  type ProviderOverride,
  ProviderRegistry,
  ProviderRegistryError,
} from "./provider-registry.js";

type FakeIntent = {
  readonly kind: "swap";
  readonly request: string;
};

const intent: FakeIntent = { kind: "swap", request: "fixture" };

function provider(
  providerId: string,
  supports: (query: ProviderSupportQuery<FakeIntent>) => boolean,
  capabilities: readonly ProviderCapability[] = ["simulate"],
): ProviderAdapter<FakeIntent> {
  return createProviderAdapter({
    providerId,
    capabilities,
    supports,
    evaluateRaw: async () => ({
      provider: { providerId, observedAt: "2026-09-10T00:00:00.000Z" },
      status: "unknown",
      responseEvidence: {
        kind: "reference",
        reference: `fixture://${providerId}`,
      },
      candidateFields: [],
    }),
  });
}

function query(
  overrides: Partial<ProviderSupportQuery<FakeIntent>> = {},
): ProviderSupportQuery<FakeIntent> {
  return {
    intent,
    chainId: 901,
    protocol: "kuru",
    capability: "simulate",
    ...overrides,
  };
}

describe("ProviderRegistry", () => {
  it("selects the only exact provider match without a default fallback", () => {
    const adapter = provider(
      "tenderly",
      (received) =>
        received.intent === intent &&
        received.chainId === 901 &&
        received.protocol === "kuru" &&
        received.capability === "simulate",
    );
    const registry = new ProviderRegistry<FakeIntent>([adapter]);

    expect(registry.resolve(query())).toBe(adapter);
  });

  it.each([
    ["intent", query({ intent: { kind: "swap", request: "other" } })],
    ["chain", query({ chainId: 902 })],
    ["protocol", query({ protocol: "camelot" })],
    ["capability", query({ capability: "quote" })],
  ] as const)(
    "fails closed when the %s is unsupported",
    (_dimension, received) => {
      const registry = new ProviderRegistry<FakeIntent>([
        provider(
          "tenderly",
          (candidate) =>
            candidate.intent === intent &&
            candidate.chainId === 901 &&
            candidate.protocol === "kuru" &&
            candidate.capability === "simulate",
        ),
      ]);

      expect(() => registry.resolve(received)).toThrowError(
        expect.objectContaining({
          code: "UNSUPPORTED_PROVIDER",
          status: "unsupported",
          retryable: false,
        }),
      );
    },
  );

  it("fails closed when a provider does not declare the requested capability", () => {
    const registry = new ProviderRegistry<FakeIntent>([
      provider("undeclared-capability", () => true, []),
    ]);

    expect(() => registry.resolve(query())).toThrowError(
      expect.objectContaining({
        code: "UNSUPPORTED_PROVIDER",
        status: "unsupported",
      }),
    );
  });

  it("rejects ambiguous exact matches instead of choosing registration order", () => {
    const supportsExact = (candidate: ProviderSupportQuery<FakeIntent>) =>
      candidate.intent === intent &&
      candidate.chainId === 901 &&
      candidate.protocol === "kuru" &&
      candidate.capability === "simulate";
    const registry = new ProviderRegistry<FakeIntent>([
      provider("tenderly", supportsExact),
      provider("native-rpc", supportsExact),
    ]);

    expect(() => registry.resolve(query())).toThrowError(
      expect.objectContaining({
        code: "AMBIGUOUS_PROVIDER",
        status: "failed",
        retryable: false,
        providerIds: ["tenderly", "native-rpc"],
      }),
    );
  });

  it("rejects duplicate provider IDs without replacing the first adapter", () => {
    const first = provider("tenderly", () => true);
    const registry = new ProviderRegistry<FakeIntent>([first]);

    expect(() =>
      registry.register(provider("tenderly", () => true)),
    ).toThrowError(
      expect.objectContaining({
        code: "DUPLICATE_PROVIDER",
        providerId: "tenderly",
      }),
    );
    expect(registry.resolve(query())).toBe(first);
  });

  it("rejects malformed adapter configuration before registration", () => {
    const registry = new ProviderRegistry<FakeIntent>();

    expect(() =>
      registry.register(null as unknown as ProviderAdapter<FakeIntent>),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_PROVIDER_CONFIGURATION",
        status: "invalid",
      }),
    );
    expect(() =>
      registry.register({
        providerId: "malformed",
        supports: () => true,
        capabilities: ["simulate", 1],
      } as unknown as ProviderAdapter<FakeIntent>),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_PROVIDER_CONFIGURATION",
        providerId: "malformed",
      }),
    );
  });

  it("rejects structurally forged adapters at registration", () => {
    const registry = new ProviderRegistry<FakeIntent>();

    expect(() =>
      registry.register({
        providerId: "forged",
        supports: () => true,
        capabilities: ["simulate"],
      } as unknown as ProviderAdapter<FakeIntent>),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_PROVIDER_CONFIGURATION",
        providerId: "forged",
      }),
    );
  });

  it("allows an explicit provider override only in development or demo configuration", () => {
    const tenderly = provider("tenderly", () => true);
    const registry = new ProviderRegistry<FakeIntent>(
      [tenderly, provider("native-rpc", () => true)],
      { environment: "development" },
    );

    expect(
      registry.resolve(query(), {
        override: { providerId: "tenderly" },
      }),
    ).toBe(tenderly);
    expect(
      registry.resolve(query(), {
        override: { providerId: "tenderly" },
      }),
    ).toBe(tenderly);
    expect(
      registry.resolve(query(), {
        providerOverride: { providerId: "tenderly" },
      }),
    ).toBe(tenderly);
  });

  it("does not let an override bypass unsupported intent, chain, protocol, or capability", () => {
    const registry = new ProviderRegistry<FakeIntent>(
      [provider("tenderly", () => false)],
      { environment: "demo" },
    );

    expect(() =>
      registry.resolve(query(), {
        override: { providerId: "tenderly" },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "UNSUPPORTED_PROVIDER",
        providerId: "tenderly",
        status: "unsupported",
      }),
    );
  });

  it("rejects overrides in ordinary or production selection paths", () => {
    const registry = new ProviderRegistry<FakeIntent>([
      provider("tenderly", () => true),
    ]);

    expect(() =>
      registry.resolve(query(), {
        override: { providerId: "tenderly" },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PROVIDER_OVERRIDE_FORBIDDEN",
        status: "invalid",
      }),
    );
    const developmentRegistry = new ProviderRegistry<FakeIntent>(
      [provider("tenderly", () => true)],
      { environment: "development" },
    );
    expect(() =>
      developmentRegistry.resolve(query(), {
        override: { providerId: "tenderly" },
      }),
    ).not.toThrow();
  });

  it("does not let a caller-supplied override authorize a production registry", () => {
    const registry = new ProviderRegistry<FakeIntent>([
      provider("tenderly", () => true),
    ]);

    expect(() =>
      registry.resolve(query(), {
        override: {
          providerId: "tenderly",
          environment: "demo",
        } as ProviderOverride & { environment: "demo" },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PROVIDER_OVERRIDE_FORBIDDEN",
        status: "invalid",
      }),
    );
  });

  it("rejects provider override fields embedded in the ordinary query", () => {
    const registry = new ProviderRegistry<FakeIntent>([
      provider("tenderly", () => true),
    ]);

    expect(() =>
      registry.resolve({
        ...query(),
        providerOverride: "tenderly",
      } as ProviderSupportQuery<FakeIntent> & { providerOverride: string }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_PROVIDER_CONFIGURATION",
        status: "invalid",
      }),
    );
  });

  it("guards runtime failures and invalid support results at the registry boundary", () => {
    const runtimeFailure = provider("runtime-failure", () => {
      throw new Error("provider support probe failed");
    });
    const invalidResult = provider(
      "invalid-result",
      () => "yes" as unknown as boolean,
    );
    const registry = new ProviderRegistry<FakeIntent>();
    registry.register(runtimeFailure);

    expect(() => registry.resolve(query())).toThrowError(
      expect.objectContaining({
        code: "PROVIDER_RUNTIME_ERROR",
        providerId: "runtime-failure",
      }),
    );

    const invalidRegistry = new ProviderRegistry<FakeIntent>();
    invalidRegistry.register(invalidResult);
    expect(() => invalidRegistry.resolve(query())).toThrowError(
      expect.objectContaining({
        code: "INVALID_PROVIDER_CONFIGURATION",
        providerId: "invalid-result",
      }),
    );
  });

  it("keeps registry errors compatible with the shared control boundary", () => {
    const error = new ProviderRegistryError({
      code: "UNSUPPORTED_PROVIDER",
      message: "no provider supports the requested selection",
      retryable: false,
      status: "unsupported",
    });

    expect(error).toBeInstanceOf(ProviderRegistryError);
    expect(isProviderRegistryError(error)).toBe(true);
    expect(isBackendControlError(error)).toBe(true);
    expect(
      isProviderRegistryError({
        name: "ProviderRegistryError",
        code: "UNSUPPORTED_PROVIDER",
        message: "no provider supports the requested selection",
        retryable: false,
        status: "failed",
      }),
    ).toBe(false);
  });

  it("does not invoke provider evaluation while selecting", () => {
    const evaluateRaw = vi.fn(async () => ({
      provider: {
        providerId: "tenderly",
        observedAt: "2026-09-10T00:00:00.000Z",
      },
      status: "unknown" as const,
      responseEvidence: {
        kind: "reference" as const,
        reference: "fixture://tenderly",
      },
      candidateFields: [],
    }));
    const adapter = createProviderAdapter<FakeIntent>({
      providerId: "tenderly",
      capabilities: ["simulate"],
      supports: () => true,
      evaluateRaw,
    });

    new ProviderRegistry<FakeIntent>([adapter]).resolve(query());

    expect(evaluateRaw).not.toHaveBeenCalled();
  });
});
