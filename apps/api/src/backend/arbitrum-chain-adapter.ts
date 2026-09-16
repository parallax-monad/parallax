import { ARBITRUM_SEPOLIA_CHAIN_ID } from "@parallax/contracts";
import {
  type BlockContext,
  type ChainAdapter,
  ChainAdapterError,
  type ChainOperation,
  type ChainOperationOptions,
  type FinalityStatus,
  type GasEstimate,
} from "./chain-adapter.js";

export { ARBITRUM_SEPOLIA_CHAIN_ID };

/** Minimal EVM JSON-RPC transaction shape kept independent of an SDK. */
export type ArbitrumTransaction = Readonly<Record<string, string | undefined>>;

export type ArbitrumRpcClient = {
  request(
    method: string,
    params?: readonly unknown[],
    options?: ChainOperationOptions,
  ): Promise<unknown>;
};

export type ArbitrumChainAdapterOptions = {
  readonly client?: ArbitrumRpcClient;
  /** No endpoint is guessed; callers must provide the runtime-configured URL. */
  readonly rpcUrl?: string;
  readonly fetchImplementation?: typeof fetch;
};

type RpcError = Error & { rpcCode?: number };

type RpcBlock = {
  readonly number?: unknown;
  readonly hash?: unknown;
  readonly timestamp?: unknown;
};

/**
 * Arbitrum Sepolia Chain adapter with an SDK-free JSON-RPC seam.
 *
 * This adapter only owns chain identity, block context, gas estimation and a
 * conservative finalized-block check. It does not sign, broadcast, or infer
 * protocol/pool state.
 */
export class ArbitrumChainAdapter implements ChainAdapter<ArbitrumTransaction> {
  public readonly chainId = ARBITRUM_SEPOLIA_CHAIN_ID;
  private readonly client: ArbitrumRpcClient;

  public constructor(options: ArbitrumChainAdapterOptions = {}) {
    if (options.client !== undefined) {
      this.client = options.client;
      return;
    }
    if (options.rpcUrl === undefined || options.rpcUrl.trim() === "") {
      throw new TypeError("Arbitrum RPC client or rpcUrl is required");
    }
    this.client = createArbitrumRpcClient(
      options.rpcUrl,
      options.fetchImplementation,
    );
  }

  public async connect(options?: ChainOperationOptions): Promise<void> {
    const observedChainId = normalizeRpcQuantity(
      await this.request("connect", "eth_chainId", [], options),
      "connect",
    );
    if (observedChainId !== String(this.chainId)) {
      throw new ChainAdapterError({
        chainId: this.chainId,
        operation: "connect",
        code: "INVALID_REQUEST",
        message: `Arbitrum RPC returned chain ${observedChainId}; expected ${this.chainId}`,
        retryable: false,
      });
    }
  }

  public async getBlockContext(
    options?: ChainOperationOptions,
  ): Promise<BlockContext> {
    const block = await this.request(
      "getBlockContext",
      "eth_getBlockByNumber",
      ["latest", false],
      options,
    );
    return blockContextFromRpc(block, "getBlockContext", this.chainId, true);
  }

  public async estimateGas(
    transaction: ArbitrumTransaction,
    options?: ChainOperationOptions,
  ): Promise<GasEstimate> {
    assertTransaction(transaction);
    const gas = await this.request(
      "estimateGas",
      "eth_estimateGas",
      [transaction],
      options,
    );
    return { gasUnits: normalizeRpcQuantity(gas, "estimateGas") };
  }

  public async getFinality(
    blockContext: BlockContext,
    options?: ChainOperationOptions,
  ): Promise<FinalityStatus> {
    const callerContext: unknown = blockContext;
    if (callerContext === null || callerContext === undefined) {
      throw new ChainAdapterError({
        chainId: this.chainId,
        operation: "getFinality",
        code: "INVALID_REQUEST",
        message: "Arbitrum finality requires a block context object",
        retryable: false,
      });
    }

    let target: bigint;
    try {
      target = parseDecimalQuantity(blockContext.blockNumber);
    } catch (cause) {
      throw new ChainAdapterError({
        chainId: this.chainId,
        operation: "getFinality",
        code: "INVALID_REQUEST",
        message: "Arbitrum finality requires a decimal block number",
        retryable: false,
        cause,
      });
    }

    const finalized = await this.request(
      "getFinality",
      "eth_getBlockByNumber",
      ["finalized", false],
      options,
    );
    if (finalized === null) return { status: "unknown" };

    const finalizedContext = blockContextFromRpc(
      finalized,
      "getFinality",
      this.chainId,
      false,
    );
    const observed = parseDecimalQuantity(finalizedContext.blockNumber);
    return observed >= target
      ? { status: "finalized", blockContext: finalizedContext }
      : { status: "pending", blockContext: finalizedContext };
  }

  private async request(
    operation: ChainOperation,
    method: string,
    params: readonly unknown[],
    options?: ChainOperationOptions,
  ): Promise<unknown> {
    if (options?.signal?.aborted) {
      throw new ChainAdapterError({
        chainId: this.chainId,
        operation,
        code: "CANCELLED",
        message: `chain operation ${operation} cancelled`,
        retryable: false,
        cause: options.signal.reason,
      });
    }

    const request = Promise.resolve().then(() =>
      this.client.request(method, params, options),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: (() => void) | undefined;
    const races: Promise<unknown>[] = [request];

    if (options?.timeoutMs !== undefined && options.timeoutMs > 0) {
      races.push(
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new ChainAdapterError({
                chainId: this.chainId,
                operation,
                code: "TIMEOUT",
                message: `chain operation ${operation} timed out`,
                retryable: true,
              }),
            );
          }, options.timeoutMs);
        }),
      );
    }

    if (options?.signal !== undefined) {
      races.push(
        new Promise<never>((_, reject) => {
          const onAbort = () => {
            reject(
              new ChainAdapterError({
                chainId: this.chainId,
                operation,
                code: "CANCELLED",
                message: `chain operation ${operation} cancelled`,
                retryable: false,
                cause: options.signal?.reason,
              }),
            );
          };
          options.signal?.addEventListener("abort", onAbort, { once: true });
          removeAbortListener = () =>
            options.signal?.removeEventListener("abort", onAbort);
        }),
      );
    }

    try {
      return await Promise.race(races);
    } catch (error) {
      if (error instanceof ChainAdapterError) throw error;
      throw new ChainAdapterError({
        chainId: this.chainId,
        operation,
        code: classifyRpcFailure(error),
        message: rpcFailureMessage(operation, error),
        retryable: classifyRpcFailure(error) === "UNAVAILABLE",
        cause: error,
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      removeAbortListener?.();
    }
  }
}

export function createArbitrumChainAdapter(
  options: ArbitrumChainAdapterOptions,
): ArbitrumChainAdapter {
  return new ArbitrumChainAdapter(options);
}

export function createArbitrumRpcClient(
  rpcUrl: string,
  fetchImplementation: typeof fetch = globalThis.fetch,
): ArbitrumRpcClient {
  if (rpcUrl.trim() === "") throw new TypeError("rpcUrl is required");
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("fetchImplementation must be a function");
  }

  let nextId = 1;
  return {
    async request(method, params = [], options): Promise<unknown> {
      const response = await fetchImplementation(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new Error(`Arbitrum RPC HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        result?: unknown;
        error?: { code?: unknown; message?: unknown };
      };
      if (payload.error !== undefined) {
        const error = new Error(
          typeof payload.error.message === "string"
            ? payload.error.message
            : "Arbitrum RPC returned an error",
        ) as RpcError;
        if (typeof payload.error.code === "number")
          error.rpcCode = payload.error.code;
        throw error;
      }
      if (!Object.hasOwn(payload, "result")) {
        throw new Error("Arbitrum RPC response has no result");
      }
      return payload.result;
    },
  };
}

function assertTransaction(
  value: unknown,
): asserts value is ArbitrumTransaction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ChainAdapterError({
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      operation: "estimateGas",
      code: "INVALID_REQUEST",
      message: "Arbitrum gas estimation requires a transaction object",
      retryable: false,
    });
  }
}

function blockContextFromRpc(
  value: unknown,
  operation: ChainOperation,
  chainId: number,
  includeObservedAt: boolean,
): BlockContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ChainAdapterError({
      chainId,
      operation,
      code: "UNKNOWN",
      message: "Arbitrum RPC returned an invalid block object",
      retryable: false,
    });
  }
  const block = value as RpcBlock;
  const blockNumber = normalizeRpcQuantity(block.number, operation);
  const blockHash =
    typeof block.hash === "string" && block.hash.length > 0
      ? block.hash
      : undefined;
  const observedAt = includeObservedAt ? new Date().toISOString() : undefined;
  return {
    blockNumber,
    ...(blockHash === undefined ? {} : { blockHash }),
    ...(observedAt === undefined ? {} : { observedAt }),
  };
}

function normalizeQuantity(value: unknown): string {
  if (typeof value === "bigint")
    return value >= 0n ? value.toString() : invalidQuantity();
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return String(value);
    return invalidQuantity();
  }
  if (typeof value !== "string") return invalidQuantity();
  if (/^\d+$/.test(value)) return String(parseDecimalQuantity(value));
  if (!/^0x[0-9a-fA-F]+$/.test(value)) return invalidQuantity();
  return BigInt(value).toString();
}

function normalizeRpcQuantity(
  value: unknown,
  operation: ChainOperation,
): string {
  try {
    return normalizeQuantity(value);
  } catch (cause) {
    throw new ChainAdapterError({
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      operation,
      code: "UNKNOWN",
      message: "Arbitrum RPC returned an invalid quantity",
      retryable: false,
      cause,
    });
  }
}

function parseDecimalQuantity(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error("invalid decimal quantity");
  return BigInt(value);
}

function invalidQuantity(): never {
  throw new Error("Arbitrum RPC returned an invalid quantity");
}

function classifyRpcFailure(
  error: unknown,
): "UNAVAILABLE" | "TIMEOUT" | "INVALID_REQUEST" | "UNKNOWN" {
  const candidate = error as RpcError | undefined;
  if (candidate?.rpcCode === -32600 || candidate?.rpcCode === -32602) {
    return "INVALID_REQUEST";
  }
  if (
    candidate?.name === "AbortError" ||
    /timeout|timed out/i.test(candidate?.message ?? "")
  ) {
    return "TIMEOUT";
  }
  if (
    candidate?.name === "TypeError" ||
    /fetch|network|http \d{3}/i.test(candidate?.message ?? "")
  ) {
    return "UNAVAILABLE";
  }
  return "UNKNOWN";
}

function rpcFailureMessage(operation: ChainOperation, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Arbitrum ${operation} RPC request failed: ${message}`;
}
