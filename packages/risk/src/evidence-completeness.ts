import type { NormalizedKuruEvidence, Sourced } from "@parallax/moss-bridge";
import type { EvidenceCompleteness } from "./types.js";

export function evidenceCompleteness(
  evidence: NormalizedKuruEvidence,
): EvidenceCompleteness {
  if (evidence.integrationStatus !== "OK") return "UNKNOWN";
  if (evidence.simulationCoverage.value?.complete !== true) return "MISSING";
  const alwaysCritical: Sourced<unknown>[] = [
    evidence.quote,
    evidence.action,
    evidence.simulationCoverage,
    evidence.blockNumber,
    evidence.warnings,
  ];
  for (const field of alwaysCritical) {
    if (field.value === null) return "MISSING";
    if (!isTrusted(field)) return "MISSING";
  }

  if (evidence.warnings.value && evidence.warnings.value.length > 0)
    return "MISSING";

  if (
    evidence.executionStatus === "SUCCESS" &&
    (evidence.receipt.value === null || evidence.outcome.value === null)
  ) {
    return "MISSING";
  }

  if (evidence.executionStatus === "SUCCESS") {
    const successCritical: Sourced<unknown>[] = [
      evidence.receipt,
      evidence.outcome,
      evidence.assetChanges,
    ];
    for (const field of successCritical) {
      if (field.value === null) return "MISSING";
      if (!isTrusted(field)) return "MISSING";
    }
    if (
      evidence.assetChangeAssessment !== "EXPLAINED" &&
      evidence.assetChangeAssessment !== "NOT_APPLICABLE"
    ) {
      return "MISSING";
    }
  }

  return "COMPLETE";
}

function isTrusted(field: Sourced<unknown>): boolean {
  return (
    field.source !== "unknown" &&
    field.source !== "mock" &&
    field.reproducibility === "REPRODUCIBLE"
  );
}
