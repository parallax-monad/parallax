import {
  type NormalizedKuruEvidence,
  type SimulationCoverage,
  type Sourced,
  toGenericEvidence,
} from "@parallax/moss-bridge";
import { evaluateEvidence } from "@parallax/risk";
import { describe, expect, it } from "vitest";

/**
 * Golden Risk-compatibility matrix: historical Moss-path expectations pinned
 * through the generic Evidence boundary (NormalizedKuruEvidence ->
 * toGenericEvidence -> evaluateEvidence). Lives in the Orchestrator because
 * it is the consumer boundary between the Moss provider adapter and the
 * generic Risk engine; moss-bridge itself must not depend on @parallax/risk.
 */

const sender = "0x1111111111111111111111111111111111111111";
const usdc = "0x2222222222222222222222222222222222222222";

function sourced<T>(
  value: T | null,
  source: Sourced<unknown>["source"],
  reproducibility: Sourced<unknown>["reproducibility"] = "REPRODUCIBLE",
): Sourced<T> {
  return {
    value,
    source,
    reproducibility,
    blockNumber: "1",
  };
}

function evidence(
  overrides: Partial<NormalizedKuruEvidence> = {},
): NormalizedKuruEvidence {
  return {
    protocol: "kuru",
    intent: {
      chainId: "143",
      sender,
      tokenIn: "MON",
      tokenOut: usdc,
      amountIn: "0.01",
      minimumReceivedSource: "unavailable",
    },
    integrationStatus: "OK",
    executionStatus: "SUCCESS",
    quote: sourced({ estimatedAmountOut: "10" }, "quote"),
    action: sourced([{ protocol: "kuru", method: "swap" }], "moss"),
    receipt: sourced({ status: "ok" }, "moss"),
    outcome: sourced({ status: "ok" }, "moss"),
    assetChanges: sourced([], "moss"),
    assetChangeAssessment: "NOT_APPLICABLE",
    warnings: sourced([], "moss"),
    revertReason: sourced<string>(null, "unknown", "UNKNOWN"),
    gas: sourced([], "moss"),
    simulationCoverage: sourced<SimulationCoverage>(
      {
        expectedTransactions: 1,
        observedResults: 1,
        unmatchedResultIndexes: [],
        missingTransactionIndexes: [],
        halted: false,
        complete: true,
      },
      "derived",
    ),
    errors: sourced([], "moss"),
    blockNumber: sourced("1", "rpc"),
    mossVersion: "@themoss/protocol-kuru@0.1.0",
    source: "moss",
    replayMode: false,
    isReplay: false,
    isMock: false,
    approval: sourced("NOT_APPLICABLE", "derived"),
    walletAffordabilityChecked: false,
    limitations: [],
    ...overrides,
  };
}
describe("Risk compatibility (old Moss path == generic path)", () => {
  const oldCases: Array<{
    name: string;
    overrides: Partial<NormalizedKuruEvidence>;
    verdict: "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";
  }> = [
    {
      name: "complete success without boundary",
      overrides: {},
      verdict: "PROCEED",
    },
    {
      name: "passing supplied boundary",
      overrides: {
        intent: {
          ...evidence().intent,
          minimumReceived: "9",
          minimumReceivedSource: "user_declared",
        },
      },
      verdict: "PROCEED",
    },
    {
      name: "below supplied boundary",
      overrides: {
        intent: {
          ...evidence().intent,
          minimumReceived: "11",
          minimumReceivedSource: "user_declared",
        },
      },
      verdict: "ADJUST",
    },
    {
      name: "original_swap boundary below",
      overrides: {
        intent: {
          ...evidence().intent,
          minimumReceived: "11",
          minimumReceivedSource: "original_swap",
        },
      },
      verdict: "ADJUST",
    },
    {
      name: "terminal NO_ROUTE",
      overrides: { executionStatus: "NO_ROUTE" },
      verdict: "STOP",
    },
    {
      name: "execution REVERTED",
      overrides: { executionStatus: "REVERTED" },
      verdict: "UNKNOWN",
    },
    {
      name: "integration error",
      overrides: {
        integrationStatus: "INTEGRATION_ERROR",
        errors: sourced(
          [
            {
              stage: "SIMULATE",
              code: "INTEGRATION_ERROR",
              message: "failed to decode revert data",
              integrationStatus: "INTEGRATION_ERROR",
              source: "moss",
              normalization: "PRESERVED",
            },
          ],
          "moss",
        ),
      },
      verdict: "UNKNOWN",
    },
    {
      name: "missing critical evidence",
      overrides: {
        receipt: sourced(null, "unknown"),
        intent: {
          ...evidence().intent,
          minimumReceived: "9",
          minimumReceivedSource: "user_declared",
        },
      },
      verdict: "UNKNOWN",
    },
    {
      name: "non-decimal quote output",
      overrides: {
        quote: sourced({ estimatedAmountOut: "not-a-decimal" }, "quote"),
        intent: {
          ...evidence().intent,
          minimumReceived: "9",
          minimumReceivedSource: "user_declared",
        },
      },
      verdict: "UNKNOWN",
    },
    {
      name: "halted simulation coverage",
      overrides: {
        simulationCoverage: sourced<SimulationCoverage>(
          {
            expectedTransactions: 2,
            observedResults: 1,
            unmatchedResultIndexes: [],
            halted: true,
            complete: false,
            missingTransactionIndexes: [1],
            haltReason: "execution halted",
          },
          "derived",
        ),
      },
      verdict: "UNKNOWN",
    },
    {
      name: "null simulation coverage",
      overrides: {
        simulationCoverage: {
          value: null,
          source: "unknown",
          reproducibility: "UNKNOWN",
        },
      },
      verdict: "UNKNOWN",
    },
    {
      name: "warnings with unknown source",
      overrides: { warnings: sourced([], "unknown") },
      verdict: "UNKNOWN",
    },
    {
      name: "warnings with unknown reproducibility",
      overrides: { warnings: sourced([], "moss", "UNKNOWN") },
      verdict: "UNKNOWN",
    },
    {
      name: "mock-sourced warnings",
      overrides: { warnings: sourced([], "mock") },
      verdict: "UNKNOWN",
    },
    {
      name: "empty trusted warnings",
      overrides: { warnings: sourced([], "moss") },
      verdict: "PROCEED",
    },
    {
      name: "quote with unknown source",
      overrides: { quote: sourced({ estimatedAmountOut: "10" }, "unknown") },
      verdict: "UNKNOWN",
    },
    {
      name: "quote with unknown reproducibility",
      overrides: {
        quote: sourced({ estimatedAmountOut: "10" }, "quote", "UNKNOWN"),
      },
      verdict: "UNKNOWN",
    },
    {
      name: "mock-sourced quote",
      overrides: { quote: sourced({ estimatedAmountOut: "10" }, "mock") },
      verdict: "UNKNOWN",
    },
    {
      name: "unexplained asset changes",
      overrides: {
        assetChanges: sourced([{ kind: "nativeTransfer" }], "moss"),
        assetChangeAssessment: "UNKNOWN",
      },
      verdict: "UNKNOWN",
    },
    {
      name: "unavailable boundary",
      overrides: {
        intent: { ...evidence().intent, minimumReceivedSource: "unavailable" },
      },
      verdict: "PROCEED",
    },
    {
      name: "demo_preset boundary outside replay",
      overrides: {
        intent: {
          ...evidence().intent,
          minimumReceived: "9",
          minimumReceivedSource: "demo_preset",
        },
      },
      verdict: "UNKNOWN",
    },
    {
      name: "demo_preset boundary in replay",
      overrides: {
        replayMode: true,
        intent: {
          ...evidence().intent,
          minimumReceived: "9",
          minimumReceivedSource: "demo_preset",
        },
      },
      verdict: "PROCEED",
    },
    {
      name: "minimumReceived without source",
      overrides: {
        intent: { ...evidence().intent, minimumReceived: "9" },
      },
      verdict: "UNKNOWN",
    },
    {
      name: "minimumReceived with unavailable source",
      overrides: {
        intent: {
          ...evidence().intent,
          minimumReceived: "9",
          minimumReceivedSource: "unavailable",
        },
      },
      verdict: "UNKNOWN",
    },
    {
      name: "source without minimumReceived",
      overrides: {
        intent: {
          ...evidence().intent,
          minimumReceivedSource: "user_declared",
        },
      },
      verdict: "UNKNOWN",
    },
  ];

  for (const testCase of oldCases) {
    it(`keeps the old-path verdict for: ${testCase.name}`, () => {
      const normalized = evidence(testCase.overrides);
      const genericResult = evaluateEvidence(toGenericEvidence(normalized));

      expect(genericResult.verdict).toBe(testCase.verdict);
    });
  }

  it("keeps old-path reasons and actions identical", () => {
    const genericResult = evaluateEvidence(toGenericEvidence(evidence()));
    expect(genericResult.reasons).toEqual([
      "No blocking evidence was found within the checked scope.",
    ]);
    expect(genericResult.actions).toEqual([]);

    const adjust = evidence({
      intent: {
        ...evidence().intent,
        minimumReceived: "11",
        minimumReceivedSource: "user_declared",
      },
    });
    const genericAdjust = evaluateEvidence(toGenericEvidence(adjust));
    expect(genericAdjust.reasons).toEqual([
      "Expected output is below the caller-provided minimum received.",
    ]);
    expect(genericAdjust.actions).toEqual([
      "Adjust amount, route, or protocol, then re-run the check.",
    ]);
  });
});

describe("status layers stay independent at the Risk boundary", () => {
  it("keeps verdict UNKNOWN for a verified REVERTED execution", () => {
    const generic = toGenericEvidence(
      evidence({ executionStatus: "REVERTED" }),
    );
    expect(generic.provider.status).toBe("SUCCESS");
    expect(generic.execution.status).toBe("REVERTED");
    expect(evaluateEvidence(generic).verdict).toBe("UNKNOWN");
  });

  it("keeps verdict UNKNOWN for an undetermined execution outcome", () => {
    const generic = toGenericEvidence(evidence({ executionStatus: "UNKNOWN" }));
    expect(generic.provider.status).toBe("UNKNOWN");
    expect(generic.execution.status).toBe("UNKNOWN");
    expect(evaluateEvidence(generic).verdict).toBe("UNKNOWN");
  });
});
