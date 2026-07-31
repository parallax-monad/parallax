import type { NormalizedKuruEvidence } from "@parallax/moss-bridge";

export function executionReason(
  evidence: NormalizedKuruEvidence,
): string | null {
  if (evidence.executionStatus === "NO_ROUTE")
    return "No verified Kuru route was available for this token pair.";
  if (evidence.executionStatus === "REVERTED")
    return "Simulation reverted without a proven wallet-state cause.";
  if (evidence.executionStatus === "UNKNOWN")
    return "Execution evidence is incomplete or contains an unsupported receipt event.";
  return null;
}
