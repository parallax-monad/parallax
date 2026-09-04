import { describe, expect, it, vi } from "vitest";
import {
  createProviderAdapter,
  evaluateProviderAdapter,
  isProviderAdapterError,
  type ProviderAdapter,
  ProviderAdapterError,
  type ProviderAdapterRawImplementation,
  type ProviderEvaluationInput,
  type ProviderEvaluationResult,
  type ProviderSupportQuery,
} from "./provider-adapter.js";
import { createProvisionalProviderResult } from "./provider-result-boundary.js";

type FakeIntent = {
  readonly kind: "swap";
  readonly chainId: number;
  readonly protocol: string;
};

type FakeRawInput = {
  readonly providerOnlyTransaction: string;
};

const intent: FakeIntent = {
  kind: "swap",
  chainId: 901,
  protocol: "test-protocol",
};

class FakeProvider
  implements ProviderAdapterRawImplementation<FakeIntent, FakeRawInput>
{
  public readonly providerId = "fake-provider";
  public readonly capabilities = ["evaluate", "simulate"] as const;
  public readonly evaluations: ProviderEvaluationInput<
    FakeIntent,
    FakeRawInput
  >[] = [];
  public readonly adapter: ProviderAdapter<FakeIntent, FakeRawInput> =
    createProviderAdapter(this);

  public constructor(private readonly externalCall: () => void) {}

  public supports(query: ProviderSupportQuery<FakeIntent>): boolean {
    return (
      query.intent?.kind === "swap" &&
      query.chainId === 901 &&
      query.protocol === "test-protocol" &&
      query.capability === "simulate"
    );
  }

  public async evaluateRaw(
    input: ProviderEvaluationInput<FakeIntent, FakeRawInput>,
  ): Promise<ProviderEvaluationResult> {
    this.externalCall();
    this.evaluations.push(input);
    return {
      ...createProvisionalProviderResult({
        provider: {
          providerId: this.providerId,
          providerVersion: "fixture-v1",
          observedAt: "2026-09-04T13:05:00.000Z",
        },
        status: "success",
        responseEvidence: {
          kind: "reference",
          reference: "fixture://fake-provider/run-1",
        },
        candidateFields: [
          {
            candidatePath: "provider.observedValue",
            sourcePath: "$.providerOnlyEvidence",
            observedShape: "string",
            nullable: false,
            transformRule: "fixture-identity",
            status: "observed",
            confidence: "unassessed",
            value: input.input.providerOnlyTransaction,
          },
        ],
      }),
      capabilities: this.capabilities,
    };
  }
}

function validResult(providerId = "fake-provider") {
  return {
    provider: { providerId, observedAt: "2026-09-04T13:11:00.000Z" },
    status: "success" as const,
    responseEvidence: {
      kind: "reference" as const,
      reference: `fixture://${providerId}/run-1`,
    },
    candidateFields: [],
  };
}

function adapterFor(output: unknown): ProviderAdapter {
  return createProviderAdapter({
    providerId: "fake-provider",
    supports: () => true,
    evaluateRaw: async () => output,
  });
}

describe("ProviderAdapter provisional port", () => {
  it("injects a fake and returns a provisional candidate boundary", async () => {
    const externalCall = vi.fn();
    const provider = new FakeProvider(externalCall);
    const rawInput: FakeRawInput = { providerOnlyTransaction: "opaque-input" };

    expect(
      provider.adapter.supports({
        intent,
        chainId: intent.chainId,
        protocol: intent.protocol,
        capability: "simulate",
      }),
    ).toBe(true);
    expect(provider.evaluations).toHaveLength(0);

    const result = await evaluateProviderAdapter(provider.adapter, {
      runId: "run-1",
      intent,
      chainId: intent.chainId,
      protocol: intent.protocol,
      input: rawInput,
    });
    expect(result).toEqual({
      status: "success",
      provider: {
        providerId: "fake-provider",
        providerVersion: "fixture-v1",
        observedAt: "2026-09-04T13:05:00.000Z",
      },
      responseEvidence: {
        kind: "reference",
        reference: "fixture://fake-provider/run-1",
      },
      candidateFields: [
        {
          candidatePath: "provider.observedValue",
          sourcePath: "$.providerOnlyEvidence",
          observedShape: "string",
          nullable: false,
          transformRule: "fixture-identity",
          status: "observed",
          confidence: "unassessed",
          value: "opaque-input",
          reviewStatus: "pending_review",
        },
      ],
      capabilities: ["evaluate", "simulate"],
    });
    expect((result as Record<string, unknown>).output).toBeUndefined();
    expect(provider.evaluations).toHaveLength(1);
    expect(provider.evaluations[0]?.input).toBe(rawInput);
    expect(externalCall).toHaveBeenCalledTimes(1);
  });

  it("keeps supports side-effect free at the public seam", () => {
    const externalCall = vi.fn();
    const provider = new FakeProvider(externalCall);

    expect(
      provider.adapter.supports({
        intent,
        chainId: 901,
        protocol: "test-protocol",
        capability: "simulate",
      }),
    ).toBe(true);
    expect(
      provider.adapter.supports({
        intent,
        chainId: 901,
        protocol: "test-protocol",
        capability: "quote",
      }),
    ).toBe(false);
    expect(
      provider.adapter.supports({
        intent,
        chainId: 1,
        protocol: "test-protocol",
        capability: "simulate",
      }),
    ).toBe(false);
    expect(
      provider.adapter.supports({
        intent,
        chainId: 901,
        protocol: "other-protocol",
        capability: "simulate",
      }),
    ).toBe(false);

    expect(externalCall).not.toHaveBeenCalled();
    expect(provider.evaluations).toHaveLength(0);
  });

  it("keeps capability representation extensible and does not require final Evidence fields", () => {
    const provider = new FakeProvider(() => {});
    expect(provider.adapter.capabilities).toEqual(["evaluate", "simulate"]);
    expect(provider.adapter.capabilities).not.toContain("quote");
  });

  it("fails closed when an adapter bypasses the provisional result factory", async () => {
    const adapter = createProviderAdapter({
      providerId: "malicious-provider",
      supports: () => true,
      evaluateRaw: async () => ({
        provider: {
          providerId: "malicious-provider",
          observedAt: "2026-09-04T13:11:00.000Z",
        },
        status: "success",
        responseEvidence: {
          kind: "reference",
          reference: "fixture://malicious-provider/run-1",
        },
        candidateFields: [
          {
            candidatePath: "provider.raw",
            observedShape: "object",
            nullable: false,
            status: "observed",
            confidence: "unassessed",
            value: new Date(),
          },
        ],
      }),
    });

    await expect(
      evaluateProviderAdapter(adapter, { runId: "run-1", input: {} }),
    ).rejects.toThrow("candidateField.value must be a JSON-compatible value");
  });

  it("validates direct public evaluate results and does not expose the raw seam", async () => {
    const raw = { ...validResult(), rawProviderObject: { secret: true } };
    const adapter = createProviderAdapter({
      providerId: "fake-provider",
      capabilities: ["simulate"],
      supports: () => true,
      evaluateRaw: async () => raw,
      rawProviderObject: raw.rawProviderObject,
    } as ProviderAdapterRawImplementation & {
      rawProviderObject: object;
    });

    expect(Object.isFrozen(adapter)).toBe(true);
    expect(Object.isFrozen(adapter.capabilities)).toBe(true);
    expect(Object.keys(adapter)).toEqual([
      "providerId",
      "capabilities",
      "supports",
    ]);
    expect(Object.getOwnPropertySymbols(adapter)).toHaveLength(0);
    expect("evaluateRaw" in adapter).toBe(false);
    expect(Object.values(adapter)).not.toContain(raw.rawProviderObject);

    const result = await evaluateProviderAdapter(adapter, {
      runId: "run-1",
      input: {},
    });
    expect(result).toEqual({ ...validResult(), capabilities: undefined });
    expect(result).not.toBe(raw);
    expect(
      (result as Record<string, unknown>).rawProviderObject,
    ).toBeUndefined();
  });

  it("rejects forged adapters before invoking their evaluate method", () => {
    const forgedEvaluate = vi.fn(async () => validResult());
    const forgedAdapter = {
      providerId: "fake-provider",
      capabilities: [],
      supports: () => true,
      evaluate: forgedEvaluate,
    } as unknown as ProviderAdapter;

    expect(() =>
      evaluateProviderAdapter(forgedAdapter, { runId: "run-1", input: {} }),
    ).toThrow("adapter must be created by createProviderAdapter");
    expect(forgedEvaluate).not.toHaveBeenCalled();
  });

  it.each([
    ["non-plain result", null, "provisional result must be a plain object"],
    [
      "provider identity mismatch",
      validResult("other-provider"),
      "provider result does not match adapter providerId",
    ],
    [
      "non-JSON candidate value",
      {
        ...validResult(),
        candidateFields: [
          {
            candidatePath: "provider.raw",
            observedShape: "object",
            nullable: false,
            status: "observed",
            confidence: "unassessed",
            value: new Date(),
          },
        ],
      },
      "candidateField.value must be a JSON-compatible value",
    ],
    [
      "illegal capabilities",
      { ...validResult(), capabilities: ["simulate", 1] },
      "adapter capabilities must be non-empty strings",
    ],
    [
      "missing response evidence",
      (() => {
        const result = validResult();
        const { responseEvidence: _responseEvidence, ...withoutEvidence } =
          result;
        return withoutEvidence;
      })(),
      "response evidence must be a plain object",
    ],
  ] as const)(
    "factory evaluation fails closed for %s",
    async (_label, output, message) => {
      await expect(
        evaluateProviderAdapter(adapterFor(output), {
          runId: "run-1",
          input: {},
        }),
      ).rejects.toThrow(message);
    },
  );

  it("rejects invalid adapter capabilities at factory creation", () => {
    const sparseCapabilities = [] as string[];
    sparseCapabilities.length = 1;
    expect(() =>
      createProviderAdapter({
        providerId: "fake-provider",
        capabilities: sparseCapabilities,
        supports: () => true,
        evaluateRaw: async () => validResult(),
      }),
    ).toThrow("adapter capabilities must be a dense array");

    expect(() =>
      createProviderAdapter({
        providerId: "fake-provider",
        capabilities: ["simulate", 1] as unknown as readonly string[],
        supports: () => true,
        evaluateRaw: async () => validResult(),
      }),
    ).toThrow("adapter capabilities must be non-empty strings");
  });

  it("rejects sparse capabilities returned by the raw implementation", async () => {
    const sparseCapabilities = [] as string[];
    sparseCapabilities.length = 1;
    const adapter = adapterFor({
      ...validResult(),
      capabilities: sparseCapabilities,
    });

    await expect(
      evaluateProviderAdapter(adapter, { runId: "run-1", input: {} }),
    ).rejects.toThrow("adapter capabilities must be a dense array");
  });

  it("snapshots valid factory capabilities independently", () => {
    const rawCapabilities = ["simulate"];
    const adapter = createProviderAdapter({
      providerId: "fake-provider",
      capabilities: rawCapabilities,
      supports: () => true,
      evaluateRaw: async () => validResult(),
    });

    rawCapabilities[0] = "mutated";
    expect(adapter.capabilities).toEqual(["simulate"]);
    expect(Object.isFrozen(adapter.capabilities)).toBe(true);
  });

  it.each(["UNSUPPORTED", "FAILED", "TIMEOUT", "UNKNOWN"] as const)(
    "identifies a %s error without converting it to success",
    (code) => {
      const cause = { code: "provider-native-error" };
      const error = new ProviderAdapterError({
        providerId: "fake-provider",
        code,
        message: `${code} provider result`,
        retryable: code === "TIMEOUT",
        cause,
      });

      expect(isProviderAdapterError(error)).toBe(true);
      expect(error.providerId).toBe("fake-provider");
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(code === "TIMEOUT");
      expect(error.cause).toBe(cause);
      expect((error as { status?: unknown }).status).toBeUndefined();
      expect((error as { verdict?: unknown }).verdict).toBeUndefined();
    },
  );

  it("rejects structurally incomplete provider errors", () => {
    expect(
      isProviderAdapterError({
        name: "ProviderAdapterError",
        providerId: "fake-provider",
        code: "FAILED",
        message: "failed",
        retryable: "false",
      }),
    ).toBe(false);
  });
});
