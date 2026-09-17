import type { GenericEvidence } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import {
  type CallerConstraint,
  compareQuoteFidelity,
  evaluateCause,
  evaluateConstraints,
  evaluateP0Risk,
  type QuoteContext,
  type VerifiedCandidate,
} from "../src/index.js";

const selected: QuoteContext = {
  chainId: 42161,
  protocol: "camelot-v3",
  tokenIn: "0xabc",
  tokenOut: "0xdef",
  amountInAtomic: "10000",
  amountOutAtomic: "4812",
  quoteId: "selected-quote",
  provenance: "quote-adapter:v1",
  blockNumber: "100",
  observedAt: "2026-09-17T00:00:00Z",
};
const current: QuoteContext = {
  ...selected,
  quoteId: "current-quote",
  blockNumber: "101",
  amountOutAtomic: "4746",
};

describe("P0 quote fidelity", () => {
  it.each([
    ["equal", "4812", "0", []],
    ["degraded", "4746", "-66", ["QUOTE_OUTPUT_DEGRADED"]],
    ["improved", "4900", "88", []],
  ] as const)(
    "compares %s output exactly",
    (_label, output, delta, observations) => {
      const result = compareQuoteFidelity(
        selected,
        { ...current, amountOutAtomic: output },
        "VERIFIED",
      );
      expect(result.status).toBe("VERIFIED");
      if (result.status === "VERIFIED") {
        expect(result.absoluteDeltaAtomic).toBe(delta);
        expect(result.observations).toEqual(observations);
        expect(result.relativeDelta).toEqual({
          numerator: delta,
          denominator: "4812",
        });
      }
    },
  );

  it("keeps missing and incompatible baselines unknown", () => {
    expect(compareQuoteFidelity(undefined, current, "VERIFIED")).toEqual({
      status: "UNKNOWN",
      reason: "MISSING_BASELINE",
    });
    expect(
      compareQuoteFidelity(
        selected,
        { ...current, tokenOut: "other" },
        "VERIFIED",
      ),
    ).toEqual({ status: "UNKNOWN", reason: "INCOMPATIBLE" });
    expect(
      compareQuoteFidelity(
        selected,
        { ...current, amountInAtomic: "10001" },
        "VERIFIED",
      ).status,
    ).toBe("UNKNOWN");
  });

  it.each(["INCOMPLETE", "UNAVAILABLE", "STALE", "UNVERIFIED"] as const)(
    "does not call %s evidence degradation",
    (state) => {
      expect(compareQuoteFidelity(selected, current, state)).toEqual({
        status: "UNKNOWN",
        reason: "EVIDENCE_NOT_VERIFIED",
      });
    },
  );

  it("preserves large atomic amounts without floating point", () => {
    const huge = "9007199254740993000000000000000000";
    const result = compareQuoteFidelity(
      { ...selected, amountOutAtomic: huge },
      { ...current, amountOutAtomic: (BigInt(huge) - 1n).toString() },
      "VERIFIED",
    );
    expect(result.status).toBe("VERIFIED");
    if (result.status === "VERIFIED")
      expect(result.relativeDelta).toEqual({
        numerator: "-1",
        denominator: huge,
      });
  });

  it("treats zero selected output as a defined absolute comparison with undefined relative ratio", () => {
    const result = compareQuoteFidelity(
      { ...selected, amountOutAtomic: "0" },
      { ...current, amountOutAtomic: "1" },
      "VERIFIED",
    );
    expect(result.status).toBe("VERIFIED");
    if (result.status === "VERIFIED") expect(result.relativeDelta).toBeNull();
  });
});

const constraints: CallerConstraint[] = [
  {
    name: "maxPriceImpact",
    source: "caller",
    declarationId: "p",
    numerator: "50",
    denominator: "1",
    unit: "bps",
  },
  {
    name: "minEffectiveRate",
    source: "caller",
    declarationId: "r",
    numerator: "45",
    denominator: "100",
    unit: "output_per_input",
  },
  {
    name: "maxTotalCost",
    source: "caller",
    declarationId: "c",
    numerator: "100",
    denominator: "1",
    unit: "cost_atomic",
    costAsset: "ETH",
  },
  {
    name: "maxGas",
    source: "caller",
    declarationId: "g",
    numerator: "100000",
    denominator: "1",
    unit: "gas_units",
  },
];

describe("P0 constraints and cause gates", () => {
  it("evaluates each explicit constraint with exact, named evidence", () => {
    const evidence = [
      {
        name: "maxPriceImpact",
        numerator: "51",
        denominator: "1",
        unit: "bps",
        evidenceKey: "impact",
      },
      {
        name: "minEffectiveRate",
        numerator: "44",
        denominator: "100",
        unit: "output_per_input",
        evidenceKey: "rate",
      },
      {
        name: "maxTotalCost",
        numerator: "99",
        denominator: "1",
        unit: "cost_atomic",
        evidenceKey: "cost",
        costAsset: "ETH",
      },
      {
        name: "maxGas",
        numerator: "100001",
        denominator: "1",
        unit: "gas_units",
        evidenceKey: "gas",
      },
    ] as const;
    expect(
      evaluateConstraints(
        constraints,
        evidence.map((item) => ({ ...item, state: "VERIFIED" })),
      ),
    ).toMatchObject([
      {
        status: "FAIL",
        violation: "MAX_PRICE_IMPACT_EXCEEDED",
        declarationId: "p",
      },
      {
        status: "FAIL",
        violation: "MIN_EFFECTIVE_RATE_NOT_MET",
        declarationId: "r",
      },
      { status: "PASS", declarationId: "c" },
      { status: "FAIL", violation: "MAX_GAS_EXCEEDED", declarationId: "g" },
    ]);
    expect(
      evaluateConstraints(
        [],
        evidence.map((item) => ({ ...item, state: "VERIFIED" })),
      ),
    ).toEqual([]);
    expect(evaluateConstraints(constraints, [])).toEqual(
      constraints.map((item) => ({
        name: item.name,
        declarationId: item.declarationId,
        status: "UNKNOWN",
      })),
    );
  });

  it("keeps stale or unverified metrics unknown", () => {
    expect(
      evaluateConstraints(constraints.slice(0, 1), [
        {
          name: "maxPriceImpact",
          numerator: "100",
          denominator: "1",
          unit: "bps",
          evidenceKey: "stale",
          state: "STALE",
        },
      ]),
    ).toEqual([
      { name: "maxPriceImpact", declarationId: "p", status: "UNKNOWN" },
    ]);
  });

  it("evaluates several declarations of one name against the single measured metric", () => {
    const declarations: CallerConstraint[] = [
      { ...constraints[0], declarationId: "loose", numerator: "50" },
      { ...constraints[0], declarationId: "strict", numerator: "10" },
    ];
    const result = evaluateConstraints(declarations, [
      {
        name: "maxPriceImpact",
        state: "VERIFIED",
        numerator: "20",
        denominator: "1",
        unit: "bps",
        evidenceKey: "impact",
      },
    ]);
    expect(result).toEqual([
      {
        name: "maxPriceImpact",
        declarationId: "loose",
        status: "PASS",
        evidenceKey: "impact",
      },
      {
        name: "maxPriceImpact",
        declarationId: "strict",
        status: "FAIL",
        evidenceKey: "impact",
        violation: "MAX_PRICE_IMPACT_EXCEEDED",
      },
    ]);
  });

  it("fails closed on ambiguous same-name evidence and never PASS or FAIL", () => {
    const declarations: CallerConstraint[] = [
      { ...constraints[0], declarationId: "loose", numerator: "50" },
      { ...constraints[0], declarationId: "strict", numerator: "10" },
    ];
    const result = evaluateConstraints(declarations, [
      {
        name: "maxPriceImpact",
        state: "VERIFIED",
        numerator: "5",
        denominator: "1",
        unit: "bps",
        evidenceKey: "metric-a",
      },
      {
        name: "maxPriceImpact",
        state: "VERIFIED",
        numerator: "20",
        denominator: "1",
        unit: "bps",
        evidenceKey: "metric-b",
      },
    ]);
    expect(result).toEqual([
      { name: "maxPriceImpact", declarationId: "loose", status: "UNKNOWN" },
      { name: "maxPriceImpact", declarationId: "strict", status: "UNKNOWN" },
    ]);
    expect(
      result.some((item) => item.status === "PASS" || item.status === "FAIL"),
    ).toBe(false);
  });

  it("never lets a first same-name record produce a false PASS", () => {
    const strict: CallerConstraint[] = [
      { ...constraints[0], declarationId: "strict", numerator: "10" },
    ];
    const result = evaluateConstraints(strict, [
      {
        name: "maxPriceImpact",
        state: "VERIFIED",
        numerator: "5",
        denominator: "1",
        unit: "bps",
        evidenceKey: "permissive",
      },
      {
        name: "maxPriceImpact",
        state: "VERIFIED",
        numerator: "999",
        denominator: "1",
        unit: "bps",
        evidenceKey: "actual",
      },
    ]);
    expect(result).toEqual([
      { name: "maxPriceImpact", declarationId: "strict", status: "UNKNOWN" },
    ]);
    expect(result.some((item) => item.status === "PASS")).toBe(false);
  });

  it("keeps distinct names isolated from another name's ambiguity", () => {
    const declarations: CallerConstraint[] = [constraints[0], constraints[3]];
    const result = evaluateConstraints(declarations, [
      {
        name: "maxPriceImpact",
        state: "VERIFIED",
        numerator: "5",
        denominator: "1",
        unit: "bps",
        evidenceKey: "impact-a",
      },
      {
        name: "maxPriceImpact",
        state: "VERIFIED",
        numerator: "20",
        denominator: "1",
        unit: "bps",
        evidenceKey: "impact-b",
      },
      {
        name: "maxGas",
        state: "VERIFIED",
        numerator: "100000",
        denominator: "1",
        unit: "gas_units",
        evidenceKey: "gas",
      },
    ]);
    expect(result).toEqual([
      { name: "maxPriceImpact", declarationId: "p", status: "UNKNOWN" },
      {
        name: "maxGas",
        declarationId: "g",
        status: "PASS",
        evidenceKey: "gas",
      },
    ]);
  });

  it("requires independent evidence and explicit causal support", () => {
    expect(evaluateCause("STATE_MOVEMENT", [])).toEqual({
      cause: "STATE_MOVEMENT",
      status: "NOT_VERIFIED",
      evidenceKeys: [],
    });
    const evidence = [
      {
        kind: "SELECTED_STATE",
        state: "VERIFIED",
        evidenceKey: "before",
        supports: ["STATE_MOVEMENT"],
      },
      {
        kind: "CURRENT_STATE",
        state: "VERIFIED",
        evidenceKey: "after",
        supports: ["STATE_MOVEMENT"],
      },
    ] as const;
    expect(
      evaluateCause(
        "STATE_MOVEMENT",
        evidence.map((item) => ({ ...item, supports: [...item.supports] })),
      ),
    ).toEqual({
      cause: "STATE_MOVEMENT",
      status: "VERIFIED",
      evidenceKeys: ["before", "after"],
    });
    expect(
      evaluateCause(
        "GAS_SPIKE",
        evidence.map((item) => ({ ...item, supports: [...item.supports] })),
      ),
    ).toMatchObject({ status: "NOT_VERIFIED" });
  });
});

function genericEvidence(): GenericEvidence {
  const field = <T>(
    value: T,
    source: "moss" | "quote" | "rpc" | "derived",
  ) => ({
    value,
    source,
    reproducibility: "REPRODUCIBLE" as const,
    blockNumber: "101",
  });
  return {
    intent: {
      chainId: 42161,
      protocol: "camelot-v3",
      sender: "sender",
      tokenIn: "0xabc",
      tokenOut: "0xdef",
      amountIn: "10000",
      minimumReceivedSource: "unavailable",
    },
    provider: {
      providerId: "provider",
      status: "SUCCESS",
      integrationStatus: "OK",
      errors: field([], "moss"),
    },
    execution: { status: "SUCCESS" },
    quote: field({ estimatedAmountOut: "4746" }, "quote"),
    action: field([], "moss"),
    receipt: field({}, "moss"),
    outcome: field({}, "moss"),
    assetChanges: field([], "moss"),
    assetChangeAssessment: "NOT_APPLICABLE",
    warnings: field([], "moss"),
    simulation: field(
      {
        expectedTransactions: 1,
        observedResults: 1,
        unmatchedResultIndexes: [],
        halted: false,
        complete: true,
        missingTransactionIndexes: [],
      },
      "derived",
    ),
    blockNumber: field("101", "rpc"),
    capabilities: [],
    provenance: { mode: "LIVE", source: "moss" },
    checkedScope: [],
    unknownScope: [],
    providerData: {},
  };
}

describe("P0 verdict gate", () => {
  const verified: VerifiedCandidate = {
    status: "VERIFIED",
    selectedQuoteId: "selected-quote",
    amountInAtomic: "10300",
    amountOutAtomic: "4820",
    quoteId: "candidate-quote",
    quoteBlockNumber: "102",
    quoteObservedAt: "2026-09-17T00:00:01Z",
    verification: {
      preparedUnsignedTxFingerprint: "sha256:candidate",
      preparedAmountInAtomic: "10300",
      providerStatus: "SUCCESS",
      riskVerdict: "PROCEED",
      parentRunId: "parent",
      childRunId: "child",
      childStatus: "completed",
      childAmountInAtomic: "10300",
      childAmountOutAtomic: "4820",
      childQuoteId: "candidate-quote",
      verificationBlock: "102",
      verificationTime: "2026-09-17T00:00:02Z",
      provenance: "provider:v1",
      checkedScope: ["constraint:maxPriceImpact"],
      isReplay: false,
      isMock: false,
      actionGateVerified: true,
    },
  };

  it("does not pass a missing baseline or missing constraint evidence", () => {
    expect(
      evaluateP0Risk(genericEvidence(), {
        currentQuote: current,
        evidenceState: "VERIFIED",
      }).verdict,
    ).toBe("UNKNOWN");
    expect(
      evaluateP0Risk(genericEvidence(), {
        selectedQuote: selected,
        currentQuote: current,
        evidenceState: "VERIFIED",
        constraints: [constraints[0]],
      }).verdict,
    ).toBe("UNKNOWN");
  });

  it("keeps a descriptive degradation separate from a user constraint", () => {
    const result = evaluateP0Risk(genericEvidence(), {
      selectedQuote: selected,
      currentQuote: current,
      evidenceState: "VERIFIED",
    });
    expect(result.quoteFidelity.status).toBe("VERIFIED");
    expect(result.verdict).toBe("PROCEED");
  });

  it("blocks verified caller constraint violations and provider unknown", () => {
    const input = {
      selectedQuote: selected,
      currentQuote: current,
      evidenceState: "VERIFIED" as const,
      constraints: [constraints[0]],
      constraintEvidence: [
        {
          name: "maxPriceImpact" as const,
          state: "VERIFIED" as const,
          numerator: "51",
          denominator: "1",
          unit: "bps" as const,
          evidenceKey: "impact",
        },
      ],
    };
    expect(evaluateP0Risk(genericEvidence(), input).verdict).toBe("STOP");
    const unavailable = genericEvidence();
    unavailable.provider.status = "UNKNOWN";
    expect(evaluateP0Risk(unavailable, input).verdict).toBe("UNKNOWN");
    expect(
      evaluateP0Risk(genericEvidence(), {
        ...input,
        verifiedRemediation: verified,
      }).verdict,
    ).toBe("ADJUST");
    expect(
      evaluateP0Risk(genericEvidence(), {
        ...input,
        verifiedRemediation: { ...verified, selectedQuoteId: "other" },
      }).verdict,
    ).toBe("STOP");
    expect(
      evaluateP0Risk(genericEvidence(), {
        ...input,
        verifiedRemediation: {
          ...verified,
          verification: { ...verified.verification, checkedScope: [] },
        },
      }).verdict,
    ).toBe("STOP");
  });

  it.each([
    [
      "a mock child Run",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, isMock: true },
      }),
    ],
    [
      "a replayed child Run",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, isReplay: true },
      }),
    ],
    [
      "a child Run that is the parent Run",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, childRunId: "parent" },
      }),
    ],
    [
      "a blank child Run identity",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, childRunId: " " },
      }),
    ],
    [
      "a blank parent Run identity",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, parentRunId: "" },
      }),
    ],
    [
      "a missing prepared transaction fingerprint",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: {
          ...value.verification,
          preparedUnsignedTxFingerprint: " ",
        },
      }),
    ],
    [
      "a prepared input that is not the candidate input",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, preparedAmountInAtomic: "999" },
      }),
    ],
    [
      "a child input that is not the candidate input",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, childAmountInAtomic: "999" },
      }),
    ],
    [
      "a child output below the candidate output",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, childAmountOutAtomic: "1" },
      }),
    ],
    [
      "a child quote that is not the candidate quote",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, childQuoteId: "other" },
      }),
    ],
    [
      "a blank candidate quote identity",
      (value: VerifiedCandidate) => ({ ...value, quoteId: "" }),
    ],
    [
      "a non-atomic verification block",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, verificationBlock: "latest" },
      }),
    ],
    [
      "an unparseable verification time",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, verificationTime: "soon" },
      }),
    ],
    [
      "an empty verification provenance",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, provenance: " " },
      }),
    ],
    [
      "a checked scope with a blank entry",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: {
          ...value.verification,
          checkedScope: ["constraint:maxPriceImpact", " "],
        },
      }),
    ],
    [
      "an unchanged candidate input",
      (value: VerifiedCandidate) => ({ ...value, amountInAtomic: "10000" }),
    ],
  ])("never emits ADJUST from %s", (_label, modify) => {
    expect(
      evaluateP0Risk(genericEvidence(), {
        selectedQuote: selected,
        currentQuote: current,
        evidenceState: "VERIFIED",
        constraints: [constraints[0]],
        constraintEvidence: [
          {
            name: "maxPriceImpact",
            state: "VERIFIED",
            numerator: "51",
            denominator: "1",
            unit: "bps",
            evidenceKey: "impact",
          },
        ],
        verifiedRemediation: modify(verified),
      }).verdict,
    ).toBe("STOP");
  });

  const gateInput = {
    selectedQuote: selected,
    currentQuote: current,
    evidenceState: "VERIFIED" as const,
    constraints: [{ ...constraints[0] }],
    constraintEvidence: [
      {
        name: "maxPriceImpact" as const,
        state: "VERIFIED" as const,
        numerator: "51",
        denominator: "1",
        unit: "bps" as const,
        evidenceKey: "impact",
      },
    ],
  };

  const blocked = (
    mutate: (value: VerifiedCandidate) => VerifiedCandidate,
  ): VerifiedCandidate => mutate(structuredClone(verified));

  it.each([
    [
      "verification block below the candidate quote block",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, verificationBlock: "101" },
      }),
    ],
    [
      "verification block above the candidate quote block",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: { ...value.verification, verificationBlock: "103" },
      }),
    ],
    [
      "candidate quote block below the selected baseline block",
      (value: VerifiedCandidate) => ({
        ...value,
        quoteBlockNumber: "99",
        verification: { ...value.verification, verificationBlock: "99" },
      }),
    ],
    [
      "a non-atomic candidate quote block",
      (value: VerifiedCandidate) => ({
        ...value,
        quoteBlockNumber: "latest",
      }),
    ],
    [
      "an unparseable candidate quote time",
      (value: VerifiedCandidate) => ({
        ...value,
        quoteObservedAt: "soon",
      }),
    ],
    [
      "verification time earlier than the candidate quote time",
      (value: VerifiedCandidate) => ({
        ...value,
        verification: {
          ...value.verification,
          verificationTime: "2026-09-17T00:00:00Z",
        },
      }),
    ],
  ])("never emits ADJUST when bound to %s", (_label, mutate) => {
    expect(
      evaluateP0Risk(genericEvidence(), {
        ...gateInput,
        verifiedRemediation: blocked(mutate),
      }).verdict,
    ).toBe("STOP");
  });

  it("emits ADJUST only for a candidate exactly bound to its candidate quote block", () => {
    expect(
      evaluateP0Risk(genericEvidence(), {
        ...gateInput,
        verifiedRemediation: blocked((value) => value),
      }).verdict,
    ).toBe("ADJUST");
    expect(
      evaluateP0Risk(genericEvidence(), {
        ...gateInput,
        verifiedRemediation: blocked((value) => ({
          ...value,
          verification: {
            ...value.verification,
            verificationTime: "2026-09-17T00:00:01Z",
          },
        })),
      }).verdict,
    ).toBe("ADJUST");
  });

  it("blocks a structurally supplied candidate that omits the preserved quote context", () => {
    const structural = {
      ...verified,
      quoteBlockNumber: undefined,
      quoteObservedAt: undefined,
    } as unknown as VerifiedCandidate;
    expect(
      evaluateP0Risk(genericEvidence(), {
        ...gateInput,
        verifiedRemediation: structural,
      }).verdict,
    ).toBe("STOP");
  });

  it("blocks a forged candidate whose verification block is far below the selected baseline", () => {
    const forged = blocked((value) => ({
      ...value,
      quoteBlockNumber: "1",
      verification: { ...value.verification, verificationBlock: "1" },
    }));
    expect(
      evaluateP0Risk(genericEvidence(), {
        ...gateInput,
        verifiedRemediation: forged,
      }).verdict,
    ).toBe("STOP");
  });
});
