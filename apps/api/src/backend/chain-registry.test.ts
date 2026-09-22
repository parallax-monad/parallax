import { describe, expect, it } from "vitest";
import {
  type BlockContext,
  type ChainAdapter,
  type ChainOperationOptions,
  ChainRegistry,
  ChainRegistryError,
  type FinalityStatus,
  type GasEstimate,
  isChainRegistryError,
} from "./chain-registry.js";
import { isBackendControlError } from "./control-boundary.js";

type FakeTransaction = { readonly payload: string };

function fakeChainAdapter(chainId: number): ChainAdapter<FakeTransaction> {
  return {
    chainId,
    async connect(_options?: ChainOperationOptions): Promise<void> {},
    async getBlockContext(
      _options?: ChainOperationOptions,
    ): Promise<BlockContext> {
      return { blockNumber: "42" };
    },
    async estimateGas(
      _transaction: FakeTransaction,
      _options?: ChainOperationOptions,
    ): Promise<GasEstimate> {
      return { gasUnits: "21000" };
    },
    async getFinality(
      _blockContext: BlockContext,
      _options?: ChainOperationOptions,
    ): Promise<FinalityStatus> {
      return { status: "finalized" };
    },
  };
}

describe("ChainRegistry", () => {
  it("registers and resolves an injected fake adapter by chainId", () => {
    const adapter = fakeChainAdapter(901);
    const registry = new ChainRegistry([adapter]);

    expect(registry.has(901)).toBe(true);
    expect(registry.resolve(901)).toBe(adapter);
  });

  it("fails explicitly with a shared unsupported control error for an unknown chain", () => {
    const error = (() => {
      try {
        new ChainRegistry([fakeChainAdapter(901)]).resolve(902);
      } catch (received) {
        return received;
      }
      throw new Error("expected unknown chain resolution to fail");
    })();

    expect(error).toBeInstanceOf(ChainRegistryError);
    expect(isChainRegistryError(error)).toBe(true);
    expect(isBackendControlError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "UNSUPPORTED_CHAIN",
      chainId: 902,
      status: "unsupported",
      retryable: false,
    });
  });

  it("rejects duplicate chain registration instead of replacing the adapter", () => {
    const first = fakeChainAdapter(901);
    const second = fakeChainAdapter(901);
    const registry = new ChainRegistry([first]);

    expect(() => registry.register(second)).toThrowError(
      "chain 901 is already registered",
    );
    expect(registry.resolve(901)).toBe(first);
  });

  it("rejects malformed structural registry errors across a runtime boundary", () => {
    expect(
      isChainRegistryError({
        name: "ChainRegistryError",
        code: "UNSUPPORTED_CHAIN",
        message: "chain is not registered",
        chainId: 901,
        retryable: false,
        status: "failed",
      }),
    ).toBe(false);
  });
});
