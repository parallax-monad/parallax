import type { IntegrationStatus } from "./types.js";

export type NormalizedMossError = {
  code:
    | "NO_ROUTE"
    | "REVERTED"
    | "TIMEOUT"
    | "UNAVAILABLE"
    | "INTEGRATION_ERROR";
  message: string;
  integrationStatus: IntegrationStatus;
};

export function normalizeMossError(message: string): NormalizedMossError {
  if (/no verified Kuru market path|no Kuru market path/i.test(message)) {
    return { code: "NO_ROUTE", message, integrationStatus: "OK" };
  }
  if (/debug_traceCall|simulator unavailable|does not expose/i.test(message)) {
    return { code: "UNAVAILABLE", message, integrationStatus: "UNAVAILABLE" };
  }
  if (/timed out|timeout/i.test(message)) {
    return { code: "TIMEOUT", message, integrationStatus: "TIMEOUT" };
  }
  if (/revert/i.test(message)) {
    return { code: "REVERTED", message, integrationStatus: "OK" };
  }
  return {
    code: "INTEGRATION_ERROR",
    message,
    integrationStatus: "INTEGRATION_ERROR",
  };
}
