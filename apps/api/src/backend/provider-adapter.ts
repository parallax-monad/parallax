/**
 * Internal provisional ProviderAdapter boundary.
 *
 * This port deliberately does not model the final Evidence Contract. Provider
 * implementations may keep SDK/runtime-specific input types behind the generic
 * parameters; this module never imports a concrete provider.
 */

import {
  normalizeProvisionalProviderResult,
  type ProvisionalProviderResult,
} from "./provider-result-boundary.js";

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

/**
 * Provider output after crossing the internal provisional boundary.
 *
 * Raw Provider output is intentionally absent. The adapter must translate it
 * into candidate observations and controlled response evidence before it can
 * be returned to a caller. Capabilities remain an adapter concern and do not
 * imply approval of any candidate field.
 */
export type ProviderEvaluationResult = ProvisionalProviderResult & {
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
 * Raw Backend-local provider implementation. This is deliberately separate
 * from the public adapter: raw provider output may only leave this seam via
 * the factory's validated closure.
 */
export type ProviderAdapterRawImplementation<
  Intent = unknown,
  Input = unknown,
> = {
  readonly providerId: string;
  readonly capabilities?: readonly ProviderCapability[];
  supports(query: ProviderSupportQuery<Intent>): boolean;
  evaluateRaw(input: ProviderEvaluationInput<Intent, Input>): Promise<unknown>;
};

declare const providerAdapterBrand: unique symbol;
type AdapterEvaluation<Intent, Input> = (
  input: ProviderEvaluationInput<Intent, Input>,
) => Promise<ProviderEvaluationResult>;
const factoryCreatedAdapters = new WeakMap<
  object,
  AdapterEvaluation<unknown, unknown>
>();

/** Replaceable, runtime-validated Backend-local provider port. */
export interface ProviderAdapter<Intent = unknown, _Input = unknown> {
  readonly [providerAdapterBrand]: true;
  readonly providerId: string;
  readonly capabilities?: readonly ProviderCapability[];

  supports(query: ProviderSupportQuery<Intent>): boolean;
}

function normalizeCapabilities(
  value: unknown,
): readonly ProviderCapability[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TypeError("adapter capabilities must be an array");
  }
  const length = value.length;
  const ownNames = Object.getOwnPropertyNames(value);
  if (
    Object.getOwnPropertySymbols(value).length > 0 ||
    ownNames.length !== length + 1 ||
    !ownNames.every(
      (key) =>
        key === "length" ||
        (/^(0|[1-9]\d*)$/.test(key) && Number(key) < length),
    )
  ) {
    throw new TypeError("adapter capabilities must be a dense array");
  }

  const normalized: ProviderCapability[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError("adapter capabilities must be a dense array");
    }
    const capability = value[index];
    if (typeof capability !== "string" || capability.trim().length === 0) {
      throw new TypeError("adapter capabilities must be non-empty strings");
    }
    normalized.push(capability);
  }
  return normalized;
}

function normalizeAdapterEvaluation(
  adapterProviderId: string,
  output: unknown,
): ProviderEvaluationResult {
  const normalized = normalizeProvisionalProviderResult(output);
  if (normalized.provider.providerId !== adapterProviderId) {
    throw new TypeError("provider result does not match adapter providerId");
  }

  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return normalized;
  }
  const capabilities = normalizeCapabilities(
    (output as { capabilities?: unknown }).capabilities,
  );
  return Object.freeze({
    ...normalized,
    capabilities:
      capabilities === undefined ? undefined : Object.freeze([...capabilities]),
  });
}

/**
 * Creates the only public adapter shape. The raw implementation is retained
 * only by closures and is never attached to the returned object.
 */
export function createProviderAdapter<Intent = unknown, Input = unknown>(
  raw: ProviderAdapterRawImplementation<Intent, Input>,
): ProviderAdapter<Intent, Input> {
  const providerId = raw.providerId;
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    throw new TypeError("adapter.providerId must be a non-empty string");
  }
  const capabilities = normalizeCapabilities(raw.capabilities);
  const publicCapabilities =
    capabilities === undefined ? undefined : Object.freeze([...capabilities]);
  const adapter = Object.freeze({
    providerId,
    capabilities: publicCapabilities,
    supports: (query: ProviderSupportQuery<Intent>) => raw.supports(query),
  }) as ProviderAdapter<Intent, Input>;
  const evaluate = async (
    input: ProviderEvaluationInput<Intent, Input>,
  ): Promise<ProviderEvaluationResult> =>
    normalizeAdapterEvaluation(providerId, await raw.evaluateRaw(input));
  factoryCreatedAdapters.set(
    adapter,
    evaluate as AdapterEvaluation<unknown, unknown>,
  );
  return adapter;
}

/** Compatibility entry point; validation is owned by the public adapter. */
export function evaluateProviderAdapter<Intent = unknown, Input = unknown>(
  adapter: ProviderAdapter<Intent, Input>,
  input: ProviderEvaluationInput<Intent, Input>,
): Promise<ProviderEvaluationResult> {
  if (
    typeof adapter !== "object" ||
    adapter === null ||
    !factoryCreatedAdapters.has(adapter)
  ) {
    throw new TypeError("adapter must be created by createProviderAdapter");
  }
  const evaluate = factoryCreatedAdapters.get(adapter);
  if (evaluate === undefined) {
    throw new TypeError("adapter must be created by createProviderAdapter");
  }
  return evaluate(input);
}
