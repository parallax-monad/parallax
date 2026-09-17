import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import controlledNativeRpcFixtures from "../../../../fixtures/provider-registry/be-011/native-rpc/controlled-p0-b/fixtures.json";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  NATIVE_RPC_ARBITRUM_PROVIDER_ID,
  NATIVE_RPC_CAPABILITIES,
  type NativeRpcPreparedExecution,
  toNativeRpcGenericEvidence,
} from "./native-rpc-evidence.js";
import type { ProviderEvaluationResult } from "./provider-adapter.js";

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

function result(status: "success" | "unknown"): ProviderEvaluationResult {
  return {
    provider: {
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      observedAt: "2026-09-10T00:01:00.000Z",
    },
    status,
    responseEvidence: {
      kind: "reference" as const,
      reference: "fixture://native-rpc",
    },
    candidateFields: [
      {
        candidatePath: "nativeRpc.ethCall.returnData",
        observedShape: "hex_string",
        status: "observed" as const,
        value: "0xabcdef",
        nullable: false,
        confidence: "high",
        reviewStatus: "pending_review" as const,
      },
      {
        candidatePath: "nativeRpc.estimateGas.gasUnits",
        observedShape: "decimal_string",
        status: "observed" as const,
        value: "21000",
        nullable: false,
        confidence: "high",
        reviewStatus: "pending_review" as const,
      },
    ],
    capabilities: NATIVE_RPC_CAPABILITIES,
  };
}

describe("Backend Native RPC evidence seam", () => {
  it("keeps the controlled fixture explicitly non-live", () => {
    expect(controlledNativeRpcFixtures).toMatchObject({
      real: false,
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      protocol: "camelot-v3",
    });
  });

  it("maps partial success to non-success evidence without observedChainId", () => {
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
