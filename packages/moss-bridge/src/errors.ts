import type { NormalizedMossError } from "./types.js";

export function normalizeMossError(
  message: string,
  context: Pick<NormalizedMossError, "stage" | "source"> = {
    source: "unknown",
  },
): NormalizedMossError {
  if (/no verified Kuru market path|no Kuru market path/i.test(message)) {
    return { ...context, code: "NO_ROUTE", message, integrationStatus: "OK" };
  }
  if (/debug_traceCall|simulator unavailable|does not expose/i.test(message)) {
    return {
      ...context,
      code: "UNAVAILABLE",
      message,
      integrationStatus: "UNAVAILABLE",
    };
  }
  if (/timed out|timeout/i.test(message)) {
    return {
      ...context,
      code: "TIMEOUT",
      message,
      integrationStatus: "TIMEOUT",
    };
  }
  return {
    ...context,
    code: "INTEGRATION_ERROR",
    message,
    integrationStatus: "INTEGRATION_ERROR",
  };
}
