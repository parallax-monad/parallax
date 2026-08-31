import type { GenericEvidence } from "@parallax/contracts";

export function executionReason(evidence: GenericEvidence): string | null {
  if (evidence.execution.status === "NO_ROUTE")
    return "No verified Kuru route was available for this token pair.";
  if (evidence.execution.status === "REVERTED")
    return "Simulation reverted without a proven wallet-state cause.";
  if (evidence.execution.status === "UNKNOWN")
    return "Execution evidence is incomplete or contains an unsupported receipt event.";
  return null;
}
