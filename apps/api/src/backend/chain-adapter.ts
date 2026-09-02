/**
 * Generic Backend boundary for a chain integration.
 *
 * This port deliberately contains no RPC SDK, provider-specific type, or
 * Evidence Contract field. Implementations own the translation between this
 * boundary and their chain client.
 */

export type ChainOperation =
  | "connect"
  | "getBlockContext"
  | "estimateGas"
  | "getFinality";

export type ChainErrorCode =
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "CANCELLED"
  | "INVALID_REQUEST"
  | "UNKNOWN";

/** Options shared by every potentially long-running chain operation. */
export type ChainOperationOptions = {
  /** Caller-owned cancellation signal. Implementations must honor it. */
  signal?: AbortSignal;
  /** Implementation-enforced operation deadline in milliseconds. */
  timeoutMs?: number;
};

/** Chain state used to anchor a read or an operation without SDK-specific types. */
export type BlockContext = {
  /** Opaque canonical block identifier; string avoids precision loss. */
  blockNumber: string;
  blockHash?: string;
  observedAt?: string;
};

/** Minimal gas result; fee currency and pricing remain outside this port. */
export type GasEstimate = {
  /** Estimated execution units represented as a decimal string. */
  gasUnits: string;
};

export type FinalityStatus = {
  status: "unknown" | "pending" | "confirmed" | "finalized";
  blockContext?: BlockContext;
};

export type ChainAdapterErrorInput = {
  chainId: number;
  operation: ChainOperation;
  code: ChainErrorCode;
  message: string;
  retryable?: boolean;
  cause?: unknown;
};

/**
 * Normalized chain-integration failure. It is intentionally separate from
 * application errors and protocol/risk decisions.
 */
export class ChainAdapterError extends Error {
  public readonly name = "ChainAdapterError";
  public readonly chainId: number;
  public readonly operation: ChainOperation;
  public readonly code: ChainErrorCode;
  public readonly retryable: boolean;

  public constructor(input: ChainAdapterErrorInput) {
    super(input.message, { cause: input.cause });
    this.chainId = input.chainId;
    this.operation = input.operation;
    this.code = input.code;
    this.retryable = input.retryable ?? false;
  }
}

export function isChainAdapterError(
  error: unknown,
): error is ChainAdapterError {
  if (error instanceof ChainAdapterError) return true;
  if (typeof error !== "object" || error === null) return false;

  const candidate = error as {
    name?: unknown;
    chainId?: unknown;
    operation?: unknown;
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
  };

  return (
    candidate.name === "ChainAdapterError" &&
    typeof candidate.chainId === "number" &&
    isChainOperation(candidate.operation) &&
    isChainErrorCode(candidate.code) &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean"
  );
}

function isChainOperation(value: unknown): value is ChainOperation {
  return (
    value === "connect" ||
    value === "getBlockContext" ||
    value === "estimateGas" ||
    value === "getFinality"
  );
}

function isChainErrorCode(value: unknown): value is ChainErrorCode {
  return (
    value === "UNAVAILABLE" ||
    value === "TIMEOUT" ||
    value === "CANCELLED" ||
    value === "INVALID_REQUEST" ||
    value === "UNKNOWN"
  );
}

/**
 * Chain integration contract consumed by Backend composition.
 *
 * Transaction is generic so a concrete chain client can keep its transaction
 * representation inside its adapter. The generic Backend layer never needs
 * to import that representation.
 */
export interface ChainAdapter<Transaction = unknown> {
  readonly chainId: number;

  connect(options?: ChainOperationOptions): Promise<void>;

  getBlockContext(options?: ChainOperationOptions): Promise<BlockContext>;

  estimateGas(
    transaction: Transaction,
    options?: ChainOperationOptions,
  ): Promise<GasEstimate>;

  getFinality(
    blockContext: BlockContext,
    options?: ChainOperationOptions,
  ): Promise<FinalityStatus>;
}
