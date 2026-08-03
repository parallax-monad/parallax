import type { NormalizedSwapIntent } from "@parallax/contracts";
import type { MossIntegrationConfig } from "./runtime-config.js";

export type AgentFlowCheckInput = {
  runId: string;
  intent: NormalizedSwapIntent;
  moss: MossIntegrationConfig;
};

/**
 * Backend's minimal caller-side contract with the Jie-owned Agent Flow.
 * Moss output, Trace, orchestration, and Risk internals remain behind this port.
 */
export interface AgentFlowPort {
  check(input: AgentFlowCheckInput): Promise<unknown>;
}
