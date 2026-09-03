import { describe, expect, it } from "vitest";
import {
  isProviderAdapterError,
  type ProviderAdapter,
  ProviderAdapterError,
  type ProviderEvaluationInput,
  type ProviderSupportQuery,
} from "./provider-adapter.js";

type FakeIntent = {
  readonly kind: "swap";
  readonly chainId: number;
  readonly protocol: string;
};

type FakeRawInput = {
  readonly providerOnlyTransaction: string;
};

type FakeRawOutput = {
  readonly providerOnlyEvidence: string;
};

const intent: FakeIntent = {
  kind: "swap",
  chainId: 901,
  protocol: "test-protocol",
};

class FakeProvider
  implements ProviderAdapter<FakeIntent, FakeRawInput, FakeRawOutput>
{
  public readonly providerId = "fake-provider";
  public readonly capabilities = ["evaluate", "simulate"] as const;
  public readonly supportQueries: ProviderSupportQuery<FakeIntent>[] = [];
  public readonly evaluations: ProviderEvaluationInput<
    FakeIntent,
    FakeRawInput
  >[] = [];

  public supports(query: ProviderSupportQuery<FakeIntent>): boolean {
    this.supportQueries.push(query);
    return (
      query.intent?.kind === "swap" &&
      query.chainId === 901 &&
      query.protocol === "test-protocol" &&
      query.capability === "simulate"
    );
  }

  public async evaluate(
    input: ProviderEvaluationInput<FakeIntent, FakeRawInput>,
  ) {
    this.evaluations.push(input);
    return {
      status: "success" as const,
      output: {
        providerOnlyEvidence: input.input.providerOnlyTransaction,
      },
      capabilities: this.capabilities,
    };
  }
}

describe("ProviderAdapter provisional port", () => {
  it("injects a fake, evaluates generic input, and preserves opaque payloads", async () => {
    const provider = new FakeProvider();
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

    await expect(
      provider.evaluate({
        runId: "run-1",
        intent,
        chainId: intent.chainId,
        protocol: intent.protocol,
        input: rawInput,
      }),
    ).resolves.toEqual({
      status: "success",
      output: { providerOnlyEvidence: "opaque-input" },
      capabilities: ["evaluate", "simulate"],
    });
    expect(provider.evaluations).toHaveLength(1);
    expect(provider.evaluations[0]?.input).toBe(rawInput);
    expect(provider.supportQueries).toHaveLength(1);
  });

  it("keeps capability representation extensible and does not require final Evidence fields", () => {
    const provider = new FakeProvider();
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
