import type {
  IntegrationStatus,
  NormalizedMossError,
  StageName,
} from "./types.js";

/**
 * Deterministic error mapping for the Moss live boundary.
 *
 * Structured errors win. String matching is only a DERIVED fallback and is
 * always exercised by tests. Errors never manufacture a protocol verdict:
 * a warning is not a failure, a timeout is not STOP, and NO_ROUTE stays under
 * the Classification Gate.
 */

export type ClassifyContext = {
  stage?: StageName;
  source?: NormalizedMossError["source"];
};

const AUTHORITATIVE_STATUSES = new Set<IntegrationStatus>([
  "OK",
  "INTEGRATION_ERROR",
  "UNAVAILABLE",
  "TIMEOUT",
]);

const KNOWN_CODES = new Set<NormalizedMossError["code"]>([
  "NO_ROUTE",
  "REVERTED",
  "TIMEOUT",
  "UNAVAILABLE",
  "INTEGRATION_ERROR",
  "UNKNOWN",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(
  value: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const candidate = value?.[field];
  return typeof candidate === "string" ? candidate : undefined;
}

/**
 * Structured errors are authoritative: when a thrown object carries an explicit
 * `integrationStatus`, its code/status/source are preserved instead of being
 * re-derived from message text. Message-based rules may only ever fire as a
 * stage-limited DERIVED fallback for unstructured errors.
 */
function preserveStructuredError(
  error: unknown,
  context: ClassifyContext,
  message: string,
): NormalizedMossError | undefined {
  const fields = asRecord(error);
  const rawStatus = stringField(fields, "integrationStatus");
  if (
    rawStatus === undefined ||
    !(AUTHORITATIVE_STATUSES as ReadonlySet<string>).has(rawStatus)
  ) {
    return undefined;
  }
  const status = rawStatus as IntegrationStatus;
  const rawCode = stringField(fields, "code");
  const code: NormalizedMossError["code"] =
    rawCode !== undefined &&
    KNOWN_CODES.has(rawCode as NormalizedMossError["code"])
      ? (rawCode as NormalizedMossError["code"])
      : status === "OK"
        ? "UNKNOWN"
        : status;
  const rawSource = stringField(fields, "source");
  const source: NormalizedMossError["source"] =
    context.source ??
    (rawSource === "moss" ||
    rawSource === "rpc" ||
    rawSource === "quote" ||
    rawSource === "unknown"
      ? rawSource
      : "unknown");
  const rawRetryable = fields?.retryable;
  return {
    ...(context.stage ? { stage: context.stage } : {}),
    code,
    message,
    integrationStatus: status,
    source,
    normalization: "PRESERVED",
    ...(typeof rawRetryable === "boolean"
      ? { retryable: rawRetryable }
      : status === "TIMEOUT" || status === "INTEGRATION_ERROR"
        ? { retryable: true }
        : {}),
  };
}

/**
 * Structured timeout raised when a stage or the whole live chain exceeds its
 * deadline. Moss APIs do not support AbortSignal, so the timeout is produced by
 * `Promise.race`; the underlying request may still be terminating in the
 * background. A timeout is never mapped to STOP or to a protocol verdict.
 */
export class StageTimeoutError extends Error {
  readonly stage: string;

  constructor(stage: string, ms: number) {
    super(`stage ${stage} timed out after ${ms}ms`);
    this.name = "StageTimeoutError";
    this.stage = stage;
  }
}

export function structuredError(input: {
  stage?: StageName;
  code: NormalizedMossError["code"];
  message: string;
  integrationStatus: NormalizedMossError["integrationStatus"];
  source?: NormalizedMossError["source"];
  retryable?: boolean;
}): NormalizedMossError {
  return {
    ...(input.stage ? { stage: input.stage } : {}),
    code: input.code,
    message: input.message,
    integrationStatus: input.integrationStatus,
    source: input.source ?? "unknown",
    normalization: "PRESERVED",
    ...(input.retryable === undefined ? {} : { retryable: input.retryable }),
  };
}

/**
 * Classify a thrown runtime error from a live stage. Errors that carry a
 * structured name (e.g. `SimulatorUnavailableError`) are recognized first;
 * everything else falls back to the derived string rules below.
 */
export function classifyLiveError(
  error: unknown,
  context: ClassifyContext = {},
): NormalizedMossError {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : undefined;

  if (error instanceof StageTimeoutError) {
    return {
      ...(error.stage ? { stage: error.stage as StageName } : {}),
      code: "TIMEOUT",
      message,
      integrationStatus: "TIMEOUT",
      source: "rpc",
      normalization: "PRESERVED",
      retryable: true,
    };
  }

  if (name === "SimulatorUnavailableError") {
    return {
      ...(context.stage ? { stage: context.stage } : {}),
      code: "UNAVAILABLE",
      message,
      integrationStatus: "UNAVAILABLE",
      source: "rpc",
      normalization: "PRESERVED",
      retryable: false,
    };
  }

  if (name === "ReceiptCoverageError") {
    return {
      ...(context.stage ? { stage: context.stage } : {}),
      code: "UNKNOWN",
      message,
      integrationStatus: "OK",
      source: "moss",
      normalization: "PRESERVED",
      retryable: false,
    };
  }

  if (name === "ChangeOrderError") {
    return {
      ...(context.stage ? { stage: context.stage } : {}),
      code: "UNKNOWN",
      message,
      integrationStatus: "OK",
      source: "moss",
      normalization: "PRESERVED",
      retryable: false,
    };
  }

  const preserved = preserveStructuredError(error, context, message);
  if (preserved) {
    return preserved;
  }

  return normalizeMossError(message, context);
}

export function normalizeMossError(
  message: string,
  context: {
    stage?: StageName;
    source?: NormalizedMossError["source"];
  } = {},
): NormalizedMossError {
  const normalized = {
    ...(context.stage ? { stage: context.stage } : {}),
    message,
  };
  // NO_ROUTE is only a confirmed terminal classification from an explicit
  // QUOTE or ACTION stage. A route-like message from any other stage, or with
  // no stage context, is not enough to claim a no-route result.
  if (
    (context.stage === "QUOTE" || context.stage === "ACTION") &&
    /no verified Kuru market path|no Kuru market path/i.test(message)
  ) {
    return {
      ...normalized,
      code: "NO_ROUTE",
      integrationStatus: "OK",
      source: context.source ?? "unknown",
      normalization: "DERIVED",
      retryable: false,
    };
  }
  if (/debug_traceCall|simulator unavailable|does not expose/i.test(message)) {
    return {
      ...normalized,
      code: "UNAVAILABLE",
      integrationStatus: "UNAVAILABLE",
      source: context.source ?? "unknown",
      normalization: "DERIVED",
      retryable: false,
    };
  }
  if (/timed out|timeout|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return {
      ...normalized,
      code: "TIMEOUT",
      integrationStatus: "TIMEOUT",
      source: context.source ?? "unknown",
      normalization: "DERIVED",
      retryable: true,
    };
  }
  // REVERTED is only derivable from an explicitly confirmed SIMULATE-stage
  // error. A revert-like message from QUOTE/ACTION/RPC is an integration
  // failure, not simulation evidence.
  if (context.stage === "SIMULATE" && /execution reverted/i.test(message)) {
    return {
      ...normalized,
      code: "REVERTED",
      integrationStatus: "OK",
      source: context.source ?? "unknown",
      normalization: "DERIVED",
      retryable: false,
    };
  }
  return {
    ...normalized,
    code: "INTEGRATION_ERROR",
    integrationStatus: "INTEGRATION_ERROR",
    source: context.source ?? "unknown",
    normalization: "DERIVED",
    retryable: true,
  };
}
