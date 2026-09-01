import type {
  GenericExecutionStatus,
  GenericIntegrationStatus,
} from "@parallax/contracts";

export type EvidenceCompleteness = "COMPLETE" | "MISSING" | "UNKNOWN";
export type EconomicBoundaryStatus =
  | "PASS"
  | "FAIL"
  | "NOT_APPLICABLE"
  | "UNKNOWN";
export type Verdict = "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";

/**
 * Legacy provider-integration health vocabulary. This is the historical
 * `integrationStatus` and must stay separate from the generic 5-state
 * provider evaluation status.
 */
export type IntegrationStatus = GenericIntegrationStatus;

export type RuleResult = {
  integrationStatus: IntegrationStatus;
  executionStatus: GenericExecutionStatus;
  evidenceCompleteness: EvidenceCompleteness;
  economicBoundary: EconomicBoundaryStatus;
  verdict: Verdict;
  reasons: string[];
  actions: string[];
};
