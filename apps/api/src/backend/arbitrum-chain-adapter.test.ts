import { describe, expect, it, vi } from "vitest";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  ArbitrumChainAdapter,
  type ArbitrumRpcClient,
  createArbitrumChainAdapter,
  createArbitrumRpcClient,
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

  it("reports pending and unknown finality conservatively", async () => {
    const pending = createArbitrumChainAdapter({
      client: clientFor({
        eth_getBlockByNumber: { number: "0x29", hash: "0xolder" },
      }),
    });
    await expect(pending.getFinality({ blockNumber: "42" })).resolves.toEqual({
      status: "pending",
      blockContext: { blockNumber: "41", blockHash: "0xolder" },
    });

    const unknown = createArbitrumChainAdapter({
      client: clientFor({ eth_getBlockByNumber: null }),
    });
    await expect(unknown.getFinality({ blockNumber: "42" })).resolves.toEqual({
      status: "unknown",
    });
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

  it("normalizes malformed transactions and RPC blocks as typed boundary errors", async () => {
    const adapter = createArbitrumChainAdapter({
      client: clientFor({
        eth_getBlockByNumber: { number: "not-a-quantity" },
      }),
    });

    await expect(
      adapter.estimateGas(null as never),
    ).rejects.toSatisfy((error: unknown) => {
      return isChainAdapterError(error) && error.code === "INVALID_REQUEST";
    });
    await expect(adapter.getBlockContext()).rejects.toSatisfy(
      (error: unknown) =>
        isChainAdapterError(error) &&
        error.operation === "getBlockContext" &&
        error.code === "UNKNOWN",
    );
  });

  it("rejects an invalid caller block context through the chain error boundary", async () => {
    const adapter = createArbitrumChainAdapter({
      client: clientFor({
        eth_getBlockByNumber: { number: "0x2b" },
      }),
    });

    await expect(
      adapter.getFinality({ blockNumber: "not-a-decimal" }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        isChainAdapterError(error) &&
        error.operation === "getFinality" &&
        error.code === "INVALID_REQUEST"
      );
    });
  });

  it("maps timeout and cancellation without leaking the pending RPC", async () => {
    const pendingClient: ArbitrumRpcClient = {
      request: vi.fn(() => new Promise<never>(() => undefined)),
    };
    const adapter = createArbitrumChainAdapter({ client: pendingClient });

    await expect(
      adapter.getBlockContext({ timeoutMs: 5 }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        isChainAdapterError(error) &&
        error.operation === "getBlockContext" &&
        error.code === "TIMEOUT" &&
        error.retryable
      );
    });

    const controller = new AbortController();
    const cancelled = adapter.getBlockContext({ signal: controller.signal });
    controller.abort("test cancellation");
    await expect(cancelled).rejects.toSatisfy((error: unknown) => {
      return (
        isChainAdapterError(error) &&
        error.operation === "getBlockContext" &&
        error.code === "CANCELLED" &&
        !error.retryable
      );
    });
  });

  it("maps injected RPC failures to typed unavailable errors", async () => {
    const adapter = createArbitrumChainAdapter({
      client: clientFor({
        eth_chainId: new TypeError("fetch failed"),
      }),
    });

    await expect(adapter.connect()).rejects.toSatisfy((error: unknown) => {
      return (
        isChainAdapterError(error) &&
        error.operation === "connect" &&
        error.code === "UNAVAILABLE" &&
        error.retryable
      );
    });
  });

  it("uses the explicit HTTP JSON-RPC seam and normalizes RPC errors", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x66eee" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            error: { code: -32602, message: "invalid params" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const client = createArbitrumRpcClient(
      "https://arbitrum.example.test",
      fetchImplementation,
    );
    const adapter = createArbitrumChainAdapter({ client });

    await expect(adapter.connect()).resolves.toBeUndefined();
    await expect(adapter.getBlockContext()).rejects.toSatisfy(
      (error: unknown) =>
        isChainAdapterError(error) &&
        error.operation === "getBlockContext" &&
        error.code === "INVALID_REQUEST",
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "https://arbitrum.example.test",
    );
    expect(JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    });
  });

  it("requires an injected client or an explicit HTTP endpoint", () => {
    expect(() => new ArbitrumChainAdapter({})).toThrow(
      "Arbitrum RPC client or rpcUrl is required",
    );
    expect(() => createArbitrumRpcClient(" ")).toThrow("rpcUrl is required");
  });
});
