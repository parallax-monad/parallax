import { describe, expect, it } from "vitest";
import { p0BasicSimulationSchema, p0RunResultSchema } from "./index.js";

const verifiedSummary = {
  expectationBaseline: {
    status: "AVAILABLE",
    chainId: 421614,
    protocol: "camelot-v3",
    tokenIn: "native",
    tokenOut: "erc20:usdc",
    amountInAtomic: "1000",
    amountOutAtomic: "490000",
    quoteId: "selected",
    blockNumber: "41",
    observedAt: "2026-09-01T00:00:00.000Z",
    provenance: "rpc",
  },
  quoteFidelity: { status: "UNKNOWN", reason: "MISSING_BASELINE" },
  cause: { status: "NOT_VERIFIED" },
  constraints: [],
  evidenceState: "VERIFIED",
  transactionProtection: { status: "NOT_APPLICABLE" },
  remediation: {
    status: "VERIFIED",
    evaluations: 1,
    parentRunId: "parent",
    childRunId: "child",
    amountInAtomic: "2000",
    amountOutAtomic: "500000",
    quoteId: "candidate",
    verificationBlock: "42",
    verificationTime: "2026-09-01T00:00:00.000Z",
    provenance: "rpc",
    checkedScope: [],
    verificationProof: {
      targetAmountOutAtomic: "490000",
      targetQuoteId: "selected",
      verifiedAmountOutAtomic: "500000",
      resultEvidenceRef: {
        kind: "CROSS_RUN_EVIDENCE",
        runId: "child",
        evidenceId: "output",
      },
    },
  },
};

describe("P0 remediation public proof", () => {
  it("preserves legacy summaries without inventing missing verification proof", () => {
    const { verificationProof: _proof, ...legacy } =
      verifiedSummary.remediation;
    expect(
      p0RunResultSchema.parse({ ...verifiedSummary, remediation: legacy })
        .remediation,
    ).not.toHaveProperty("verificationProof");
  });

  it("requires a complete, target-bound, uint256 actual-output proof when recorded", () => {
    expect(p0RunResultSchema.safeParse(verifiedSummary).success).toBe(true);
    for (const delta of [
      { targetQuoteId: "wrong" },
      { targetAmountOutAtomic: "480000" },
      { verifiedAmountOutAtomic: "490000" },
      { verifiedAmountOutAtomic: "not-an-amount" },
      {
        resultEvidenceRef: {
          kind: "CROSS_RUN_EVIDENCE",
          runId: "other-child",
          evidenceId: "output",
        },
      },
    ]) {
      expect(
        p0RunResultSchema.safeParse({
          ...verifiedSummary,
          remediation: {
            ...verifiedSummary.remediation,
            verificationProof: {
              ...verifiedSummary.remediation.verificationProof,
              ...delta,
            },
          },
        }).success,
      ).toBe(false);
    }
    expect(
      p0RunResultSchema.safeParse({
        ...verifiedSummary,
        remediation: {
          ...verifiedSummary.remediation,
          verificationProof: {
            resultEvidenceRef: {
              kind: "CROSS_RUN_EVIDENCE",
              runId: "child",
              evidenceId: "output",
            },
          },
        },
      }).success,
    ).toBe(false);
  });
});

const fingerprint = `sha256:${"a".repeat(64)}`;
const validBinding = {
  chainId: 421614,
  protocol: "camelot-v3",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  tokenIn: "native",
  tokenOut: "erc20:0xb893e3334d4bd6c5ba8277fd559e99ed683a9fc7",
  amountInAtomic: "1000",
  amountOutMinimumAtomic: "990",
  router: "0x171b925c51565f5d2a7d8c494ba3188d304efd93",
  from: "0x1111111111111111111111111111111111111111",
  to: "0x171b925c51565f5d2a7d8c494ba3188d304efd93",
  value: "0x3e8",
  dataFingerprint: fingerprint,
};

const validSimulation = {
  call: { status: "SUCCEEDED" as const, returnDataFingerprint: fingerprint },
  gasEstimate: { status: "AVAILABLE" as const, gasUnits: "21000" },
  blockNumber: "42",
  blockHash: `0x${"b".repeat(64)}`,
  observedAt: "2026-09-01T00:00:00.000Z",
  validityAtExecution: "VALID" as const,
  preparedTransactionFingerprint: fingerprint,
  transactionBinding: validBinding,
  uncheckedCapabilities: ["receipt"],
};

describe("p0BasicSimulationSchema", () => {
  it("requires proof fields for VALID and observed success statuses", () => {
    expect(p0BasicSimulationSchema.safeParse(validSimulation).success).toBe(
      true,
    );

    const {
      blockHash: _blockHash,
      transactionBinding: _binding,
      ...noValidityProof
    } = validSimulation;
    expect(p0BasicSimulationSchema.safeParse(noValidityProof).success).toBe(
      false,
    );

    expect(
      p0BasicSimulationSchema.safeParse({
        ...validSimulation,
        call: { status: "SUCCEEDED" },
      }).success,
    ).toBe(false);

    expect(
      p0BasicSimulationSchema.safeParse({
        ...validSimulation,
        gasEstimate: { status: "AVAILABLE" },
      }).success,
    ).toBe(false);
  });
});
