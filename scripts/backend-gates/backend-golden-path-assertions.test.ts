import { describe, expect, it } from "vitest";
import {
  basicSimulationBindingMatchesRequest,
  evaluateBackendGoldenPathAssertions,
  evaluateExecutionBinding,
  isBasicSimulationCallVerified,
  summarizeBasicSimulation,
} from "./backend-golden-path-assertions.js";

const expectedBinding = {
  chainId: 421614,
  protocol: "camelot-v3",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  tokenIn: "native",
  tokenOut: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  amountInAtomic: "1000000000000000",
};

function basicSimulation(overrides: Record<string, unknown> = {}) {
  return {
    call: {
      status: "SUCCEEDED",
      returnDataFingerprint: `sha256:${"a".repeat(64)}`,
      rawReturnData: "0xprivate",
    },
    gasEstimate: {
      status: "UNAVAILABLE",
      providerPayload: { rpcUrl: "https://secret.invalid" },
    },
    blockNumber: "310131879",
    blockHash: `0x${"b".repeat(64)}`,
    observedAt: "2026-09-27T00:00:00.000Z",
    validityAtExecution: "VALID",
    preparedTransactionFingerprint: `sha256:${"c".repeat(64)}`,
    transactionBinding: {
      ...expectedBinding,
      amountOutMinimumAtomic: "990000000000000",
      router: "0x2222222222222222222222222222222222222222",
      from: expectedBinding.sender,
      to: "0x2222222222222222222222222222222222222222",
      value: "0x38d7ea4c68000",
      dataFingerprint: `sha256:${"d".repeat(64)}`,
      calldata: "0xprivate",
    },
    uncheckedCapabilities: ["receipt"],
    rawPayload: "0xprivate",
    ...overrides,
  };
}

const validPublicSimulation = summarizeBasicSimulation(basicSimulation());
if (validPublicSimulation === undefined)
  throw new Error("Test simulation must be valid after public sanitization");

const completePath = {
  httpStatus: 200,
  runStatus: "completed" as const,
  persistedRunRoundTrip: true,
  historicalReadNoRpc: true,
  explicitRecheckVerified: true,
  basicSimulationCallVerified: true,
  basicSimulationMatchesRequest: true,
  basicSimulationRoundTrip: true,
  basicSimulation: validPublicSimulation,
  simulatorPinnedBlock: "310131879",
  baselineStatus: "AVAILABLE" as const,
  baselineIdentityMatches: true,
  providerEvidenceReachedP0Risk: true,
  providerExecutionVerified: true,
  selectedQuoteRemainsExpectationOnly: true,
  publicSurfaceSafe: true,
  evidenceState: "INCOMPLETE" as const,
  quoteFidelityStatus: "UNKNOWN" as const,
  quoteFidelityReason: "EVIDENCE_NOT_VERIFIED" as const,
  verdict: "UNKNOWN" as const,
  causeStatus: "NOT_VERIFIED" as const,
  unknownScope: ["receipt", "outcome", "assetChanges", "simulation"],
  remediationConfigured: false,
  remediationStatus: "NOT_RUN" as const,
  remediationHasChildRun: false,
};

describe("Backend Golden Path acceptance assertions", () => {
  it("records safe call, gas, block, and transaction identity facts", () => {
    const summary = summarizeBasicSimulation(basicSimulation());

    expect(summary).toMatchObject({
      call: {
        status: "SUCCEEDED",
        returnDataFingerprint: `sha256:${"a".repeat(64)}`,
      },
      gasEstimate: { status: "UNAVAILABLE" },
      blockNumber: "310131879",
      blockHash: `0x${"b".repeat(64)}`,
      preparedTransactionFingerprint: `sha256:${"c".repeat(64)}`,
      transactionBinding: {
        chainId: 421614,
        protocol: "camelot-v3",
        from: "0x1111111111111111111111111111111111111111",
      },
    });
    expect(JSON.stringify(summary)).not.toContain("rawReturnData");
    expect(JSON.stringify(summary)).not.toContain("providerPayload");
    expect(JSON.stringify(summary)).not.toContain("calldata");
    expect(JSON.stringify(summary)).not.toContain("rawPayload");
    expect(isBasicSimulationCallVerified(summary)).toBe(true);
    expect(basicSimulationBindingMatchesRequest(summary, expectedBinding)).toBe(
      true,
    );
  });

  it("does not verify an otherwise valid call bound to another request", () => {
    const changedRequest = basicSimulation({
      transactionBinding: {
        ...(basicSimulation().transactionBinding as Record<string, unknown>),
        amountInAtomic: "2000000000000000",
        value: "0x71afd498d0000",
      },
    });

    expect(isBasicSimulationCallVerified(changedRequest)).toBe(true);
    expect(
      basicSimulationBindingMatchesRequest(changedRequest, expectedBinding),
    ).toBe(false);
  });

  it("does not verify an HTTP-success-shaped result without a successful call identity", () => {
    expect(
      isBasicSimulationCallVerified({
        call: { status: "UNAVAILABLE" },
        gasEstimate: { status: "AVAILABLE", gasUnits: "21000" },
        blockNumber: "42",
        observedAt: "2026-09-27T00:00:00.000Z",
        validityAtExecution: "UNKNOWN",
        preparedTransactionFingerprint: `sha256:${"c".repeat(64)}`,
        uncheckedCapabilities: ["receipt"],
      }),
    ).toBe(false);
  });

  it("accepts a completed path while recording expected fail-closed UNKNOWN", () => {
    const result = evaluateBackendGoldenPathAssertions(completePath);

    expect(result.integrationExercise).toBe("COMPLETE");
    expect(result.gateStatus).toBe("EXERCISE_COMPLETE_REVIEW_REQUIRED");
    expect(result.expectedFailClosedUnknown).toBe(true);
    expect(result.executionBinding).toEqual({
      verified: true,
      level: "NUMBER",
    });
    expect(result.remediation).toEqual({
      configured: false,
      status: "NOT_RUN",
      childLifecycle: "NOT_RUN",
    });
  });

  it("records hash-level binding only when a matching pinned hash is supplied", () => {
    const pinnedHash = `0x${"B".repeat(64)}`;
    const result = evaluateBackendGoldenPathAssertions({
      ...completePath,
      simulatorPinnedBlockHash: pinnedHash,
    });
    expect(result.integrationExercise).toBe("COMPLETE");
    expect(result.executionBinding).toEqual({ verified: true, level: "HASH" });
  });

  it.each([
    [
      "missing simulation",
      undefined,
      "310131879",
      undefined,
      "SIMULATION_MISSING",
    ],
    [
      "malformed simulation",
      { call: null },
      "310131879",
      undefined,
      "SIMULATION_MALFORMED",
    ],
    [
      "UNKNOWN validity",
      { ...validPublicSimulation, validityAtExecution: "UNKNOWN" },
      "310131879",
      undefined,
      "VALIDITY_NOT_VALID",
    ],
    [
      "INVALID validity",
      { ...validPublicSimulation, validityAtExecution: "INVALID" },
      "310131879",
      undefined,
      "VALIDITY_NOT_VALID",
    ],
    [
      "missing execution block",
      { ...validPublicSimulation, blockNumber: undefined },
      "310131879",
      undefined,
      "EXECUTION_BLOCK_MISSING",
    ],
    [
      "malformed execution block",
      { ...validPublicSimulation, blockNumber: "0310131879" },
      "310131879",
      undefined,
      "EXECUTION_BLOCK_MALFORMED",
    ],
    [
      "number mismatch",
      { ...validPublicSimulation, blockNumber: "310131880" },
      "310131879",
      undefined,
      "BLOCK_NUMBER_MISMATCH",
    ],
    [
      "missing execution hash",
      { ...validPublicSimulation, blockHash: undefined },
      "310131879",
      undefined,
      "EXECUTION_HASH_MISSING",
    ],
    [
      "malformed execution hash",
      { ...validPublicSimulation, blockHash: "0x123" },
      "310131879",
      undefined,
      "EXECUTION_HASH_MALFORMED",
    ],
    [
      "pinned hash mismatch",
      validPublicSimulation,
      "310131879",
      `0x${"e".repeat(64)}`,
      "PINNED_HASH_MISMATCH",
    ],
    [
      "missing transaction binding",
      { ...validPublicSimulation, transactionBinding: undefined },
      "310131879",
      undefined,
      "TRANSACTION_BINDING_MISSING",
    ],
    [
      "malformed transaction binding",
      { ...validPublicSimulation, transactionBinding: { chainId: 421614 } },
      "310131879",
      undefined,
      "SIMULATION_MALFORMED",
    ],
    [
      "missing pinned block",
      validPublicSimulation,
      undefined,
      undefined,
      "PINNED_BLOCK_MALFORMED",
    ],
  ] as const)(
    "fails closed on %s",
    (_name, basicSimulation, simulatorPinnedBlock, simulatorPinnedBlockHash, gap) => {
      const result = evaluateBackendGoldenPathAssertions({
        ...completePath,
        basicSimulation,
        simulatorPinnedBlock,
        simulatorPinnedBlockHash,
      });
      expect(result.integrationExercise).toBe("INCOMPLETE");
      expect(result.gateStatus).toBe("NOT_PASS_INTEGRATION_OR_ACCEPTANCE_GAP");
      expect(result.executionBinding).toEqual({
        verified: false,
        level: "NONE",
        gap,
      });
    },
  );

  it("rejects noncanonical pinned numbers and malformed pinned hashes", () => {
    expect(
      evaluateExecutionBinding(validPublicSimulation, "0310131879"),
    ).toMatchObject({ verified: false, gap: "PINNED_BLOCK_MALFORMED" });
    expect(
      evaluateExecutionBinding(validPublicSimulation, "310131879", "0x123"),
    ).toMatchObject({ verified: false, gap: "PINNED_HASH_MALFORMED" });
  });

  it("does not call an incomplete public path a completed exercise", () => {
    const result = evaluateBackendGoldenPathAssertions({
      ...completePath,
      baselineIdentityMatches: false,
    });

    expect(result.integrationExercise).toBe("INCOMPLETE");
    expect(result.gateStatus).toBe("NOT_PASS_INTEGRATION_OR_ACCEPTANCE_GAP");
    expect(result.expectedFailClosedUnknown).toBe(true);
  });

  it("requires a verified live provider handoff and expectation-only baseline", () => {
    const providerGap = evaluateBackendGoldenPathAssertions({
      ...completePath,
      providerExecutionVerified: false,
    });
    const constraintGap = evaluateBackendGoldenPathAssertions({
      ...completePath,
      selectedQuoteRemainsExpectationOnly: false,
    });

    expect(providerGap.integrationExercise).toBe("INCOMPLETE");
    expect(constraintGap.integrationExercise).toBe("INCOMPLETE");
  });

  it("does not treat HTTP/provider success as proof that eth_call executed", () => {
    const result = evaluateBackendGoldenPathAssertions({
      ...completePath,
      basicSimulationCallVerified: false,
    });

    expect(result.integrationExercise).toBe("INCOMPLETE");
    expect(result.gateStatus).toBe("NOT_PASS_INTEGRATION_OR_ACCEPTANCE_GAP");
  });

  it("does not complete the exercise if execution binding differs from the request", () => {
    const result = evaluateBackendGoldenPathAssertions({
      ...completePath,
      basicSimulationMatchesRequest: false,
    });

    expect(result.integrationExercise).toBe("INCOMPLETE");
    expect(result.gateStatus).toBe("NOT_PASS_INTEGRATION_OR_ACCEPTANCE_GAP");
  });

  it("requires basicSimulation facts to survive the public historical read", () => {
    const result = evaluateBackendGoldenPathAssertions({
      ...completePath,
      basicSimulationRoundTrip: false,
    });

    expect(result.integrationExercise).toBe("INCOMPLETE");
    expect(result.gateStatus).toBe("NOT_PASS_INTEGRATION_OR_ACCEPTANCE_GAP");
  });

  it("does not classify a different UNKNOWN reason as the expected evidence gap", () => {
    const result = evaluateBackendGoldenPathAssertions({
      ...completePath,
      quoteFidelityReason: "MISSING_BASELINE",
    });

    expect(result.integrationExercise).toBe("COMPLETE");
    expect(result.expectedFailClosedUnknown).toBe(false);
  });

  it("derives child lifecycle from the observed remediation result", () => {
    const result = evaluateBackendGoldenPathAssertions({
      ...completePath,
      evidenceState: "VERIFIED",
      quoteFidelityStatus: "VERIFIED",
      quoteFidelityReason: undefined,
      verdict: "PROCEED",
      causeStatus: "NOT_VERIFIED",
      remediationConfigured: true,
      remediationStatus: "VERIFIED",
      remediationHasChildRun: true,
    });

    expect(result.expectedFailClosedUnknown).toBe(false);
    expect(result.remediation).toEqual({
      configured: true,
      status: "VERIFIED",
      childLifecycle: "VERIFIED",
    });
  });
});
