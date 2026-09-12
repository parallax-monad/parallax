import {
  BackendControlError,
  type BackendControlFailureStatus,
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

export type ProviderRegistryErrorCode =
  | "UNSUPPORTED_PROVIDER"
  | "AMBIGUOUS_PROVIDER"
  | "DUPLICATE_PROVIDER"
  | "INVALID_PROVIDER_CONFIGURATION"
  | "PROVIDER_RUNTIME_ERROR"
  | "PROVIDER_OVERRIDE_FORBIDDEN"
  | "PROVIDER_OVERRIDE_NOT_FOUND";

export type ProviderRegistryErrorInput = {
  readonly code: ProviderRegistryErrorCode;
  readonly message: string;
  readonly providerId?: string;
  readonly providerIds?: readonly string[];
  readonly intent?: unknown;
  readonly chainId?: number;
  readonly protocol?: string;
  readonly capability?: string;
  readonly retryable?: boolean;
  readonly status?: BackendControlFailureStatus;
  readonly cause?: unknown;
};

/** Explicit failure raised when a Provider cannot be selected safely. */
export class ProviderRegistryError extends BackendControlError {
  public readonly name = "ProviderRegistryError";
  public readonly providerId?: string;
  public readonly providerIds?: readonly string[];
  public readonly intent?: unknown;
  public readonly chainId?: number;
  public readonly protocol?: string;
  public readonly capability?: string;
  public readonly code: ProviderRegistryErrorCode;
  public readonly retryable: boolean;

  public constructor(input: ProviderRegistryErrorInput) {
    const status = controlStatusForCode(input.code);
    if (input.status !== undefined && input.status !== status) {
      throw new TypeError(
        `provider registry error status must be ${status} for ${input.code}`,
      );
    }
    const retryable = input.retryable ?? false;
    super({
      code: input.code,
      message: input.message,
      retryable,
      status,
      cause: input.cause,
    });
    this.providerId = input.providerId;
    this.providerIds =
      input.providerIds === undefined ? undefined : [...input.providerIds];
    this.intent = input.intent;
    this.chainId = input.chainId;
    this.protocol = input.protocol;
    this.capability = input.capability;
    this.code = input.code;
    this.retryable = retryable;
  }
}

export function isProviderRegistryError(
  error: unknown,
): error is ProviderRegistryError {
  if (error instanceof ProviderRegistryError) return true;
  if (!isBackendControlError(error)) return false;

  const candidate = error as {
    name?: unknown;
    providerId?: unknown;
    providerIds?: unknown;
    chainId?: unknown;
    protocol?: unknown;
    capability?: unknown;
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    status?: unknown;
  };

  return (
    candidate.name === "ProviderRegistryError" &&
    isProviderRegistryErrorCode(candidate.code) &&
    typeof candidate.message === "string" &&
    candidate.message.trim().length > 0 &&
    (candidate.providerId === undefined ||
      (typeof candidate.providerId === "string" &&
        candidate.providerId.trim().length > 0)) &&
    (candidate.providerIds === undefined ||
      (Array.isArray(candidate.providerIds) &&
        candidate.providerIds.length > 0 &&
        candidate.providerIds.every(
          (providerId) =>
            typeof providerId === "string" && providerId.trim().length > 0,
        ))) &&
    (candidate.chainId === undefined || isChainId(candidate.chainId)) &&
    (candidate.protocol === undefined ||
      (typeof candidate.protocol === "string" &&
        candidate.protocol.trim().length > 0)) &&
    (candidate.capability === undefined ||
      (typeof candidate.capability === "string" &&
        candidate.capability.trim().length > 0)) &&
    typeof candidate.retryable === "boolean" &&
    candidate.status === controlStatusForCode(candidate.code)
  );
}

function isProviderRegistryErrorCode(
  value: unknown,
): value is ProviderRegistryErrorCode {
  return (
    value === "UNSUPPORTED_PROVIDER" ||
    value === "AMBIGUOUS_PROVIDER" ||
    value === "DUPLICATE_PROVIDER" ||
    value === "INVALID_PROVIDER_CONFIGURATION" ||
    value === "PROVIDER_RUNTIME_ERROR" ||
    value === "PROVIDER_OVERRIDE_FORBIDDEN" ||
    value === "PROVIDER_OVERRIDE_NOT_FOUND"
  );
}
