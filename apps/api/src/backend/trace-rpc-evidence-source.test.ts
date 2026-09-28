import { describe, expect, it, vi } from "vitest";
import { NativeRpcClientError } from "./native-rpc-client.js";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  type NativeRpcIntent,
  type NativeRpcPreparedExecution,
} from "./native-rpc-evidence.js";
import { fingerprintPreparedTransaction } from "./prepared-transaction-fingerprint.js";
import {
  createTraceRpcEvidenceSource,
  type TraceCapabilityFailureReason,
  type TraceRpcClient,
  type TraceRpcEvidenceInput,
} from "./trace-rpc-evidence-source.js";

const FROM = `0x${"11".repeat(20)}`;
const TO = `0x${"22".repeat(20)}`;
const CHANGED = `0x${"33".repeat(20)}`;
const BLOCK_HASH = `0x${"aa".repeat(32)}`;
const OTHER_BLOCK_HASH = `0x${"bb".repeat(32)}`;
const BLOCK_NUMBER = "310131879";
const BLOCK_TAG = `0x${BigInt(BLOCK_NUMBER).toString(16)}`;

const intent: NativeRpcIntent = {
  chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
  protocol: "camelot-v3",
  sender: FROM,
};

const transaction = {
  from: FROM,
  to: TO,
  data: "0x1234",
  value: "0x0",
} as const;

function evaluationInput(): TraceRpcEvidenceInput {
  const prepared: NativeRpcPreparedExecution = {
    runId: "run-106",
    intent,
    chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
    protocol: "camelot-v3",
    blockContext: {
      blockNumber: BLOCK_NUMBER,
      blockHash: BLOCK_HASH,
      observedAt: "2026-09-27T06:00:00.000Z",
    },
    quote: {
      estimatedAmountOut: "1",
    },
    unsignedTransaction: {
      kind: "unsigned",
      payload: transaction,
    },
    gasEstimate: {
      gasUnits: "100000",
    },
    finality: {
      status: "unknown",
    },
  };

  return {
    runId: "run-106",
    intent,
    chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
    protocol: "camelot-v3",
    input: prepared,
  };
}

function clientFor(
  handler: (method: string, params: readonly unknown[]) => Promise<unknown>,
): TraceRpcClient & {
  request: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn(async (method: string, params: readonly unknown[] = []) =>
      handler(method, params),
    ),
  };
}

function successfulClient() {
  return clientFor(async (method, params) => {
    if (method === "eth_chainId") {
      return `0x${ARBITRUM_SEPOLIA_CHAIN_ID.toString(16)}`;
    }

    if (method === "eth_getBlockByNumber") {
      expect(params).toEqual([BLOCK_TAG, false]);
      return {
        number: BLOCK_TAG,
        hash: BLOCK_HASH,
      };
    }

    if (method === "debug_traceCall") {
      const config = params[2] as {
        tracer?: string;
      };

      expect(params[0]).toEqual(transaction);
      expect(params[1]).toBe(BLOCK_TAG);

      if (config.tracer === "callTracer") {
        return {
          type: "CALL",
          from: FROM,
          to: TO,
          input: transaction.data,
          value: transaction.value,
          gasUsed: "0x5208",
          output: "0x1234",
        };
      }

      if (config.tracer === "prestateTracer") {
        expect(config).toEqual({
          tracer: "prestateTracer",
          tracerConfig: { diffMode: true },
        });

        return {
          pre: {
            [FROM]: {
              balance: "0x1",
            },
          },
          post: {
            [CHANGED]: {
              storage: {
                "0x00": "0x01",
              },
            },
          },
        };
      }
    }

    throw new Error(`unexpected method ${method}`);
  });
}

describe("TraceRpcEvidenceSource", () => {
  it("normalizes both qualified trace capabilities without exposing raw payloads", async () => {
    const client = successfulClient();

    const source = createTraceRpcEvidenceSource({
      client,
      mode: "LIVE",
      now: () => "2026-09-27T06:10:00.000Z",
    });

    const result = await source.evaluate(evaluationInput());

    expect(result.status).toBe("success");
    expect(result.source).toEqual({
      sourceId: "trace-rpc",
      sourceVersion: "trace-rpc-evidence-source-v1",
      mode: "LIVE",
      observedAt: "2026-09-27T06:10:00.000Z",
    });

    expect(result.binding?.transactionFingerprint).toBe(
      fingerprintPreparedTransaction(transaction),
    );

    expect(result.binding?.blockContext).toEqual({
      blockNumber: BLOCK_NUMBER,
      blockHash: BLOCK_HASH,
      observedAt: "2026-09-27T06:00:00.000Z",
    });

    expect(result.capabilities.callTracer).toMatchObject({
      status: "observed",
      executionStatus: "succeeded",
      gasUsed: "0x5208",
      output: "0x1234",
    });

    expect(result.capabilities.prestateTracerDiff).toMatchObject({
      status: "observed",
      diffMode: true,
      preAddressCount: 1,
      postAddressCount: 1,
      changedAddresses: [FROM.toLowerCase(), CHANGED.toLowerCase()],
    });

    expect(result.checkedScope).toEqual([
      "trace-rpc.chain",
      "trace-rpc.pinned-block",
      "trace-rpc.callTracer",
      "trace-rpc.prestateTracer.diffMode",
    ]);
    expect(result.unknownScope).toEqual([]);
    expect(result.unavailableScope).toEqual([]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('"storage":{"0x00":"0x01"}');
    expect(serialized).not.toContain("quiknode");
  });

  it("includes pre-only addresses in the sorted, deduplicated state-diff summary", async () => {
    const preOnly = `0x${"AA".repeat(20)}`;
    const shared = `0x${"BB".repeat(20)}`;
    const postOnly = `0x${"CC".repeat(20)}`;
    const client = traceClient((tracer) =>
      tracer === "callTracer"
        ? OBSERVED_CALL
        : {
            pre: {
              [preOnly]: { balance: "0xdeadbeef" },
              [shared]: { balance: "0x1" },
            },
            post: {
              [postOnly]: { balance: "0x2" },
              [shared.toLowerCase()]: { balance: "0x3" },
              [shared]: { balance: "0x4" },
            },
          },
    );

    const result = await sourceFor(client).evaluate(evaluationInput());

    expect(result.status).toBe("success");
    expect(result.capabilities.prestateTracerDiff).toMatchObject({
      status: "observed",
      preAddressCount: 2,
      postAddressCount: 3,
      changedAddresses: [
        preOnly.toLowerCase(),
        shared.toLowerCase(),
        postOnly.toLowerCase(),
      ],
    });
    expect(JSON.stringify(result)).not.toContain("0xdeadbeef");
  });

  it("fails before RPC when outer and prepared execution bindings diverge", async () => {
    const client = successfulClient();
    const source = createTraceRpcEvidenceSource({
      client,
      mode: "MOCK",
    });

    const valid = evaluationInput();
    const result = await source.evaluate({
      ...valid,
      input: {
        ...valid.input,
        runId: "different-run",
      },
    });

    expect(result.status).toBe("invalid");
    expect(result.capabilities.callTracer).toEqual({
      status: "unknown",
      reason: "binding_mismatch",
    });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects intent protocol, sender, and transaction chain mismatches before RPC", async () => {
    const client = successfulClient();
    const source = createTraceRpcEvidenceSource({ client, mode: "MOCK" });
    const valid = evaluationInput();
    const mismatches: TraceRpcEvidenceInput[] = [
      {
        ...valid,
        intent: { ...intent, protocol: "other" },
        input: {
          ...valid.input,
          intent: { ...intent, protocol: "other" },
        },
      },
      {
        ...valid,
        intent: { ...intent, sender: TO },
        input: {
          ...valid.input,
          intent: { ...intent, sender: TO },
        },
      },
      {
        ...valid,
        input: {
          ...valid.input,
          unsignedTransaction: {
            kind: "unsigned",
            payload: { ...transaction, chainId: "0x1" },
          },
        },
      },
    ];

    for (const mismatch of mismatches) {
      const result = await source.evaluate(mismatch);
      expect(result.status).toBe("invalid");
      expect(result.capabilities.callTracer).toEqual({
        status: "unknown",
        reason: "binding_mismatch",
      });
    }
    expect(client.request).not.toHaveBeenCalled();
  });

  it("fails closed when the pinned block hash does not match", async () => {
    const client = clientFor(async (method) => {
      if (method === "eth_chainId") {
        return `0x${ARBITRUM_SEPOLIA_CHAIN_ID.toString(16)}`;
      }

      if (method === "eth_getBlockByNumber") {
        return {
          number: BLOCK_TAG,
          hash: OTHER_BLOCK_HASH,
        };
      }

      throw new Error("trace request must not execute");
    });

    const source = createTraceRpcEvidenceSource({
      client,
      mode: "LIVE",
    });

    const result = await source.evaluate(evaluationInput());

    expect(result.status).toBe("invalid");
    expect(result.capabilities.callTracer).toEqual({
      status: "unknown",
      reason: "context_unverified",
    });
    expect(result.checkedScope).toEqual(["trace-rpc.chain"]);
    expect(result.unknownScope).toEqual([
      "trace-rpc.pinned-block",
      "trace-rpc.callTracer",
      "trace-rpc.prestateTracer.diffMode",
    ]);

    expect(client.request.mock.calls.map((call) => call[0])).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
    ]);
  });

  it("preserves an observed call trace when state-diff tracing is unsupported", async () => {
    const client = clientFor(async (method, params) => {
      if (method === "eth_chainId") {
        return `0x${ARBITRUM_SEPOLIA_CHAIN_ID.toString(16)}`;
      }

      if (method === "eth_getBlockByNumber") {
        return {
          number: BLOCK_TAG,
          hash: BLOCK_HASH,
        };
      }

      if (method === "debug_traceCall") {
        const config = params[2] as {
          tracer?: string;
        };

        if (config.tracer === "callTracer") {
          return {
            type: "CALL",
            from: FROM,
            to: TO,
            input: transaction.data,
            value: transaction.value,
            gasUsed: "0x5208",
            output: "0x1234",
          };
        }

        throw new NativeRpcClientError(
          "RPC_ERROR",
          "method unsupported",
          -32601,
        );
      }

      throw new Error(`unexpected method ${method}`);
    });

    const source = createTraceRpcEvidenceSource({
      client,
      mode: "LIVE",
    });

    const result = await source.evaluate(evaluationInput());

    expect(result.status).toBe("partial");

    expect(result.capabilities.callTracer.status).toBe("observed");

    expect(result.capabilities.prestateTracerDiff).toEqual({
      status: "unavailable",
      reason: "method_unsupported",
    });

    expect(result.checkedScope).toContain("trace-rpc.callTracer");
    expect(result.unavailableScope).toEqual([
      "trace-rpc.prestateTracer.diffMode",
    ]);
  });

  it("keeps malformed callTrace evidence UNKNOWN while preserving valid state-diff evidence", async () => {
    const client = clientFor(async (method, params) => {
      if (method === "eth_chainId") {
        return `0x${ARBITRUM_SEPOLIA_CHAIN_ID.toString(16)}`;
      }

      if (method === "eth_getBlockByNumber") {
        return {
          number: BLOCK_TAG,
          hash: BLOCK_HASH,
        };
      }

      if (method === "debug_traceCall") {
        const config = params[2] as {
          tracer?: string;
        };

        if (config.tracer === "callTracer") {
          return {
            type: "CALL",
            from: FROM,
            to: TO,
            input: "0xdeadbeef",
            value: transaction.value,
            gasUsed: "0x5208",
            output: "0x1234",
          };
        }

        return {
          pre: {
            [FROM]: {
              balance: "0x1",
            },
          },
          post: {
            [CHANGED]: {
              balance: "0x2",
            },
          },
        };
      }

      throw new Error(`unexpected method ${method}`);
    });

    const source = createTraceRpcEvidenceSource({
      client,
      mode: "LIVE",
    });

    const result = await source.evaluate(evaluationInput());

    expect(result.status).toBe("partial");

    expect(result.capabilities.callTracer).toEqual({
      status: "unknown",
      reason: "binding_mismatch",
    });

    expect(result.capabilities.prestateTracerDiff.status).toBe("observed");

    expect(result.unknownScope).toEqual(["trace-rpc.callTracer"]);
  });

  it("does not leak the RPC endpoint when transport fails", async () => {
    const secretEndpoint = "https://secret.example.invalid/private-token";

    const source = createTraceRpcEvidenceSource({
      rpcUrl: secretEndpoint,
      mode: "LIVE",
      fetchImplementation: vi.fn(async () => {
        throw new Error(secretEndpoint);
      }) as typeof fetch,
    });

    const result = await source.evaluate(evaluationInput());

    expect(result.status).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain(secretEndpoint);
    expect(result.capabilities.callTracer).toEqual({
      status: "unknown",
      reason: "rpc_unavailable",
    });
  });

  it("requires an explicit truthfulness mode and exactly one runtime seam", () => {
    expect(() =>
      createTraceRpcEvidenceSource({
        client: successfulClient(),
        mode: undefined as never,
      }),
    ).toThrow(/mode/);

    expect(() =>
      createTraceRpcEvidenceSource({
        mode: "LIVE",
      }),
    ).toThrow(/exactly one/);

    expect(() =>
      createTraceRpcEvidenceSource({
        client: successfulClient(),
        rpcUrl: "https://example.invalid",
        mode: "LIVE",
      }),
    ).toThrow(/exactly one/);
  });
});

const OBSERVED_CALL = {
  type: "CALL",
  from: FROM,
  to: TO,
  input: transaction.data,
  value: transaction.value,
  gasUsed: "0x5208",
  output: "0x1234",
} as const;

const OBSERVED_DIFF = {
  pre: {
    [FROM]: {
      balance: "0x1",
    },
  },
  post: {
    [CHANGED]: {
      balance: "0x2",
    },
  },
} as const;

const TRACE_SCOPES = [
  "trace-rpc.callTracer",
  "trace-rpc.prestateTracer.diffMode",
] as const;

const SENSITIVE_ERROR =
  "https://secret.example.invalid/private-token raw state 0xdeadbeef";

const FAILURE_CASES: readonly {
  readonly name: string;
  readonly error: () => Error;
  readonly status: "unknown" | "unavailable";
  readonly reason: TraceCapabilityFailureReason;
}[] = [
  {
    name: "unsupported method (-32601)",
    error: () => new NativeRpcClientError("RPC_ERROR", SENSITIVE_ERROR, -32601),
    status: "unavailable",
    reason: "method_unsupported",
  },
  {
    name: "invalid parameters (-32602)",
    error: () => new NativeRpcClientError("RPC_ERROR", SENSITIVE_ERROR, -32602),
    status: "unknown",
    reason: "invalid_parameters",
  },
  {
    name: "timeout",
    error: () => new NativeRpcClientError("TIMEOUT", SENSITIVE_ERROR),
    status: "unknown",
    reason: "timeout",
  },
  {
    name: "caller cancellation",
    error: () => new NativeRpcClientError("ABORTED", SENSITIVE_ERROR),
    status: "unknown",
    reason: "cancelled",
  },
  {
    name: "malformed response",
    error: () => new NativeRpcClientError("INVALID_ENVELOPE", SENSITIVE_ERROR),
    status: "unknown",
    reason: "malformed_response",
  },
  {
    name: "other RPC error",
    error: () => new NativeRpcClientError("RPC_ERROR", SENSITIVE_ERROR, -32000),
    status: "unknown",
    reason: "rpc_unavailable",
  },
  {
    name: "transport failure",
    error: () => new NativeRpcClientError("NETWORK_FAILURE", SENSITIVE_ERROR),
    status: "unknown",
    reason: "rpc_unavailable",
  },
  {
    name: "injected client failure",
    error: () => new Error(SENSITIVE_ERROR),
    status: "unknown",
    reason: "rpc_unavailable",
  },
];

/**
 * Client whose chain/pinned-block context resolves, delegating only the two
 * trace capabilities to the caller.
 */
function traceClient(
  trace: (tracer: string) => unknown,
): ReturnType<typeof clientFor> {
  return clientFor(async (method, params) => {
    if (method === "eth_chainId") {
      return `0x${ARBITRUM_SEPOLIA_CHAIN_ID.toString(16)}`;
    }

    if (method === "eth_getBlockByNumber") {
      return {
        number: BLOCK_TAG,
        hash: BLOCK_HASH,
      };
    }

    if (method === "debug_traceCall") {
      const config = params[2] as {
        tracer?: string;
      };

      return trace(config.tracer ?? "");
    }

    throw new Error(`unexpected method ${method}`);
  });
}

function unsupportedMethod(): never {
  throw new NativeRpcClientError("RPC_ERROR", "method unsupported", -32601);
}

function sourceFor(client: TraceRpcClient) {
  return createTraceRpcEvidenceSource({
    client,
    mode: "LIVE",
    now: () => "2026-09-27T06:10:00.000Z",
  });
}

describe("TraceRpcEvidenceSource status semantics", () => {
  describe.each(["eth_chainId", "eth_getBlockByNumber"] as const)(
    "%s context failures",
    (probe) => {
      it.each(FAILURE_CASES)(
        "classifies $name without overstating coverage",
        async (failure) => {
          const client = clientFor(async (method) => {
            if (method === probe) {
              throw failure.error();
            }
            if (method === "eth_chainId") {
              return `0x${ARBITRUM_SEPOLIA_CHAIN_ID.toString(16)}`;
            }
            if (method === "eth_getBlockByNumber") {
              return { number: BLOCK_TAG, hash: BLOCK_HASH };
            }
            throw new Error("trace must not execute after context failure");
          });

          const result = await sourceFor(client).evaluate(evaluationInput());

          expect(result.status).toBe(failure.status);
          expect(result.capabilities.callTracer).toEqual({
            status: failure.status,
            reason: failure.reason,
          });
          expect(result.capabilities.prestateTracerDiff).toEqual({
            status: failure.status,
            reason: failure.reason,
          });
          const failedScope = [
            ...(probe === "eth_getBlockByNumber"
              ? ["trace-rpc.pinned-block"]
              : []),
            "trace-rpc.callTracer",
            "trace-rpc.prestateTracer.diffMode",
          ];
          expect(result.unknownScope).toEqual(
            failure.status === "unknown" ? failedScope : [],
          );
          expect(result.unavailableScope).toEqual(
            failure.status === "unavailable" ? failedScope : [],
          );
          expect(result.checkedScope).toEqual(
            probe === "eth_getBlockByNumber" ? ["trace-rpc.chain"] : [],
          );
          expect(client.request.mock.calls.map((call) => call[0])).toEqual(
            probe === "eth_chainId"
              ? ["eth_chainId"]
              : ["eth_chainId", "eth_getBlockByNumber"],
          );
          expect(JSON.stringify(result)).not.toContain("private-token");
          expect(JSON.stringify(result)).not.toContain("0xdeadbeef");
        },
      );
    },
  );

  it("keeps a malformed pinned block lookup UNKNOWN without exposing its payload", async () => {
    const client = clientFor(async (method) => {
      if (method === "eth_chainId") {
        return `0x${ARBITRUM_SEPOLIA_CHAIN_ID.toString(16)}`;
      }
      if (method === "eth_getBlockByNumber") {
        return { number: BLOCK_TAG, hash: SENSITIVE_ERROR };
      }
      throw new Error("trace must not execute after malformed block lookup");
    });

    const result = await sourceFor(client).evaluate(evaluationInput());

    expect(result.status).toBe("unknown");
    expect(result.capabilities.callTracer).toEqual({
      status: "unknown",
      reason: "malformed_response",
    });
    expect(result.capabilities.prestateTracerDiff).toEqual({
      status: "unknown",
      reason: "malformed_response",
    });
    expect(result.checkedScope).toEqual(["trace-rpc.chain"]);
    expect(result.unknownScope).toEqual([
      "trace-rpc.pinned-block",
      "trace-rpc.callTracer",
      "trace-rpc.prestateTracer.diffMode",
    ]);
    expect(result.unavailableScope).toEqual([]);
    expect(client.request.mock.calls.map((call) => call[0])).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
    ]);
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(JSON.stringify(result)).not.toContain("0xdeadbeef");
  });

  describe.each(["callTracer", "prestateTracer"] as const)(
    "%s capability failures",
    (failedTracer) => {
      it.each(FAILURE_CASES)(
        "preserves the observed sibling on $name",
        async (failure) => {
          const client = traceClient((tracer) => {
            if (tracer === failedTracer) {
              throw failure.error();
            }
            return tracer === "callTracer" ? OBSERVED_CALL : OBSERVED_DIFF;
          });

          const result = await sourceFor(client).evaluate(evaluationInput());
          const failedScope =
            failedTracer === "callTracer"
              ? "trace-rpc.callTracer"
              : "trace-rpc.prestateTracer.diffMode";
          const observedScope =
            failedTracer === "callTracer"
              ? "trace-rpc.prestateTracer.diffMode"
              : "trace-rpc.callTracer";

          expect(result.status).toBe("partial");
          expect(
            failedTracer === "callTracer"
              ? result.capabilities.callTracer
              : result.capabilities.prestateTracerDiff,
          ).toEqual({ status: failure.status, reason: failure.reason });
          expect(
            failedTracer === "callTracer"
              ? result.capabilities.prestateTracerDiff.status
              : result.capabilities.callTracer.status,
          ).toBe("observed");
          expect(result.checkedScope).toEqual([
            "trace-rpc.chain",
            "trace-rpc.pinned-block",
            observedScope,
          ]);
          expect(result.unknownScope).toEqual(
            failure.status === "unknown" ? [failedScope] : [],
          );
          expect(result.unavailableScope).toEqual(
            failure.status === "unavailable" ? [failedScope] : [],
          );
          expect(JSON.stringify(result)).not.toContain("private-token");
          expect(JSON.stringify(result)).not.toContain("0xdeadbeef");
        },
      );
    },
  );

  it("keeps an all-uninterpretable result UNKNOWN instead of UNAVAILABLE", async () => {
    const client = traceClient((tracer) =>
      tracer === "callTracer"
        ? {
            ...OBSERVED_CALL,
            from: TO,
          }
        : {},
    );

    const result = await sourceFor(client).evaluate(evaluationInput());

    expect(result.status).toBe("unknown");
    expect(result.capabilities.callTracer).toEqual({
      status: "unknown",
      reason: "binding_mismatch",
    });
    expect(result.capabilities.prestateTracerDiff).toEqual({
      status: "unknown",
      reason: "malformed_response",
    });
    expect(result.unknownScope).toEqual([...TRACE_SCOPES]);
    expect(result.unavailableScope).toEqual([]);
  });

  it("reports UNAVAILABLE only when every capability is provably unavailable", async () => {
    const result = await sourceFor(
      traceClient(() => unsupportedMethod()),
    ).evaluate(evaluationInput());

    expect(result.status).toBe("unavailable");
    expect(result.capabilities.callTracer).toEqual({
      status: "unavailable",
      reason: "method_unsupported",
    });
    expect(result.capabilities.prestateTracerDiff).toEqual({
      status: "unavailable",
      reason: "method_unsupported",
    });
    expect(result.unavailableScope).toEqual([...TRACE_SCOPES]);
    expect(result.unknownScope).toEqual([]);
  });

  it("prefers UNKNOWN when unknown and unavailable scopes are mixed", async () => {
    const client = traceClient((tracer) => {
      if (tracer === "callTracer") {
        return {};
      }

      return unsupportedMethod();
    });

    const result = await sourceFor(client).evaluate(evaluationInput());

    expect(result.status).toBe("unknown");
    expect(result.unknownScope).toEqual(["trace-rpc.callTracer"]);
    expect(result.unavailableScope).toEqual([
      "trace-rpc.prestateTracer.diffMode",
    ]);
    expect(result.checkedScope).toEqual([
      "trace-rpc.chain",
      "trace-rpc.pinned-block",
    ]);
  });

  it("does not report an uninterpretable context probe as UNAVAILABLE", async () => {
    const client = clientFor(async (method) => {
      if (method === "eth_chainId") {
        return "not-a-hex-quantity";
      }

      throw new Error("trace must not execute");
    });

    const result = await sourceFor(client).evaluate(evaluationInput());

    expect(result.status).toBe("unknown");
    expect(result.unavailableScope).toEqual([]);
    expect(result.unknownScope).toEqual([...TRACE_SCOPES]);
    expect(result.checkedScope).toEqual([]);
    expect(client.request.mock.calls.map((call) => call[0])).toEqual([
      "eth_chainId",
    ]);
  });

  it("still reports a provably unsupported context probe as UNAVAILABLE", async () => {
    const client = clientFor(async (method) => {
      if (method === "eth_chainId") {
        return unsupportedMethod();
      }

      throw new Error("trace must not execute");
    });

    const result = await sourceFor(client).evaluate(evaluationInput());

    expect(result.status).toBe("unavailable");
    expect(result.unavailableScope).toEqual([...TRACE_SCOPES]);
    expect(result.unknownScope).toEqual([]);
  });

  it("keeps a partially observed result PARTIAL regardless of failure kind", async () => {
    const unknownHalf = await sourceFor(
      traceClient((tracer) => (tracer === "callTracer" ? {} : OBSERVED_DIFF)),
    ).evaluate(evaluationInput());

    expect(unknownHalf.status).toBe("partial");
    expect(unknownHalf.capabilities.prestateTracerDiff.status).toBe("observed");

    const unavailableHalf = await sourceFor(
      traceClient((tracer) =>
        tracer === "callTracer" ? OBSERVED_CALL : unsupportedMethod(),
      ),
    ).evaluate(evaluationInput());

    expect(unavailableHalf.status).toBe("partial");
    expect(unavailableHalf.capabilities.callTracer.status).toBe("observed");
  });
});

describe("TraceRpcEvidenceSource freshness semantics", () => {
  it("declares freshness explicitly as not_checked on every result path", async () => {
    const success = await sourceFor(successfulClient()).evaluate(
      evaluationInput(),
    );

    const partial = await sourceFor(
      traceClient((tracer) =>
        tracer === "callTracer" ? OBSERVED_CALL : unsupportedMethod(),
      ),
    ).evaluate(evaluationInput());

    const unknown = await sourceFor(traceClient(() => ({}))).evaluate(
      evaluationInput(),
    );

    const unavailable = await sourceFor(
      traceClient(() => unsupportedMethod()),
    ).evaluate(evaluationInput());

    const valid = evaluationInput();

    const invalid = await sourceFor(successfulClient()).evaluate({
      ...valid,
      input: {
        ...valid.input,
        runId: "different-run",
      },
    });

    expect([
      success.status,
      partial.status,
      unknown.status,
      unavailable.status,
      invalid.status,
    ]).toEqual(["success", "partial", "unknown", "unavailable", "invalid"]);

    for (const result of [success, partial, unknown, unavailable, invalid]) {
      expect(result.freshness).toEqual({
        status: "not_checked",
      });
    }

    // Freshness must never be invented as fresh or stale.
    expect(
      JSON.stringify([success, partial, unknown, unavailable, invalid]),
    ).not.toMatch(/"fresh"|"stale"/);
  });
});
