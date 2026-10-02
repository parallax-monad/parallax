import { describe, expect, it } from "vitest";
import { isVerifiedArbitrumRemediationPublicationEligible } from "./arbitrum-remediation-publication.js";

describe("Arbitrum verified-remediation publication gate", () => {
  it("does not publish a successful candidate over a canonical UNKNOWN parent", () => {
    expect(
      isVerifiedArbitrumRemediationPublicationEligible({
        projected: { status: "completed", verdict: "UNKNOWN" },
        solver: { status: "VERIFIED" },
      }),
    ).toBe(false);
  });

  it("publishes only a verified candidate for a completed STOP parent", () => {
    expect(
      isVerifiedArbitrumRemediationPublicationEligible({
        projected: { status: "completed", verdict: "STOP" },
        solver: { status: "VERIFIED" },
      }),
    ).toBe(true);
    expect(
      isVerifiedArbitrumRemediationPublicationEligible({
        projected: { status: "completed", verdict: "ADJUST" },
        solver: { status: "VERIFIED" },
      }),
    ).toBe(false);
    expect(
      isVerifiedArbitrumRemediationPublicationEligible({
        projected: { status: "integration_error", verdict: "UNKNOWN" },
        solver: { status: "VERIFIED" },
      }),
    ).toBe(false);
  });
});
