import type { ProvisionalProviderResultStatus } from "./provider-result-boundary.js";

/**
 * Backend control status is the same status axis used by the BE-007
 * provisional Provider result. It is deliberately separate from any Run
 * verdict or final Evidence Contract.
 */
export type BackendControlStatus = ProvisionalProviderResultStatus;
export type BackendControlFailureStatus = Exclude<
  BackendControlStatus,
  "success"
>;

export const BACKEND_CONTROL_STATUSES: readonly BackendControlStatus[] = [
  "success",
  "unsupported",
  "failed",
  "timeout",
  "unknown",
  "stale",
  "invalid",
];

export const BACKEND_CONTROL_FAILURE_STATUSES: readonly BackendControlFailureStatus[] =
  BACKEND_CONTROL_STATUSES.filter(
    (status): status is BackendControlFailureStatus => status !== "success",
  );

export function isBackendControlStatus(
  value: unknown,
): value is BackendControlStatus {
  return (
    typeof value === "string" &&
    BACKEND_CONTROL_STATUSES.includes(value as BackendControlStatus)
  );
}

function isBackendControlFailureStatus(
  value: unknown,
): value is BackendControlFailureStatus {
  return (
    typeof value === "string" &&
    BACKEND_CONTROL_FAILURE_STATUSES.includes(
      value as BackendControlFailureStatus,
    )
  );
}

/** Input for a typed system-level Backend control failure. */
export type BackendControlErrorInput = {
  readonly status: BackendControlFailureStatus;
  readonly providerId?: string;
  /** Stable machine-readable diagnostic code from the failing boundary. */
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
};

/**
 * Shared Backend control failure. Adapter-specific errors extend this class so
 * unsupported, failed, timeout, unknown, stale, and invalid states remain
 * distinguishable without introducing a second result boundary.
 */
export class BackendControlError extends Error {
  public readonly name: string = "BackendControlError";
  public readonly status: BackendControlFailureStatus;
  public readonly providerId?: string;
  public readonly code: string;
  public readonly retryable: boolean;

  public constructor(input: BackendControlErrorInput) {
    if (!isBackendControlFailureStatus(input.status)) {
      throw new TypeError("control error status must be a failure status");
    }
    if (
      input.providerId !== undefined &&
      (typeof input.providerId !== "string" || input.providerId.trim() === "")
    ) {
      throw new TypeError("control error providerId must be non-empty");
    }
    if (typeof input.code !== "string" || input.code.trim() === "") {
      throw new TypeError("control error code must be non-empty");
    }
    if (typeof input.message !== "string" || input.message.trim() === "") {
      throw new TypeError("control error message must be non-empty");
    }
    if (typeof input.retryable !== "boolean") {
      throw new TypeError("control error retryable must be a boolean");
    }

    if (input.cause === undefined) {
      super(input.message);
    } else {
      super(input.message, { cause: input.cause });
    }
    this.status = input.status;
    this.providerId = input.providerId;
    this.code = input.code;
    this.retryable = input.retryable;
  }
}

/** Structural guard used when an error crossed a package/runtime boundary. */
export function isBackendControlError(
  error: unknown,
): error is BackendControlError {
  if (error instanceof BackendControlError) return true;
  if (typeof error !== "object" || error === null) return false;

  const candidate = error as {
    name?: unknown;
    status?: unknown;
    providerId?: unknown;
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
  };

  return (
    (candidate.name === "BackendControlError" ||
      candidate.name === "ProviderAdapterError" ||
      candidate.name === "ChainAdapterError" ||
      candidate.name === "ProtocolAdapterError" ||
      candidate.name === "ChainRegistryError" ||
      candidate.name === "ProtocolRegistryError" ||
      candidate.name === "ProviderRegistryError" ||
      candidate.name === "UnsupportedAgentFlowError") &&
    isBackendControlFailureStatus(candidate.status) &&
    (candidate.providerId === undefined ||
      (typeof candidate.providerId === "string" &&
        candidate.providerId.trim() !== "")) &&
    typeof candidate.code === "string" &&
    candidate.code.trim() !== "" &&
    typeof candidate.message === "string" &&
    candidate.message.trim() !== "" &&
    typeof candidate.retryable === "boolean"
  );
}

/**
 * Maps a boundary code to the shared control status. Specific error classes
 * should provide a more precise mapping where their vocabulary permits it.
 */
export function controlStatusForCode(
  code: string,
): BackendControlFailureStatus {
  const normalized = code.trim().toUpperCase();
  if (normalized.includes("UNSUPPORTED")) return "unsupported";
  if (normalized.includes("TIMEOUT")) return "timeout";
  if (normalized.includes("STALE")) return "stale";
  if (normalized.includes("MISMATCH")) return "invalid";
  if (normalized.includes("FORBIDDEN")) return "invalid";
  if (normalized.includes("NOT_FOUND")) return "unsupported";
  if (normalized === "UNKNOWN") return "unknown";
  if (normalized.includes("INVALID")) return "invalid";
  return "failed";
}

/** Internal diagnostic projection that retains cause without making it a DTO. */
export type BackendControlDiagnostic = {
  readonly status: BackendControlFailureStatus;
  readonly providerId?: string;
  readonly code: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
};

export function backendControlDiagnostic(
  error: unknown,
): BackendControlDiagnostic | undefined {
  if (!isBackendControlError(error)) return undefined;
  return {
    status: error.status,
    providerId: error.providerId,
    code: error.code,
    retryable: error.retryable,
    cause: error.cause,
  };
}
