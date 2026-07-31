import type { NormalizedMossError } from "./types.js";

export function normalizeMossError(
  message: string,
  context: Pick<NormalizedMossError, "stage" | "source"> = {
    source: "unknown",
  },
): NormalizedMossError {
  if (/no verified Kuru market path|no Kuru market path/i.test(message)) {
    return {
      ...context,
      code: "NO_ROUTE",
      message,
      integrationStatus: "OK",
      normalization: "DERIVED",
    };
  }
  if (/debug_traceCall|simulator unavailable|does not expose/i.test(message)) {
    return {
      ...context,
      code: "UNAVAILABLE",
      message,
      integrationStatus: "UNAVAILABLE",
      normalization: "DERIVED",
    };
  }
  if (/timed out|timeout/i.test(message)) {
    return {
      ...context,
      code: "TIMEOUT",
      message,
      integrationStatus: "TIMEOUT",
      normalization: "DERIVED",
    };
  }
  return {
    ...context,
    code: "INTEGRATION_ERROR",
    message,
    integrationStatus: "INTEGRATION_ERROR",
    normalization: "DERIVED",
  };
}
