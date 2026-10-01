import { describe, expect, it, vi } from "vitest";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  ArbitrumChainAdapter,
  type ArbitrumRpcClient,
  createArbitrumChainAdapter,
  createArbitrumRpcClient,
} from "./arbitrum-chain-adapter.js";
import {
  type ChainOperationOptions,
  isChainAdapterError,
} from "./chain-adapter.js";

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

    await expect(adapter.estimateGas(null as never)).rejects.toSatisfy(
      (error: unknown) => {
        return isChainAdapterError(error) && error.code === "INVALID_REQUEST";
      },
    );
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

  it("rejects null or undefined caller block context before making an RPC request", async () => {
    const client = clientFor({
      eth_getBlockByNumber: { number: "0x2b" },
    });
    const adapter = createArbitrumChainAdapter({ client });

    for (const missingContext of [null, undefined]) {
      await expect(
        adapter.getFinality(missingContext as never),
      ).rejects.toSatisfy(
        (error: unknown) =>
          isChainAdapterError(error) &&
          error.operation === "getFinality" &&
          error.code === "INVALID_REQUEST" &&
          error.message === "Arbitrum finality requires a block context object",
      );
    }
    expect(client.calls).toEqual([]);
  });

  it("aborts the underlying RPC before returning a typed timeout", async () => {
    let underlyingSignal: AbortSignal | undefined;
    let resolveRequestStarted!: () => void;
    let resolveAbortObserved!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      resolveRequestStarted = resolve;
    });
    const abortObserved = new Promise<void>((resolve) => {
      resolveAbortObserved = resolve;
    });
    const pendingClient: ArbitrumRpcClient = {
      request: vi.fn(
        (
          _method: string,
          _params: readonly unknown[] = [],
          options?: ChainOperationOptions,
        ) => {
          underlyingSignal = options?.signal;
          resolveRequestStarted();
          return new Promise<never>((_, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => {
                resolveAbortObserved();
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          });
        },
      ),
    };
    const adapter = createArbitrumChainAdapter({ client: pendingClient });

    const timedOut = adapter.getBlockContext({ timeoutMs: 5 });
    await requestStarted;
    await expect(timedOut).rejects.toSatisfy((error: unknown) => {
      return (
        isChainAdapterError(error) &&
        error.operation === "getBlockContext" &&
        error.code === "TIMEOUT" &&
        error.retryable
      );
    });
    await expect(abortObserved).resolves.toBeUndefined();
    expect(underlyingSignal).toBeDefined();
    expect(underlyingSignal?.aborted).toBe(true);
  });

  it("aborts the underlying RPC on caller cancellation and preserves CANCELLED", async () => {
    let underlyingSignal: AbortSignal | undefined;
    let resolveRequestStarted!: () => void;
    let resolveAbortObserved!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      resolveRequestStarted = resolve;
    });
    const abortObserved = new Promise<void>((resolve) => {
      resolveAbortObserved = resolve;
    });
    const pendingClient: ArbitrumRpcClient = {
      request: vi.fn(
        (
          _method: string,
          _params: readonly unknown[] = [],
          options?: ChainOperationOptions,
        ) => {
          underlyingSignal = options?.signal;
          resolveRequestStarted();
          return new Promise<never>((_, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => {
                resolveAbortObserved();
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          });
        },
      ),
    };
    const adapter = createArbitrumChainAdapter({ client: pendingClient });
    const controller = new AbortController();
    const cancelled = adapter.getBlockContext({ signal: controller.signal });
    await requestStarted;
    controller.abort("test cancellation");
    await expect(cancelled).rejects.toSatisfy((error: unknown) => {
      return (
        isChainAdapterError(error) &&
        error.operation === "getBlockContext" &&
        error.code === "CANCELLED" &&
        !error.retryable
      );
    });
    await expect(abortObserved).resolves.toBeUndefined();
    expect(underlyingSignal).toBeDefined();
    expect(underlyingSignal).not.toBe(controller.signal);
    expect(underlyingSignal?.aborted).toBe(true);
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

  it("classifies estimateGas balance failures as insufficient native balance", async () => {
    const adapter = createArbitrumChainAdapter({
      client: clientFor({
        eth_estimateGas: new Error(
          "failed with 50003829 gas: insufficient funds for gas * price + value: address 0x1111111111111111111111111111111111111111 have 50883771891842106 want 100000000000000000000",
        ),
      }),
    });

    await expect(
      adapter.estimateGas({
        to: "0xrouter",
        data: "0x",
        value: "0x56bc75e2d63100000",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        isChainAdapterError(error) &&
        error.operation === "estimateGas" &&
        error.code === "INSUFFICIENT_NATIVE_BALANCE" &&
        !error.retryable
      );
    });
  });

  it("does not classify unrelated estimateGas failures as balance failures", async () => {
    const adapter = createArbitrumChainAdapter({
      client: clientFor({
        eth_estimateGas: new Error("execution reverted: pool is paused"),
      }),
    });

    await expect(
      adapter.estimateGas({ to: "0xrouter", data: "0x", value: "0x0" }),
    ).rejects.toSatisfy((error: unknown) => {
      return isChainAdapterError(error) && error.code === "UNKNOWN";
    });
  });

  it("classifies an explicit JSON-RPC execution revert separately", async () => {
    const adapter = createArbitrumChainAdapter({
      client: clientFor({
        eth_estimateGas: Object.assign(
          new Error("execution reverted: pool is paused"),
          { rpcCode: 3 },
        ),
      }),
    });

    await expect(
      adapter.estimateGas({ to: "0xrouter", data: "0x", value: "0x0" }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        isChainAdapterError(error) &&
        error.operation === "estimateGas" &&
        error.code === "EXECUTION_REVERT" &&
        error.message ===
          "Arbitrum gas preflight observed an EVM execution revert" &&
        !error.retryable
      );
    });
  });

  it.each([
    "execution reverted: network failure while executing the request",
    "execution reverted: fetch failed in the upstream error details",
  ])(
    "prioritizes JSON-RPC execution reverts over generic network text: %s",
    async (message) => {
      const adapter = createArbitrumChainAdapter({
        client: clientFor({
          eth_estimateGas: Object.assign(new Error(message), { rpcCode: 3 }),
        }),
      });

      await expect(
        adapter.estimateGas({ to: "0xrouter", data: "0x", value: "0x0" }),
      ).rejects.toSatisfy((error: unknown) => {
        return (
          isChainAdapterError(error) &&
          error.operation === "estimateGas" &&
          error.code === "EXECUTION_REVERT" &&
          !error.retryable
        );
      });
    },
  );

  it("does not classify JSON-RPC code 3 as a revert without revert semantics", async () => {
    const adapter = createArbitrumChainAdapter({
      client: clientFor({
        eth_estimateGas: Object.assign(
          new Error("upstream execution failure"),
          {
            rpcCode: 3,
          },
        ),
      }),
    });

    await expect(
      adapter.estimateGas({ to: "0xrouter", data: "0x", value: "0x0" }),
    ).rejects.toSatisfy((error: unknown) => {
      return isChainAdapterError(error) && error.code === "UNKNOWN";
    });
  });

  it("uses the explicit HTTP JSON-RPC seam and normalizes RPC errors", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x66eee" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
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
    expect(
      JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)),
    ).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    });
  });

  it.each([
    { status: 400, code: "INVALID_REQUEST", retryable: false },
    { status: 422, code: "INVALID_REQUEST", retryable: false },
    { status: 408, code: "TIMEOUT", retryable: true },
    { status: 429, code: "UNAVAILABLE", retryable: true },
    { status: 503, code: "UNAVAILABLE", retryable: true },
    { status: 403, code: "UNKNOWN", retryable: false },
  ] as const)(
    "classifies HTTP $status as $code without treating client errors as unavailable",
    async ({ status, code, retryable }) => {
      const client = createArbitrumRpcClient(
        "https://arbitrum.example.test",
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("rpc error", { status })),
      );
      const adapter = createArbitrumChainAdapter({ client });

      await expect(adapter.connect()).rejects.toSatisfy((error: unknown) => {
        return (
          isChainAdapterError(error) &&
          error.operation === "connect" &&
          error.code === code &&
          error.retryable === retryable
        );
      });
    },
  );

  it("requires an injected client or an explicit HTTP endpoint", () => {
    expect(() => new ArbitrumChainAdapter({})).toThrow(
      "Arbitrum RPC client or rpcUrl is required",
    );
    expect(() => createArbitrumRpcClient(" ")).toThrow("rpcUrl is required");
  });
});
