import type {
  IntegrationStatus,
  NormalizedKuruEvidence,
} from "@parallax/moss-bridge";

export type EvidenceCompleteness = "COMPLETE" | "MISSING" | "UNKNOWN";
export type EconomicBoundaryStatus =
  | "PASS"
  | "FAIL"
  | "NOT_APPLICABLE"
  | "UNKNOWN";
export type Verdict = "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";

export type RuleResult = {
  integrationStatus: IntegrationStatus;
  executionStatus: NormalizedKuruEvidence["executionStatus"];
  evidenceCompleteness: EvidenceCompleteness;
  economicBoundary: EconomicBoundaryStatus;
  verdict: Verdict;
  reasons: string[];
  actions: string[];
};
