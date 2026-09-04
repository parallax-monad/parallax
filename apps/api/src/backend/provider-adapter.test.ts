import { describe, expect, it, vi } from "vitest";
import {
  isProviderAdapterError,
  type ProviderAdapter,
  ProviderAdapterError,
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

class FakeProvider implements ProviderAdapter<FakeIntent, FakeRawInput> {
  public readonly providerId = "fake-provider";
  public readonly capabilities = ["evaluate", "simulate"] as const;
  public readonly evaluations: ProviderEvaluationInput<
    FakeIntent,
    FakeRawInput
  >[] = [];

  public constructor(private readonly externalCall: () => void) {}

  public supports(query: ProviderSupportQuery<FakeIntent>): boolean {
    return (
      query.intent?.kind === "swap" &&
      query.chainId === 901 &&
      query.protocol === "test-protocol" &&
      query.capability === "simulate"
    );
  }

  public async evaluate(
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

describe("ProviderAdapter provisional port", () => {
  it("injects a fake and returns a provisional candidate boundary", async () => {
    const externalCall = vi.fn();
    const provider = new FakeProvider(externalCall);
    const rawInput: FakeRawInput = { providerOnlyTransaction: "opaque-input" };

    expect(
      provider.supports({
        intent,
        chainId: intent.chainId,
        protocol: intent.protocol,
        capability: "simulate",
      }),
    ).toBe(true);
    expect(provider.evaluations).toHaveLength(0);

    const result = await provider.evaluate({
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
      provider.supports({
        intent,
        chainId: 901,
        protocol: "test-protocol",
        capability: "simulate",
      }),
    ).toBe(true);
    expect(
      provider.supports({
        intent,
        chainId: 901,
        protocol: "test-protocol",
        capability: "quote",
      }),
    ).toBe(false);
    expect(
      provider.supports({
        intent,
        chainId: 1,
        protocol: "test-protocol",
        capability: "simulate",
      }),
    ).toBe(false);
    expect(
      provider.supports({
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
    expect(provider.capabilities).toEqual(["evaluate", "simulate"]);
    expect(provider.capabilities).not.toContain("quote");
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
