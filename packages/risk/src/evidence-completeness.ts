import type { EvidenceField, GenericEvidence } from "@parallax/contracts";
import type { EvidenceCompleteness } from "./types.js";

/**
 * Deterministic completeness gate over generic Evidence. Missing or
 * untrusted fields never count as checked; mock/unknown sources and
 * non-reproducible fields fail closed.
 */
export function evidenceCompleteness(
  evidence: GenericEvidence,
): EvidenceCompleteness {
  if (evidence.provider.integrationStatus !== "OK") return "UNKNOWN";
  if (evidence.simulation.value?.complete !== true) return "MISSING";
  const alwaysCritical: EvidenceField<unknown>[] = [
    evidence.quote,
    evidence.action,
    evidence.simulation,
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
    evidence.execution.status === "SUCCESS" &&
    (evidence.receipt.value === null || evidence.outcome.value === null)
  ) {
    return "MISSING";
  }

  if (evidence.execution.status === "SUCCESS") {
    const successCritical: EvidenceField<unknown>[] = [
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

function isTrusted(field: EvidenceField<unknown>): boolean {
  return (
    field.source !== "unknown" &&
    field.source !== "mock" &&
    field.reproducibility === "REPRODUCIBLE"
  );
}
