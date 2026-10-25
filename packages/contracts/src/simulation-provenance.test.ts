import { describe, expect, it } from "vitest";
import { providerNeutralSimulationProvenanceSchema } from "./simulation-provenance.js";

const sender = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const router = "0x3333333333333333333333333333333333333333";
const pool = "0x4444444444444444444444444444444444444444";
const wrappedNative = "0x5555555555555555555555555555555555555555";
const usdc = "0x6666666666666666666666666666666666666666";
const sourceBlockNumber = "515881859";
const sourceBlockHash = `0x${"ab".repeat(32)}`;
const transactionFingerprint = `sha256:${"11".repeat(32)}`;
const stateFingerprint = `sha256:${"22".repeat(32)}`;
const dataFingerprint = `sha256:${"33".repeat(32)}`;

function validProvenance() {
  return {
    schemaVersion: 1,
    status: "AVAILABLE",
    sourceChainId: 42161,
    sourceBlockNumber,
    sourceBlockHash,
    sourceObservedAt: "2026-10-17T19:17:33.990Z",
    executionEnvironment: "LOCAL_FORK",
    executionChainId: 31337,
    executionBlockContext: {
      baseBlockNumber: sourceBlockNumber,
      baseBlockHash: sourceBlockHash,
      observedHeadNumber: sourceBlockNumber,
    },
    forkRunId: "00000000-0000-4000-8000-000000000001",
    stateRevision: { status: "AVAILABLE", fingerprint: stateFingerprint },
    accountOverridesApplied: true,
    transactionFingerprint,
    transactionBinding: {
      chainId: 42161,
      protocol: "camelot-v3",
      sender,
      recipient,
      tokenIn: "native",
      tokenOut: usdc,
      amountInAtomic: "1000000000000000",
      amountOutMinimumAtomic: "0",
      router,
      from: sender,
      to: router,
      value: "0x38d7ea4c68000",
      dataFingerprint,
    },
    quote: {
      amountInAtomic: "1000000000000000",
      amountOutAtomic: "2413423",
      poolAddress: pool,
      tokenPath: [wrappedNative, usdc],
    },
    capabilities: {
      call: {
        status: "SUCCEEDED",
        returnDataFingerprint: dataFingerprint,
      },
      gasEstimate: { status: "AVAILABLE", gasUnits: "21000" },
      amountReceived: {
        status: "AVAILABLE",
        amountReceivedAtomic: "2413423",
        source: "VALIDATED_STATE_DIFF",
      },
    },
    quoteReconciliation: {
      status: "MATCHED",
      comparisonMethod: "ATOMIC_INTEGER_EQUALITY",
      quoteAmountOutAtomic: "2413423",
      simulatedAmountReceivedAtomic: "2413423",
      differenceAtomic: "0",
    },
  } as const;
}

describe("provider-neutral simulation provenance contract", () => {
  it("accepts exact atomic quote reconciliation on a matching local-fork context", () => {
    expect(
      providerNeutralSimulationProvenanceSchema.parse(validProvenance()),
    ).toMatchObject({
      executionEnvironment: "LOCAL_FORK",
      sourceChainId: 42161,
      executionChainId: 31337,
      quoteReconciliation: {
        status: "MATCHED",
        comparisonMethod: "ATOMIC_INTEGER_EQUALITY",
        differenceAtomic: "0",
      },
    });
  });

  it("accepts provider-neutral live evidence without local-fork-only claims", () => {
    const { forkRunId: _forkRunId, ...base } = validProvenance();
    const live = {
      ...base,
      executionEnvironment: "LIVE" as const,
      executionChainId: 42161,
      stateRevision: {
        status: "UNKNOWN" as const,
        reason: "NO_QUALIFIED_STATE_REVISION_TOKEN" as const,
      },
      accountOverridesApplied: false,
      capabilities: {
        ...base.capabilities,
        amountReceived: {
          status: "UNAVAILABLE" as const,
          reason: "STATE_DIFF_NOT_QUALIFIED" as const,
        },
      },
      quoteReconciliation: {
        status: "UNAVAILABLE" as const,
        comparisonMethod: "ATOMIC_INTEGER_EQUALITY" as const,
        quoteAmountOutAtomic: "2413423",
        reason: "SIMULATED_OUTPUT_UNAVAILABLE" as const,
      },
    };
    expect(providerNeutralSimulationProvenanceSchema.parse(live)).toMatchObject(
      {
        executionEnvironment: "LIVE",
        stateRevision: { status: "UNKNOWN" },
        accountOverridesApplied: false,
        capabilities: { amountReceived: { status: "UNAVAILABLE" } },
      },
    );
  });

  it("retains an exact signed mismatch rather than applying a tolerance", () => {
    const provenance = validProvenance();
    const mismatched = {
      ...provenance,
      capabilities: {
        ...provenance.capabilities,
        amountReceived: {
          status: "AVAILABLE" as const,
          amountReceivedAtomic: "2409000",
          source: "VALIDATED_STATE_DIFF" as const,
        },
      },
      quoteReconciliation: {
        status: "MISMATCHED" as const,
        comparisonMethod: "ATOMIC_INTEGER_EQUALITY" as const,
        quoteAmountOutAtomic: "2413423",
        simulatedAmountReceivedAtomic: "2409000",
        differenceAtomic: "-4423",
      },
    };
    expect(
      providerNeutralSimulationProvenanceSchema.parse(mismatched),
    ).toMatchObject({
      quoteReconciliation: {
        status: "MISMATCHED",
        differenceAtomic: "-4423",
      },
    });
    expect(
      providerNeutralSimulationProvenanceSchema.safeParse({
        ...mismatched,
        quoteReconciliation: {
          ...mismatched.quoteReconciliation,
          differenceAtomic: "-4422",
        },
      }).success,
    ).toBe(false);
  });

  it("keeps unavailable output explicit and never derives it from the quote", () => {
    const provenance = validProvenance();
    const unavailable = {
      ...provenance,
      capabilities: {
        ...provenance.capabilities,
        amountReceived: {
          status: "UNAVAILABLE" as const,
          reason: "STATE_DIFF_NOT_QUALIFIED" as const,
        },
      },
      quoteReconciliation: {
        status: "UNAVAILABLE" as const,
        comparisonMethod: "ATOMIC_INTEGER_EQUALITY" as const,
        quoteAmountOutAtomic: "2413423",
        reason: "SIMULATED_OUTPUT_UNAVAILABLE" as const,
      },
    };
    expect(
      providerNeutralSimulationProvenanceSchema.parse(unavailable),
    ).toMatchObject({
      capabilities: {
        amountReceived: { status: "UNAVAILABLE" },
      },
      quoteReconciliation: { status: "UNAVAILABLE" },
    });
  });

  it.each([
    {
      name: "timeout",
      call: { status: "UNAVAILABLE", failureReason: "RPC_TIMEOUT" },
    },
    {
      name: "RPC unavailability",
      call: { status: "UNAVAILABLE", failureReason: "RPC_UNAVAILABLE" },
    },
    {
      name: "malformed response",
      call: { status: "UNAVAILABLE", failureReason: "MALFORMED_RESPONSE" },
    },
    {
      name: "insufficient native balance",
      call: {
        status: "UNAVAILABLE",
        failureReason: "INSUFFICIENT_NATIVE_BALANCE",
      },
    },
    {
      name: "ordinary revert",
      call: { status: "REVERTED", failureReason: "EVM_REVERT" },
    },
    {
      name: "slippage guard revert",
      call: { status: "REVERTED", failureReason: "SLIPPAGE_GUARD" },
    },
  ] as const)("preserves $name as a distinct capability state", ({ call }) => {
    const provenance = validProvenance();
    const unavailableAmount = {
      status: "UNAVAILABLE" as const,
      reason: "CALL_NOT_SUCCEEDED" as const,
    };
    expect(
      providerNeutralSimulationProvenanceSchema.safeParse({
        ...provenance,
        capabilities: {
          call,
          gasEstimate:
            call.status === "REVERTED"
              ? {
                  status: "UNAVAILABLE",
                  failureReason: call.failureReason,
                }
              : provenance.capabilities.gasEstimate,
          amountReceived: unavailableAmount,
        },
        quoteReconciliation: {
          status: "UNAVAILABLE",
          comparisonMethod: "ATOMIC_INTEGER_EQUALITY",
          quoteAmountOutAtomic: "2413423",
          reason: "SIMULATED_OUTPUT_UNAVAILABLE",
        },
      }).success,
    ).toBe(true);
  });

  it("requires the exact source block and fork execution context to agree", () => {
    const provenance = validProvenance();
    expect(
      providerNeutralSimulationProvenanceSchema.safeParse({
        ...provenance,
        executionBlockContext: {
          ...provenance.executionBlockContext,
          baseBlockHash: `0x${"cd".repeat(32)}`,
        },
      }).success,
    ).toBe(false);
    expect(
      providerNeutralSimulationProvenanceSchema.safeParse({
        ...provenance,
        executionBlockContext: {
          ...provenance.executionBlockContext,
          observedHeadNumber: "515881860",
        },
      }).success,
    ).toBe(false);
  });
});
