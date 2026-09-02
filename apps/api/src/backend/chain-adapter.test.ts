import { describe, expect, it } from "vitest";
import {
  type BlockContext,
  type ChainAdapter,
  ChainAdapterError,
  type ChainOperationOptions,
  type FinalityStatus,
  type GasEstimate,
  isChainAdapterError,
} from "./chain-adapter.js";

type FakeTransaction = {
  opaquePayload: string;
};

type FakeCall = {
  operation: string;
  options?: ChainOperationOptions;
};

class FakeChainAdapter implements ChainAdapter<FakeTransaction> {
  public readonly chainId = 901;
  public readonly calls: FakeCall[] = [];

  public async connect(options?: ChainOperationOptions): Promise<void> {
    this.calls.push({ operation: "connect", options });
  }

  public async getBlockContext(
    options?: ChainOperationOptions,
  ): Promise<BlockContext> {
    this.calls.push({ operation: "getBlockContext", options });
    return {
      blockNumber: "42",
      observedAt: "2026-09-01T00:00:00.000Z",
    };
  }

  public async estimateGas(
    _transaction: FakeTransaction,
    options?: ChainOperationOptions,
  ): Promise<GasEstimate> {
    this.calls.push({ operation: "estimateGas", options });
    return { gasUnits: "21000" };
  }

  public async getFinality(
    _block: BlockContext,
    options?: ChainOperationOptions,
  ): Promise<FinalityStatus> {
    this.calls.push({ operation: "getFinality", options });
    return { status: "finalized" };
  }
}

async function inspectChain(
  adapter: ChainAdapter<FakeTransaction>,
  options: ChainOperationOptions,
) {
  await adapter.connect(options);
  const block = await adapter.getBlockContext(options);
  const gas = await adapter.estimateGas(
    { opaquePayload: "fake-transaction" },
    options,
  );
  const finality = await adapter.getFinality(block, options);
  return { block, gas, finality };
}

describe("ChainAdapter port", () => {
  it("accepts an injected fake for the generic chain lifecycle", async () => {
    const adapter = new FakeChainAdapter();
    const signal = AbortSignal.abort("caller-cancelled");

    await expect(
      inspectChain(adapter, { signal, timeoutMs: 2_000 }),
    ).resolves.toEqual({
      block: {
        blockNumber: "42",
        observedAt: "2026-09-01T00:00:00.000Z",
      },
      gas: { gasUnits: "21000" },
      finality: { status: "finalized" },
    });

    expect(adapter.chainId).toBe(901);
    expect(adapter.calls).toHaveLength(4);
    expect(adapter.calls.every((call) => call.options?.signal === signal)).toBe(
      true,
    );
    expect(
      adapter.calls.every((call) => call.options?.timeoutMs === 2_000),
    ).toBe(true);
  });

  it("preserves a typed chain-level timeout error from an adapter", async () => {
    const error = new ChainAdapterError({
      chainId: 901,
      code: "TIMEOUT",
      operation: "estimateGas",
      message: "Gas estimation timed out",
      retryable: true,
    });

    const adapter: ChainAdapter<FakeTransaction> = {
      chainId: 901,
      async connect() {},
      async getBlockContext() {
        return { blockNumber: "42" };
      },
      async estimateGas() {
        throw error;
      },
      async getFinality() {
        return { status: "unknown" };
      },
    };

    await expect(
      adapter.estimateGas({ opaquePayload: "fake-transaction" }),
    ).rejects.toSatisfy((received: unknown) => {
      return (
        isChainAdapterError(received) &&
        received.chainId === 901 &&
        received.code === "TIMEOUT" &&
        received.operation === "estimateGas" &&
        received.retryable === true
      );
    });
  });

  it("rejects incomplete structural chain adapter errors", () => {
    const baseCandidate = {
      name: "ChainAdapterError",
      chainId: 1,
      operation: "connect",
      code: "TIMEOUT",
    };

    expect(isChainAdapterError(baseCandidate)).toBe(false);
    expect(
      isChainAdapterError({
        ...baseCandidate,
        message: "Connection timed out",
        retryable: "true",
      }),
    ).toBe(false);
    expect(
      isChainAdapterError({
        ...baseCandidate,
        message: "Connection timed out",
        retryable: true,
      }),
    ).toBe(true);
  });
});
