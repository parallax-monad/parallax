import {
  type GenericEvidence,
  genericEvidenceSchema,
  type NormalizedSwapIntent,
  type RunResult,
} from "@parallax/contracts";
import type {
  CallerConstraint,
  ConstraintEvidence,
  QuoteContext,
} from "@parallax/risk";
import { describe, expect, it } from "vitest";
import {
  applyBackendP0Verdict,
  type BackendCurrentQuoteInput,
  backendEvidenceState,
  buildBackendCurrentQuoteContext,
  evaluateBackendP0Risk,
} from "./p0-risk-integration.js";

const CHAIN_ID = 421614;
const PROTOCOL = "camelot-v3";
const TOKEN_OUT = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const SENDER = "0x1111111111111111111111111111111111111111";
const BLOCK_NUMBER = "42";
const OBSERVED_AT = "2026-09-17T00:00:00.000Z";
const RUNTIME_VERSION = "arbitrum-camelot-v3";
const RUNTIME_REVISION = "native-rpc";
const PARENT_RUN_ID = "run-parent";

const baseIntent: NormalizedSwapIntent = {
  chainId: CHAIN_ID,
  protocol: PROTOCOL,
  sender: SENDER,
  recipient: SENDER,
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: { kind: "erc20", address: TOKEN_OUT },
  amountInAtomic: "1000000000000000",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

function field<T>(value: T) {
  return {
    value,
    source: "rpc" as const,
    reproducibility: "REPRODUCIBLE" as const,
    blockNumber: BLOCK_NUMBER,
    fetchedAt: OBSERVED_AT,
  };
}

/**
 * A fully provider-neutral, verified observation. It is intentionally *not*
 * Native RPC evidence: Native RPC's partial surface must never be inflated to
 * this state by the mapping under test.
 */
function verifiedEvidence(
  overrides: Partial<GenericEvidence> = {},
): GenericEvidence {
  return genericEvidenceSchema.parse({
    intent: {
      chainId: CHAIN_ID,
      protocol: PROTOCOL,
      sender: SENDER,
      tokenIn: "native",
      tokenOut: TOKEN_OUT,
      amountIn: "0.001",
      minimumReceivedSource: "unavailable",
    },
    provider: {
      providerId: "native-rpc-arbitrum",
      status: "SUCCESS",
      integrationStatus: "OK",
      errors: field([]),
    },
    execution: { status: "SUCCESS" },
    quote: {
      value: { estimatedAmountOut: "0.5" },
      source: "quote",
      reproducibility: "REPRODUCIBLE",
      blockNumber: BLOCK_NUMBER,
      fetchedAt: OBSERVED_AT,
    },
    action: field([]),
    receipt: field({}),
    outcome: field({}),
    assetChanges: field([]),
    assetChangeAssessment: "NOT_APPLICABLE",
    warnings: field([]),
    simulation: {
      value: {
        expectedTransactions: 1,
        observedResults: 1,
        unmatchedResultIndexes: [],
        halted: false,
        complete: true,
        missingTransactionIndexes: [],
      },
      source: "derived",
      reproducibility: "REPRODUCIBLE",
      blockNumber: BLOCK_NUMBER,
      fetchedAt: OBSERVED_AT,
    },
    blockNumber: field(BLOCK_NUMBER),
    capabilities: ["quote"],
    provenance: {
      observedChainId: CHAIN_ID,
      fetchedAt: OBSERVED_AT,
      mode: "LIVE",
      source: "rpc",
      simulationBlock: BLOCK_NUMBER,
      runtime: {
        runtimeVersion: RUNTIME_VERSION,
        runtimeRevision: RUNTIME_REVISION,
      },
    },
    checkedScope: ["quote"],
    unknownScope: [],
    providerData: {},
    ...overrides,
  });
}

function executionQuote(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    estimatedAmountOut: "0.5",
    blockNumber: BLOCK_NUMBER,
    runtimeVersion: RUNTIME_VERSION,
    runtimeRevision: RUNTIME_REVISION,
    ...overrides,
  };
}

function currentQuoteInput(
  overrides: Partial<BackendCurrentQuoteInput> = {},
): BackendCurrentQuoteInput {
  return {
    intent: baseIntent,
    evidence: verifiedEvidence(),
    quote: executionQuote(),
    blockNumber: BLOCK_NUMBER,
    observedAt: OBSERVED_AT,
    tokenOutDecimals: 6,
    ...overrides,
  };
}

function currentQuote(
  overrides: Partial<BackendCurrentQuoteInput> = {},
): QuoteContext {
  const result = buildBackendCurrentQuoteContext(currentQuoteInput(overrides));
  if (result.status !== "available") {
    throw new Error(`expected an available quote: ${result.reason}`);
  }
  return result.quote;
}

/** Selected quote / Expectation Baseline for the current execution context. */
function baseline(overrides: Partial<QuoteContext> = {}): QuoteContext {
  return {
    ...currentQuote(),
    quoteId: "selected-baseline",
    blockNumber: "41",
    observedAt: "2026-09-16T00:00:00.000Z",
    amountOutAtomic: "490000",
    ...overrides,
  };
}

const priceImpactConstraint: CallerConstraint = {
  name: "maxPriceImpact",
  source: "caller",
  declarationId: "impact",
  numerator: "50",
  denominator: "1",
  unit: "bps",
};

const priceImpactEvidence: ConstraintEvidence = {
  name: "maxPriceImpact",
  state: "VERIFIED",
  numerator: "50",
  denominator: "1",
  unit: "bps",
  evidenceKey: "impact",
};

describe("Backend P0 Risk bridge: selected baseline", () => {
  it("fails closed to UNKNOWN / MISSING_BASELINE without a selected baseline", () => {
    const result = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: baseIntent,
      evidence: verifiedEvidence(),
      currentQuote: currentQuote(),
    });

    expect(result.quoteFidelity).toEqual({
      status: "UNKNOWN",
      reason: "MISSING_BASELINE",
    });
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("never substitutes the current quote, minimumReceived, or a fixture baseline", () => {
    const current = currentQuote();
    const intentWithBoundary: NormalizedSwapIntent = {
      ...baseIntent,
      economicBoundary: {
        availability: "available",
        minimumReceivedAtomic: "400000",
        source: "user_declared",
      },
    };
    const result = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: intentWithBoundary,
      evidence: verifiedEvidence(),
      currentQuote: current,
    });

    expect(result.quoteFidelity).toEqual({
      status: "UNKNOWN",
      reason: "MISSING_BASELINE",
    });
    expect(result.quoteFidelity).not.toHaveProperty("selectedQuoteId");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("reports Quote Fidelity VERIFIED for a compatible selected baseline", () => {
    const current = currentQuote();
    const result = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: baseIntent,
      evidence: verifiedEvidence(),
      currentQuote: current,
      selectedQuote: baseline(),
    });

    expect(result.evidenceState).toBe("VERIFIED");
    expect(result.quoteFidelity).toMatchObject({
      status: "VERIFIED",
      selectedAmountOutAtomic: "490000",
      currentAmountOutAtomic: "500000",
      absoluteDeltaAtomic: "10000",
      observations: [],
      selectedQuoteId: "selected-baseline",
      currentQuoteId: current.quoteId,
    });
    expect(result.verdict).toBe("PROCEED");
  });

  it("keeps an incompatible amountIn unknown", () => {
    const result = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: baseIntent,
      evidence: verifiedEvidence(),
      currentQuote: currentQuote(),
      selectedQuote: baseline({ amountInAtomic: "999" }),
    });

    expect(result.quoteFidelity).toEqual({
      status: "UNKNOWN",
      reason: "INCOMPATIBLE",
    });
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("keeps an incompatible token pair unknown", () => {
    const result = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: baseIntent,
      evidence: verifiedEvidence(),
      currentQuote: currentQuote(),
      selectedQuote: baseline({
        tokenOut: "0x9999999999999999999999999999999999999999",
      }),
    });

    expect(result.quoteFidelity).toEqual({
      status: "UNKNOWN",
      reason: "INCOMPATIBLE",
    });
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("keeps a selected baseline newer than the current block unknown", () => {
    const result = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: baseIntent,
      evidence: verifiedEvidence(),
      currentQuote: currentQuote(),
      selectedQuote: baseline({ blockNumber: "43" }),
    });

    expect(result.quoteFidelity).toEqual({
      status: "UNKNOWN",
      reason: "INCOMPATIBLE",
    });
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("drops a current quote that is not bound to the checked Intent", () => {
    const foreign = { ...currentQuote(), amountInAtomic: "1" };
    const result = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: baseIntent,
      evidence: verifiedEvidence(),
      currentQuote: foreign,
      selectedQuote: baseline(),
    });

    expect(result.quoteFidelity).toEqual({
      status: "UNKNOWN",
      reason: "EVIDENCE_NOT_VERIFIED",
    });
    expect(result.verdict).toBe("UNKNOWN");
  });
});

describe("Backend P0 Risk bridge: EvidenceState mapping", () => {
  it("maps explicit provider staleness to STALE and fails closed", () => {
    const evidence = verifiedEvidence({
      provider: {
        providerId: "native-rpc-arbitrum",
        status: "STALE",
        integrationStatus: "OK",
        errors: field([]),
      },
    });

    expect(backendEvidenceState(evidence)).toBe("STALE");
    expect(
      evaluateBackendP0Risk({
        parentRunId: PARENT_RUN_ID,
        intent: baseIntent,
        evidence,
        currentQuote: currentQuote(),
        selectedQuote: baseline(),
      }).verdict,
    ).toBe("UNKNOWN");
  });

  it("maps a partial provider surface to INCOMPLETE and fails closed", () => {
    // Native RPC reports provider.status=UNKNOWN even on success: the partial
    // surface must stay INCOMPLETE, never VERIFIED.
    const evidence = verifiedEvidence({
      provider: {
        providerId: "native-rpc-arbitrum",
        status: "UNKNOWN",
        integrationStatus: "OK",
        errors: field([]),
      },
    });

    expect(backendEvidenceState(evidence)).toBe("INCOMPLETE");
    expect(
      evaluateBackendP0Risk({
        parentRunId: PARENT_RUN_ID,
        intent: baseIntent,
        evidence,
        currentQuote: currentQuote(),
        selectedQuote: baseline(),
      }).verdict,
    ).toBe("UNKNOWN");
  });

  it("keeps frozen Native RPC partial semantics: LIVE, fresh, reproducible Evidence stays INCOMPLETE and UNKNOWN", () => {
    // Frozen #69 / #70 semantics: a successful but partial Native RPC
    // evaluation reports provider.status=UNKNOWN and must never be promoted to
    // a complete Provider SUCCESS. Even with a verified current quote and an
    // injected selected baseline, the Backend Evidence State must stay
    // INCOMPLETE and the final P0 verdict must stay UNKNOWN. This is the
    // correct fail-closed P0 result while the Native RPC surface stays partial,
    // not a bug, and it must not be relaxed to VERIFIED.
    const evidence = verifiedEvidence({
      provider: {
        providerId: "native-rpc-arbitrum",
        status: "UNKNOWN",
        integrationStatus: "OK",
        errors: field([]),
      },
      simulation: {
        value: null,
        source: "rpc",
        reproducibility: "REPRODUCIBLE",
        blockNumber: BLOCK_NUMBER,
        fetchedAt: OBSERVED_AT,
      },
      receipt: field(null),
      outcome: field(null),
      assetChanges: field(null),
      capabilities: ["simulate", "eth_call", "estimateGas", "pinned-block"],
      checkedScope: ["native-rpc.eth_call", "native-rpc.estimateGas"],
      unknownScope: ["receipt", "outcome", "assetChanges", "simulation"],
      providerData: {
        nativeRpc: {
          status: "unknown",
          freshness: {
            status: "fresh",
            pinnedBlock: BLOCK_NUMBER,
            headBlock: BLOCK_NUMBER,
            lag: "0",
            maxBlockLag: 5,
          },
        },
      },
    });

    expect(evidence.provider.status).toBe("UNKNOWN");
    expect(evidence.provider.integrationStatus).toBe("OK");
    expect(evidence.provenance.mode).toBe("LIVE");
    expect(evidence.provenance.source).toBe("rpc");
    expect(evidence.quote.reproducibility).toBe("REPRODUCIBLE");

    expect(backendEvidenceState(evidence)).toBe("INCOMPLETE");
    expect(backendEvidenceState(evidence)).not.toBe("VERIFIED");

    expect(
      evaluateBackendP0Risk({
        parentRunId: PARENT_RUN_ID,
        intent: baseIntent,
        evidence,
        currentQuote: currentQuote(),
        selectedQuote: baseline(),
      }).verdict,
    ).toBe("UNKNOWN");
  });

  it("maps a reserved unknownScope key to INCOMPLETE", () => {
    const evidence = verifiedEvidence({
      unknownScope: ["quote", "receipt"],
    });

    expect(backendEvidenceState(evidence)).toBe("INCOMPLETE");
  });

  it("maps an unavailable integration to UNAVAILABLE", () => {
    expect(
      backendEvidenceState(
        verifiedEvidence({
          provider: {
            providerId: "native-rpc-arbitrum",
            status: "UNKNOWN",
            integrationStatus: "UNAVAILABLE",
            errors: field([]),
          },
        }),
      ),
    ).toBe("UNAVAILABLE");
    expect(
      backendEvidenceState(
        verifiedEvidence({
          quote: {
            value: null,
            source: "quote",
            reproducibility: "REPRODUCIBLE",
            blockNumber: BLOCK_NUMBER,
            fetchedAt: OBSERVED_AT,
          },
        }),
      ),
    ).toBe("UNAVAILABLE");
  });

  it("maps unverifiable provenance or observation to UNVERIFIED", () => {
    expect(
      backendEvidenceState(
        verifiedEvidence({
          provenance: {
            observedChainId: CHAIN_ID,
            fetchedAt: OBSERVED_AT,
            mode: "RECORDED_REPLAY",
            source: "rpc",
            simulationBlock: BLOCK_NUMBER,
            runtime: {
              runtimeVersion: RUNTIME_VERSION,
              runtimeRevision: RUNTIME_REVISION,
            },
          },
        }),
      ),
    ).toBe("UNVERIFIED");
    expect(
      backendEvidenceState(
        verifiedEvidence({
          quote: {
            value: { estimatedAmountOut: "0.5" },
            source: "quote",
            reproducibility: "REPRODUCIBLE",
            blockNumber: BLOCK_NUMBER,
          },
        }),
      ),
    ).toBe("UNVERIFIED");
    expect(
      backendEvidenceState(
        verifiedEvidence({
          provenance: {
            observedChainId: CHAIN_ID,
            fetchedAt: OBSERVED_AT,
            mode: "LIVE",
            source: "rpc",
            simulationBlock: BLOCK_NUMBER,
          },
        }),
      ),
    ).toBe("UNVERIFIED");
  });

  it("does not require receipt, outcome, or asset-change coverage to verify", () => {
    const evidence = verifiedEvidence({
      receipt: field(null),
      outcome: field(null),
      assetChanges: field(null),
    });

    expect(backendEvidenceState(evidence)).toBe("VERIFIED");
  });
});

describe("Backend P0 Risk bridge: constraints and Transaction Protection", () => {
  it("evaluates caller constraints only when they are explicitly injected", () => {
    const withoutConstraints = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: baseIntent,
      evidence: verifiedEvidence(),
      currentQuote: currentQuote(),
      selectedQuote: baseline(),
    });
    expect(withoutConstraints.constraints).toEqual([]);
    expect(withoutConstraints.verdict).toBe("PROCEED");

    const withConstraints = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: baseIntent,
      evidence: verifiedEvidence(),
      currentQuote: currentQuote(),
      selectedQuote: baseline(),
      constraints: [priceImpactConstraint],
      constraintEvidence: [priceImpactEvidence],
    });
    expect(withConstraints.constraints).toEqual([
      {
        name: "maxPriceImpact",
        declarationId: "impact",
        status: "PASS",
        evidenceKey: "impact",
      },
    ]);
    expect(withConstraints.verdict).toBe("PROCEED");

    const violated = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: baseIntent,
      evidence: verifiedEvidence(),
      currentQuote: currentQuote(),
      selectedQuote: baseline(),
      constraints: [{ ...priceImpactConstraint, numerator: "10" }],
      constraintEvidence: [priceImpactEvidence],
    });
    expect(violated.constraints).toEqual([
      {
        name: "maxPriceImpact",
        declarationId: "impact",
        status: "FAIL",
        evidenceKey: "impact",
        violation: "MAX_PRICE_IMPACT_EXCEEDED",
      },
    ]);
    expect(violated.verdict).toBe("STOP");
  });

  it("never converts the Intent Economic Boundary into a CallerConstraint", () => {
    const protectedIntent: NormalizedSwapIntent = {
      ...baseIntent,
      economicBoundary: {
        availability: "available",
        minimumReceivedAtomic: "400000",
        source: "user_declared",
      },
    };
    const result = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: protectedIntent,
      evidence: verifiedEvidence(),
      currentQuote: currentQuote(),
      selectedQuote: baseline(),
    });

    expect(result.constraints).toEqual([]);
    for (const name of [
      "maxPriceImpact",
      "minEffectiveRate",
      "maxTotalCost",
      "maxGas",
    ]) {
      expect(result.constraints.some((item) => item.name === name)).toBe(false);
    }
    // The transaction protection stays Transaction Protection: it is not a
    // constraint evaluation, and it does not by itself establish a Cause.
    expect(result.verdict).toBe("PROCEED");
  });
});

describe("Backend P0 Risk bridge: provider raw payload", () => {
  const sentinel = "0xdeadbeefsentinelrawpayload";

  it("never reads or re-emits a provider raw payload", () => {
    const plain = verifiedEvidence();
    const withRawPayload = verifiedEvidence({
      providerData: {
        nativeRpc: {
          status: "unknown",
          callReturnData: sentinel,
          endpoint: "https://rpc.invalid/secret",
        },
      },
    });

    const plainResult = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: baseIntent,
      evidence: plain,
      currentQuote: currentQuote(),
      selectedQuote: baseline(),
    });
    const rawResult = evaluateBackendP0Risk({
      parentRunId: PARENT_RUN_ID,
      intent: baseIntent,
      evidence: withRawPayload,
      currentQuote: currentQuote(),
      selectedQuote: baseline(),
    });

    // Identical results prove the provider-specific payload is never read.
    expect(rawResult).toEqual(plainResult);
    expect(JSON.stringify(rawResult)).not.toContain(sentinel);
    expect(JSON.stringify(rawResult)).not.toContain("rpc.invalid");

    const context = buildBackendCurrentQuoteContext(
      currentQuoteInput({ evidence: withRawPayload }),
    );
    expect(context.status).toBe("available");
    if (context.status === "available") {
      expect(JSON.stringify(context.quote)).not.toContain(sentinel);
      expect(context.quote.provenance).not.toContain("rpc.invalid");
    }
  });
});

describe("Backend P0 Risk bridge: current quote identity", () => {
  it("is deterministic for identical execution context", () => {
    expect(currentQuote().quoteId).toBe(currentQuote().quoteId);
    expect(currentQuote({ evidence: verifiedEvidence() }).quoteId).toBe(
      currentQuote({ evidence: verifiedEvidence() }).quoteId,
    );
  });

  it("is bound to chain, protocol, assets, amounts, block, time, and runtime", () => {
    const original = currentQuote();
    const mutations: ReadonlyArray<
      [string, Partial<BackendCurrentQuoteInput>, QuoteContext?]
    > = [
      ["chainId", { intent: { ...baseIntent, chainId: 42161 } }, undefined],
      ["protocol", { intent: { ...baseIntent, protocol: "kuru" } }, undefined],
      [
        "tokenIn",
        {
          intent: {
            ...baseIntent,
            tokenIn: {
              kind: "erc20",
              address: "0x2222222222222222222222222222222222222222",
            },
          },
        },
        undefined,
      ],
      [
        "tokenOut",
        {
          intent: {
            ...baseIntent,
            tokenOut: {
              kind: "erc20",
              address: "0x3333333333333333333333333333333333333333",
            },
          },
        },
        undefined,
      ],
      [
        "amountIn",
        { intent: { ...baseIntent, amountInAtomic: "2000" } },
        undefined,
      ],
      [
        "amountOut",
        { quote: executionQuote({ estimatedAmountOut: "0.6" }) },
        undefined,
      ],
      [
        "runtimeVersion",
        { quote: executionQuote({ runtimeVersion: "camelot-v4" }) },
        undefined,
      ],
      [
        "runtimeRevision",
        { quote: executionQuote({ runtimeRevision: "other-revision" }) },
        undefined,
      ],
    ];

    const identities = new Set<string>([original.quoteId]);
    for (const [label, overrides] of mutations) {
      const mutated = currentQuote(overrides);
      expect(mutated.quoteId, label).not.toBe(original.quoteId);
      identities.add(mutated.quoteId);
    }
    expect(identities.size).toBe(mutations.length + 1);
  });

  it("uses the pinned execution block and never a selected baseline block", () => {
    const context = currentQuote({
      quote: { estimatedAmountOut: "0.5" },
      blockNumber: "42",
    });
    expect(context.blockNumber).toBe("42");
    expect(context.observedAt).toBe(OBSERVED_AT);
  });

  it("rejects quote block and observation time drift from the pipeline context", () => {
    expect(
      buildBackendCurrentQuoteContext(
        currentQuoteInput({
          quote: executionQuote({ blockNumber: "43" }),
        }),
      ),
    ).toEqual({ status: "unavailable", reason: "BLOCK_NUMBER_MISMATCH" });
    expect(
      buildBackendCurrentQuoteContext(
        currentQuoteInput({
          quote: executionQuote({
            fetchedAt: "2026-09-18T00:00:00.000Z",
          }),
        }),
      ),
    ).toEqual({ status: "unavailable", reason: "OBSERVED_AT_MISMATCH" });
  });

  it("fails closed instead of inventing a block, time, or runtime identity", () => {
    const cases: ReadonlyArray<
      [string, Partial<BackendCurrentQuoteInput>, string]
    > = [
      [
        "no block",
        { quote: { estimatedAmountOut: "0.5" }, blockNumber: "" },
        "BLOCK_NUMBER_UNAVAILABLE",
      ],
      [
        "latest block",
        { quote: { estimatedAmountOut: "0.5" }, blockNumber: "latest" },
        "BLOCK_NUMBER_UNAVAILABLE",
      ],
      [
        "malformed quote block",
        { quote: executionQuote({ blockNumber: "latest" }) },
        "BLOCK_NUMBER_UNAVAILABLE",
      ],
      [
        "no observation time",
        { observedAt: undefined, quote: { estimatedAmountOut: "0.5" } },
        "OBSERVED_AT_UNAVAILABLE",
      ],
      [
        "no runtime identity",
        {
          quote: { estimatedAmountOut: "0.5", blockNumber: BLOCK_NUMBER },
          evidence: verifiedEvidence({
            provenance: {
              observedChainId: CHAIN_ID,
              fetchedAt: OBSERVED_AT,
              mode: "LIVE",
              source: "rpc",
              simulationBlock: BLOCK_NUMBER,
            },
          }),
        },
        "RUNTIME_PROVENANCE_UNAVAILABLE",
      ],
      [
        "unrepresentable output",
        { quote: executionQuote({ estimatedAmountOut: "0.1234567" }) },
        "INVALID_AMOUNT",
      ],
      ["missing quote", { quote: undefined }, "QUOTE_UNAVAILABLE"],
    ];

    for (const [label, overrides, reason] of cases) {
      expect(
        buildBackendCurrentQuoteContext(currentQuoteInput(overrides)),
        label,
      ).toEqual({ status: "unavailable", reason });
    }
  });
});

describe("Backend P0 Risk verdict merge", () => {
  function projected(
    verdict: RunResult["verdict"],
    summary = "projected summary",
  ): RunResult {
    return {
      status: "completed",
      verdict,
      summary,
    } as unknown as RunResult;
  }

  it("never lets the legacy projection report PROCEED over a P0 UNKNOWN", () => {
    expect(
      applyBackendP0Verdict(projected("PROCEED"), "UNKNOWN"),
    ).toMatchObject({
      verdict: "UNKNOWN",
      summary: "Live check could not establish a trustworthy result",
    });
    expect(applyBackendP0Verdict(projected("PROCEED"), "STOP")).toMatchObject({
      verdict: "STOP",
      summary: "Live check completed with verdict STOP",
    });
  });

  it("never promotes an untrusted projection through a P0 PROCEED", () => {
    expect(
      applyBackendP0Verdict(projected("UNKNOWN"), "PROCEED"),
    ).toMatchObject({
      verdict: "UNKNOWN",
      summary: "projected summary",
    });
    expect(applyBackendP0Verdict(projected("STOP"), "PROCEED")).toMatchObject({
      verdict: "STOP",
      summary: "projected summary",
    });
    expect(applyBackendP0Verdict(projected("STOP"), "UNKNOWN")).toMatchObject({
      verdict: "STOP",
      summary: "projected summary",
    });
  });

  it("keeps a PROCEED projection only when P0 also proceeds", () => {
    const result = applyBackendP0Verdict(projected("PROCEED"), "PROCEED");
    expect(result).toMatchObject({
      verdict: "PROCEED",
      summary: "projected summary",
    });
  });

  it("publishes a remediation candidate as STOP while no child Run exists", () => {
    expect(applyBackendP0Verdict(projected("PROCEED"), "ADJUST")).toMatchObject(
      {
        verdict: "STOP",
      },
    );
  });

  it("never overrides an integration_error verdict", () => {
    const failed = {
      status: "integration_error",
      verdict: "UNKNOWN",
      summary: "integration summary",
    } as unknown as RunResult;
    expect(applyBackendP0Verdict(failed, "STOP")).toBe(failed);
  });
});
