import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import controlledNativeRpcFixtures from "../../../../fixtures/provider-registry/be-011/native-rpc/controlled-p0-b/fixtures.json";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  createNativeRpcProvider,
  NATIVE_RPC_ARBITRUM_PROVIDER_ID,
  NATIVE_RPC_CAPABILITIES,
  type NativeRpcClient,
  type NativeRpcPreparedExecution,
  NativeRpcProvider,
  toNativeRpcGenericEvidence,
} from "./native-rpc-provider.js";
import { evaluateProviderAdapter } from "./provider-adapter.js";

const intent: NormalizedSwapIntent = {
  chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
  protocol: "camelot-v3",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: {
    kind: "erc20",
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  amountInAtomic: "1000000000000000000",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

const prepared: NativeRpcPreparedExecution<NormalizedSwapIntent> = {
  runId: "native-rpc-run",
  intent,
  chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
  protocol: "camelot-v3",
  blockContext: {
    blockNumber: "42",
    blockHash: "0xblock",
    observedAt: "2026-09-10T00:00:00.000Z",
  },
  quote: {
    estimatedAmountOut: "0.5",
    minimumAmountOut: "0.4",
  },
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

function clientFor(responses: Record<string, unknown>): NativeRpcClient & {
  calls: Array<{ method: string; params: readonly unknown[] }>;
} {
  const calls: Array<{ method: string; params: readonly unknown[] }> = [];
  return {
    calls,
    async request(method, params = []) {
      calls.push({ method, params });
      const response = responses[method];
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

describe("NativeRpcProvider", () => {
  it("keeps controlled fixture inputs explicitly non-live", () => {
    expect(controlledNativeRpcFixtures).toMatchObject({
      real: false,
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      protocol: "camelot-v3",
    });
  });

  it("supports only the Arbitrum Camelot simulation seam without side effects", () => {
    const provider = new NativeRpcProvider({ client: clientFor({}) });

    expect(provider.adapter.providerId).toBe(NATIVE_RPC_ARBITRUM_PROVIDER_ID);
    expect(provider.adapter.capabilities).toEqual(NATIVE_RPC_CAPABILITIES);
    expect(
      provider.adapter.supports({
        intent,
        chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
        protocol: "camelot-v3",
        capability: "simulate",
      }),
    ).toBe(true);
    expect(
      provider.adapter.supports({
        intent,
        chainId: 1,
        protocol: "camelot-v3",
        capability: "simulate",
      }),
    ).toBe(false);
    expect(
      provider.adapter.supports({
        intent,
        chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
        protocol: "camelot-v3",
        capability: "state-diff",
      }),
    ).toBe(false);
  });

  it("evaluates a prepared transaction with eth_call and estimateGas at the pinned block", async () => {
    const client = clientFor({
      eth_call: "0xabcdef",
      eth_estimateGas: "0x5208",
    });
    const provider = createNativeRpcProvider({
      client,
      mode: "MOCK",
      now: () => "2026-09-10T00:01:00.000Z",
    });

    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });

    expect(result).toMatchObject({
      provider: {
        providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
        observedAt: "2026-09-10T00:01:00.000Z",
      },
      status: "success",
      capabilities: expect.arrayContaining([
        "eth_call",
        "estimateGas",
        "pinned-block",
      ]),
    });
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.ethCall.returnData",
          status: "observed",
          value: "0xabcdef",
        }),
        expect.objectContaining({
          candidatePath: "nativeRpc.estimateGas.gasUnits",
          status: "observed",
          value: "21000",
        }),
        expect.objectContaining({
          candidatePath: "nativeRpc.blockContext.blockNumber",
          value: "42",
        }),
      ]),
    );
    expect(client.calls).toEqual([
      {
        method: "eth_call",
        params: [
          {
            from: intent.sender,
            to: "0x2222222222222222222222222222222222222222",
            data: "0x1234",
            value: "0x0",
          },
          "0x2a",
        ],
      },
      {
        method: "eth_estimateGas",
        params: [
          {
            from: intent.sender,
            to: "0x2222222222222222222222222222222222222222",
            data: "0x1234",
            value: "0x0",
          },
          "0x2a",
        ],
      },
    ]);
  });

  it.each([
    [
      "unsupported",
      Object.assign(new Error("method not found"), { rpcCode: -32601 }),
    ],
    [
      "unknown",
      Object.assign(new Error("invalid params"), { rpcCode: -32602 }),
    ],
    ["failed", new Error("network connection failed")],
    [
      "timeout",
      Object.assign(new Error("request timed out"), { name: "AbortError" }),
    ],
  ] as const)(
    "classifies eth_call %s without fabricating success",
    async (status, failure) => {
      const client = clientFor({ eth_call: failure });
      const provider = createNativeRpcProvider({ client, mode: "MOCK" });

      const result = await evaluateProviderAdapter(provider, {
        runId: prepared.runId,
        intent,
        chainId: prepared.chainId,
        protocol: prepared.protocol,
        input: prepared,
      });

      expect(result.status).toBe(status);
      expect(result.candidateFields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidatePath: "nativeRpc.ethCall.returnData",
            status: "missing",
          }),
        ]),
      );
    },
  );

  it("bounds a hanging RPC request as timeout", async () => {
    const provider = createNativeRpcProvider({
      client: {
        request: async () => new Promise<never>(() => undefined),
      },
      mode: "MOCK",
      timeoutMs: 1,
    });

    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });

    expect(result.status).toBe("timeout");
  });

  it("returns UNKNOWN for incomplete prepared execution instead of calling an unbound RPC", async () => {
    const client = clientFor({
      eth_call: "0xabcdef",
      eth_estimateGas: "0x5208",
    });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });

    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: {
        ...prepared,
        unsignedTransaction: { kind: "unsigned", payload: {} },
      },
    });

    expect(result.status).toBe("unknown");
    expect(client.calls).toHaveLength(0);
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.preparedExecution",
          status: "invalid",
        }),
      ]),
    );
  });

  it("returns UNKNOWN before RPC when required gas preparation is missing", async () => {
    const client = clientFor({
      eth_call: "0xabcdef",
      eth_estimateGas: "0x5208",
    });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });

    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: {
        ...prepared,
        gasEstimate: undefined,
      } as unknown as NativeRpcPreparedExecution<NormalizedSwapIntent>,
    });

    expect(result.status).toBe("unknown");
    expect(client.calls).toHaveLength(0);
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.preparedExecution",
          status: "invalid",
        }),
      ]),
    );
  });

  it("returns UNKNOWN before RPC when the unsigned transaction is missing", async () => {
    const client = clientFor({
      eth_call: "0xabcdef",
      eth_estimateGas: "0x5208",
    });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });

    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: {
        ...prepared,
        unsignedTransaction: undefined,
      } as unknown as NativeRpcPreparedExecution<NormalizedSwapIntent>,
    });

    expect(result.status).toBe("unknown");
    expect(client.calls).toHaveLength(0);
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.preparedExecution",
          status: "invalid",
        }),
      ]),
    );
  });

  it.each([
    [
      "missing prepared intent",
      {
        ...prepared,
        intent: undefined,
      },
    ],
    [
      "mismatched prepared run ID",
      {
        ...prepared,
        runId: "different-run",
      },
    ],
    [
      "missing prepared quote",
      {
        ...prepared,
        quote: undefined,
      },
    ],
  ] as const)("returns UNKNOWN before RPC for %s", async (_label, input) => {
    const client = clientFor({
      eth_call: "0xabcdef",
      eth_estimateGas: "0x5208",
    });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });

    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input:
        input as unknown as NativeRpcPreparedExecution<NormalizedSwapIntent>,
    });

    expect(result.status).toBe("unknown");
    expect(client.calls).toHaveLength(0);
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.preparedExecution",
          status: "invalid",
        }),
      ]),
    );
  });

  it("returns UNKNOWN before RPC when the request intent differs from prepared execution", async () => {
    const client = clientFor({
      eth_call: "0xabcdef",
      eth_estimateGas: "0x5208",
    });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });
    const mismatchedIntent = {
      ...intent,
      amountInAtomic: "2000000000000000000",
    };

    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent: mismatchedIntent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });

    expect(result.status).toBe("unknown");
    expect(client.calls).toHaveLength(0);
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.preparedExecution",
          status: "invalid",
        }),
      ]),
    );
  });

  it("returns UNKNOWN before RPC when the prepared transaction sender differs from the intent", async () => {
    const client = clientFor({
      eth_call: "0xabcdef",
      eth_estimateGas: "0x5208",
    });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });
    const mismatchedSender = "0x3333333333333333333333333333333333333333";

    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: {
        ...prepared,
        unsignedTransaction: {
          ...prepared.unsignedTransaction,
          payload: {
            ...prepared.unsignedTransaction.payload,
            from: mismatchedSender,
          },
        },
      },
    });

    expect(result.status).toBe("unknown");
    expect(client.calls).toHaveLength(0);
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.preparedExecution",
          status: "invalid",
        }),
      ]),
    );
  });

  it("classifies a pinned block as stale only when the explicit freshness probe exceeds policy", async () => {
    const client = clientFor({
      eth_call: "0xabcdef",
      eth_estimateGas: "0x5208",
      eth_blockNumber: "0x2c",
    });
    const provider = createNativeRpcProvider({
      client,
      mode: "MOCK",
      checkFreshness: true,
      maxBlockLag: 1,
    });

    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });

    expect(result.status).toBe("stale");
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.freshness",
          status: "observed",
          value: expect.objectContaining({ status: "stale", headBlock: "44" }),
        }),
      ]),
    );
  });

  it("preserves an unverifiable freshness probe as UNKNOWN metadata", async () => {
    const client = clientFor({
      eth_call: "0xabcdef",
      eth_estimateGas: "0x5208",
      eth_blockNumber: "0x20",
    });
    const provider = createNativeRpcProvider({
      client,
      mode: "MOCK",
      checkFreshness: true,
    });
    const providerResult = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });

    expect(providerResult.status).toBe("unknown");
    const evidence = toNativeRpcGenericEvidence({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult,
    });

    expect(evidence.providerData).toMatchObject({
      nativeRpc: {
        freshness: {
          status: "unknown",
          reason: "RPC head is behind the pinned block",
        },
      },
    });
  });

  it("maps partial native evidence to explicit UNKNOWN scopes and preserves metadata", async () => {
    const client = clientFor({
      eth_call: "0xabcdef",
      eth_estimateGas: "0x5208",
    });
    const provider = createNativeRpcProvider({
      client,
      mode: "MOCK",
      now: () => "2026-09-10T00:01:00.000Z",
    });
    const providerResult = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });

    const evidence = toNativeRpcGenericEvidence({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult,
    });

    expect(evidence.provider).toMatchObject({
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      status: "UNKNOWN",
      integrationStatus: "OK",
    });
    expect(evidence.execution.status).toBe("SUCCESS");
    expect(evidence.checkedScope).toEqual(
      expect.arrayContaining([
        "native-rpc.eth_call",
        "native-rpc.estimateGas",
        "native-rpc.pinned-block",
      ]),
    );
    expect(evidence.unknownScope).toEqual(
      expect.arrayContaining([
        "receipt",
        "outcome",
        "assetChanges",
        "simulation",
      ]),
    );
    expect(evidence.capabilities).toEqual(
      expect.arrayContaining(["eth_call", "estimateGas", "pinned-block"]),
    );
    expect(evidence.provenance).toMatchObject({
      mode: "MOCK",
      source: "mock",
      simulationBlock: "42",
      fetchedAt: "2026-09-10T00:01:00.000Z",
    });
    expect(evidence.providerData).toMatchObject({
      nativeRpc: expect.objectContaining({
        freshness: expect.objectContaining({ status: "not_checked" }),
        notChecked: expect.arrayContaining([
          "receipt",
          "outcome",
          "assetChanges",
        ]),
      }),
    });
    expect(evidence.quote.value).toEqual({
      estimatedAmountOut: "0.5",
      minimumAmountOut: "0.4",
    });
  });

  it("maps transport failures to FAILED integration evidence without treating them as OK", async () => {
    const provider = createNativeRpcProvider({
      client: clientFor({ eth_call: new Error("network connection failed") }),
      mode: "MOCK",
    });
    const providerResult = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });

    const evidence = toNativeRpcGenericEvidence({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult,
    });

    expect(evidence.provider).toMatchObject({
      status: "FAILED",
      integrationStatus: "INTEGRATION_ERROR",
      failure: {
        code: "INTEGRATION_ERROR",
        integrationStatus: "INTEGRATION_ERROR",
      },
    });
  });

  it("never invokes raw RPC when supports rejects the requested chain or protocol", () => {
    const client = clientFor({});
    const provider = createNativeRpcProvider({ client });
    expect(
      provider.supports({
        intent,
        chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
        protocol: "kuru",
        capability: "simulate",
      }),
    ).toBe(false);
    expect(client.calls).toEqual([]);
  });

  it("does not expose the raw client through the public adapter", () => {
    const provider = new NativeRpcProvider({ client: clientFor({}) });
    expect(Object.keys(provider.adapter)).toEqual([
      "providerId",
      "capabilities",
      "supports",
    ]);
    expect(
      (provider.adapter as unknown as Record<string, unknown>).client,
    ).toBeUndefined();
  });
});
