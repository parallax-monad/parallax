import type { NativeRpcClient } from "./native-rpc-provider.js";

export type NativeRpcClientFailure =
  | "HTTP_FAILURE"
  | "NETWORK_FAILURE"
  | "JSON_PARSE_FAILURE"
  | "INVALID_ENVELOPE"
  | "ID_MISMATCH"
  | "RPC_ERROR"
  | "MISSING_RESULT"
  | "TIMEOUT"
  | "ABORTED";

/** Only controlled error text crosses the Provider boundary. */
export class NativeRpcClientError extends Error {
  public readonly name = "NativeRpcClientError";

  public constructor(
    public readonly kind: NativeRpcClientFailure,
    message: string,
    public readonly rpcCode?: number,
  ) {
    super(message);
  }
}

export type NativeRpcHttpClientOptions = {
  readonly rpcUrl: string;
  readonly fetchImplementation?: typeof fetch;
};

/** Explicit endpoint only. No public or credentialed endpoint is inferred. */
export function createNativeRpcClient(
  options: NativeRpcHttpClientOptions,
): NativeRpcClient {
  if (typeof options.rpcUrl !== "string" || options.rpcUrl.trim() === "") {
    throw new TypeError("Native RPC URL is required");
  }
  const parsed = new URL(options.rpcUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError("Native RPC URL must use HTTP or HTTPS");
  }
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("Native RPC fetch implementation is required");
  }

  let nextId = 0;
  return {
    async request(method, params = [], operation = {}): Promise<unknown> {
      const id = ++nextId;
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort();
      operation.signal?.addEventListener("abort", onAbort, { once: true });
      if (operation.signal?.aborted) controller.abort();
      const timer =
        operation.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, operation.timeoutMs);

      try {
        const response = await fetchImplementation(options.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new NativeRpcClientError(
            "HTTP_FAILURE",
            `Native RPC HTTP ${response.status}`,
          );
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new NativeRpcClientError(
            "JSON_PARSE_FAILURE",
            "Native RPC response is not valid JSON",
          );
        }
        if (
          !isRecord(payload) ||
          payload.jsonrpc !== "2.0" ||
          !Object.hasOwn(payload, "id") ||
          (Object.hasOwn(payload, "result") && Object.hasOwn(payload, "error"))
        ) {
          throw new NativeRpcClientError(
            "INVALID_ENVELOPE",
            "Native RPC response has an invalid JSON-RPC envelope",
          );
        }
        if (payload.id !== id) {
          throw new NativeRpcClientError(
            "ID_MISMATCH",
            "Native RPC response ID does not match request",
          );
        }
        if (Object.hasOwn(payload, "error")) {
          const rpcError = payload.error;
          if (
            !isRecord(rpcError) ||
            !Number.isInteger(rpcError.code) ||
            typeof rpcError.message !== "string"
          ) {
            throw new NativeRpcClientError(
              "INVALID_ENVELOPE",
              "Native RPC error envelope is malformed",
            );
          }
          // RPC messages can contain endpoint URLs or echoed request data.
          // Keep the code and a bounded semantic classification only.
          const semantic = /execution reverted|revert/i.test(rpcError.message)
            ? "execution reverted"
            : rpcError.code === -32601
              ? "method unsupported"
              : rpcError.code === -32602
                ? "invalid parameters"
                : "RPC error";
          throw new NativeRpcClientError(
            "RPC_ERROR",
            semantic,
            rpcError.code as number,
          );
        }
        if (!Object.hasOwn(payload, "result")) {
          throw new NativeRpcClientError(
            "MISSING_RESULT",
            "Native RPC response has no result",
          );
        }
        return payload.result;
      } catch (error) {
        if (timedOut) {
          throw new NativeRpcClientError(
            "TIMEOUT",
            "Native RPC request timed out",
          );
        }
        if (controller.signal.aborted) {
          throw new NativeRpcClientError(
            "ABORTED",
            "Native RPC request was cancelled",
          );
        }
        if (error instanceof NativeRpcClientError) throw error;
        throw new NativeRpcClientError(
          "NETWORK_FAILURE",
          "Native RPC network request failed",
        );
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        operation.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
