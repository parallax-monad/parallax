/**
 * Internal provisional ProviderAdapter boundary.
 *
 * This port deliberately does not model the final Evidence Contract. Provider
 * implementations may keep SDK/runtime-specific input and output types behind
 * the generic parameters; this module never imports a concrete provider.
 */

/**
 * Extensible capability identifier. The string representation is intentionally
 * open-ended until Provider and Contract Owners approve final vocabulary.
 */
export type ProviderCapability = string;

/** Generic, side-effect-free capability query. */
export type ProviderSupportQuery<Intent = unknown> = {
  readonly intent?: Intent;
  readonly chainId?: number;
  readonly protocol?: string;
  readonly capability?: ProviderCapability;
};

/** Generic input envelope accepted by a ProviderAdapter. */
export type ProviderEvaluationInput<Intent = unknown, Input = unknown> = {
  readonly runId: string;
  readonly intent?: Intent;
  readonly chainId?: number;
  readonly protocol?: string;
  readonly input: Input;
};

/** Provisional result; it is not an Evidence or Risk result. */
export type ProviderEvaluationResult<Output = unknown> =
  | {
      readonly status: "success";
      readonly output: Output;
      readonly capabilities?: readonly ProviderCapability[];
    }
  | {
      readonly status: "unknown";
      readonly reason?: string;
      readonly capabilities?: readonly ProviderCapability[];
    };

export type ProviderAdapterErrorCode =
  | "UNSUPPORTED"
  | "FAILED"
  | "TIMEOUT"
  | "UNKNOWN";

export type ProviderAdapterErrorInput = {
  readonly providerId: string;
  readonly code: ProviderAdapterErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
};

/**
 * Typed ProviderAdapter control failure. It must remain distinguishable from a
 * successful result and carries no Risk verdict or final Evidence semantics.
 */
export class ProviderAdapterError extends Error {
  public readonly name = "ProviderAdapterError";
  public readonly providerId: string;
  public readonly code: ProviderAdapterErrorCode;
  public readonly retryable: boolean;

  public constructor(input: ProviderAdapterErrorInput) {
    super(input.message, { cause: input.cause });
    this.providerId = input.providerId;
    this.code = input.code;
    this.retryable = input.retryable ?? false;
  }
}

export function isProviderAdapterError(
  error: unknown,
): error is ProviderAdapterError {
  if (error instanceof ProviderAdapterError) return true;
  if (typeof error !== "object" || error === null) return false;

  const candidate = error as {
    name?: unknown;
    providerId?: unknown;
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
  };

  return (
    candidate.name === "ProviderAdapterError" &&
    typeof candidate.providerId === "string" &&
    isProviderAdapterErrorCode(candidate.code) &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean"
  );
}

function isProviderAdapterErrorCode(
  value: unknown,
): value is ProviderAdapterErrorCode {
  return (
    value === "UNSUPPORTED" ||
    value === "FAILED" ||
    value === "TIMEOUT" ||
    value === "UNKNOWN"
  );
}

/**
 * Replaceable Backend-local provider port. Implementations own all raw
 * provider translation and must keep supports(...) cheap and side-effect free.
 */
export interface ProviderAdapter<
  Intent = unknown,
  Input = unknown,
  Output = unknown,
> {
  readonly providerId: string;
  readonly capabilities?: readonly ProviderCapability[];

  supports(query: ProviderSupportQuery<Intent>): boolean;

  evaluate(
    input: ProviderEvaluationInput<Intent, Input>,
  ): Promise<ProviderEvaluationResult<Output>>;
}
