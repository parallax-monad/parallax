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

export type NativeRpcClientSemanticReason =
  | "INSUFFICIENT_NATIVE_BALANCE"
  | "SLIPPAGE_GUARD";

const MAX_REVERT_REASON_BYTES = 128;
const MAX_REVERT_DATA_HEX_LENGTH =
  2 + 8 + 64 + 64 + MAX_REVERT_REASON_BYTES * 2;
const SLIPPAGE_REVERT_REASONS = new Set([
  "too little received",
  "minimum output",
  "amountoutminimum",
]);

/** Only controlled error text crosses the Provider boundary. */
export class NativeRpcClientError extends Error {
  public readonly name = "NativeRpcClientError";

  public constructor(
    public readonly kind: NativeRpcClientFailure,
    message: string,
    public readonly rpcCode?: number,
    public readonly semanticReason?: NativeRpcClientSemanticReason,
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
  let parsed: URL;
  try {
    parsed = new URL(options.rpcUrl);
  } catch {
    // URL parsers may attach the supplied endpoint to an exception.
    throw new TypeError("Native RPC URL is invalid");
  }
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
      // An already-aborted caller signal must fail through the controlled
      // ABORTED path before any transport work. Aborting the internal
      // controller alone would still invoke the injected fetch implementation.
      if (operation.signal?.aborted) {
        throw new NativeRpcClientError(
          "ABORTED",
          "Native RPC request was cancelled",
        );
      }
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
          const semanticReason =
            /^insufficient funds for gas\s*\*\s*price\s*\+\s*value(?:\b|:)/i.test(
              rpcError.message,
            )
              ? "INSUFFICIENT_NATIVE_BALANCE"
              : rpcError.code === 3 &&
                  hasStructuredSlippageRevertData(rpcError.data)
                ? "SLIPPAGE_GUARD"
                : undefined;
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
            semanticReason,
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

/**
 * Recognize only a small allowlist of canonical Solidity Error(string)
 * payloads. The decoded reason is deliberately discarded; only the bounded
 * semantic enum crosses the Native RPC boundary.
 */
function hasStructuredSlippageRevertData(data: unknown): boolean {
  if (
    typeof data !== "string" ||
    data.length > MAX_REVERT_DATA_HEX_LENGTH ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(data)
  ) {
    return false;
  }

  const encoded = data.slice(2);
  if (
    encoded.length < 136 ||
    encoded.slice(0, 8).toLowerCase() !== "08c379a0" ||
    BigInt(`0x${encoded.slice(8, 72)}`) !== 32n
  ) {
    return false;
  }

  const reasonLength = BigInt(`0x${encoded.slice(72, 136)}`);
  if (reasonLength === 0n || reasonLength > BigInt(MAX_REVERT_REASON_BYTES)) {
    return false;
  }
  const byteLength = Number(reasonLength);
  const paddedByteLength = Math.ceil(byteLength / 32) * 32;
  const reasonHexStart = 136;
  if (encoded.length !== reasonHexStart + paddedByteLength * 2) return false;

  const reasonHex = encoded.slice(
    reasonHexStart,
    reasonHexStart + byteLength * 2,
  );
  const padding = encoded.slice(reasonHexStart + byteLength * 2);
  if (!/^0*$/.test(padding)) return false;

  const reasonBytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    reasonBytes[index] = Number.parseInt(
      reasonHex.slice(index * 2, index * 2 + 2),
      16,
    );
  }
  try {
    const reason = new TextDecoder("utf-8", { fatal: true })
      .decode(reasonBytes)
      .trim()
      .toLowerCase();
    return SLIPPAGE_REVERT_REASONS.has(reason);
  } catch {
    return false;
  }
}
