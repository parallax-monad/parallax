import { describe, expect, it, vi } from "vitest";
import {
  createNativeRpcClient,
  NativeRpcClientError,
} from "./native-rpc-client.js";

const rpcUrl = "https://user:secret@example.test/rpc?key=private";

function rpcResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

describe("Native RPC JSON-RPC transport", () => {
  it("sanitizes malformed endpoint errors", () => {
    expect(() =>
      createNativeRpcClient({ rpcUrl: "https://secret^invalid" }),
    ).toThrow("Native RPC URL is invalid");
  });
  it("uses JSON-RPC 2.0, unique IDs, and caller cancellation", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImplementation = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return rpcResponse({
          jsonrpc: "2.0",
          id: bodies.length,
          result: "0x2a",
        });
      },
    ) as typeof fetch;
    const client = createNativeRpcClient({ rpcUrl, fetchImplementation });
    expect(await client.request("eth_blockNumber", [])).toBe("0x2a");
    expect(await client.request("eth_chainId", [])).toBe("0x2a");
    expect(bodies).toEqual([
      { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_chainId", params: [] },
    ]);
  });

  it.each([
    ["HTTP_FAILURE", () => new Response("", { status: 503 })],
    ["JSON_PARSE_FAILURE", () => new Response("not json")],
    ["INVALID_ENVELOPE", () => rpcResponse({ id: 1, result: "0x" })],
    [
      "ID_MISMATCH",
      () => rpcResponse({ jsonrpc: "2.0", id: 99, result: "0x" }),
    ],
    ["MISSING_RESULT", () => rpcResponse({ jsonrpc: "2.0", id: 1 })],
    [
      "RPC_ERROR",
      () =>
        rpcResponse({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32601,
            message: `bad ${rpcUrl}`,
          },
        }),
    ],
  ] as const)(
    "classifies %s without leaking the endpoint",
    async (kind, response) => {
      const client = createNativeRpcClient({
        rpcUrl,
        fetchImplementation: vi.fn(async () => response()) as typeof fetch,
      });
      try {
        await client.request("eth_call", []);
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(NativeRpcClientError);
        expect((error as NativeRpcClientError).kind).toBe(kind);
        expect((error as Error).message).not.toContain("secret");
        expect((error as Error).message).not.toContain("private");
      }
    },
  );

  it("aborts an in-flight fetch when the Provider timeout expires", async () => {
    let signal: AbortSignal | undefined;
    const client = createNativeRpcClient({
      rpcUrl,
      fetchImplementation: vi.fn(async (_url, init) => {
        signal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }) as typeof fetch,
    });
    await expect(
      client.request("eth_call", [], { timeoutMs: 1 }),
    ).rejects.toMatchObject({
      kind: "TIMEOUT",
    });
    expect(signal?.aborted).toBe(true);
  });

  it("distinguishes caller cancellation", async () => {
    const controller = new AbortController();
    const client = createNativeRpcClient({
      rpcUrl,
      fetchImplementation: vi.fn(async (_url, init) => {
        const signal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }) as typeof fetch,
    });
    const request = client.request("eth_call", [], {
      signal: controller.signal,
    });
    controller.abort();
    await expect(request).rejects.toMatchObject({ kind: "ABORTED" });
  });
});
