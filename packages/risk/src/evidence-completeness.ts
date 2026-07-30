import type { NormalizedKuruEvidence } from "@parallax/moss-bridge";
import type { EvidenceCompleteness } from "./types.js";

export function evidenceCompleteness(
  evidence: NormalizedKuruEvidence,
): EvidenceCompleteness {
  if (evidence.integrationStatus !== "OK") return "UNKNOWN";
  if (evidence.warnings.value && evidence.warnings.value.length > 0)
    return "MISSING";
  if (
    evidence.quote.value === null ||
    evidence.action.value === null ||
    evidence.blockNumber.value === null
  ) {
    return "MISSING";
  }
  if (
    evidence.executionStatus === "SUCCESS" &&
    (evidence.receipt.value === null || evidence.outcome.value === null)
  ) {
    return "MISSING";
  }
  return "COMPLETE";
}
