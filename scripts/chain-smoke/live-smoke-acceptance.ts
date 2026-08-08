/**
 * Pure acceptance/provenance helpers for the live Kuru smoke harness.
 *
 * Kept separate from kuru-live.ts so they can be unit-tested without importing
 * the live smoke entry (which registers a Vitest case that requires a live
 * RPC).
 */

import {
  MONAD_CHAIN_ID,
  type P0DecisionCandidate,
} from "@parallax/moss-bridge";
import {
  type CompletedRunResult,
  runResultSchema,
} from "../../packages/contracts/src/index.js";

export function completedLiveApiRun(value: unknown): CompletedRunResult | null {
  const parsed = runResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.status !== "completed") return null;
  return parsed.data;
}

/**
 * The /api/check boundary produced a completed authoritative live Run. The API
 * assigns its own Run ID, so identity is proven by authoritative fields rather
 * than runId equality, and a legitimate fail-closed Verdict (e.g. UNKNOWN when
 * no economic boundary is provided) still represents a completed Live Run.
 */
export function apiCheckAcceptanceOf(value: unknown): boolean {
  const run = completedLiveApiRun(value);
  if (!run) return false;
  return (
    run.intent.chainId === Number(MONAD_CHAIN_ID) &&
    run.intent.protocol === "kuru" &&
    run.evidence.every(
      (item) => item.isReplay === false && item.isMock === false,
    ) &&
    run.scope.every((item) => item.status !== "unknown")
  );
}

export type LiveAdapterProvenance = {
  simulatorPinnedBlock?: string;
  observedChainId?: number;
  evidence: { runtimeVersion?: string; runtimeRevision?: string };
};

/**
 * Cross-run provenance between the API Run and the captured adapter result.
 * Two independently created Runs may legitimately pin different base blocks,
 * so provenance requires presence and validity of each side's pin plus
 * matching chain and runtime identity - never string equality of unrelated
 * Run IDs or blocks.
 */
export function apiCheckProvenanceMatchesOf(
  value: unknown,
  adapter: LiveAdapterProvenance,
): boolean {
  const run = completedLiveApiRun(value);
  if (!run) return false;
  const validBlock = (block: string | undefined): boolean =>
    block !== undefined && /^\d+$/.test(block);
  if (!validBlock(run.simulatorPinnedBlock)) return false;
  if (!validBlock(adapter.simulatorPinnedBlock)) return false;
  if (run.intent.chainId !== adapter.observedChainId) return false;
  return run.evidence.some(
    (item) =>
      item.runtimeVersion === adapter.evidence.runtimeVersion &&
      item.runtimeRevision === adapter.evidence.runtimeRevision,
  );
}

/**
 * Independent smoke/product status axis. Unlike p0DecisionCandidate, this
 * field may carry smoke-only labels such as VALID_LIVE_UNKNOWN (technical Live
 * acceptance passed but the canonical product Verdict is not PROCEED).
 */
export type SmokeStatus =
  | "PARTIALLY_VERIFIED"
  | "VALID_LIVE_UNKNOWN"
  | "FAILED";

export function smokeStatusOf(input: {
  integrationStatus: string;
  failedStage?: { stage: string } | null;
  liveSuccess: boolean;
  productProceed: boolean;
}): SmokeStatus {
  if (input.integrationStatus === "TIMEOUT") return "FAILED";
  if (input.failedStage) return "PARTIALLY_VERIFIED";
  if (!input.liveSuccess) return "FAILED";
  return input.productProceed ? "PARTIALLY_VERIFIED" : "VALID_LIVE_UNKNOWN";
}

/**
 * p0DecisionCandidate must stay acceptance-derived and use only the shared
 * P0DecisionCandidate set. When the adapter gate alone says P0_LIVE_READY but
 * the smoke-level boundary checks failed, the run did not clear the smoke gate
 * and is reported as a simulation blocker rather than inventing a fourth
 * candidate.
 */
export function p0CandidateOf(input: {
  liveSuccess: boolean;
  adapterCandidate: P0DecisionCandidate;
}): P0DecisionCandidate {
  if (!input.liveSuccess && input.adapterCandidate === "P0_LIVE_READY") {
    return "P0_LIVE_BLOCKED_SIMULATION";
  }
  return input.adapterCandidate;
}
