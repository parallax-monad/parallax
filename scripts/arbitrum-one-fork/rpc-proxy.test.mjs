import { afterEach, describe, expect, it, vi } from "vitest";
import { createReadOnlyProxy, isReadOnlyUpstreamMethod } from "./rpc-proxy.mjs";

const blockNumber = "515881859";
const blockHash = `0x${"ab".repeat(32)}`;

async function withProxy(fetchImplementation, action) {
  const server = createReadOnlyProxy({
    upstreamUrl:
      "https://rpc.example.invalid/private-path?key=not-a-real-secret",
    sourceChainId: 42161,
    sourceBlockNumber: blockNumber,
    sourceBlockHash: blockHash,
    fetchImplementation,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    return await action(origin);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("Arbitrum One fork upstream read-only proxy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("allows the read-only quote/fork methods but not transaction or admin writes", () => {
    expect(isReadOnlyUpstreamMethod("eth_call")).toBe(true);
    expect(isReadOnlyUpstreamMethod("eth_getCode")).toBe(true);
    expect(isReadOnlyUpstreamMethod("eth_sendRawTransaction")).toBe(false);
    expect(isReadOnlyUpstreamMethod("eth_sendTransaction")).toBe(false);
    expect(isReadOnlyUpstreamMethod("anvil_setBalance")).toBe(false);
  });

  it("validates chain and pinned block through a secret-free health response", async () => {
    const fetchImplementation = vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body);
      const result =
        request.method === "eth_chainId"
          ? "0xa4b1"
          : {
              number: `0x${BigInt(blockNumber).toString(16)}`,
              hash: blockHash,
            };
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    await withProxy(fetchImplementation, async (origin) => {
      const response = await fetch(`${origin}/healthz`);
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({
        ok: true,
        sourceChainId: 42161,
        sourceBlockNumber: blockNumber,
        sourceBlockHash: blockHash,
      });
      expect(JSON.stringify(body)).not.toContain("private-path");
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    });
  });

  it("rejects upstream writes without forwarding them", async () => {
    const fetchImplementation = vi.fn();
    await withProxy(fetchImplementation, async (origin) => {
      const response = await fetch(origin, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "eth_sendRawTransaction",
          params: ["0xdeadbeef"],
        }),
      });
      const body = await response.json();
      expect(body.error.message).toBe("Read-only RPC method required");
      expect(fetchImplementation).not.toHaveBeenCalled();
    });
  });

  it("sanitizes upstream provider error messages that contain endpoint material", async () => {
    const fetchImplementation = vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32000,
            message: "credential-marker-in-provider-error",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    await withProxy(fetchImplementation, async (origin) => {
      const response = await fetch(origin, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 8,
          method: "eth_blockNumber",
          params: [],
        }),
      });
      const body = await response.json();
      expect(body.error.message).toBe("Upstream read-only RPC request failed");
      expect(JSON.stringify(body)).not.toContain("credential-marker");
    });
  });

  it("does not accept non-HTTPS upstream endpoints", () => {
    expect(() =>
      createReadOnlyProxy({
        upstreamUrl: "http://rpc.example.invalid",
        sourceChainId: 42161,
        sourceBlockNumber: blockNumber,
        sourceBlockHash: blockHash,
      }),
    ).toThrow("INVALID_RPC_ENDPOINT");
  });
});
