import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import controlledNativeRpcFixtures from "../../../../fixtures/provider-registry/be-011/native-rpc/controlled-p0-b/fixtures.json";
import { NativeRpcClientError } from "./native-rpc-client.js";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  createNativeRpcProvider,
  NATIVE_RPC_ARBITRUM_PROVIDER_ID,
  NATIVE_RPC_CAPABILITIES,
  type NativeRpcClient,
  type NativeRpcPreparedExecution,
  NativeRpcProvider,
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
    blockHash: `0x${"a".repeat(64)}`,
    observedAt: "2026-09-10T00:00:00.000Z",
  },
  quote: {
    estimatedAmountOut: "0.5",
    minimumAmountOut: "0.4",
  },
  unsignedTransaction: {
    kind: "unsigned",
    payload: {
      from: intent.sender,
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
      if (method === "eth_chainId" && !Object.hasOwn(responses, method)) {
        return "0x66eee";
      }
      if (
        method === "eth_getBlockByNumber" &&
        !Object.hasOwn(responses, method)
      ) {
        return { number: "0x2a", hash: prepared.blockContext.blockHash };
      }
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
    const provider = new NativeRpcProvider({
      client: clientFor({}),
      mode: "MOCK",
    });

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

  it("fails closed on a wrong observed chain before block or transaction RPC", async () => {
    const client = clientFor({ eth_chainId: "0x1" });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });
    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });
    expect(result.status).toBe("unknown");
    expect(client.calls).toEqual([{ method: "eth_chainId", params: [] }]);
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.chainId",
          status: "observed",
          value: "0x1",
        }),
      ]),
    );
    expect(result.responseEvidence).toMatchObject({
      kind: "redacted_snapshot",
      snapshot: {
        methods: { eth_chainId: "0x1", eth_call: null, eth_estimateGas: null },
      },
    });
  });

  it.each(["421614", "0x", undefined])(
    "rejects malformed chain identity %s before block or transaction RPC",
    async (chainId) => {
      const client = clientFor({ eth_chainId: chainId });
      const provider = createNativeRpcProvider({ client, mode: "MOCK" });
      const result = await evaluateProviderAdapter(provider, {
        runId: prepared.runId,
        intent,
        chainId: prepared.chainId,
        protocol: prepared.protocol,
        input: prepared,
      });
      expect(result.status).toBe("unknown");
      expect(client.calls).toEqual([{ method: "eth_chainId", params: [] }]);
      expect(result.candidateFields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidatePath: "nativeRpc.chainId",
            status: "invalid",
          }),
        ]),
      );
    },
  );

  it.each([
    ["failed", new Error("network unavailable")],
    ["timeout", Object.assign(new Error("timed out"), { name: "AbortError" })],
    [
      "unsupported",
      Object.assign(new Error("method missing"), { rpcCode: -32601 }),
    ],
  ] as const)(
    "preserves %s chain RPC failure without later calls",
    async (status, error) => {
      const client = clientFor({ eth_chainId: error });
      const provider = createNativeRpcProvider({ client, mode: "MOCK" });
      const result = await evaluateProviderAdapter(provider, {
        runId: prepared.runId,
        intent,
        chainId: prepared.chainId,
        protocol: prepared.protocol,
        input: prepared,
      });
      expect(result.status).toBe(status);
      expect(client.calls).toEqual([{ method: "eth_chainId", params: [] }]);
      expect(result.candidateFields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidatePath: "nativeRpc.chainId",
            status: "missing",
          }),
        ]),
      );
    },
  );

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
          candidatePath: "nativeRpc.chainId",
          status: "observed",
          value: "0x66eee",
        }),
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
      { method: "eth_chainId", params: [] },
      {
        method: "eth_getBlockByNumber",
        params: ["0x2a", false],
      },
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

  it("uses the concrete JSON-RPC client when an explicit endpoint is supplied", async () => {
    const requests: Array<{ id: number; method: string; params: unknown[] }> =
      [];
    const provider = createNativeRpcProvider({
      rpcUrl: "https://rpc.example.test",
      mode: "MOCK",
      fetchImplementation: (async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        requests.push(request);
        const result =
          request.method === "eth_chainId"
            ? "0x66eee"
            : request.method === "eth_getBlockByNumber"
              ? { number: "0x2a", hash: prepared.blockContext.blockHash }
              : request.method === "eth_call"
                ? "0xabcdef"
                : "0x5208";
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
        );
      }) as typeof fetch,
    });
    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });
    expect(result.status).toBe("success");
    expect(requests.map((request) => request.method)).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_call",
      "eth_estimateGas",
    ]);
    expect(requests.map((request) => request.id)).toEqual([1, 2, 3, 4]);
    expect(requests[2]?.params).toEqual([
      prepared.unsignedTransaction.payload,
      "0x2a",
    ]);
    expect(requests[3]?.params).toEqual([
      prepared.unsignedTransaction.payload,
      "0x2a",
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
    ["unknown", Object.assign(new Error("execution reverted"), { rpcCode: 3 })],
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

  it.each([
    ["missing sender", { from: undefined }],
    ["missing value", { value: undefined }],
    ["wrong chain", { chainId: "0x1" }],
    ["malformed calldata", { data: "0x123" }],
  ])("rejects %s before any RPC call", async (_label, changes) => {
    const client = clientFor({ eth_call: "0x", eth_estimateGas: "0x5208" });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });
    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: {
        ...prepared,
        unsignedTransaction: {
          kind: "unsigned",
          payload: { ...prepared.unsignedTransaction.payload, ...changes },
        },
      },
    });
    expect(result.status).toBe("unknown");
    expect(client.calls).toEqual([]);
  });

  it("keeps the exact prepared transaction including value and extra RPC fields", async () => {
    const client = clientFor({ eth_call: "0x", eth_estimateGas: "0x5208" });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });
    const payload = {
      ...prepared.unsignedTransaction.payload,
      value: "0x1",
      gas: "0x5208",
    };
    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: {
        ...prepared,
        unsignedTransaction: { kind: "unsigned", payload },
      },
    });
    expect(result.status).toBe("success");
    expect(client.calls[2]?.params).toEqual([payload, "0x2a"]);
    expect(client.calls[3]?.params).toEqual([payload, "0x2a"]);
    expect(payload).toEqual({
      ...prepared.unsignedTransaction.payload,
      value: "0x1",
      gas: "0x5208",
    });
  });

  it("does not fall back to latest when estimateGas rejects the block parameter", async () => {
    const client = clientFor({
      eth_call: "0x",
      eth_estimateGas: Object.assign(new Error("invalid params"), {
        rpcCode: -32602,
      }),
    });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });
    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });
    expect(result.status).toBe("unknown");
    expect(
      client.calls.filter((call) => call.method === "eth_estimateGas"),
    ).toEqual([
      {
        method: "eth_estimateGas",
        params: [prepared.unsignedTransaction.payload, "0x2a"],
      },
    ]);
  });

  it("rejects a pinned block hash mismatch before transaction evaluation", async () => {
    const client = clientFor({
      eth_getBlockByNumber: {
        number: "0x2a",
        hash: `0x${"b".repeat(64)}`,
      },
      eth_call: "0x",
      eth_estimateGas: "0x5208",
    });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });
    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });
    expect(result.status).toBe("unknown");
    expect(client.calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
    ]);
    // A later pinned-block failure must not erase the truthful chain identity
    // that was already observed.
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.chainId",
          status: "observed",
          value: "0x66eee",
        }),
        expect.objectContaining({
          candidatePath: "nativeRpc.pinnedBlock",
          status: "invalid",
        }),
      ]),
    );
  });

  it("retains observed chain identity when the pinned block RPC fails", async () => {
    const client = clientFor({
      eth_getBlockByNumber: new NativeRpcClientError(
        "NETWORK_FAILURE",
        "endpoint unreachable",
      ),
    });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });
    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });
    expect(result.status).toBe("failed");
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.chainId",
          status: "observed",
          value: "0x66eee",
        }),
        expect.objectContaining({
          candidatePath: "nativeRpc.pinnedBlock",
          status: "missing",
        }),
      ]),
    );
  });

  it("retains chain and verified block evidence when eth_call returns non-hex data", async () => {
    const client = clientFor({
      eth_call: "not-hex",
      eth_estimateGas: "0x5208",
    });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });
    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });
    expect(result.status).toBe("unknown");
    expect(client.calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_call",
    ]);
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.chainId",
          status: "observed",
          value: "0x66eee",
        }),
        expect.objectContaining({
          candidatePath: "nativeRpc.blockContext.blockNumber",
          status: "observed",
          value: "42",
        }),
        expect.objectContaining({
          candidatePath: "nativeRpc.blockContext.blockHash",
          status: "observed",
          value: prepared.blockContext.blockHash,
        }),
        expect.objectContaining({
          candidatePath: "nativeRpc.ethCall.returnData",
          status: "invalid",
        }),
      ]),
    );
    // Diagnostic text is semantic metadata, never candidate return data.
    const callField = result.candidateFields.find(
      (field) => field.candidatePath === "nativeRpc.ethCall.returnData",
    );
    expect(callField?.value).toBeUndefined();
    expect(callField?.semanticNote).toBe("eth_call returned a non-hex result");
    expect(result.responseEvidence).toMatchObject({
      kind: "redacted_snapshot",
      snapshot: {
        methods: { eth_chainId: "0x66eee", eth_call: null },
      },
    });
  });

  it.each([
    [
      "an object cycle",
      () => {
        const cyclic: Record<string, unknown> = { estimatedAmountOut: "0.5" };
        cyclic.self = cyclic;
        return cyclic;
      },
    ],
    [
      "an array cycle",
      () => {
        const cyclic: unknown[] = [];
        cyclic.push(cyclic);
        return cyclic;
      },
    ],
    ["a non-JSON bigint", () => ({ estimatedAmountOut: 1n })],
  ])(
    "fails closed without recursion for %s in the prepared quote",
    async (_label, makeQuote) => {
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
        input: { ...prepared, quote: makeQuote() },
      });

      expect(result.status).toBe("unknown");
      expect(client.calls).toHaveLength(0);
      expect(result.candidateFields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidatePath: "nativeRpc.preparedExecution",
            status: "invalid",
            semanticNote:
              "Native RPC requires a JSON-serializable prepared quote",
          }),
        ]),
      );
    },
  );

  it("rejects malformed gas quantity as incomplete evidence", async () => {
    const client = clientFor({ eth_call: "0x", eth_estimateGas: "21000" });
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });
    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });
    expect(result.status).toBe("unknown");
  });

  it("cancels a hanging injected client when the Provider deadline expires", async () => {
    let signal: AbortSignal | undefined;
    const provider = createNativeRpcProvider({
      client: {
        request: async (_method, _params, options) => {
          signal = options?.signal;
          return new Promise<never>(() => undefined);
        },
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
    expect(signal?.aborted).toBe(true);
  });

  it("honors configured cancellation without issuing transaction calls", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = clientFor({ eth_call: "0x", eth_estimateGas: "0x5208" });
    const provider = createNativeRpcProvider({
      client,
      mode: "MOCK",
      signal: controller.signal,
    });
    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });
    expect(result.status).toBe("unknown");
    expect(client.calls).toEqual([]);
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
  it("never invokes raw RPC when supports rejects the requested chain or protocol", () => {
    const client = clientFor({});
    const provider = createNativeRpcProvider({ client, mode: "MOCK" });
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
    const provider = new NativeRpcProvider({
      client: clientFor({}),
      mode: "MOCK",
    });
    expect(Object.keys(provider.adapter)).toEqual([
      "providerId",
      "capabilities",
      "supports",
    ]);
    expect(
      (provider.adapter as unknown as Record<string, unknown>).client,
    ).toBeUndefined();
  });

  it("requires an explicit mode whenever a client or rpcUrl is supplied", () => {
    // A silent `MOCK` fallback would label real RPC observations as
    // `source: mock` / `NOT_REPRODUCIBLE`, so endpoint-backed construction
    // must fail closed rather than falsify provenance.
    expect(() => new NativeRpcProvider({ client: clientFor({}) })).toThrow(
      TypeError,
    );
    expect(() =>
      createNativeRpcProvider({ rpcUrl: "https://rpc.example.invalid" }),
    ).toThrow(TypeError);
    expect(
      new NativeRpcProvider({ client: clientFor({}), mode: "LIVE" }).adapter
        .providerId,
    ).toBe(NATIVE_RPC_ARBITRUM_PROVIDER_ID);
  });

  it("does not copy an injected client's arbitrary error message into evidence", async () => {
    const leaked =
      "https://secret-endpoint.invalid/?apikey=SUPERSECRET token=0xdeadbeef";
    const client = clientFor({
      eth_chainId: new NativeRpcClientError("NETWORK_FAILURE", leaked),
    });
    const provider = createNativeRpcProvider({ client, mode: "LIVE" });
    const result = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-endpoint.invalid");
    expect(serialized).not.toContain("SUPERSECRET");
    expect(serialized).not.toContain("0xdeadbeef");
    expect(result.status).toBe("failed");
    expect(result.responseEvidence).toMatchObject({
      kind: "redacted_snapshot",
      snapshot: {
        mode: "LIVE",
        failure: {
          status: "failed",
          message: "Native RPC request could not reach the endpoint",
        },
      },
    });
  });

  it("keeps kind-derived failure text across every client failure kind", async () => {
    const cases = [
      ["TIMEOUT", "timeout", "Native RPC request timed out"],
      ["ABORTED", "unknown", "Native RPC request was aborted"],
      [
        "HTTP_FAILURE",
        "failed",
        "Native RPC endpoint returned a failing HTTP status",
      ],
      [
        "JSON_PARSE_FAILURE",
        "unknown",
        "Native RPC response was not valid JSON",
      ],
      [
        "INVALID_ENVELOPE",
        "unknown",
        "Native RPC response envelope was malformed",
      ],
      [
        "ID_MISMATCH",
        "unknown",
        "Native RPC response id did not match the request id",
      ],
      [
        "MISSING_RESULT",
        "unknown",
        "Native RPC response did not contain a result",
      ],
      ["RPC_ERROR", "failed", "Native RPC endpoint returned a JSON-RPC error"],
    ] as const;

    for (const [kind, status, message] of cases) {
      const client = clientFor({
        eth_chainId: new NativeRpcClientError(kind, "attacker controlled text"),
      });
      const provider = createNativeRpcProvider({ client, mode: "LIVE" });
      const result = await evaluateProviderAdapter(provider, {
        runId: prepared.runId,
        intent,
        chainId: prepared.chainId,
        protocol: prepared.protocol,
        input: prepared,
      });
      expect(result.status).toBe(status);
      expect(JSON.stringify(result)).not.toContain("attacker controlled text");
      expect(result.responseEvidence).toMatchObject({
        kind: "redacted_snapshot",
        snapshot: { failure: { status, message } },
      });
    }
  });
});
