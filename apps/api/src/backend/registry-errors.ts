import {
  BackendControlError,
  controlStatusForCode,
  isBackendControlError,
} from "./control-boundary.js";

export type ChainRegistryErrorCode = "UNSUPPORTED_CHAIN" | "DUPLICATE_CHAIN";

export type ChainRegistryErrorInput = {
  readonly chainId: number;
  readonly code: ChainRegistryErrorCode;
  readonly message: string;
  readonly cause?: unknown;
};

/** Explicit failure raised when a chain adapter cannot be selected. */
export class ChainRegistryError extends BackendControlError {
  public readonly name = "ChainRegistryError";
  public readonly chainId: number;
  public readonly code: ChainRegistryErrorCode;
  public readonly retryable = false;

  public constructor(input: ChainRegistryErrorInput) {
    super({
      code: input.code,
      message: input.message,
      retryable: false,
      status: controlStatusForCode(input.code),
      cause: input.cause,
    });
    this.chainId = input.chainId;
    this.code = input.code;
  }
}

export function isChainRegistryError(
  error: unknown,
): error is ChainRegistryError {
  if (error instanceof ChainRegistryError) return true;
  if (!isBackendControlError(error)) return false;

  const candidate = error as {
    name?: unknown;
    chainId?: unknown;
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    status?: unknown;
  };

  return (
    candidate.name === "ChainRegistryError" &&
    isChainRegistryErrorCode(candidate.code) &&
    isChainId(candidate.chainId) &&
    typeof candidate.message === "string" &&
    candidate.retryable === false &&
    candidate.status === controlStatusForCode(candidate.code)
  );
}

function isChainRegistryErrorCode(
  value: unknown,
): value is ChainRegistryErrorCode {
  return value === "UNSUPPORTED_CHAIN" || value === "DUPLICATE_CHAIN";
}

function isChainId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export type ProtocolRegistryErrorCode =
  | "UNSUPPORTED_CHAIN"
  | "UNSUPPORTED_PROTOCOL"
  | "CHAIN_PROTOCOL_MISMATCH"
  | "DUPLICATE_PROTOCOL";

export type ProtocolRegistryErrorInput = {
  readonly chainId: number;
  readonly protocol: string;
  readonly code: ProtocolRegistryErrorCode;
  readonly message: string;
  readonly cause?: unknown;
};

/** Explicit failure raised when a protocol adapter cannot be selected. */
export class ProtocolRegistryError extends BackendControlError {
  public readonly name = "ProtocolRegistryError";
  public readonly chainId: number;
  public readonly protocol: string;
  public readonly code: ProtocolRegistryErrorCode;
  public readonly retryable = false;

  public constructor(input: ProtocolRegistryErrorInput) {
    super({
      code: input.code,
      message: input.message,
      retryable: false,
      status: controlStatusForCode(input.code),
      cause: input.cause,
    });
    this.chainId = input.chainId;
    this.protocol = input.protocol;
    this.code = input.code;
  }
}

export function isProtocolRegistryError(
  error: unknown,
): error is ProtocolRegistryError {
  if (error instanceof ProtocolRegistryError) return true;
  if (!isBackendControlError(error)) return false;

  const candidate = error as {
    name?: unknown;
    chainId?: unknown;
    protocol?: unknown;
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    status?: unknown;
  };

  return (
    candidate.name === "ProtocolRegistryError" &&
    isProtocolRegistryErrorCode(candidate.code) &&
    isChainId(candidate.chainId) &&
    typeof candidate.protocol === "string" &&
    candidate.protocol.trim().length > 0 &&
    typeof candidate.message === "string" &&
    candidate.retryable === false &&
    candidate.status === controlStatusForCode(candidate.code)
  );
}

function isProtocolRegistryErrorCode(
  value: unknown,
): value is ProtocolRegistryErrorCode {
  return (
    value === "UNSUPPORTED_CHAIN" ||
    value === "UNSUPPORTED_PROTOCOL" ||
    value === "CHAIN_PROTOCOL_MISMATCH" ||
    value === "DUPLICATE_PROTOCOL"
  );
}
