import { describe, expect, it } from "vitest";
import {
  type ActionEvaluation,
  actionEvaluationSchema,
  actionVerificationEvidenceSchema,
  assetIdentity,
  checkSwapRequestSchema,
  type EvidenceItem,
  type EvidenceRef,
  evidenceItemSchema,
  genericEvidenceItemSchema,
  normalizedSwapIntentSchema,
  type RuleResult,
  ruleResultSchema,
  runDiffSchema,
  runResultSchema,
  type SimulatedTokenOutEvidence,
  scopeDisclosureSchema,
  serializeJson,
  simulatedTokenOutEvidenceSchema,
} from "./index.js";

const sender = "0x1111111111111111111111111111111111111111";
const otherRecipient = "0x2222222222222222222222222222222222222222";
const usdc = {
  kind: "erc20" as const,
  address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
};
const otherToken = {
  kind: "erc20" as const,
  address: "0x3333333333333333333333333333333333333333",
};
const mon = { kind: "native" as const };

const baseRequest = {
  chainId: 143,
  protocol: "kuru" as const,
  sender,
  tokenIn: mon,
  tokenOut: usdc,
  amountIn: "1.5",
  economicBoundary: {
    availability: "unavailable" as const,
    source: "unavailable" as const,
  },
};

const normalizedIntent = {
  chainId: 143,
  protocol: "kuru" as const,
  sender,
  recipient: sender,
  recipientSource: "defaulted_from_sender" as const,
  tokenIn: mon,
  tokenOut: usdc,
  amountInAtomic: "1500000000000000000",
  economicBoundary: {
    availability: "unavailable" as const,
    source: "unavailable" as const,
  },
};

const availableIntent = {
  ...normalizedIntent,
  economicBoundary: {
    availability: "available" as const,
    minimumReceivedAtomic: "20000000",
    source: "user_declared" as const,
  },
};

const simulationCoverageEvidence = {
  kind: "generic" as const,
  key: "simulation-coverage",
  status: "confirmed" as const,
  summary: "Simulation coverage is complete",
  source: "moss" as const,
  stage: "SIMULATE" as const,
  blockNumber: "12345",
  runtimeVersion: "moss-v1",
  runtimeRevision: "revision-1",
  fixtureId: "fixture-live-1",
  isReplay: false,
  isMock: false,
};

const actionVerificationEvidence = {
  kind: "action_verification" as const,
  key: "protocol-action-verification",
  status: "confirmed" as const,
  summary: "A rerun verified an alternative protocol path",
  source: "derived" as const,
  stage: "QUOTE" as const,
  runtimeVersion: "moss-v1",
  runtimeRevision: "revision-1",
  fixtureId: "fixture-live-1",
  isReplay: false,
  isMock: false,
  field: "protocol" as const,
  actionReasonCode: "ALTERNATIVE_PATH_VERIFIED" as const,
  baselineRunId: "run-1",
  verificationRunId: "run-2",
  beforeValue: "kuru",
  afterValue: "pancake",
  resultEvidenceKey: simulationCoverageEvidence.key,
};

function simulatedOutput(
  amountReceivedAtomic: string,
  overrides: Partial<SimulatedTokenOutEvidence> = {},
): SimulatedTokenOutEvidence {
  return {
    kind: "simulated_token_out" as const,
    key: "simulated-token-out",
    status: "confirmed" as const,
    summary: "Recipient tokenOut balance delta",
    source: "derived" as const,
    stage: "SIMULATE" as const,
    blockNumber: "12345",
    runtimeVersion: "moss-v1",
    runtimeRevision: "revision-1",
    fixtureId: "fixture-live-1",
    isReplay: false,
    isMock: false,
    tokenOut: usdc,
    recipient: sender,
    amountReceivedAtomic,
    derivation: "recipient_balance_delta" as const,
    ...overrides,
  };
}

function evidenceRef(evidence: EvidenceItem): EvidenceRef {
  return {
    key: evidence.key,
    source: evidence.source,
    stage: evidence.stage,
    blockNumber: evidence.blockNumber,
    runtimeVersion: evidence.runtimeVersion,
    runtimeRevision: evidence.runtimeRevision,
    fixtureId: evidence.fixtureId,
    isReplay: evidence.isReplay,
    isMock: evidence.isMock,
  };
}

const unavailableEconomicRule: RuleResult = {
  ruleId: "P0-ECONOMIC-001",
  status: "NOT_APPLICABLE",
  applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
  evidenceRefs: [],
  actionEvaluations: [],
};

const completedResult = {
  runId: "run-1",
  replayMode: false,
  intent: normalizedIntent,
  status: "completed",
  systemStatus: "OK",
  verdict: "UNKNOWN",
  summary: "The economic boundary was not provided.",
  ruleResults: [unavailableEconomicRule],
  recommendedActions: [],
  irrelevantActions: [],
  evidence: [simulationCoverageEvidence],
  scope: [
    {
      key: "P0-ECONOMIC-001",
      label: "Economic result",
      status: "not_checked",
      reason: "PRECONDITION_ABSENT",
    },
    {
      key: "OUTSIDE_P0_SCOPE",
      label: "Complete protocol security",
      status: "not_checked",
      reason: "OUTSIDE_P0_SCOPE",
    },
  ],
  route: {
    availability: "available",
    protocol: "kuru",
    path: [mon, usdc],
    source: "quote",
    blockNumber: "12345",
  },
};

function economicRun(
  status: "PASS" | "FAIL",
  amountReceivedAtomic: string,
  overrides: Record<string, unknown> = {},
) {
  const output = simulatedOutput(amountReceivedAtomic);
  const rule: RuleResult =
    status === "PASS"
      ? {
          ruleId: "P0-ECONOMIC-001",
          status,
          evidenceRefs: [evidenceRef(output)],
          actionEvaluations: [],
        }
      : {
          ruleId: "P0-ECONOMIC-001",
          status,
          reasonCode: "OUTPUT_BELOW_BOUNDARY",
          evidenceRefs: [evidenceRef(output)],
          actionEvaluations: [],
        };

  return {
    ...completedResult,
    intent: availableIntent,
    evidence: [simulationCoverageEvidence, output],
    ruleResults: [rule],
    scope: scopeWithCheckedEconomic,
    ...overrides,
  };
}

const scopeWithCheckedEconomic = completedResult.scope.map((item) =>
  item.key === "P0-ECONOMIC-001"
    ? { ...item, status: "checked" as const, reason: undefined }
    : item,
);

const scopeWithUnknownExecution = [
  ...completedResult.scope,
  {
    key: "P0-EXECUTION-001" as const,
    label: "Execution result",
    status: "unknown" as const,
    reason: "CLASSIFICATION_INCOMPLETE" as const,
  },
];

describe("checkSwapRequestSchema", () => {
  it("accepts an exact-input native-to-token request", () => {
    expect(checkSwapRequestSchema.parse(baseRequest)).toEqual(baseRequest);
  });

  it("accepts a user-declared public Economic Boundary", () => {
    const request = {
      ...baseRequest,
      economicBoundary: {
        availability: "available",
        minimumReceived: "20",
        source: "user_declared",
      },
    };

    expect(checkSwapRequestSchema.parse(request)).toEqual(request);
  });

  it.each(["original_swap", "demo_preset"])(
    "rejects trusted-only source %s at the public boundary",
    (source) => {
      expect(
        checkSwapRequestSchema.safeParse({
          ...baseRequest,
          economicBoundary: {
            availability: "available",
            minimumReceived: "20",
            source,
          },
        }).success,
      ).toBe(false);
    },
  );

  it("rejects swapping an asset to itself", () => {
    expect(
      checkSwapRequestSchema.safeParse({
        ...baseRequest,
        tokenIn: usdc,
        tokenOut: {
          ...usdc,
          address: usdc.address.toUpperCase().replace("0X", "0x"),
        },
      }).success,
    ).toBe(false);
  });

  it("rejects client-supplied token metadata or atomic units", () => {
    expect(
      checkSwapRequestSchema.safeParse({
        ...baseRequest,
        tokenOut: { ...usdc, symbol: "USDC", decimals: 6 },
      }).success,
    ).toBe(false);
    expect(
      checkSwapRequestSchema.safeParse({
        ...baseRequest,
        amountInAtomic: "1500000000000000000",
      }).success,
    ).toBe(false);
  });

  it("requires a complete discriminated Economic Boundary", () => {
    const { economicBoundary: _boundary, ...withoutBoundary } = baseRequest;
    expect(checkSwapRequestSchema.safeParse(withoutBoundary).success).toBe(
      false,
    );
    expect(
      checkSwapRequestSchema.safeParse({
        ...baseRequest,
        economicBoundary: {
          availability: "available",
          source: "user_declared",
        },
      }).success,
    ).toBe(false);
    expect(
      checkSwapRequestSchema.safeParse({
        ...baseRequest,
        economicBoundary: {
          availability: "unavailable",
          source: "unavailable",
          minimumReceived: "20",
        },
      }).success,
    ).toBe(false);
  });
});

describe("asset and normalized intent contracts", () => {
  it("normalizes asset identity by chain and address casing", () => {
    const upperCaseUsdc = {
      ...usdc,
      address: usdc.address.toUpperCase().replace("0X", "0x"),
    };

    expect(assetIdentity({ chainId: 143, asset: usdc })).toBe(
      assetIdentity({ chainId: 143, asset: upperCaseUsdc }),
    );
    expect(assetIdentity({ chainId: 143, asset: usdc })).not.toBe(
      assetIdentity({ chainId: 1, asset: usdc }),
    );
  });

  it("uses atomic units and permits trusted internal boundary sources", () => {
    expect(normalizedSwapIntentSchema.parse(normalizedIntent)).toEqual(
      normalizedIntent,
    );
    expect(
      normalizedSwapIntentSchema.safeParse({
        ...availableIntent,
        economicBoundary: {
          ...availableIntent.economicBoundary,
          source: "original_swap",
        },
      }).success,
    ).toBe(true);
    expect(
      normalizedSwapIntentSchema.safeParse({
        ...normalizedIntent,
        amountIn: "1.5",
      }).success,
    ).toBe(false);
  });
});

describe("Evidence provenance contracts", () => {
  it("requires Replay and Mock provenance explicitly", () => {
    const { isReplay: _isReplay, ...withoutReplay } =
      simulationCoverageEvidence;
    expect(evidenceItemSchema.safeParse(withoutReplay).success).toBe(false);

    expect(
      evidenceItemSchema.safeParse({
        ...simulationCoverageEvidence,
        source: "mock",
        isMock: false,
      }).success,
    ).toBe(false);
  });

  it("represents a complete zero-amount simulated tokenOut result", () => {
    expect(evidenceItemSchema.parse(simulatedOutput("0"))).toMatchObject({
      kind: "simulated_token_out",
      amountReceivedAtomic: "0",
      stage: "SIMULATE",
    });
  });

  it("rejects mock simulated tokenOut Evidence", () => {
    expect(
      evidenceItemSchema.safeParse(
        simulatedOutput("20000000", { isMock: true }),
      ).success,
    ).toBe(false);
  });

  it("enforces Mock provenance at every public Evidence schema entry", () => {
    expect(
      genericEvidenceItemSchema.safeParse({
        ...simulationCoverageEvidence,
        source: "mock",
        isMock: false,
      }).success,
    ).toBe(false);
    expect(
      simulatedTokenOutEvidenceSchema.safeParse(
        simulatedOutput("20000000", { isMock: true }),
      ).success,
    ).toBe(false);
  });

  it("requires output-improvement verification to preserve the boundary", () => {
    expect(
      actionVerificationEvidenceSchema.safeParse({
        ...actionVerificationEvidence,
        field: "amountIn",
        actionReasonCode: "OUTPUT_IMPROVEMENT_VERIFIED",
        baselineBoundaryAtomic: "20000000",
        verificationBoundaryAtomic: "19000000",
      }).success,
    ).toBe(false);
    expect(
      actionVerificationEvidenceSchema.safeParse({
        ...actionVerificationEvidence,
        field: "amountIn",
        actionReasonCode: "OUTPUT_IMPROVEMENT_VERIFIED",
        baselineBoundaryAtomic: "20000000",
        verificationBoundaryAtomic: "20000000",
      }).success,
    ).toBe(true);
  });
});

describe("RuleResult contract", () => {
  it("separates local Rule status from the global Verdict", () => {
    const output = simulatedOutput("19000000");
    const result = ruleResultSchema.parse({
      ruleId: "P0-ECONOMIC-001",
      status: "FAIL",
      reasonCode: "OUTPUT_BELOW_BOUNDARY",
      evidenceRefs: [evidenceRef(output)],
      actionEvaluations: [],
    });

    expect(result.status).toBe("FAIL");
    expect("verdict" in result).toBe(false);
  });

  it("enforces status-specific reason and applicability codes", () => {
    expect(
      ruleResultSchema.safeParse({
        ...unavailableEconomicRule,
        status: "FAIL",
      }).success,
    ).toBe(false);
    expect(
      ruleResultSchema.safeParse({
        ...unavailableEconomicRule,
        applicabilityReasonCode: undefined,
      }).success,
    ).toBe(false);
    expect(
      ruleResultSchema.safeParse({
        ...unavailableEconomicRule,
        status: "PASS",
        evidenceRefs: [],
      }).success,
    ).toBe(false);
  });

  it.each(["P0-EVIDENCE-001", "P0-EXECUTION-001"] as const)(
    "rejects NOT_APPLICABLE for non-economic Rule %s",
    (ruleId) => {
      expect(
        ruleResultSchema.safeParse({
          ruleId,
          status: "NOT_APPLICABLE",
          applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
          evidenceRefs: [],
          actionEvaluations: [],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects reason codes owned by a different Rule", () => {
    expect(
      ruleResultSchema.safeParse({
        ruleId: "P0-ECONOMIC-001",
        status: "UNKNOWN",
        reasonCode: "NO_ROUTE_FOUND",
        evidenceRefs: [],
        actionEvaluations: [],
      }).success,
    ).toBe(false);
    expect(
      ruleResultSchema.safeParse({
        ruleId: "P0-EXECUTION-001",
        status: "FAIL",
        reasonCode: "OUTPUT_BELOW_BOUNDARY",
        evidenceRefs: [evidenceRef(simulationCoverageEvidence)],
        actionEvaluations: [],
      }).success,
    ).toBe(false);
  });
});

describe("ActionEvaluation contract", () => {
  const reference = evidenceRef(simulationCoverageEvidence);

  it("preserves UNKNOWN action relevance without recommending it", () => {
    const evaluation = actionEvaluationSchema.parse({
      id: "unknown-slippage",
      action: { kind: "TRANSACTION_ADJUSTMENT", field: "slippage" },
      relevance: "UNKNOWN",
      recommendable: false,
      actionReasonCode: "EFFECT_NOT_VERIFIED",
      evidenceRefs: [],
    });

    expect(evaluation.relevance).toBe("UNKNOWN");
  });

  it("requires stable identity and a concrete change for public transaction actions", () => {
    expect(
      actionEvaluationSchema.safeParse({
        id: "protocol-without-change",
        action: { kind: "TRANSACTION_ADJUSTMENT", field: "protocol" },
        relevance: "RELEVANT",
        recommendable: true,
        actionReasonCode: "ALTERNATIVE_PATH_VERIFIED",
        evidenceRefs: [reference],
      }).success,
    ).toBe(false);

    expect(
      actionEvaluationSchema.safeParse({
        id: "protocol-change",
        action: { kind: "TRANSACTION_ADJUSTMENT", field: "protocol" },
        relevance: "RELEVANT",
        recommendable: true,
        actionReasonCode: "ALTERNATIVE_PATH_VERIFIED",
        evidenceRefs: [reference],
        proposedChange: {
          field: "protocol",
          before: "kuru",
          after: "pancake",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects recommendable UNKNOWN and IRRELEVANT actions", () => {
    for (const relevance of ["UNKNOWN", "IRRELEVANT"] as const) {
      expect(
        actionEvaluationSchema.safeParse({
          id: `unrecommendable-${relevance.toLowerCase()}`,
          action: { kind: "TRANSACTION_ADJUSTMENT", field: "amountIn" },
          relevance,
          recommendable: true,
          actionReasonCode: "EFFECT_NOT_VERIFIED",
          evidenceRefs: [reference],
        }).success,
      ).toBe(false);
    }
  });

  it("rejects a recommendation whose reason says its effect is unverified", () => {
    expect(
      actionEvaluationSchema.safeParse({
        id: "unverified-protocol",
        action: { kind: "TRANSACTION_ADJUSTMENT", field: "protocol" },
        relevance: "RELEVANT",
        recommendable: true,
        actionReasonCode: "EFFECT_NOT_VERIFIED",
        evidenceRefs: [reference],
      }).success,
    ).toBe(false);
  });

  it("requires verification Evidence for IRRELEVANT actions", () => {
    expect(
      actionEvaluationSchema.safeParse({
        id: "irrelevant-slippage",
        action: { kind: "TRANSACTION_ADJUSTMENT", field: "slippage" },
        relevance: "IRRELEVANT",
        recommendable: false,
        actionReasonCode: "CANNOT_CREATE_MISSING_ROUTE",
        evidenceRefs: [],
      }).success,
    ).toBe(false);
  });

  it("distinguishes system recovery and acceptance-boundary changes", () => {
    expect(
      actionEvaluationSchema.safeParse({
        id: "retry-check",
        action: { kind: "SYSTEM_RECOVERY", action: "RETRY_CHECK" },
        relevance: "RELEVANT",
        recommendable: true,
        actionReasonCode: "RESTORES_CHECK_ONLY",
        evidenceRefs: [reference],
      }).success,
    ).toBe(true);

    expect(
      actionEvaluationSchema.safeParse({
        id: "boundary-change",
        action: {
          kind: "ACCEPTANCE_BOUNDARY_CHANGE",
          field: "minimumReceived",
        },
        relevance: "RELEVANT",
        recommendable: true,
        actionReasonCode: "CHANGES_ACCEPTANCE_BOUNDARY_ONLY",
        evidenceRefs: [reference],
      }).success,
    ).toBe(false);
  });
});

describe("completed Run Result contract", () => {
  it("accepts the explicit unavailable Economic Rule state", () => {
    const result = runResultSchema.parse(completedResult);
    expect(result.status).toBe("completed");
    expect(result.ruleResults[0]?.status).toBe("NOT_APPLICABLE");
  });

  it("requires RuleResult and Rule-bound Scope to agree in both directions", () => {
    const mismatchedScope = completedResult.scope.map((item) =>
      item.key === "P0-ECONOMIC-001"
        ? { ...item, status: "checked" as const, reason: undefined }
        : item,
    );
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        scope: mismatchedScope,
      }).success,
    ).toBe(false);

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        scope: [
          ...completedResult.scope,
          {
            key: "P0-EXECUTION-001" as const,
            label: "Execution result",
            status: "checked" as const,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("preserves Economic FAIL independently from the global Verdict", () => {
    const result = runResultSchema.parse(economicRun("FAIL", "19000000"));
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.ruleResults[0]?.status).toBe("FAIL");
  });

  it("requires a complete Simulation result for Economic PASS/FAIL", () => {
    const quoteEvidence: EvidenceItem = {
      ...simulationCoverageEvidence,
      key: "quote-output",
      source: "quote",
      stage: "QUOTE",
      summary: "Quote estimated output",
    };
    const rule: RuleResult = {
      ruleId: "P0-ECONOMIC-001",
      status: "FAIL",
      reasonCode: "OUTPUT_BELOW_BOUNDARY",
      evidenceRefs: [evidenceRef(quoteEvidence)],
      actionEvaluations: [],
    };

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        intent: availableIntent,
        evidence: [quoteEvidence],
        ruleResults: [rule],
      }).success,
    ).toBe(false);
  });

  it("requires matching tokenOut, recipient, and comparison status", () => {
    const mismatches = [
      { tokenOut: otherToken },
      { recipient: otherRecipient },
      { amountReceivedAtomic: "21000000" },
    ];

    for (const mismatch of mismatches) {
      const output = simulatedOutput("19000000", mismatch);
      const rule: RuleResult = {
        ruleId: "P0-ECONOMIC-001",
        status: "FAIL",
        reasonCode: "OUTPUT_BELOW_BOUNDARY",
        evidenceRefs: [evidenceRef(output)],
        actionEvaluations: [],
      };
      expect(
        runResultSchema.safeParse({
          ...completedResult,
          intent: availableIntent,
          evidence: [output],
          ruleResults: [rule],
        }).success,
      ).toBe(false);
    }
  });

  it.each(["PASS", "FAIL", "UNKNOWN"] as const)(
    "rejects unavailable Economic Boundary with %s",
    (status) => {
      const rule =
        status === "PASS"
          ? {
              ...unavailableEconomicRule,
              status,
              applicabilityReasonCode: undefined,
              evidenceRefs: [evidenceRef(simulationCoverageEvidence)],
            }
          : {
              ...unavailableEconomicRule,
              status,
              applicabilityReasonCode: undefined,
              reasonCode:
                status === "FAIL"
                  ? "OUTPUT_BELOW_BOUNDARY"
                  : "SIMULATED_OUTPUT_UNAVAILABLE",
            };

      expect(
        runResultSchema.safeParse({
          ...completedResult,
          ruleResults: [rule],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects generic Evidence as a trusted no-route terminal result", () => {
    const noRouteEvidence = {
      ...simulationCoverageEvidence,
      key: "no-route",
      stage: "QUOTE" as const,
      summary: "Moss returned a classified no-route result",
    };
    const terminalExecutionRule: RuleResult = {
      ruleId: "P0-EXECUTION-001",
      status: "FAIL",
      reasonCode: "NO_ROUTE_FOUND",
      evidenceRefs: [evidenceRef(noRouteEvidence)],
      actionEvaluations: [],
    };

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        intent: availableIntent,
        evidence: [noRouteEvidence],
        route: {
          availability: "unavailable",
          reason: "No route is available for this intent",
        },
        ruleResults: [
          {
            ...unavailableEconomicRule,
            applicabilityReasonCode: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
          },
          terminalExecutionRule,
        ],
      }).success,
    ).toBe(false);
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        intent: availableIntent,
        ruleResults: [
          {
            ...unavailableEconomicRule,
            applicabilityReasonCode: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("permits terminal Economic applicability with structured no-route Evidence", () => {
    const rawEvidence = {
      ...simulationCoverageEvidence,
      kind: "no_route_raw_output" as const,
      key: "raw-no-route",
      stage: "QUOTE" as const,
      summary: "Raw Moss quote returned no route",
      payloadFingerprint: `sha256:${"a".repeat(64)}`,
    };
    const classificationEvidence = {
      kind: "no_route_classification" as const,
      key: "classified-no-route",
      status: "confirmed" as const,
      summary: "Raw Moss output normalized to NO_ROUTE",
      source: "derived" as const,
      stage: "QUOTE" as const,
      runtimeVersion: "moss-v1",
      runtimeRevision: "revision-1",
      fixtureId: "fixture-live-1",
      isReplay: false,
      isMock: false,
      protocol: "kuru" as const,
      chainId: 143,
      sender,
      recipient: sender,
      tokenIn: mon,
      tokenOut: usdc,
      amountInAtomic: availableIntent.amountInAtomic,
      rawEvidenceKey: rawEvidence.key,
      normalizedCode: "NO_ROUTE" as const,
      integrationStatus: "OK" as const,
    };
    const terminalExecutionRule: RuleResult = {
      ruleId: "P0-EXECUTION-001",
      status: "FAIL",
      reasonCode: "NO_ROUTE_FOUND",
      evidenceRefs: [
        evidenceRef(classificationEvidence),
        evidenceRef(rawEvidence),
      ],
      actionEvaluations: [],
    };

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        intent: availableIntent,
        evidence: [classificationEvidence, rawEvidence],
        route: {
          availability: "unavailable",
          reason: "No route is available for this intent",
        },
        scope: [
          {
            key: "P0-ECONOMIC-001",
            label: "Economic result",
            status: "not_checked",
            reason: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
          },
          {
            key: "P0-EXECUTION-001",
            label: "Execution result",
            status: "checked",
          },
          {
            key: "OUTSIDE_P0_SCOPE",
            label: "Complete protocol security",
            status: "not_checked",
            reason: "OUTSIDE_P0_SCOPE",
          },
        ],
        ruleResults: [
          {
            ...unavailableEconomicRule,
            applicabilityReasonCode: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
          },
          terminalExecutionRule,
        ],
      }).success,
    ).toBe(true);

    const warningRawEvidence = {
      ...rawEvidence,
      status: "warning" as const,
    };
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        intent: availableIntent,
        evidence: [classificationEvidence, warningRawEvidence],
        route: {
          availability: "unavailable",
          reason: "No route is available for this intent",
        },
        ruleResults: [
          {
            ...unavailableEconomicRule,
            applicabilityReasonCode: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
          },
          {
            ...terminalExecutionRule,
            evidenceRefs: [
              evidenceRef(classificationEvidence),
              evidenceRef(rawEvidence),
            ],
          },
        ],
      }).success,
    ).toBe(false);

    const externalRawEvidence = {
      ...simulationCoverageEvidence,
      key: rawEvidence.key,
      stage: "QUOTE" as const,
      summary: "External disclosure claims no route",
      source: "external" as const,
    };
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        intent: availableIntent,
        evidence: [
          classificationEvidence,
          externalRawEvidence,
          simulationCoverageEvidence,
        ],
        route: {
          availability: "unavailable",
          reason: "No route is available for this intent",
        },
        ruleResults: [
          {
            ...unavailableEconomicRule,
            applicabilityReasonCode: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
          },
          {
            ...terminalExecutionRule,
            evidenceRefs: [
              evidenceRef(classificationEvidence),
              evidenceRef(externalRawEvidence),
              evidenceRef(simulationCoverageEvidence),
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("matches simulated output to an explicit intended recipient", () => {
    const output = simulatedOutput("20000000", {
      recipient: otherRecipient,
    });
    const rule: RuleResult = {
      ruleId: "P0-ECONOMIC-001",
      status: "PASS",
      evidenceRefs: [evidenceRef(output)],
      actionEvaluations: [],
    };

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        intent: {
          ...availableIntent,
          recipient: otherRecipient,
          recipientSource: "explicit",
        },
        evidence: [output],
        scope: scopeWithCheckedEconomic,
        ruleResults: [rule],
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate Evidence keys, Rule IDs, and dangling references", () => {
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        evidence: [
          simulationCoverageEvidence,
          { ...simulationCoverageEvidence },
        ],
      }).success,
    ).toBe(false);
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        ruleResults: [unavailableEconomicRule, { ...unavailableEconomicRule }],
      }).success,
    ).toBe(false);
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        ruleResults: [
          {
            ...unavailableEconomicRule,
            evidenceRefs: [
              {
                ...evidenceRef(simulationCoverageEvidence),
                key: "missing-evidence",
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate stable Action IDs across RuleResults", () => {
    const duplicateAction: ActionEvaluation = {
      id: "duplicate-action-id",
      action: { kind: "SYSTEM_RECOVERY", action: "RETRY_CHECK" },
      relevance: "UNKNOWN",
      recommendable: false,
      actionReasonCode: "EFFECT_NOT_VERIFIED",
      evidenceRefs: [],
    };
    const executionRule: RuleResult = {
      ruleId: "P0-EXECUTION-001",
      status: "UNKNOWN",
      reasonCode: "RULE_CLASSIFICATION_NOT_VERIFIED",
      evidenceRefs: [],
      actionEvaluations: [duplicateAction],
    };
    const evidenceRule: RuleResult = {
      ruleId: "P0-EVIDENCE-001",
      status: "UNKNOWN",
      reasonCode: "CRITICAL_EVIDENCE_MISSING",
      evidenceRefs: [],
      actionEvaluations: [{ ...duplicateAction }],
    };

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        scope: [
          ...scopeWithUnknownExecution,
          {
            key: "P0-EVIDENCE-001" as const,
            label: "Evidence result",
            status: "unknown" as const,
            reason: "REQUIRED_EVIDENCE_UNAVAILABLE" as const,
          },
        ],
        ruleResults: [unavailableEconomicRule, executionRule, evidenceRule],
      }).success,
    ).toBe(false);
  });

  it("rejects a defaulted recipient that diverges from sender", () => {
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        intent: {
          ...normalizedIntent,
          recipient: otherRecipient,
          recipientSource: "defaulted_from_sender",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects Evidence references with altered provenance", () => {
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        ruleResults: [
          {
            ...unavailableEconomicRule,
            evidenceRefs: [
              {
                ...evidenceRef(simulationCoverageEvidence),
                runtimeRevision: "different-revision",
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each(["mock", "unknown", "external"] as const)(
    "rejects %s Evidence as support for core PASS",
    (source) => {
      const evidence: EvidenceItem = {
        ...simulationCoverageEvidence,
        source,
        isMock: source === "mock",
      };
      const rule: RuleResult = {
        ruleId: "P0-EVIDENCE-001",
        status: "PASS",
        evidenceRefs: [evidenceRef(evidence)],
        actionEvaluations: [],
      };

      expect(
        runResultSchema.safeParse({
          ...completedResult,
          evidence: [evidence],
          ruleResults: [unavailableEconomicRule, rule],
        }).success,
      ).toBe(false);
    },
  );

  it("allows External disclosure alongside independently sufficient Evidence", () => {
    const output = simulatedOutput("20000000");
    const externalEvidence: EvidenceItem = {
      ...simulationCoverageEvidence,
      key: "external-disclosure",
      source: "external",
      summary: "Supplementary external disclosure",
    };
    const rule: RuleResult = {
      ruleId: "P0-ECONOMIC-001",
      status: "PASS",
      evidenceRefs: [evidenceRef(output), evidenceRef(externalEvidence)],
      actionEvaluations: [],
    };

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        intent: availableIntent,
        evidence: [output, externalEvidence],
        scope: scopeWithCheckedEconomic,
        ruleResults: [rule],
      }).success,
    ).toBe(true);
  });

  it("enforces Replay Evidence provenance and demo-preset scope", () => {
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        evidence: [{ ...simulationCoverageEvidence, isReplay: true }],
      }).success,
    ).toBe(false);

    const replayOutput = simulatedOutput("20000000", { isReplay: true });
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        replayMode: true,
        intent: {
          ...availableIntent,
          economicBoundary: {
            ...availableIntent.economicBoundary,
            source: "demo_preset",
          },
        },
        evidence: [replayOutput],
        scope: scopeWithCheckedEconomic,
        ruleResults: [
          {
            ruleId: "P0-ECONOMIC-001",
            status: "PASS",
            evidenceRefs: [evidenceRef(replayOutput)],
            actionEvaluations: [],
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        intent: {
          ...availableIntent,
          economicBoundary: {
            ...availableIntent.economicBoundary,
            source: "demo_preset",
          },
        },
        ruleResults: [
          {
            ...unavailableEconomicRule,
            applicabilityReasonCode: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("filters public actions through their Rule ActionEvaluation", () => {
    const reference = evidenceRef(simulationCoverageEvidence);
    const verificationReference = evidenceRef(actionVerificationEvidence);
    const recommended: ActionEvaluation = {
      id: "recommend-protocol",
      action: { kind: "TRANSACTION_ADJUSTMENT", field: "protocol" },
      relevance: "RELEVANT",
      recommendable: true,
      actionReasonCode: "ALTERNATIVE_PATH_VERIFIED",
      evidenceRefs: [verificationReference, reference],
      proposedChange: {
        field: "protocol",
        before: "kuru",
        after: "pancake",
      },
    };
    const irrelevant: ActionEvaluation = {
      id: "boundary-is-irrelevant",
      action: {
        kind: "ACCEPTANCE_BOUNDARY_CHANGE",
        field: "minimumReceived",
      },
      relevance: "IRRELEVANT",
      recommendable: false,
      actionReasonCode: "CHANGES_ACCEPTANCE_BOUNDARY_ONLY",
      evidenceRefs: [reference],
    };
    const executionRule: RuleResult = {
      ruleId: "P0-EXECUTION-001",
      status: "UNKNOWN",
      reasonCode: "RULE_CLASSIFICATION_NOT_VERIFIED",
      evidenceRefs: [reference],
      actionEvaluations: [recommended, irrelevant],
    };

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        evidence: [simulationCoverageEvidence, actionVerificationEvidence],
        scope: scopeWithUnknownExecution,
        ruleResults: [unavailableEconomicRule, executionRule],
        recommendedActions: [recommended],
        irrelevantActions: [irrelevant],
      }).success,
    ).toBe(true);

    const mismatchedPublicProjection: ActionEvaluation = {
      ...recommended,
      proposedChange: {
        field: "protocol",
        before: "kuru",
        after: "sushi",
      },
    };
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        evidence: [simulationCoverageEvidence, actionVerificationEvidence],
        scope: scopeWithUnknownExecution,
        ruleResults: [unavailableEconomicRule, executionRule],
        recommendedActions: [mismatchedPublicProjection],
        irrelevantActions: [irrelevant],
      }).success,
    ).toBe(false);

    const wrongBoundaryReason: ActionEvaluation = {
      ...irrelevant,
      actionReasonCode: "CANNOT_CREATE_MISSING_ROUTE",
    };
    const wrongBoundaryRule: RuleResult = {
      ...executionRule,
      actionEvaluations: [recommended, wrongBoundaryReason],
    };
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        evidence: [simulationCoverageEvidence, actionVerificationEvidence],
        scope: scopeWithUnknownExecution,
        ruleResults: [unavailableEconomicRule, wrongBoundaryRule],
        recommendedActions: [recommended],
        irrelevantActions: [wrongBoundaryReason],
      }).success,
    ).toBe(false);

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        recommendedActions: [recommended],
      }).success,
    ).toBe(false);

    const conflictingIrrelevant: ActionEvaluation = {
      ...recommended,
      relevance: "IRRELEVANT",
      recommendable: false,
      actionReasonCode: "CANNOT_CREATE_MISSING_ROUTE",
    };
    const evidenceRule: RuleResult = {
      ruleId: "P0-EVIDENCE-001",
      status: "UNKNOWN",
      reasonCode: "CRITICAL_EVIDENCE_MISSING",
      evidenceRefs: [reference],
      actionEvaluations: [conflictingIrrelevant],
    };
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        ruleResults: [unavailableEconomicRule, executionRule, evidenceRule],
        recommendedActions: [recommended],
        irrelevantActions: [conflictingIrrelevant],
      }).success,
    ).toBe(false);
  });

  it("rejects a public transaction recommendation without Action Gate Evidence", () => {
    const reference = evidenceRef(simulationCoverageEvidence);
    const recommended: ActionEvaluation = {
      id: "unverified-recommendation",
      action: { kind: "TRANSACTION_ADJUSTMENT", field: "protocol" },
      relevance: "RELEVANT",
      recommendable: true,
      actionReasonCode: "ALTERNATIVE_PATH_VERIFIED",
      evidenceRefs: [reference],
      proposedChange: {
        field: "protocol",
        before: "kuru",
        after: "pancake",
      },
    };
    const executionRule: RuleResult = {
      ruleId: "P0-EXECUTION-001",
      status: "UNKNOWN",
      reasonCode: "RULE_CLASSIFICATION_NOT_VERIFIED",
      evidenceRefs: [reference],
      actionEvaluations: [recommended],
    };

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        ruleResults: [unavailableEconomicRule, executionRule],
        recommendedActions: [recommended],
      }).success,
    ).toBe(false);
  });

  it("rejects a proposed change that disagrees with Action Verification Evidence", () => {
    const reference = evidenceRef(simulationCoverageEvidence);
    const verificationReference = evidenceRef(actionVerificationEvidence);
    const mismatched: ActionEvaluation = {
      id: "mismatched-protocol-recommendation",
      action: { kind: "TRANSACTION_ADJUSTMENT", field: "protocol" },
      relevance: "RELEVANT",
      recommendable: true,
      actionReasonCode: "ALTERNATIVE_PATH_VERIFIED",
      evidenceRefs: [verificationReference, reference],
      proposedChange: {
        field: "protocol",
        before: "kuru",
        after: "sushi",
      },
    };
    const executionRule: RuleResult = {
      ruleId: "P0-EXECUTION-001",
      status: "UNKNOWN",
      reasonCode: "RULE_CLASSIFICATION_NOT_VERIFIED",
      evidenceRefs: [reference],
      actionEvaluations: [mismatched],
    };

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        evidence: [simulationCoverageEvidence, actionVerificationEvidence],
        scope: scopeWithUnknownExecution,
        ruleResults: [unavailableEconomicRule, executionRule],
        recommendedActions: [mismatched],
      }).success,
    ).toBe(false);
  });

  it("keeps UNKNOWN candidate actions out of both public lists", () => {
    const unknown: ActionEvaluation = {
      id: "unknown-slippage-candidate",
      action: { kind: "TRANSACTION_ADJUSTMENT", field: "slippage" },
      relevance: "UNKNOWN",
      recommendable: false,
      actionReasonCode: "EFFECT_NOT_VERIFIED",
      evidenceRefs: [],
    };
    const executionRule: RuleResult = {
      ruleId: "P0-EXECUTION-001",
      status: "UNKNOWN",
      reasonCode: "RULE_CLASSIFICATION_NOT_VERIFIED",
      evidenceRefs: [],
      actionEvaluations: [unknown],
    };

    for (const list of ["recommendedActions", "irrelevantActions"] as const) {
      expect(
        runResultSchema.safeParse({
          ...completedResult,
          ruleResults: [unavailableEconomicRule, executionRule],
          [list]: [unknown],
        }).success,
      ).toBe(false);
    }
  });

  it("treats EvidenceRef order as irrelevant to public action identity", () => {
    const firstReference = evidenceRef(simulationCoverageEvidence);
    const secondReference = evidenceRef(actionVerificationEvidence);
    const evaluated: ActionEvaluation = {
      id: "ordered-protocol-action",
      action: { kind: "TRANSACTION_ADJUSTMENT", field: "protocol" },
      relevance: "RELEVANT",
      recommendable: true,
      actionReasonCode: "ALTERNATIVE_PATH_VERIFIED",
      evidenceRefs: [firstReference, secondReference],
      proposedChange: {
        field: "protocol",
        before: "kuru",
        after: "pancake",
      },
    };
    const published: ActionEvaluation = {
      ...evaluated,
      evidenceRefs: [secondReference, firstReference],
    };
    const executionRule: RuleResult = {
      ruleId: "P0-EXECUTION-001",
      status: "UNKNOWN",
      reasonCode: "RULE_CLASSIFICATION_NOT_VERIFIED",
      evidenceRefs: [firstReference],
      actionEvaluations: [evaluated],
    };

    expect(
      runResultSchema.safeParse({
        ...completedResult,
        evidence: [simulationCoverageEvidence, actionVerificationEvidence],
        scope: scopeWithUnknownExecution,
        ruleResults: [unavailableEconomicRule, executionRule],
        recommendedActions: [published],
      }).success,
    ).toBe(true);
  });

  it("retains minimum PROCEED invariants", () => {
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        verdict: "PROCEED",
        scope: completedResult.scope.map((item) => ({
          ...item,
          status: "not_checked",
        })),
      }).success,
    ).toBe(false);
    expect(
      runResultSchema.safeParse({
        ...completedResult,
        verdict: "PROCEED",
        evidence: [
          {
            ...simulationCoverageEvidence,
            status: "failed",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("Integration Error Result contract", () => {
  const failedEvidence: EvidenceItem = {
    ...simulationCoverageEvidence,
    key: "integration-error",
    status: "failed",
    summary: "Moss did not respond",
  };
  const reference = evidenceRef(failedEvidence);
  const recovery: ActionEvaluation = {
    id: "retry-check",
    action: { kind: "SYSTEM_RECOVERY", action: "RETRY_CHECK" },
    relevance: "RELEVANT",
    recommendable: true,
    actionReasonCode: "RESTORES_CHECK_ONLY",
    evidenceRefs: [reference],
  };
  const evidenceRule: RuleResult = {
    ruleId: "P0-EVIDENCE-001",
    status: "UNKNOWN",
    reasonCode: "CRITICAL_EVIDENCE_MISSING",
    evidenceRefs: [reference],
    actionEvaluations: [recovery],
  };
  const integrationErrorResult = {
    runId: "run-2",
    replayMode: false,
    intent: normalizedIntent,
    status: "integration_error",
    systemStatus: "INTEGRATION_ERROR",
    verdict: "UNKNOWN",
    summary: "The check could not be completed.",
    error: {
      code: "MOSS_UNAVAILABLE",
      stage: "simulation",
      message: "Moss did not respond",
      retryable: true,
    },
    ruleResults: [evidenceRule],
    recommendedActions: [recovery],
    irrelevantActions: [],
    evidence: [failedEvidence],
    scope: [
      {
        key: "P0-EVIDENCE-001",
        label: "Evidence result",
        status: "unknown",
        reason: "REQUIRED_EVIDENCE_UNAVAILABLE",
      },
      {
        key: "P0-EXECUTION-001",
        label: "Execution result",
        status: "unknown",
        reason: "REQUIRED_CHECK_INTERRUPTED",
      },
    ],
  };

  it("preserves the canonical public error and System Recovery action", () => {
    expect(runResultSchema.parse(integrationErrorResult)).toMatchObject({
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      error: { code: "MOSS_UNAVAILABLE", retryable: true },
    });
  });

  it("rejects a RuleResult for an interrupted Scope subject", () => {
    expect(
      runResultSchema.safeParse({
        ...integrationErrorResult,
        scope: integrationErrorResult.scope.map((item) =>
          item.key === "P0-EVIDENCE-001"
            ? { ...item, reason: "REQUIRED_CHECK_INTERRUPTED" as const }
            : item,
        ),
      }).success,
    ).toBe(false);
  });

  it("applies Economic Boundary consistency to the Integration Error branch", () => {
    const unknownEconomicRule: RuleResult = {
      ruleId: "P0-ECONOMIC-001",
      status: "UNKNOWN",
      reasonCode: "SIMULATED_OUTPUT_UNAVAILABLE",
      evidenceRefs: [],
      actionEvaluations: [],
    };

    expect(
      runResultSchema.safeParse({
        ...integrationErrorResult,
        ruleResults: [evidenceRule, unknownEconomicRule],
        scope: [
          ...integrationErrorResult.scope,
          {
            key: "P0-ECONOMIC-001" as const,
            label: "Economic result",
            status: "unknown" as const,
            reason: "REQUIRED_EVIDENCE_UNAVAILABLE" as const,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects transaction actions and protocol PASS/FAIL", () => {
    const transactionAction: ActionEvaluation = {
      id: "transaction-action-on-error",
      action: { kind: "TRANSACTION_ADJUSTMENT", field: "amountIn" },
      relevance: "RELEVANT",
      recommendable: true,
      actionReasonCode: "OUTPUT_IMPROVEMENT_VERIFIED",
      evidenceRefs: [reference],
      proposedChange: {
        field: "amountIn",
        before: "1500000000000000000",
        after: "1000000000000000000",
      },
    };
    expect(
      runResultSchema.safeParse({
        ...integrationErrorResult,
        recommendedActions: [transactionAction],
      }).success,
    ).toBe(false);
    expect(
      runResultSchema.safeParse({
        ...integrationErrorResult,
        ruleResults: [
          {
            ...evidenceRule,
            status: "FAIL",
            reasonCode: "CRITICAL_EVIDENCE_MISSING",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("run diff, scope, and serialization", () => {
  it("accepts an atomic input amount diff", () => {
    const result = runDiffSchema.parse({
      previousRunId: "run-1",
      previousVerdict: "ADJUST",
      changedFields: [
        {
          field: "amountInAtomic",
          before: "1500000000000000000",
          after: "1000000000000000000",
        },
      ],
    });

    expect(result.changedFields[0]?.field).toBe("amountInAtomic");
  });

  it("represents recipient-only reruns in the structured diff", () => {
    expect(
      runDiffSchema.safeParse({
        previousRunId: "run-1",
        previousVerdict: "UNKNOWN",
        changedFields: [
          {
            field: "recipient",
            before: sender,
            after: otherRecipient,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("preserves recipient provenance in a rerun diff", () => {
    expect(
      runDiffSchema.safeParse({
        previousRunId: "run-1",
        previousVerdict: "UNKNOWN",
        changedFields: [
          {
            field: "recipientSource",
            before: "defaulted_from_sender",
            after: "explicit",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate scope keys", () => {
    expect(
      scopeDisclosureSchema.safeParse([
        {
          key: "P0-EXECUTION-001",
          label: "Execution result",
          status: "checked",
        },
        {
          key: "P0-EXECUTION-001",
          label: "Execution result",
          status: "unknown",
          reason: "CLASSIFICATION_INCOMPLETE",
        },
      ]).success,
    ).toBe(false);
  });

  it("serializes bigint values as decimal strings", () => {
    expect(serializeJson({ blockNumber: 12345n, gas: 21000n })).toBe(
      '{"blockNumber":"12345","gas":"21000"}',
    );
  });
});
