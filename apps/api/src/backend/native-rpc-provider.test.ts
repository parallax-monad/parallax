import {
  convertAtomicAmountToHuman,
  convertHumanAmountToAtomic,
  type GenericEvidenceMode,
  type NormalizedSwapIntent,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import controlledNativeRpcFixtures from "../../../../fixtures/provider-registry/be-011/native-rpc/controlled-p0-b/fixtures.json";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import {
  CAMELOT_SEPOLIA_USDC,
  CamelotV3ProtocolAdapter,
} from "./camelot-v3-protocol-adapter.js";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  NATIVE_RPC_ARBITRUM_PROVIDER_ID,
  NATIVE_RPC_CAPABILITIES,
  type NativeRpcPreparedExecution,
  toNativeRpcGenericEvidence,
} from "./native-rpc-evidence.js";
import type { ProviderEvaluationResult } from "./provider-adapter.js";

type CandidateField = ProviderEvaluationResult["candidateFields"][number];

const intent: NormalizedSwapIntent = {
  chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
  protocol: "camelot-v3",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender" as const,
  tokenIn: { kind: "native" as const },
  tokenOut: {
    kind: "erc20" as const,
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  amountInAtomic: "1000000000000000000",
  economicBoundary: {
    availability: "unavailable" as const,
    source: "unavailable" as const,
  },
};

const prepared: NativeRpcPreparedExecution = {
  runId: "native-rpc-run",
  intent,
  chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
  protocol: "camelot-v3",
  blockContext: {
    blockNumber: "42",
    blockHash: "0xblock",
    observedAt: "2026-09-10T00:00:00.000Z",
  },
  quote: { estimatedAmountOut: "0.5", minimumAmountOut: "0.4" },
  unsignedTransaction: {
    kind: "unsigned",
    payload: {
      to: "0x2222222222222222222222222222222222222222",
      data: "0x1234",
      value: "0x0",
    },
  },
  gasEstimate: { gasUnits: "21000" },
  finality: { status: "finalized" },
};

function candidateField(
  candidatePath: string,
  value: CandidateField["value"],
  status: CandidateField["status"] = "observed",
): CandidateField {
  return {
    candidatePath,
    observedShape: "fixture_value",
    status,
    nullable: false,
    confidence: status === "observed" ? "high" : "low",
    reviewStatus: "pending_review",
    ...(value === undefined ? {} : { value }),
  };
}

function completeCandidateFields(): readonly CandidateField[] {
  return [
    candidateField("nativeRpc.ethCall.returnData", "0xabcdef"),
    candidateField("nativeRpc.estimateGas.gasUnits", "21000"),
  ];
}

function result(
  status: ProviderEvaluationResult["status"],
  candidateFields: readonly CandidateField[] = completeCandidateFields(),
  responseEvidence: ProviderEvaluationResult["responseEvidence"] = {
    kind: "reference",
    reference: "fixture://native-rpc",
  },
  capabilities: readonly string[] = NATIVE_RPC_CAPABILITIES,
  mode: GenericEvidenceMode = "MOCK",
): ProviderEvaluationResult {
  return {
    mode,
    provider: {
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      observedAt: "2026-09-10T00:01:00.000Z",
    },
    status,
    responseEvidence,
    candidateFields,
    capabilities,
  };
}

type ControlledCase = {
  readonly name: string;
  readonly status: ProviderEvaluationResult["status"];
  readonly candidateFields: readonly CandidateField[];
  readonly expectedProviderStatus:
    | "UNKNOWN"
    | "UNSUPPORTED"
    | "STALE"
    | "FAILED";
  readonly expectedExecutionStatus: "SUCCESS" | "UNKNOWN";
  readonly expectedIntegrationStatus: "OK" | "TIMEOUT" | "INTEGRATION_ERROR";
  readonly expectedFailureCode?: "TIMEOUT" | "INTEGRATION_ERROR";
  readonly expectedFreshness: "fresh" | "stale" | "unknown" | "not_checked";
  readonly preparedExecution?: NativeRpcPreparedExecution;
};

const incompletePrepared: NativeRpcPreparedExecution = {
  ...prepared,
  quote: { estimatedAmountOut: "not-a-number" },
  unsignedTransaction: {
    kind: "unsigned",
    payload: {
      to: "0x2222222222222222222222222222222222222222",
      data: undefined as unknown as string,
      value: "0x0",
    },
  },
};

const controlledCases: readonly ControlledCase[] = [
  {
    name: "success_partial",
    status: "success",
    candidateFields: [
      candidateField(
        "nativeRpc.ethCall.returnData",
        controlledNativeRpcFixtures.cases.success_partial.eth_call,
      ),
      candidateField(
        "nativeRpc.estimateGas.gasUnits",
        controlledNativeRpcFixtures.cases.success_partial.eth_estimateGas,
      ),
    ],
    expectedProviderStatus: "UNKNOWN",
    expectedExecutionStatus: "SUCCESS",
    expectedIntegrationStatus: "OK",
    expectedFreshness: "not_checked",
  },
  {
    name: "unknown_rpc_error",
    status: "unknown",
    candidateFields: [
      candidateField(
        "nativeRpc.ethCall.returnData",
        controlledNativeRpcFixtures.cases.unknown_rpc_error.message,
        "invalid",
      ),
    ],
    expectedProviderStatus: "UNKNOWN",
    expectedExecutionStatus: "UNKNOWN",
    expectedIntegrationStatus: "OK",
    expectedFreshness: "not_checked",
  },
  {
    name: "unsupported_method",
    status: "unsupported",
    candidateFields: [
      candidateField(
        "nativeRpc.ethCall.returnData",
        controlledNativeRpcFixtures.cases.unsupported_method.message,
        "invalid",
      ),
    ],
    expectedProviderStatus: "UNSUPPORTED",
    expectedExecutionStatus: "UNKNOWN",
    expectedIntegrationStatus: "OK",
    expectedFreshness: "not_checked",
  },
  {
    name: "failed_transport",
    status: "failed",
    candidateFields: [
      candidateField(
        "nativeRpc.ethCall.returnData",
        controlledNativeRpcFixtures.cases.failed_transport.error,
        "invalid",
      ),
    ],
    expectedProviderStatus: "FAILED",
    expectedExecutionStatus: "UNKNOWN",
    expectedIntegrationStatus: "INTEGRATION_ERROR",
    expectedFailureCode: "INTEGRATION_ERROR",
    expectedFreshness: "not_checked",
  },
  {
    name: "timeout",
    status: "timeout",
    candidateFields: [
      candidateField(
        "nativeRpc.ethCall.returnData",
        controlledNativeRpcFixtures.cases.timeout.error,
        "invalid",
      ),
    ],
    expectedProviderStatus: "FAILED",
    expectedExecutionStatus: "UNKNOWN",
    expectedIntegrationStatus: "TIMEOUT",
    expectedFailureCode: "TIMEOUT",
    expectedFreshness: "not_checked",
  },
  {
    name: "incomplete_prepared_execution",
    status: "unknown",
    candidateFields: [],
    expectedProviderStatus: "UNKNOWN",
    expectedExecutionStatus: "UNKNOWN",
    expectedIntegrationStatus: "OK",
    expectedFreshness: "not_checked",
    preparedExecution: incompletePrepared,
  },
  {
    name: "stale_pinned_block",
    status: "stale",
    candidateFields: [
      candidateField(
        "nativeRpc.ethCall.returnData",
        controlledNativeRpcFixtures.cases.stale_pinned_block.eth_call,
      ),
      candidateField(
        "nativeRpc.estimateGas.gasUnits",
        controlledNativeRpcFixtures.cases.stale_pinned_block.eth_estimateGas,
      ),
      candidateField("nativeRpc.freshness", {
        status: "stale",
        pinnedBlock:
          controlledNativeRpcFixtures.cases.stale_pinned_block.pinnedBlock,
        headBlock:
          controlledNativeRpcFixtures.cases.stale_pinned_block.eth_blockNumber,
        lag: "2",
        maxBlockLag:
          controlledNativeRpcFixtures.cases.stale_pinned_block.maxBlockLag,
      }),
    ],
    expectedProviderStatus: "STALE",
    expectedExecutionStatus: "UNKNOWN",
    expectedIntegrationStatus: "OK",
    expectedFreshness: "stale",
  },
];

describe("Backend Native RPC evidence seam", () => {
  it("reports the same Transaction Protection the prepared Camelot calldata encodes", async () => {
    const amountOutQuoted = 2n * 10n ** 18n;
    const declaredMinimumAtomic = "1750000000000000000";
    const rpcClient: ArbitrumRpcClient = {
      request: async () =>
        `0x${amountOutQuoted.toString(16).padStart(64, "0")}${"0".repeat(64)}`,
    };
    const adapter = new CamelotV3ProtocolAdapter({
      rpcClient,
      tokenOutDecimals: 18,
    });
    const protectedIntent: NormalizedSwapIntent = {
      ...intent,
      amountInAtomic: "1000000000000000",
      tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
      economicBoundary: {
        availability: "available",
        minimumReceivedAtomic: declaredMinimumAtomic,
        source: "user_declared",
      },
    };
    const blockContext = { blockNumber: "42" };
    const quote = await adapter.quote(protectedIntent, { blockContext });
    const unsignedTransaction = await adapter.buildTransaction(
      protectedIntent,
      { blockContext, quote },
    );
    const calldataMinimum = BigInt(
      `0x${String(unsignedTransaction.payload.data).slice(2 + 8 + 5 * 64, 2 + 8 + 6 * 64)}`,
    );
    const evidence = toNativeRpcGenericEvidence({
      intent: protectedIntent,
      tokenInDecimals: 18,
      tokenOutDecimals: 18,
      preparedExecution: {
        ...prepared,
        intent: protectedIntent,
        quote,
        blockContext,
        unsignedTransaction: unsignedTransaction as never,
      },
      providerResult: result("success"),
    });

    // The public Evidence must not silently fall back to the 99% protocol floor.
    expect(calldataMinimum).toBe(BigInt(declaredMinimumAtomic));
    expect(calldataMinimum).not.toBe((amountOutQuoted * 99n) / 100n);
    expect(evidence.intent.minimumReceivedSource).toBe("user_declared");
    expect(evidence.intent.minimumReceived).toBe(
      convertAtomicAmountToHuman(declaredMinimumAtomic, 18),
    );
    // Same source of truth: the reported protection round-trips to calldata.
    const roundTrip = convertHumanAmountToAtomic(
      evidence.intent.minimumReceived as string,
      18,
    );
    expect(roundTrip).toMatchObject({ success: true });
    if (roundTrip.success) {
      expect(BigInt(roundTrip.amountAtomic)).toBe(calldataMinimum);
    }
  });

  it("does not fabricate a caller declaration when the boundary is unavailable", async () => {
    const amountOutQuoted = 2n * 10n ** 18n;
    const rpcClient: ArbitrumRpcClient = {
      request: async () =>
        `0x${amountOutQuoted.toString(16).padStart(64, "0")}${"0".repeat(64)}`,
    };
    const adapter = new CamelotV3ProtocolAdapter({
      rpcClient,
      tokenOutDecimals: 18,
    });
    const derivedIntent: NormalizedSwapIntent = {
      ...intent,
      amountInAtomic: "1000000000000000",
      tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
    };
    const blockContext = { blockNumber: "42" };
    const quote = await adapter.quote(derivedIntent, { blockContext });
    const unsignedTransaction = await adapter.buildTransaction(derivedIntent, {
      blockContext,
      quote,
    });
    const evidence = toNativeRpcGenericEvidence({
      intent: derivedIntent,
      tokenInDecimals: 18,
      tokenOutDecimals: 18,
      preparedExecution: {
        ...prepared,
        intent: derivedIntent,
        quote,
        blockContext,
        unsignedTransaction: unsignedTransaction as never,
      },
      providerResult: result("success"),
    });

    const calldataMinimum = BigInt(
      `0x${String(unsignedTransaction.payload.data).slice(2 + 8 + 5 * 64, 2 + 8 + 6 * 64)}`,
    );
    expect(calldataMinimum).toBe((amountOutQuoted * 99n) / 100n);
    expect(evidence.intent.minimumReceived).toBeUndefined();
    expect(evidence.intent.minimumReceivedSource).toBe("unavailable");
  });

  it("keeps the controlled fixture explicitly non-live", () => {
    expect(controlledNativeRpcFixtures).toMatchObject({
      real: false,
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      protocol: "camelot-v3",
    });
    expect(Object.keys(controlledNativeRpcFixtures.cases)).toEqual([
      "success_partial",
      "unknown_rpc_error",
      "unsupported_method",
      "failed_transport",
      "timeout",
      "incomplete_prepared_execution",
      "stale_pinned_block",
    ]);
  });

  it.each(controlledCases)(
    "maps controlled fixture %s through the fail-closed evidence boundary",
    ({
      name,
      status,
      candidateFields,
      expectedProviderStatus,
      expectedExecutionStatus,
      expectedIntegrationStatus,
      expectedFailureCode,
      expectedFreshness,
      preparedExecution = prepared,
    }) => {
      const fixtureCase =
        controlledNativeRpcFixtures.cases[
          name as keyof typeof controlledNativeRpcFixtures.cases
        ];
      const evidence = toNativeRpcGenericEvidence({
        intent,
        tokenInDecimals: 18,
        tokenOutDecimals: 6,
        preparedExecution,
        providerResult: result(status, candidateFields, {
          kind: "reference",
          reference: `fixture://native-rpc/${name}/${JSON.stringify(
            fixtureCase,
          )}`,
        }),
      });

      expect(evidence.provider).toMatchObject({
        status: expectedProviderStatus,
        integrationStatus: expectedIntegrationStatus,
      });
      expect(evidence.execution.status).toBe(expectedExecutionStatus);
      expect(evidence.simulation.value).toMatchObject({
        halted: status !== "success",
      });
      expect(evidence.provenance).toMatchObject({
        fetchedAt: "2026-09-10T00:01:00.000Z",
        mode: "MOCK",
        source: "mock",
        simulationBlock: "42",
      });
      expect(evidence.provenance).not.toHaveProperty("observedChainId");
      expect(evidence.capabilities).toEqual(NATIVE_RPC_CAPABILITIES);
      expect(evidence.providerData).toMatchObject({
        nativeRpc: {
          status,
          freshness: { status: expectedFreshness },
        },
      });
      expect(evidence.unknownScope).toEqual(
        expect.arrayContaining(["receipt", "outcome", "assetChanges"]),
      );
      expect(evidence.unknownScope).toContain("simulation");

      if (expectedFailureCode === undefined) {
        expect(evidence.provider.failure).toBeUndefined();
      } else {
        expect(evidence.provider.failure).toMatchObject({
          code: expectedFailureCode,
          integrationStatus: expectedIntegrationStatus,
          retryable: status === "timeout",
          source: "rpc",
        });
      }

      if (name === "success_partial") {
        expect(evidence.checkedScope).toEqual(
          expect.arrayContaining([
            "native-rpc.eth_call",
            "native-rpc.estimateGas",
          ]),
        );
        expect(evidence.providerData).toMatchObject({
          nativeRpc: {
            callReturnData:
              controlledNativeRpcFixtures.cases.success_partial.eth_call,
            gasUnits:
              controlledNativeRpcFixtures.cases.success_partial.eth_estimateGas,
          },
        });
      }
      if (name === "incomplete_prepared_execution") {
        expect(evidence.unknownScope).toEqual(
          expect.arrayContaining(["quote", "action"]),
        );
        expect(evidence.providerData).toMatchObject({
          nativeRpc: {
            notChecked: expect.arrayContaining([
              "native-rpc.eth_call",
              "native-rpc.estimateGas",
            ]),
          },
        });
      }
      if (name === "stale_pinned_block") {
        expect(evidence.checkedScope).toEqual(
          expect.arrayContaining([
            "native-rpc.eth_call",
            "native-rpc.estimateGas",
          ]),
        );
        expect(evidence.unknownScope).toContain("freshness");
        expect(evidence.providerData).toMatchObject({
          nativeRpc: {
            freshness: {
              status: "stale",
              pinnedBlock:
                controlledNativeRpcFixtures.cases.stale_pinned_block
                  .pinnedBlock,
              headBlock:
                controlledNativeRpcFixtures.cases.stale_pinned_block
                  .eth_blockNumber,
              maxBlockLag:
                controlledNativeRpcFixtures.cases.stale_pinned_block
                  .maxBlockLag,
            },
          },
        });
      }
    },
  );

  it("maps complete freshness metadata and preserves RPC provenance and capabilities", () => {
    const evidence = toNativeRpcGenericEvidence({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult: result(
        "success",
        [
          ...completeCandidateFields(),
          candidateField("nativeRpc.freshness", {
            status: "fresh",
            pinnedBlock: "42",
            headBlock: "43",
            lag: "1",
            maxBlockLag: 2,
          }),
        ],
        {
          kind: "redacted_snapshot",
          redactionProfile: "controlled-native-rpc",
          snapshot: { mode: "LIVE" },
        },
        ["eth_call", "estimateGas"],
        "LIVE",
      ),
    });

    expect(evidence.providerData).toMatchObject({
      nativeRpc: {
        freshness: {
          status: "fresh",
          pinnedBlock: "42",
          headBlock: "43",
          lag: "1",
          maxBlockLag: 2,
        },
      },
    });
    expect(evidence.checkedScope).toEqual(
      expect.arrayContaining([
        "native-rpc.eth_call",
        "native-rpc.estimateGas",
        "native-rpc.freshness",
      ]),
    );
    expect(evidence.unknownScope).not.toContain("freshness");
    expect(evidence.provenance).toMatchObject({
      mode: "LIVE",
      source: "rpc",
    });
    expect(evidence.simulation.reproducibility).toBe("REPRODUCIBLE");
    expect(evidence.capabilities).toEqual(["eth_call", "estimateGas"]);
    expect(evidence.provenance).not.toHaveProperty("observedChainId");
  });

  it("marks malformed or non-observed freshness as unknown rather than fresh", () => {
    const incomplete = toNativeRpcGenericEvidence({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult: result("success", [
        ...completeCandidateFields(),
        candidateField("nativeRpc.freshness", {
          status: "fresh",
          pinnedBlock: "42",
        }),
      ]),
    });
    const unavailable = toNativeRpcGenericEvidence({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult: result("success", [
        ...completeCandidateFields(),
        candidateField(
          "nativeRpc.freshness",
          "provider did not return freshness",
          "missing",
        ),
      ]),
    });

    expect(incomplete.providerData).toMatchObject({
      nativeRpc: { freshness: { status: "unknown" } },
    });
    expect(incomplete.unknownScope).toContain("freshness");
    expect(unavailable.providerData).toMatchObject({
      nativeRpc: {
        freshness: {
          status: "unknown",
          reason: "provider did not return freshness",
        },
      },
    });
    expect(unavailable.unknownScope).toContain("freshness");
  });

  it("maps a partial success to non-success evidence without observedChainId", () => {
    const evidence = toNativeRpcGenericEvidence({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult: result("success"),
    });
    expect(evidence.provider.status).toBe("UNKNOWN");
    expect(evidence.execution.status).toBe("SUCCESS");
    expect(evidence.unknownScope).toEqual(
      expect.arrayContaining([
        "receipt",
        "outcome",
        "assetChanges",
        "simulation",
      ]),
    );
    expect(evidence.provenance).not.toHaveProperty("observedChainId");
  });

  it("never projects diagnostic text from a non-observed call field as callReturnData", () => {
    const diagnostic = "eth_call returned a non-hex result";
    const evidence = toNativeRpcGenericEvidence({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult: result("unknown", [
        candidateField("nativeRpc.ethCall.returnData", diagnostic, "invalid"),
        candidateField(
          "nativeRpc.estimateGas.gasUnits",
          "gas unavailable",
          "missing",
        ),
      ]),
    });

    const nativeRpc = evidence.providerData.nativeRpc as Record<
      string,
      unknown
    >;
    expect(nativeRpc).not.toHaveProperty("callReturnData");
    expect(nativeRpc).not.toHaveProperty("gasUnits");
    expect(evidence.unknownScope).toEqual(
      expect.arrayContaining(["native-rpc.eth_call", "native-rpc.estimateGas"]),
    );
    expect(evidence.checkedScope).not.toContain("native-rpc.eth_call");
    expect(JSON.stringify(evidence)).not.toContain(diagnostic);
  });

  it("preserves non-success provider evidence", () => {
    const evidence = toNativeRpcGenericEvidence({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult: result("unknown"),
    });
    expect(evidence.provider.status).toBe("UNKNOWN");
    expect(evidence.simulation.value).toMatchObject({ halted: true });
    expect(evidence.unknownScope).toEqual(
      expect.arrayContaining(["simulation"]),
    );
  });
});
