import type { GenericEvidence } from "@parallax/contracts";
import type { EvidenceState } from "@parallax/risk";

/**
 * Closed scope keys whose absence from the current provider observation is
 * material to this slice: the P0 gate consumes this Run's current quote
 * observation only. Receipt, outcome, asset-change, and complete-simulation
 * coverage stay outside the slice and are never required here.
 */
const P0_RESERVED_SCOPE_KEYS: readonly string[] = ["quote"];

/**
 * Conservative Provider-neutral GenericEvidence → P0 `EvidenceState` mapping.
 *
 * Rules are applied in order and the first match wins:
 *  1. explicit Provider / GenericEvidence staleness → `STALE`;
 *  2. Provider integration unavailable, unsupported, failed, or the required
 *     provider observation absent → `UNAVAILABLE`;
 *  3. provider-neutral evidence present but incomplete for this slice
 *     (including a reserved `unknownScope` key) → `INCOMPLETE`;
 *  4. provenance, reproducibility, or the required observation not verifiable
 *     → `UNVERIFIED`;
 *  5. otherwise → `VERIFIED`.
 *
 * `VERIFIED` here means only that the fields this slice's P0 Risk consumes are
 * verified for this Run. It never asserts a complete simulation, a receipt,
 * final outcome, asset-change completeness, or transaction safety. In
 * particular, Native RPC's partial provider surface is never inflated, and
 * receipt/outcome coverage is never required in order to reach `VERIFIED`.
 */
export function backendEvidenceState(evidence: GenericEvidence): EvidenceState {
  if (evidence.provider.status === "STALE") return "STALE";
  if (
    evidence.provider.integrationStatus !== "OK" ||
    evidence.provider.status === "UNSUPPORTED" ||
    evidence.provider.status === "FAILED" ||
    evidence.quote.value === null
  ) {
    return "UNAVAILABLE";
  }
  if (
    evidence.provider.status !== "SUCCESS" ||
    evidence.quote.source !== "quote" ||
    evidence.unknownScope.some((key) => P0_RESERVED_SCOPE_KEYS.includes(key))
  ) {
    return "INCOMPLETE";
  }
  if (
    evidence.provenance.mode !== "LIVE" ||
    evidence.provenance.source === "mock" ||
    evidence.provenance.source === "unknown" ||
    evidence.provenance.source === "external" ||
    evidence.quote.reproducibility !== "REPRODUCIBLE" ||
    evidence.quote.blockNumber === undefined ||
    evidence.quote.fetchedAt === undefined ||
    evidence.provenance.runtime?.runtimeVersion === undefined ||
    evidence.provenance.runtime?.runtimeRevision === undefined
  ) {
    return "UNVERIFIED";
  }
  return "VERIFIED";
}
