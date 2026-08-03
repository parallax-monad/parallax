import type { NormalizedMossError, StageName } from "./types.js";

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
  if (/no verified Kuru market path|no Kuru market path/i.test(message)) {
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
  if (/execution reverted/i.test(message)) {
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
