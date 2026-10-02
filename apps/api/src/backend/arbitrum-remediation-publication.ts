import type { RunResult } from "@parallax/contracts";
import type { SolverResult } from "@parallax/risk";

/**
 * Keep verified-remediation publication behind the canonical parent STOP
 * result, even if an internal solver candidate is available.
 */
export function isVerifiedArbitrumRemediationPublicationEligible<
  Projected extends Pick<RunResult, "status" | "verdict">,
  Solver extends Pick<SolverResult, "status"> | undefined,
>(input: {
  readonly projected: Projected;
  readonly solver: Solver;
}): input is {
  readonly projected: Projected & {
    readonly status: "completed";
    readonly verdict: "STOP";
  };
  readonly solver: Solver & { readonly status: "VERIFIED" };
} {
  return (
    input.projected.status === "completed" &&
    input.projected.verdict === "STOP" &&
    input.solver?.status === "VERIFIED"
  );
}
