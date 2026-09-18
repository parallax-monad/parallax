import {
  convertAtomicAmountToHuman,
  type GenericEvidence,
  type GenericEvidenceMode,
  type GenericProviderStatus,
  type GenericSwapIntent,
  genericEvidenceSchema,
  type NormalizedSwapIntent,
} from "@parallax/contracts";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  type ArbitrumTransaction,
} from "./arbitrum-chain-adapter.js";

import type { BlockContext, GasEstimate } from "./chain-adapter.js";
import type { ProviderEvaluationResult } from "./provider-adapter.js";
import type {
  ProvisionalCandidateFieldInput,
  ProvisionalJsonValue,
} from "./provider-result-boundary.js";

export { ARBITRUM_SEPOLIA_CHAIN_ID };

export const NATIVE_RPC_ARBITRUM_PROVIDER_ID = "native-rpc-arbitrum" as const;
export const NATIVE_RPC_CAPABILITIES = Object.freeze([
  "simulate",
  "eth_call",
  "estimateGas",
  "pinned-block",
] as const);

export type NativeRpcIntent = {
  readonly chainId: number;
  readonly protocol: string;
  readonly sender: string;
};

/**
 * Exact execution material accepted by the fixture-first Native RPC seam.
 * Protocol-specific transaction details stay behind the unsigned transaction
 * payload; this provider never builds, signs, or broadcasts a transaction.
 */
export type NativeRpcPreparedExecution<
  Intent extends NativeRpcIntent = NativeRpcIntent,
> = {
  readonly runId: string;
  readonly intent: Intent;
  readonly chainId: number;
  readonly protocol: string;
  readonly blockContext: BlockContext;
  readonly quote: unknown;
  readonly unsignedTransaction: {
    readonly kind: "unsigned";
    readonly payload: ArbitrumTransaction | Readonly<Record<string, unknown>>;
  };
  readonly gasEstimate: GasEstimate;
  readonly finality: {
    readonly status: "unknown" | "pending" | "confirmed" | "finalized";
    readonly blockContext?: BlockContext;
  };
};

export type NativeRpcProviderMode = GenericEvidenceMode;

type Freshness =
  | {
      readonly status: "fresh";
      readonly pinnedBlock: string;
      readonly headBlock: string;
      readonly lag: string;
      readonly maxBlockLag: number;
    }
  | {
      readonly status: "stale";
      readonly pinnedBlock: string;
      readonly headBlock: string;
      readonly lag: string;
      readonly maxBlockLag: number;
    }
  | { readonly status: "unknown"; readonly reason: string }
  | { readonly status: "not_checked" };

type NativeRpcStatus =
  | "success"
  | "unknown"
  | "unsupported"
  | "stale"
  | "timeout"
  | "failed"
  | "invalid";

export type NativeRpcGenericEvidenceInput = {
  readonly intent: NormalizedSwapIntent | GenericSwapIntent;
  readonly tokenInDecimals: number;
  readonly tokenOutDecimals: number;
  readonly preparedExecution: NativeRpcPreparedExecution;
  readonly providerResult: ProviderEvaluationResult;
  readonly mode?: NativeRpcProviderMode;
};

/**
 * Explicit provisional ProviderEvaluationResult → GenericEvidence projection.
 *
 * The Backend owns this provider-neutral mapping only. The concrete
 * NativeRpcProvider, raw RPC client, endpoint lifecycle, and provider-owned
 * qualification remain the Provider Owner (#66) handoff; an adapter is passed
 * into the composition through the existing ProviderAdapter seam.
 *
 * The projection keeps Native RPC's partial surface fail-closed: a successful
 * `eth_call` and gas estimate do not become a complete simulation receipt,
 * outcome, or asset-change assertion. Those scopes remain visible as unknown.
 */
export function toNativeRpcGenericEvidence(
  input: NativeRpcGenericEvidenceInput,
): GenericEvidence {
  const mode =
    input.mode ?? providerModeFromResult(input.providerResult) ?? "MOCK";
  const source = mode === "MOCK" ? "mock" : "rpc";
  const candidate = new Map(
    input.providerResult.candidateFields.map((field) => [
      field.candidatePath,
      field,
    ]),
  );
  const blockNumber = input.preparedExecution.blockContext.blockNumber;
  const fetchedAt = input.providerResult.provider.observedAt;
  const callField = candidate.get("nativeRpc.ethCall.returnData");
  const gasField = candidate.get("nativeRpc.estimateGas.gasUnits");
  const freshnessField = candidate.get("nativeRpc.freshness");
  const callChecked = callField?.status === "observed";
  const gasChecked = gasField?.status === "observed";
  const blockChecked =
    candidate.get("nativeRpc.blockContext.blockNumber")?.status === "observed";
  const freshness = freshnessFromCandidate(freshnessField);
  const genericStatus = genericProviderStatus(input.providerResult.status);
  const integrationStatus =
    input.providerResult.status === "timeout"
      ? "TIMEOUT"
      : input.providerResult.status === "failed" ||
          input.providerResult.status === "invalid"
        ? "INTEGRATION_ERROR"
        : "OK";
  const failure =
    genericStatus === "FAILED"
      ? {
          code:
            input.providerResult.status === "timeout"
              ? "TIMEOUT"
              : "INTEGRATION_ERROR",
          message: "Native RPC could not produce a verified provider result",
          integrationStatus,
          source: "rpc" as const,
          normalization: "DERIVED" as const,
          retryable: input.providerResult.status === "timeout",
        }
      : undefined;
  const intent = toGenericIntent(
    input.intent,
    input.tokenInDecimals,
    input.tokenOutDecimals,
  );
  const quote = quoteField(
    input.preparedExecution.quote,
    source,
    blockNumber,
    fetchedAt,
  );
  const runtime = runtimeFromQuote(input.preparedExecution.quote);
  const actionValue = jsonValueOrNull(
    input.preparedExecution.unsignedTransaction.payload,
  );
  const checkedScope = [
    ...(callChecked ? ["native-rpc.eth_call"] : []),
    ...(gasChecked ? ["native-rpc.estimateGas"] : []),
    ...(blockChecked ? ["native-rpc.pinned-block"] : []),
    ...(freshness.status === "fresh" ? ["native-rpc.freshness"] : []),
  ];
  const unknownScope = [
    ...(quote.value === null ? ["quote"] : []),
    ...(actionValue === null ? ["action"] : []),
    ...(callField !== undefined && !callChecked ? ["native-rpc.eth_call"] : []),
    ...(gasField !== undefined && !gasChecked
      ? ["native-rpc.estimateGas"]
      : []),
    "receipt",
    "outcome",
    "assetChanges",
    "simulation",
    ...(freshness.status !== "fresh" ? ["freshness"] : []),
  ];
  const notChecked = [
    ...(callField === undefined ? ["native-rpc.eth_call"] : []),
    ...(gasField === undefined ? ["native-rpc.estimateGas"] : []),
    "receipt",
    "outcome",
    "assetChanges",
    "state-diff",
    "logs",
    "traces",
    ...(freshness.status === "not_checked" ? ["freshness"] : []),
  ];
  const providerData = {
    nativeRpc: {
      status: input.providerResult.status,
      checked: checkedScope,
      notChecked,
      unknown: unknownScope,
      freshness,
      ...(callField?.value === undefined
        ? {}
        : { callReturnData: callField.value }),
      ...(gasField?.value === undefined ? {} : { gasUnits: gasField.value }),
    },
  };
  const evidence = genericEvidenceSchema.parse({
    intent,
    provider: {
      providerId: input.providerResult.provider.providerId,
      status: genericStatus,
      integrationStatus,
      ...(failure === undefined ? {} : { failure }),
      errors: jsonField(
        failure === undefined ? [] : [failure],
        source,
        blockNumber,
        fetchedAt,
      ),
    },
    execution: {
      status: input.providerResult.status === "success" ? "SUCCESS" : "UNKNOWN",
    },
    quote,
    action: arrayField(
      actionValue === null ? null : [actionValue],
      source,
      blockNumber,
      fetchedAt,
    ),
    receipt: jsonField(null, source, blockNumber, fetchedAt),
    outcome: jsonField(null, source, blockNumber, fetchedAt),
    assetChanges: arrayField(null, source, blockNumber, fetchedAt),
    assetChangeAssessment: "UNKNOWN",
    warnings: arrayField([], source, blockNumber, fetchedAt),
    simulation: {
      value: {
        expectedTransactions: 1,
        observedResults: 0,
        unmatchedResultIndexes: [],
        halted: input.providerResult.status !== "success",
        complete: false,
        missingTransactionIndexes: [0],
        ...(input.providerResult.status === "success"
          ? {}
          : {
              haltReason: `Native RPC result was ${input.providerResult.status}`,
            }),
      },
      source: "derived",
      reproducibility: reproducibility(mode),
      blockNumber,
      fetchedAt,
      limitation:
        "Standard eth_call does not produce a receipt or generic asset-change set",
    },
    blockNumber: stringField(blockNumber, source, blockNumber, fetchedAt),
    capabilities: [
      ...(input.providerResult.capabilities ?? NATIVE_RPC_CAPABILITIES),
    ],
    provenance: {
      fetchedAt,
      mode,
      source,
      simulationBlock: blockNumber,
      ...(runtime === undefined ? {} : { runtime }),
    },
    checkedScope,
    unknownScope,
    providerData,
  });
  return evidence;
}

export const mapNativeRpcProviderResult = toNativeRpcGenericEvidence;

function genericProviderStatus(status: NativeRpcStatus): GenericProviderStatus {
  switch (status) {
    case "success":
      // The Native RPC surface is deliberately partial even when both methods
      // return successfully; no receipt/outcome/asset changes were observed.
      return "UNKNOWN";
    case "unknown":
      return "UNKNOWN";
    case "unsupported":
      return "UNSUPPORTED";
    case "stale":
      return "STALE";
    case "timeout":
    case "failed":
    case "invalid":
      return "FAILED";
  }
}

function toGenericIntent(
  intent: NormalizedSwapIntent | GenericSwapIntent,
  tokenInDecimals: number,
  tokenOutDecimals: number,
): GenericSwapIntent {
  if (!("economicBoundary" in intent)) return { ...intent };
  const boundary = intent.economicBoundary;
  return {
    chainId: intent.chainId,
    protocol: intent.protocol,
    sender: intent.sender,
    tokenIn:
      intent.tokenIn.kind === "native" ? "native" : intent.tokenIn.address,
    tokenOut:
      intent.tokenOut.kind === "native" ? "native" : intent.tokenOut.address,
    amountIn: convertAtomicAmountToHuman(
      intent.amountInAtomic,
      tokenInDecimals,
    ),
    ...(boundary.availability === "available"
      ? {
          minimumReceived: convertAtomicAmountToHuman(
            boundary.minimumReceivedAtomic,
            tokenOutDecimals,
          ),
          minimumReceivedSource: boundary.source,
        }
      : { minimumReceivedSource: "unavailable" }),
  };
}

function quoteField(
  quote: unknown,
  source: "mock" | "rpc",
  blockNumber: string,
  fetchedAt: string,
) {
  if (!isRecord(quote)) return jsonField(null, source, blockNumber, fetchedAt);
  const estimatedAmountOut = quote.estimatedAmountOut;
  const minimumAmountOut = quote.minimumAmountOut;
  if (
    typeof estimatedAmountOut !== "string" ||
    !/^\d+(?:\.\d+)?$/.test(estimatedAmountOut) ||
    (minimumAmountOut !== undefined &&
      (typeof minimumAmountOut !== "string" ||
        !/^\d+(?:\.\d+)?$/.test(minimumAmountOut)))
  ) {
    return jsonField(null, source, blockNumber, fetchedAt);
  }
  return {
    value: {
      estimatedAmountOut,
      ...(minimumAmountOut === undefined ? {} : { minimumAmountOut }),
    },
    source: source === "mock" ? "mock" : "quote",
    reproducibility: source === "mock" ? "NOT_REPRODUCIBLE" : "REPRODUCIBLE",
    blockNumber,
    fetchedAt,
  };
}

function runtimeFromQuote(quote: unknown) {
  if (!isRecord(quote)) return undefined;
  const runtimeVersion = quote.runtimeVersion;
  const runtimeRevision = quote.runtimeRevision;
  if (
    typeof runtimeVersion !== "string" ||
    runtimeVersion.trim() === "" ||
    typeof runtimeRevision !== "string" ||
    runtimeRevision.trim() === ""
  ) {
    return undefined;
  }
  return { runtimeVersion, runtimeRevision };
}

function jsonField(
  value: ProvisionalJsonValue | null,
  source: "mock" | "rpc",
  blockNumber: string,
  fetchedAt: string,
) {
  return {
    value,
    source,
    reproducibility: source === "mock" ? "NOT_REPRODUCIBLE" : "REPRODUCIBLE",
    blockNumber,
    fetchedAt,
  } as const;
}

function arrayField(
  value: readonly ProvisionalJsonValue[] | null,
  source: "mock" | "rpc",
  blockNumber: string,
  fetchedAt: string,
) {
  return jsonField(
    value === null ? null : [...value],
    source,
    blockNumber,
    fetchedAt,
  );
}

function stringField(
  value: string,
  source: "mock" | "rpc",
  blockNumber: string,
  fetchedAt: string,
) {
  return jsonField(value, source, blockNumber, fetchedAt);
}

function reproducibility(mode: NativeRpcProviderMode) {
  return mode === "MOCK" ? "NOT_REPRODUCIBLE" : "REPRODUCIBLE";
}

function providerModeFromResult(
  result: ProviderEvaluationResult,
): NativeRpcProviderMode | undefined {
  if (result.responseEvidence?.kind !== "redacted_snapshot") return undefined;
  const snapshot = result.responseEvidence.snapshot;
  if (!isRecord(snapshot)) return undefined;
  const mode = snapshot.mode;
  return mode === "LIVE" || mode === "RECORDED_REPLAY" || mode === "MOCK"
    ? mode
    : undefined;
}

function freshnessFromCandidate(
  field: ProvisionalCandidateFieldInput | undefined,
): Freshness {
  if (field === undefined) {
    return { status: "not_checked" };
  }
  if (field.status !== "observed") {
    return {
      status: "unknown",
      reason:
        typeof field.value === "string"
          ? field.value
          : (field.semanticNote ??
            "Native RPC freshness metadata is unavailable"),
    };
  }
  if (!isRecord(field.value)) {
    return {
      status: "unknown",
      reason: "Native RPC freshness metadata is incomplete",
    };
  }
  const status = field.value.status;
  if (status === "fresh" || status === "stale") {
    const pinnedBlock = field.value.pinnedBlock;
    const headBlock = field.value.headBlock;
    const lag = field.value.lag;
    const maxBlockLag = field.value.maxBlockLag;
    if (
      typeof pinnedBlock === "string" &&
      typeof headBlock === "string" &&
      typeof lag === "string" &&
      typeof maxBlockLag === "number"
    ) {
      return { status, pinnedBlock, headBlock, lag, maxBlockLag };
    }
  }
  return {
    status: "unknown",
    reason: "Native RPC freshness metadata is incomplete",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValueOrNull(value: unknown): ProvisionalJsonValue | null {
  return toJsonValue(value) ?? null;
}

function toJsonValue(value: unknown): ProvisionalJsonValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    const values = value.map(toJsonValue);
    return values.some((entry) => entry === undefined)
      ? undefined
      : (values as ProvisionalJsonValue[]);
  }
  if (isRecord(value)) {
    const result: Record<string, ProvisionalJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalized = toJsonValue(entry);
      if (normalized === undefined) return undefined;
      result[key] = normalized;
    }
    return result;
  }
  return undefined;
}
