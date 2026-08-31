import type {
  GenericExecutionStatus,
  GenericProviderStatus,
} from "@parallax/contracts";

export type EvidenceCompleteness = "COMPLETE" | "MISSING" | "UNKNOWN";
export type EconomicBoundaryStatus =
  | "PASS"
  | "FAIL"
  | "NOT_APPLICABLE"
  | "UNKNOWN";
export type Verdict = "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";

export type RuleResult = {
  integrationStatus: GenericProviderStatus;
  executionStatus: GenericExecutionStatus;
  evidenceCompleteness: EvidenceCompleteness;
  economicBoundary: EconomicBoundaryStatus;
  verdict: Verdict;
  reasons: string[];
  actions: string[];
};
