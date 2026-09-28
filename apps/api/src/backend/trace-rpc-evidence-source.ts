import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ArbitrumTransaction } from "./arbitrum-chain-adapter.js";
import type { BlockContext, ChainOperationOptions } from "./chain-adapter.js";
import {
  createNativeRpcClient,
  NativeRpcClientError,
} from "./native-rpc-client.js";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  type NativeRpcIntent,
  type NativeRpcPreparedExecution,
  type NativeRpcProviderMode,
} from "./native-rpc-evidence.js";
import type { ProviderEvaluationInput } from "./provider-adapter.js";

export const TRACE_RPC_EVIDENCE_SOURCE_ID = "trace-rpc" as const;

export const TRACE_RPC_CAPABILITIES = Object.freeze([
  "debug_traceCall.callTracer",
  "debug_traceCall.prestateTracer.diffMode",
] as const);

export type TraceRpcEvidenceMode = NativeRpcProviderMode;

export type TraceRpcEvidenceStatus =
  | "success"
  | "partial"
  | "unknown"
  | "unavailable"
  | "invalid";

/**
 * Backend-local freshness declaration.
 *
 * The trace source performs no head-lag comparison between the pinned block
 * and the current chain head, so it cannot truthfully claim "fresh" or
 * "stale". Freshness is therefore explicitly declared as not checked rather
 * than inferred or invented.
 */
export type TraceRpcFreshness = {
  readonly status: "not_checked";
};

const FRESHNESS_NOT_CHECKED: TraceRpcFreshness = Object.freeze({
  status: "not_checked",
});

export type TraceRpcClient = {
  request(
    method: string,
    params?: readonly unknown[],
    options?: ChainOperationOptions,
  ): Promise<unknown>;
};

export type TraceRpcEvidenceSourceOptions = {
  readonly client?: TraceRpcClient;
  /** Explicit endpoint only. Never returned by the source. */
  readonly rpcUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  /**
   * Required truthfulness mode. A real endpoint must never silently inherit
   * MOCK provenance.
   */
  readonly mode: TraceRpcEvidenceMode;
  readonly sourceVersion?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => string;
};

export type TraceRpcEvidenceInput<
  Intent extends NativeRpcIntent = NativeRpcIntent,
> = ProviderEvaluationInput<Intent, NativeRpcPreparedExecution<Intent>>;

export type TraceCapabilityFailureReason =
  | "method_unsupported"
  | "invalid_parameters"
  | "timeout"
  | "cancelled"
  | "rpc_unavailable"
  | "malformed_response"
  | "binding_mismatch"
  | "context_unverified";

export type TraceCapabilityFailure = {
  readonly status: "unknown" | "unavailable";
  readonly reason: TraceCapabilityFailureReason;
};

export type TraceCallEvidence =
  | {
      readonly status: "observed";
      readonly executionStatus: "succeeded" | "reverted";
      readonly gasUsed: string;
      readonly output?: string;
      readonly resultFingerprint: string;
    }
  | TraceCapabilityFailure;

export type TraceStateDiffEvidence =
  | {
      readonly status: "observed";
      readonly diffMode: true;
      readonly preAddressCount: number;
      readonly postAddressCount: number;
      /**
       * Address-only normalized summary. Raw account/storage values stay behind
       * the source boundary.
       */
      readonly changedAddresses: readonly string[];
      readonly resultFingerprint: string;
    }
  | TraceCapabilityFailure;

export type TraceRpcBinding = {
  readonly runId: string;
  readonly chainId: number;
  readonly protocol: string;
  readonly transactionFingerprint: string;
  readonly blockContext: BlockContext;
};

export type TraceRpcEvidenceResult = {
  readonly status: TraceRpcEvidenceStatus;
  readonly source: {
    readonly sourceId: typeof TRACE_RPC_EVIDENCE_SOURCE_ID;
    readonly sourceVersion: string;
    readonly mode: TraceRpcEvidenceMode;
    readonly observedAt: string;
  };
  /**
   * Explicitly unverified freshness. Never fabricated as fresh or stale.
   */
  readonly freshness: TraceRpcFreshness;
  readonly binding?: TraceRpcBinding;
  readonly capabilities: {
    readonly callTracer: TraceCallEvidence;
    readonly prestateTracerDiff: TraceStateDiffEvidence;
  };
  readonly checkedScope: readonly string[];
  readonly unknownScope: readonly string[];
  readonly unavailableScope: readonly string[];
};

type ValidatedInput = {
  readonly transaction: ArbitrumTransaction;
  readonly blockTag: string;
  readonly binding: TraceRpcBinding;
};

class TraceNormalizationError extends Error {
  public constructor(
    public readonly reason:
      | "malformed_response"
      | "binding_mismatch"
      | "context_unverified",
  ) {
    super(reason);
  }
}

/**
 * Reusable supplementary Trace RPC evidence source.
 *
 * This is intentionally not a ProviderRegistry adapter. NativeRpcProvider
 * remains the primary baseline; this source only contributes deeper trace /
 * state-diff facts for Backend composition under #110.
 */
export class TraceRpcEvidenceSource<
  Intent extends NativeRpcIntent = NativeRpcIntent,
> {
  public readonly sourceId = TRACE_RPC_EVIDENCE_SOURCE_ID;
  public readonly capabilities = TRACE_RPC_CAPABILITIES;
  public readonly mode: TraceRpcEvidenceMode;

  private readonly client: TraceRpcClient;
  private readonly sourceVersion: string;
  private readonly timeoutMs: number;
  private readonly signal?: AbortSignal;
  private readonly now: () => string;

  public constructor(options: TraceRpcEvidenceSourceOptions) {
    if (
      options.mode !== "LIVE" &&
      options.mode !== "RECORDED_REPLAY" &&
      options.mode !== "MOCK"
    ) {
      throw new TypeError(
        "Trace RPC mode must be LIVE, RECORDED_REPLAY, or MOCK",
      );
    }

    if (
      (options.client === undefined && options.rpcUrl === undefined) ||
      (options.client !== undefined && options.rpcUrl !== undefined)
    ) {
      throw new TypeError("Trace RPC requires exactly one of client or rpcUrl");
    }

    if (
      options.client !== undefined &&
      (options.client === null || typeof options.client.request !== "function")
    ) {
      throw new TypeError("Trace RPC client.request is required");
    }

    if (
      options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      throw new TypeError("Trace RPC timeoutMs must be a positive integer");
    }

    if (
      options.sourceVersion !== undefined &&
      options.sourceVersion.trim() === ""
    ) {
      throw new TypeError("Trace RPC sourceVersion must be non-empty");
    }

    this.mode = options.mode;
    this.client =
      options.client ??
      createNativeRpcClient({
        rpcUrl: options.rpcUrl ?? "",
        fetchImplementation: options.fetchImplementation,
      });
    this.sourceVersion =
      options.sourceVersion ?? "trace-rpc-evidence-source-v1";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.signal = options.signal;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async evaluate(
    input: TraceRpcEvidenceInput<Intent>,
  ): Promise<TraceRpcEvidenceResult> {
    let validated: ValidatedInput;

    try {
      validated = validateInput(input);
    } catch (error) {
      const reason =
        error instanceof TraceNormalizationError
          ? error.reason
          : "binding_mismatch";

      return this.invalidResult(reason);
    }

    const rpcOptions: ChainOperationOptions = {
      timeoutMs: this.timeoutMs,
      ...(this.signal === undefined ? {} : { signal: this.signal }),
    };

    try {
      const observedChainId = normalizeHexQuantity(
        await this.client.request("eth_chainId", [], rpcOptions),
      );

      if (BigInt(observedChainId) !== BigInt(ARBITRUM_SEPOLIA_CHAIN_ID)) {
        return this.invalidResult("context_unverified", validated.binding);
      }
    } catch (error) {
      return this.contextUnavailableResult(
        classifyCapabilityFailure(error),
        validated.binding,
      );
    }

    let observedBlockHash: string;

    try {
      const block = asRecord(
        await this.client.request(
          "eth_getBlockByNumber",
          [validated.blockTag, false],
          rpcOptions,
        ),
      );

      const observedNumber = normalizeHexQuantity(block.number);
      observedBlockHash = normalizeBlockHash(block.hash);

      if (
        BigInt(observedNumber) !== BigInt(validated.blockTag) ||
        (validated.binding.blockContext.blockHash !== undefined &&
          observedBlockHash.toLowerCase() !==
            validated.binding.blockContext.blockHash.toLowerCase())
      ) {
        return this.invalidResult("context_unverified", validated.binding);
      }
    } catch (error) {
      return this.contextUnavailableResult(
        classifyCapabilityFailure(error),
        validated.binding,
      );
    }

    const binding: TraceRpcBinding = {
      ...validated.binding,
      blockContext: {
        ...validated.binding.blockContext,
        blockHash: observedBlockHash,
      },
    };

    const callTracer = await this.evaluateCallTrace(
      validated.transaction,
      validated.blockTag,
      rpcOptions,
    );

    const prestateTracerDiff = await this.evaluateStateDiff(
      validated.transaction,
      validated.blockTag,
      rpcOptions,
    );

    return this.result(binding, callTracer, prestateTracerDiff);
  }

  private async evaluateCallTrace(
    transaction: ArbitrumTransaction,
    blockTag: string,
    options: ChainOperationOptions,
  ): Promise<TraceCallEvidence> {
    try {
      const raw = await this.client.request(
        "debug_traceCall",
        [transaction, blockTag, { tracer: "callTracer" }],
        options,
      );

      return normalizeCallTrace(raw, transaction);
    } catch (error) {
      return classifyCapabilityFailure(error);
    }
  }

  private async evaluateStateDiff(
    transaction: ArbitrumTransaction,
    blockTag: string,
    options: ChainOperationOptions,
  ): Promise<TraceStateDiffEvidence> {
    try {
      const raw = await this.client.request(
        "debug_traceCall",
        [
          transaction,
          blockTag,
          {
            tracer: "prestateTracer",
            tracerConfig: { diffMode: true },
          },
        ],
        options,
      );

      return normalizeStateDiff(raw);
    } catch (error) {
      return classifyCapabilityFailure(error);
    }
  }

  private result(
    binding: TraceRpcBinding,
    callTracer: TraceCallEvidence,
    prestateTracerDiff: TraceStateDiffEvidence,
  ): TraceRpcEvidenceResult {
    const checkedScope = [
      "trace-rpc.chain",
      "trace-rpc.pinned-block",
      ...(callTracer.status === "observed" ? ["trace-rpc.callTracer"] : []),
      ...(prestateTracerDiff.status === "observed"
        ? ["trace-rpc.prestateTracer.diffMode"]
        : []),
    ];

    const unknownScope = [
      ...(callTracer.status === "unknown" ? ["trace-rpc.callTracer"] : []),
      ...(prestateTracerDiff.status === "unknown"
        ? ["trace-rpc.prestateTracer.diffMode"]
        : []),
    ];

    const unavailableScope = [
      ...(callTracer.status === "unavailable" ? ["trace-rpc.callTracer"] : []),
      ...(prestateTracerDiff.status === "unavailable"
        ? ["trace-rpc.prestateTracer.diffMode"]
        : []),
    ];

    const observedCount =
      Number(callTracer.status === "observed") +
      Number(prestateTracerDiff.status === "observed");

    const unknownCount =
      Number(callTracer.status === "unknown") +
      Number(prestateTracerDiff.status === "unknown");

    return Object.freeze({
      status: observabilityStatus(observedCount, unknownCount),
      source: this.source(),
      freshness: FRESHNESS_NOT_CHECKED,
      binding,
      capabilities: {
        callTracer,
        prestateTracerDiff,
      },
      checkedScope: Object.freeze(checkedScope),
      unknownScope: Object.freeze(unknownScope),
      unavailableScope: Object.freeze(unavailableScope),
    });
  }

  private invalidResult(
    reason: TraceCapabilityFailureReason,
    binding?: TraceRpcBinding,
  ): TraceRpcEvidenceResult {
    const failure: TraceCapabilityFailure = {
      status: "unknown",
      reason,
    };

    return Object.freeze({
      status: "invalid",
      source: this.source(),
      freshness: FRESHNESS_NOT_CHECKED,
      ...(binding === undefined ? {} : { binding }),
      capabilities: {
        callTracer: failure,
        prestateTracerDiff: failure,
      },
      checkedScope: Object.freeze([]),
      unknownScope: Object.freeze([
        "trace-rpc.callTracer",
        "trace-rpc.prestateTracer.diffMode",
      ]),
      unavailableScope: Object.freeze([]),
    });
  }

  private contextUnavailableResult(
    failure: TraceCapabilityFailure,
    binding: TraceRpcBinding,
  ): TraceRpcEvidenceResult {
    const unknown =
      failure.status === "unknown"
        ? ["trace-rpc.callTracer", "trace-rpc.prestateTracer.diffMode"]
        : [];

    const unavailable =
      failure.status === "unavailable"
        ? ["trace-rpc.callTracer", "trace-rpc.prestateTracer.diffMode"]
        : [];

    // Both capabilities inherit the same context failure, so the top-level
    // status is derived from that same evidence: an UNKNOWN capability must
    // never be reported as UNAVAILABLE.
    const unknownCount = failure.status === "unknown" ? 2 : 0;

    return Object.freeze({
      status: observabilityStatus(0, unknownCount),
      source: this.source(),
      freshness: FRESHNESS_NOT_CHECKED,
      binding,
      capabilities: {
        callTracer: failure,
        prestateTracerDiff: failure,
      },
      checkedScope: Object.freeze([]),
      unknownScope: Object.freeze(unknown),
      unavailableScope: Object.freeze(unavailable),
    });
  }

  private source() {
    return Object.freeze({
      sourceId: TRACE_RPC_EVIDENCE_SOURCE_ID,
      sourceVersion: this.sourceVersion,
      mode: this.mode,
      observedAt: this.now(),
    });
  }
}

export function createTraceRpcEvidenceSource<
  Intent extends NativeRpcIntent = NativeRpcIntent,
>(options: TraceRpcEvidenceSourceOptions): TraceRpcEvidenceSource<Intent> {
  return new TraceRpcEvidenceSource<Intent>(options);
}

function validateInput<Intent extends NativeRpcIntent>(
  input: TraceRpcEvidenceInput<Intent>,
): ValidatedInput {
  const prepared = input.input;

  const outerIntent = input.intent;
  if (
    outerIntent === undefined ||
    typeof input.runId !== "string" ||
    input.runId.trim() === "" ||
    input.runId !== prepared.runId ||
    input.chainId !== prepared.chainId ||
    typeof input.protocol !== "string" ||
    input.protocol.trim() === "" ||
    input.protocol !== prepared.protocol ||
    outerIntent.protocol !== input.protocol ||
    !isDeepStrictEqual(outerIntent, prepared.intent)
  ) {
    throw new TraceNormalizationError("binding_mismatch");
  }

  if (
    input.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID ||
    outerIntent.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID
  ) {
    throw new TraceNormalizationError("context_unverified");
  }

  if (prepared.unsignedTransaction.kind !== "unsigned") {
    throw new TraceNormalizationError("binding_mismatch");
  }

  const transaction = normalizeTransaction(
    prepared.unsignedTransaction.payload,
  );

  if (
    !sameAddress(outerIntent.sender, transaction.from) ||
    (transaction.chainId !== undefined &&
      transaction.chainId !== decimalToHex(String(input.chainId)))
  ) {
    throw new TraceNormalizationError("binding_mismatch");
  }

  if (!/^(0|[1-9]\d*)$/.test(prepared.blockContext.blockNumber)) {
    throw new TraceNormalizationError("context_unverified");
  }

  if (
    prepared.blockContext.blockHash !== undefined &&
    !/^0x[0-9a-fA-F]{64}$/.test(prepared.blockContext.blockHash)
  ) {
    throw new TraceNormalizationError("context_unverified");
  }

  return {
    transaction,
    blockTag: decimalToHex(prepared.blockContext.blockNumber),
    binding: {
      runId: input.runId,
      chainId: input.chainId,
      protocol: input.protocol,
      transactionFingerprint: fingerprintPreparedTransaction(transaction),
      blockContext: {
        ...prepared.blockContext,
      },
    },
  };
}

function normalizeTransaction(value: unknown): ArbitrumTransaction {
  if (!isRecord(value)) {
    throw new TraceNormalizationError("binding_mismatch");
  }

  const transaction: Record<string, string | undefined> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      transaction[key] = undefined;
      continue;
    }

    if (typeof entry !== "string") {
      throw new TraceNormalizationError("binding_mismatch");
    }

    transaction[key] = entry;
  }

  const from = transaction.from;
  const to = transaction.to;
  const data = transaction.data;
  const txValue = transaction.value;

  if (
    !isAddress(from) ||
    !isAddress(to) ||
    !isHexData(data) ||
    !isHexQuantity(txValue)
  ) {
    throw new TraceNormalizationError("binding_mismatch");
  }

  return Object.freeze(transaction);
}

function normalizeCallTrace(
  value: unknown,
  transaction: ArbitrumTransaction,
): TraceCallEvidence {
  const trace = asRecord(value);

  const from = asString(trace.from);
  const to = asString(trace.to);
  const input = asString(trace.input);
  const tracedValue = normalizeHexQuantity(trace.value);

  if (
    trace.type !== "CALL" ||
    !sameAddress(from, transaction.from) ||
    !sameAddress(to, transaction.to) ||
    input.toLowerCase() !== transaction.data?.toLowerCase() ||
    BigInt(tracedValue) !== BigInt(transaction.value ?? "0x0")
  ) {
    throw new TraceNormalizationError("binding_mismatch");
  }

  const gasUsed = normalizeHexQuantity(trace.gasUsed);

  const hasRevert =
    (typeof trace.error === "string" && trace.error.length > 0) ||
    (typeof trace.revertReason === "string" && trace.revertReason.length > 0);

  let output: string | undefined;

  if (trace.output !== undefined) {
    if (!isHexData(trace.output)) {
      throw new TraceNormalizationError("malformed_response");
    }
    output = trace.output;
  } else if (!hasRevert) {
    throw new TraceNormalizationError("malformed_response");
  }

  return Object.freeze({
    status: "observed",
    executionStatus: hasRevert ? "reverted" : "succeeded",
    gasUsed,
    ...(output === undefined ? {} : { output }),
    resultFingerprint: sha256Json(value),
  });
}

function normalizeStateDiff(value: unknown): TraceStateDiffEvidence {
  const result = asRecord(value);
  const pre = asRecord(result.pre);
  const post = asRecord(result.post);

  const preAddresses = normalizeAddressKeys(pre);
  const postAddresses = normalizeAddressKeys(post);

  return Object.freeze({
    status: "observed",
    diffMode: true,
    preAddressCount: preAddresses.length,
    postAddressCount: postAddresses.length,
    changedAddresses: Object.freeze(
      [...new Set([...preAddresses, ...postAddresses])].sort(),
    ),
    resultFingerprint: sha256Json(value),
  });
}

/**
 * Truthful top-level status derivation over the two trace capabilities.
 *
 * - every capability observed            -> success
 * - at least one capability observed     -> partial
 * - none observed, any of them unknown   -> unknown
 * - none observed, all of them unavailable -> unavailable
 *
 * UNKNOWN is never collapsed into UNAVAILABLE: "unavailable" is reserved for
 * capabilities the endpoint provably cannot serve (for example an unsupported
 * method), while "unknown" means the capability could not be interpreted.
 * Binding or context invalidity is reported separately as "invalid".
 */
function observabilityStatus(
  observedCount: number,
  unknownCount: number,
): Extract<
  TraceRpcEvidenceStatus,
  "success" | "partial" | "unknown" | "unavailable"
> {
  if (observedCount === TRACE_RPC_CAPABILITIES.length) {
    return "success";
  }

  if (observedCount > 0) {
    return "partial";
  }

  return unknownCount > 0 ? "unknown" : "unavailable";
}

function classifyCapabilityFailure(error: unknown): TraceCapabilityFailure {
  if (error instanceof TraceNormalizationError) {
    return {
      status: "unknown",
      reason: error.reason,
    };
  }

  if (error instanceof NativeRpcClientError) {
    if (error.kind === "RPC_ERROR" && error.rpcCode === -32601) {
      return {
        status: "unavailable",
        reason: "method_unsupported",
      };
    }

    if (error.kind === "RPC_ERROR" && error.rpcCode === -32602) {
      return {
        status: "unknown",
        reason: "invalid_parameters",
      };
    }

    if (error.kind === "TIMEOUT") {
      return {
        status: "unknown",
        reason: "timeout",
      };
    }

    if (error.kind === "ABORTED") {
      return {
        status: "unknown",
        reason: "cancelled",
      };
    }

    if (
      error.kind === "JSON_PARSE_FAILURE" ||
      error.kind === "INVALID_ENVELOPE" ||
      error.kind === "ID_MISMATCH" ||
      error.kind === "MISSING_RESULT"
    ) {
      return {
        status: "unknown",
        reason: "malformed_response",
      };
    }

    // Other RPC and transport failures do not prove this capability is unsupported.
    return {
      status: "unknown",
      reason: "rpc_unavailable",
    };
  }

  return {
    status: "unknown",
    reason: "rpc_unavailable",
  };
}

function normalizeAddressKeys(value: Record<string, unknown>): string[] {
  const addresses = Object.keys(value);

  for (const address of addresses) {
    if (!isAddress(address)) {
      throw new TraceNormalizationError("malformed_response");
    }
  }

  return addresses.map((address) => address.toLowerCase());
}

function fingerprintPreparedTransaction(
  transaction: ArbitrumTransaction,
): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        kind: "unsigned",
        payload: transaction,
      }),
    )
    .digest("hex")}`;
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function decimalToHex(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function normalizeHexQuantity(value: unknown): string {
  if (!isHexQuantity(value)) {
    throw new TraceNormalizationError("malformed_response");
  }
  return value;
}

function normalizeBlockHash(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TraceNormalizationError("malformed_response");
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TraceNormalizationError("malformed_response");
  }
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TraceNormalizationError("malformed_response");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isHexQuantity(value: unknown): value is string {
  return (
    typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  );
}

function isHexData(value: unknown): value is string {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
}

function sameAddress(left: unknown, right: unknown): boolean {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}
