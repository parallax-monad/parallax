import { describe, expect, it, vi } from "vitest";
import { isChainAdapterError } from "./chain-adapter.js";
import {
  createFakeChainAdapter,
  createFakeProtocolAdapter,
  createFakeProviderAdapter,
  createFakeProviderAdapterHarness,
  fakeBackendFixture,
} from "./fake-harness.js";
import {
  evaluateProviderAdapter,
  isFactoryCreatedProviderAdapter,
} from "./provider-adapter.js";

describe("fake Backend adapter harness", () => {
  it("provides deterministic Chain lifecycle values and forwards operation options", async () => {
    const fixture = fakeBackendFixture();
    const adapter = createFakeChainAdapter(fixture.chain);
    const signal = new AbortController().signal;
    const options = { signal, timeoutMs: 100 };
    const transaction = { payload: "opaque" };

    await adapter.connect(options);
    const block = await adapter.getBlockContext(options);
    const gas = await adapter.estimateGas(transaction, options);
    const finality = await adapter.getFinality(block, options);

    expect(block).toEqual({
      blockNumber: "42",
      observedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(gas).toEqual({ gasUnits: "21000" });
    expect(finality).toEqual({ status: "finalized" });
    expect(adapter.calls).toHaveLength(4);
    expect(adapter.calls.every((call) => call.options === options)).toBe(true);
  });

  it("rejects a pre-aborted signal for every Chain operation", async () => {
    const fixture = fakeBackendFixture();
    const adapter = createFakeChainAdapter(fixture.chain);
    const signal = AbortSignal.abort("fixture-cancelled");
    const options = { signal };
    const blockContext = {
      blockNumber: fixture.chain.blockNumber,
    };
    const operations = [
      { operation: "connect", invoke: () => adapter.connect(options) },
      {
        operation: "getBlockContext",
        invoke: () => adapter.getBlockContext(options),
      },
      {
        operation: "estimateGas",
        invoke: () => adapter.estimateGas({ payload: "opaque" }, options),
      },
      {
        operation: "getFinality",
        invoke: () => adapter.getFinality(blockContext, options),
      },
    ] as const;

    for (const { operation, invoke } of operations) {
      await expect(invoke()).rejects.toSatisfy((received: unknown) => {
        return (
          isChainAdapterError(received) &&
          received.chainId === fixture.chain.chainId &&
          received.operation === operation &&
          received.code === "CANCELLED" &&
          received.retryable === false &&
          received.cause === signal.reason
        );
      });
    }

    expect(adapter.calls).toHaveLength(0);
  });

  it("keeps Protocol payloads opaque and marks built transactions unsigned", async () => {
    const fixture = fakeBackendFixture();
    const adapter = createFakeProtocolAdapter(fixture.protocol);
    const intent = { privateProtocolInput: "fixture" };

    await expect(adapter.quote(intent)).resolves.toEqual({ amountOut: "42" });
    await expect(adapter.buildTransaction(intent)).resolves.toEqual({
      kind: "unsigned",
      payload: { data: "0xfixture" },
    });
    expect(adapter.calls).toEqual([
      { operation: "quote", intent },
      { operation: "buildTransaction", intent },
    ]);
  });

  it("creates Provider fakes through the factory and exposes only provisional output", async () => {
    const fixture = fakeBackendFixture();
    const { adapter, evaluations } = createFakeProviderAdapterHarness(
      fixture.provider,
    );

    expect(isFactoryCreatedProviderAdapter(adapter)).toBe(true);
    expect(Object.keys(adapter)).toEqual([
      "providerId",
      "capabilities",
      "supports",
    ]);
    expect("evaluateRaw" in adapter).toBe(false);
    expect(
      adapter.supports({
        intent: fixture.provider.intent,
        chainId: fixture.provider.chainId,
        protocol: fixture.provider.protocol,
        capability: "simulate",
      }),
    ).toBe(true);

    const result = await evaluateProviderAdapter(adapter, {
      runId: "fixture-run",
      intent: fixture.provider.intent,
      chainId: fixture.provider.chainId,
      protocol: fixture.provider.protocol,
      input: { raw: "never exposed" },
    });

    expect(result).toMatchObject({
      provider: { providerId: "fixture-provider" },
      status: "success",
      responseEvidence: {
        kind: "reference",
        reference: "fixture://fixture-provider/fixture-run",
      },
      capabilities: ["simulate"],
    });
    expect(result).not.toHaveProperty("output");
    expect(evaluations).toHaveLength(1);
  });

  it("supports injected Provider behavior without invoking it during supports", () => {
    const supports = vi.fn(() => true);
    const fixture = fakeBackendFixture();
    const adapter = createFakeProviderAdapter({
      ...fixture.provider,
      supports,
    });

    expect(
      adapter.supports({
        intent: fixture.provider.intent,
        chainId: fixture.provider.chainId,
        protocol: fixture.provider.protocol,
      }),
    ).toBe(true);
    expect(supports).toHaveBeenCalledTimes(1);
  });
});
