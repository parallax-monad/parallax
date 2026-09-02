import type { NormalizedSwapIntent } from "@parallax/contracts";

/**
 * Protocol transaction payload kept opaque to the generic Backend boundary.
 * The discriminator makes it explicit that this result is not signed.
 */
export type UnsignedTransaction<Transaction = unknown> = {
  readonly kind: "unsigned";
  readonly payload: Transaction;
};

export type ProtocolAdapterErrorCode =
  | "UNSUPPORTED_PROTOCOL"
  | "INVALID_INTENT"
  | "QUOTE_FAILED"
  | "BUILD_TRANSACTION_FAILED"
  | "UNAVAILABLE";

export type ProtocolAdapterErrorInput = {
  code: ProtocolAdapterErrorCode;
  message: string;
  protocol?: string;
  cause?: unknown;
};

/** Normalized failure boundary for protocol-specific adapter operations. */
export class ProtocolAdapterError extends Error {
  public readonly name = "ProtocolAdapterError";
  public readonly code: ProtocolAdapterErrorCode;
  public readonly protocol?: string;

  public constructor(input: ProtocolAdapterErrorInput) {
    super(input.message, { cause: input.cause });
    this.code = input.code;
    this.protocol = input.protocol;
  }
}

export function isProtocolAdapterError(
  error: unknown,
): error is ProtocolAdapterError {
  if (error instanceof ProtocolAdapterError) return true;
  if (typeof error !== "object" || error === null) return false;

  const candidate = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    protocol?: unknown;
  };

  return (
    candidate.name === "ProtocolAdapterError" &&
    isProtocolAdapterErrorCode(candidate.code) &&
    typeof candidate.message === "string" &&
    (candidate.protocol === undefined || typeof candidate.protocol === "string")
  );
}

function isProtocolAdapterErrorCode(
  value: unknown,
): value is ProtocolAdapterErrorCode {
  return (
    value === "UNSUPPORTED_PROTOCOL" ||
    value === "INVALID_INTENT" ||
    value === "QUOTE_FAILED" ||
    value === "BUILD_TRANSACTION_FAILED" ||
    value === "UNAVAILABLE"
  );
}

/**
 * Replaceable Backend boundary for protocol quote and unsigned transaction
 * construction. Protocol-specific payloads remain inside the adapter.
 */
export interface ProtocolAdapter<
  Intent = NormalizedSwapIntent,
  Quote = unknown,
  Transaction = unknown,
> {
  quote(intent: Intent): Promise<Quote>;

  buildTransaction(intent: Intent): Promise<UnsignedTransaction<Transaction>>;
}
