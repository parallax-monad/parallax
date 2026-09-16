import { describe, expect, it } from "vitest";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  ArbitrumChainAdapter,
  type ArbitrumRpcClient,
  createArbitrumChainAdapter,
} from "./arbitrum-chain-adapter.js";
import { isChainAdapterError } from "./chain-adapter.js";

type RpcCall = { method: string; params: readonly unknown[] };

function clientFor(responses: Record<string, unknown>): ArbitrumRpcClient & {
  calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  return {
    calls,
    async request(method, params = []) {
      calls.push({ method, params });
      const response = responses[method];
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

describe("ArbitrumChainAdapter", () => {
  it("normalizes the Arbitrum Sepolia chain and block quantities", async () => {
    const client = clientFor({
      eth_chainId: "0x66eee",
      eth_getBlockByNumber: {
        number: "0x2a",
        hash: "0xblock",
        timestamp: "0x65000000",
      },
      eth_estimateGas: "0x5208",
    });
    const adapter = new ArbitrumChainAdapter({ client });

    await expect(adapter.connect()).resolves.toBeUndefined();
    await expect(adapter.getBlockContext()).resolves.toEqual({
      blockNumber: "42",
      blockHash: "0xblock",
      observedAt: expect.any(String),
    });
    await expect(
      adapter.estimateGas({ to: "0xrouter", data: "0x", value: "0x0" }),
    ).resolves.toEqual({ gasUnits: "21000" });

    expect(adapter.chainId).toBe(ARBITRUM_SEPOLIA_CHAIN_ID);
    expect(client.calls).toEqual([
      { method: "eth_chainId", params: [] },
      { method: "eth_getBlockByNumber", params: ["latest", false] },
      {
        method: "eth_estimateGas",
        params: [{ to: "0xrouter", data: "0x", value: "0x0" }],
      },
    ]);
  });

  it("returns finality from the finalized block without claiming receipt semantics", async () => {
    const client = clientFor({
      eth_getBlockByNumber: {
        number: "0x2b",
        hash: "0xfinalized",
      },
    });
    const adapter = createArbitrumChainAdapter({ client });

    await expect(
      adapter.getFinality({ blockNumber: "42", blockHash: "0xblock" }),
    ).resolves.toEqual({
      status: "finalized",
      blockContext: { blockNumber: "43", blockHash: "0xfinalized" },
    });
    expect(client.calls).toEqual([
      { method: "eth_getBlockByNumber", params: ["finalized", false] },
    ]);
  });

  it("fails closed when the configured endpoint reports another chain", async () => {
    const adapter = new ArbitrumChainAdapter({
      client: clientFor({ eth_chainId: "0x1" }),
    });

    await expect(adapter.connect()).rejects.toSatisfy((error: unknown) => {
      return (
        isChainAdapterError(error) &&
        error.code === "INVALID_REQUEST" &&
        error.chainId === ARBITRUM_SEPOLIA_CHAIN_ID
      );
    });
  });

  it("requires an injected client or an explicit HTTP endpoint", () => {
    expect(() => new ArbitrumChainAdapter({})).toThrow(
      "Arbitrum RPC client or rpcUrl is required",
    );
  });
});
