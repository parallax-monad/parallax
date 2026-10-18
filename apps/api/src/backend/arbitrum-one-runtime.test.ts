import { describe, expect, it, vi } from "vitest";
import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_ONE_RUNTIME_PROFILE,
  bootstrapBackendRuntime,
} from "../runtime-config.js";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import {
  type ArbitrumOneReadOnlyRpcMethod,
  createArbitrumOneQuoteRuntime,
} from "./arbitrum-one-runtime.js";

const baseEnvironment = {
  MONAD_RPC_URL: "https://monad.example.test",
  MOSS_RUNTIME_VERSION: "fixture-runtime",
  MOSS_RUNTIME_REVISION: "fixture-revision",
};

function runtimeFor(environment: Record<string, string> = {}) {
  return bootstrapBackendRuntime({
    environment: { ...baseEnvironment, ...environment },
    tokenRegistry: {
      chains: [{ chainId: ARBITRUM_ONE_CHAIN_ID, symbol: "ETH", decimals: 18 }],
      tokens: [],
    },
  });
}

describe("Arbitrum One quote runtime", () => {
  it("validates chain ID and exposes only the quote-path read RPC surface", async () => {
    const calls: string[] = [];
    const timeouts: (number | undefined)[] = [];
    const rpcClient: ArbitrumRpcClient = {
      async request(method, _params, options) {
        calls.push(method);
        timeouts.push(options?.timeoutMs);
        return method === "eth_chainId" ? "0xa4b1" : "0x1234";
      },
    };

    const runtime = await createArbitrumOneQuoteRuntime(
      runtimeFor({ ARBITRUM_ONE_RPC_URL: "https://one.example.test" }),
      { rpcClient },
    );

    expect(runtime.profile).toEqual(ARBITRUM_ONE_RUNTIME_PROFILE);
    expect(runtime.profile.capabilities).toEqual({
      quote: true,
      check: false,
      simulation: false,
    });
    await expect(
      runtime.rpcClient.request("eth_getCode", [
        ARBITRUM_ONE_RUNTIME_PROFILE.deployments.quoterAddress,
        "latest",
      ]),
    ).resolves.toBe("0x1234");
    await expect(
      runtime.rpcClient.request(
        "eth_estimateGas" as ArbitrumOneReadOnlyRpcMethod,
        [],
      ),
    ).rejects.toThrow("read-only RPC methods only");
    await expect(
      runtime.rpcClient.request(
        "eth_sendRawTransaction" as ArbitrumOneReadOnlyRpcMethod,
        [],
      ),
    ).rejects.toThrow("read-only RPC methods only");
    expect(calls).toEqual(["eth_chainId", "eth_getCode"]);
    expect(timeouts).toEqual([30_000, 30_000]);
  });

  it("creates the RPC client from the Arbitrum One endpoint, not the Sepolia URL", async () => {
    const urls: string[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      urls.push(String(input));
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
      };
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: request.method === "eth_chainId" ? "0xa4b1" : "0x1234",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const runtime = await createArbitrumOneQuoteRuntime(
      runtimeFor({
        ARBITRUM_RPC_URL: "https://sepolia.example.test",
        ARBITRUM_ONE_RPC_URL: "https://one.example.test",
      }),
      { fetchImplementation },
    );

    await expect(runtime.rpcClient.request("eth_call", [])).resolves.toBe(
      "0x1234",
    );
    expect(urls).toEqual([
      "https://one.example.test",
      "https://one.example.test",
    ]);
  });

  it("fails closed when the One endpoint reports the Sepolia chain ID", async () => {
    const calls: string[] = [];
    const rpcClient: ArbitrumRpcClient = {
      async request(method) {
        calls.push(method);
        return "0x66eee";
      },
    };
    const runtime = runtimeFor({
      ARBITRUM_RPC_URL: "https://sepolia.example.test",
      ARBITRUM_ONE_RPC_URL: "https://one.example.test",
    });

    await expect(
      createArbitrumOneQuoteRuntime(runtime, { rpcClient }),
    ).rejects.toThrow(
      "Arbitrum One RPC chain mismatch: expected 42161, received 421614",
    );
    expect(calls).toEqual(["eth_chainId"]);
    expect(runtime.config.arbitrum?.rpcUrl).toBe(
      "https://sepolia.example.test",
    );
    expect(runtime.config.arbitrumOne?.rpcUrl).toBe("https://one.example.test");
  });

  it.each([undefined, "42161", "0x", "0x0104a1"])(
    "rejects an invalid chain ID response (%s)",
    async (chainId) => {
      const rpcClient: ArbitrumRpcClient = {
        async request() {
          return chainId;
        },
      };

      await expect(
        createArbitrumOneQuoteRuntime(
          runtimeFor({ ARBITRUM_ONE_RPC_URL: "https://one.example.test" }),
          { rpcClient },
        ),
      ).rejects.toThrow("Arbitrum One RPC returned an invalid chain ID");
    },
  );

  it("does not fall back to the Sepolia endpoint when the One endpoint is absent", async () => {
    let requestCount = 0;
    const rpcClient: ArbitrumRpcClient = {
      async request() {
        requestCount += 1;
        return "0xa4b1";
      },
    };
    const runtime = runtimeFor({
      ARBITRUM_RPC_URL: "https://sepolia.example.test",
    });

    await expect(
      createArbitrumOneQuoteRuntime(runtime, { rpcClient }),
    ).rejects.toThrow("ARBITRUM_ONE_RPC_URL is required");
    expect(requestCount).toBe(0);
    expect(runtime.config.arbitrumOne?.rpcUrl).toBeUndefined();
  });

  it("sanitizes failures while validating the configured endpoint", async () => {
    const rpcClient: ArbitrumRpcClient = {
      async request() {
        throw new Error("request failed for https://secret.example.test/token");
      },
    };

    await expect(
      createArbitrumOneQuoteRuntime(
        runtimeFor({ ARBITRUM_ONE_RPC_URL: "https://one.example.test" }),
        { rpcClient },
      ),
    ).rejects.toThrow("Arbitrum One RPC chain ID validation failed");
  });

  it("sanitizes failures from subsequent quote-path reads", async () => {
    const rpcClient: ArbitrumRpcClient = {
      async request(method) {
        if (method === "eth_chainId") return "0xa4b1";
        throw new Error("upstream returned credential-marker");
      },
    };
    const runtime = await createArbitrumOneQuoteRuntime(
      runtimeFor({ ARBITRUM_ONE_RPC_URL: "https://one.example.test" }),
      { rpcClient },
    );

    await expect(runtime.rpcClient.request("eth_call", [])).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Arbitrum One RPC eth_call request failed" &&
        !error.message.includes("credential-marker"),
    );
  });
});
