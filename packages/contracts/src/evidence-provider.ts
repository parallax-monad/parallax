import type {
  GenericEvidence,
  GenericProviderErrorCode,
  GenericProviderStage,
  GenericSwapIntent,
} from "./generic-evidence.js";

/**
 * Evidence Provider abstraction.
 *
 * A provider acquires, normalizes and maps protocol evidence into the generic
 * Evidence contract. Parallax Core (Risk / Orchestrator) depends only on this
 * interface plus `GenericEvidence`; provider raw types never cross this
 * boundary.
 *
 * Contract:
 * - `supports(intent)` must be cheap and side-effect free.
 * - `evaluate(input)` resolves to a checked GenericEvidence, or throws an
 *   `EvidenceProviderError` when no evidence could be produced (provider or
 *   RPC unavailable, timeout, internal failure, unsupported intent).
 * - Provider failures are never converted into successful Evidence: a
 *   classified failure is either thrown, or returned as
 *   `provider.status !== "OK"` with `provider.failure` set.
 */
export interface EvidenceProvider {
  readonly providerId: string;

  supports(intent: GenericSwapIntent): boolean;

  evaluate(input: EvidenceEvaluationInput): Promise<GenericEvidence>;
}

export type EvidenceEvaluationInput = {
  runId: string;
  intent: GenericSwapIntent;
  tokenInDecimals: number;
  tokenOutDecimals: number;
};

/**
 * Thrown by a provider when it cannot produce Evidence at all. The fields
 * mirror the normalized provider failure vocabulary so callers can classify
 * the failure without reaching into provider internals.
 */
export class EvidenceProviderError extends Error {
  public readonly providerId: string;
  public readonly code:
    | GenericProviderErrorCode
    | "INTERNAL_ERROR"
    | "UNSUPPORTED";
  public readonly integrationStatus?:
    | "OK"
    | "INTEGRATION_ERROR"
    | "UNAVAILABLE"
    | "TIMEOUT";
  public readonly source?: "moss" | "rpc" | "quote" | "unknown";
  public readonly stage?: GenericProviderStage;
  public readonly retryable?: boolean;

  public constructor(input: {
    providerId: string;
    code: GenericProviderErrorCode | "INTERNAL_ERROR" | "UNSUPPORTED";
    message: string;
    integrationStatus?: "OK" | "INTEGRATION_ERROR" | "UNAVAILABLE" | "TIMEOUT";
    source?: "moss" | "rpc" | "quote" | "unknown";
    stage?: GenericProviderStage;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "EvidenceProviderError";
    this.providerId = input.providerId;
    this.code = input.code;
    this.integrationStatus = input.integrationStatus;
    this.source = input.source;
    this.stage = input.stage;
    this.retryable = input.retryable;
  }
}
