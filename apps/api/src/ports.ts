import type { NormalizedSwapIntent } from "@parallax/contracts";
import {
  BackendControlError,
  isBackendControlError,
} from "./backend/control-boundary.js";
import type { MossIntegrationConfig } from "./runtime-config.js";

export type AgentFlowCheckInput = {
  runId: string;
  intent: NormalizedSwapIntent;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  moss: MossIntegrationConfig;
};

/** Identifies the explicit no-runtime state where Live Agent Flow is unavailable. */
export class UnsupportedAgentFlowError extends BackendControlError {
  public readonly name = "UnsupportedAgentFlowError";
  public readonly code = "UNSUPPORTED" as const;

  public constructor() {
    super({
      status: "unsupported",
      code: "UNSUPPORTED",
      message: "The live Agent Flow is not configured",
      retryable: false,
    });
  }
}

export function isUnsupportedAgentFlowError(
  error: unknown,
): error is UnsupportedAgentFlowError {
  return (
    error instanceof UnsupportedAgentFlowError ||
    (isBackendControlError(error) &&
      error.name === "UnsupportedAgentFlowError" &&
      error.status === "unsupported" &&
      error.code === "UNSUPPORTED")
  );
}

/**
 * Backend's minimal caller-side contract with the Jie-owned Agent Flow.
 * Moss output, Trace, orchestration, and Risk internals remain behind this port.
 */
export interface AgentFlowPort {
  check(input: AgentFlowCheckInput): Promise<unknown>;
}

/** Backend-owned caller contract for the pre-check Quote flow. */
export interface QuoteAgentFlowPort {
  quote(input: AgentFlowCheckInput): Promise<unknown>;
}
