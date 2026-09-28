import { createHash } from "node:crypto";
import type { BlockContext } from "./chain-adapter.js";
import {
  NATIVE_RPC_UNCHECKED_CAPABILITIES,
  type NativeRpcIntent,
  type NativeRpcPreparedExecution,
} from "./native-rpc-evidence.js";
import type { ProviderEvaluationResult } from "./provider-adapter.js";
import type { ProvisionalCandidateFieldInput } from "./provider-result-boundary.js";
import type {
  TraceCallEvidence,
  TraceRpcEvidenceResult,
  TraceRpcFreshness,
  TraceStateDiffEvidence,
} from "./trace-rpc-evidence-source.js";

/**
 * Provider-neutral Evidence portability projection (#91).
 *
 * NativeRpcProvider stays the primary execution baseline and
 * TraceRpcEvidenceSource stays supplementary. This module only compares the
 * normalized facts that both sources can contribute for one exact prepared
 * unsigned transaction context, so a capability difference is published as an
 * explicit `checked` / `unknown` / `unavailable` observation instead of being
 * padded to parity.
 *
 * Boundaries this module must preserve:
 *
 * - it consumes normalized provider outputs only (`ProviderEvaluationResult`
 *   candidate observations and `TraceRpcEvidenceResult`), never a raw RPC
 *   response, endpoint, credential, or transport error;
 * - an observation one source does not perform remains `unavailable` with an
 *   explicit reason, and an observation that failed remains `unknown`;
 * - identical fields are not required: `agreement` records whether two
 *   comparable observations matched, and `not_comparable` is a valid outcome;
 * - it introduces no ranking, scoring, voting, consensus, preference, or
 *   automatic fallback, and it changes no Risk/Product/Contract semantics.
 */

export const EVIDENCE_PORTABILITY_VERSION = "evidence-portability-v1";

export const EVIDENCE_PORTABILITY_FACTS = Object.freeze([
  "call",
  "gas",
  "trace",
  "stateDiff",
  "block",
  "freshness",
  "provenance",
] as const);

export type PortabilityFactName = (typeof EVIDENCE_PORTABILITY_FACTS)[number];

export type PortabilityFactState = "checked" | "unknown" | "unavailable";

/**
 * Whether two comparable observations matched. This is a statement of fact for
 * one capability, not a provider preference: differing measurements stay
 * visible and never select, rank, or replace a source.
 */
export type PortabilityAgreement = "equal" | "different" | "not_comparable";

export type PortabilityFactDetail = Readonly<
  Record<string, string | number | boolean | readonly string[]>
>;

export type PortabilityFactObservation = {
  readonly state: PortabilityFactState;
  readonly reason?: string;
  readonly detail?: PortabilityFactDetail;
};

export type PortabilityFact = {
  readonly fact: PortabilityFactName;
  readonly nativeRpc: PortabilityFactObservation;
  readonly traceRpc: PortabilityFactObservation;
  readonly agreement: PortabilityAgreement;
};

export type PortabilitySourceSummary = {
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly mode: string;
  readonly observedAt: string;
  readonly status: string;
  readonly capabilities: readonly string[];
  /**
   * Scope names derived from this source's per-fact states in `facts`, so the
   * published scope can never disagree with the published observation.
   */
  readonly checkedScope: readonly string[];
  readonly unknownScope: readonly string[];
  readonly unavailableScope: readonly string[];
};

export type EvidencePortabilityBinding = {
  readonly runId: string;
  readonly chainId: number;
  readonly protocol: string;
  readonly preparedTransactionFingerprint: string;
  readonly preparedTransaction: {
    readonly from: string;
    readonly to: string;
    readonly data: string;
    readonly value: string;
  };
  readonly blockContext: BlockContext;
};

export type EvidencePortabilityScope = {
  readonly nativeRpcPrimaryBaseline: true;
  readonly traceSupplementaryOnly: true;
  readonly providerRanking: false;
  readonly providerScoring: false;
  readonly providerVoting: false;
  readonly providerConsensus: false;
  readonly automaticFallback: false;
  readonly unsignedReadOnly: true;
};

export type EvidencePortabilityRecord = {
  readonly version: string;
  readonly binding: EvidencePortabilityBinding;
  readonly sources: {
    readonly nativeRpc: PortabilitySourceSummary;
    readonly traceRpc: PortabilitySourceSummary;
  };
  readonly facts: readonly PortabilityFact[];
  readonly scope: EvidencePortabilityScope;
};

export type EvidencePortabilityInput<
  Intent extends NativeRpcIntent = NativeRpcIntent,
> = {
  readonly nativeRpc: ProviderEvaluationResult;
  readonly traceRpc: TraceRpcEvidenceResult;
  readonly preparedExecution: NativeRpcPreparedExecution<Intent>;
};

export type EvidencePortabilityFailureReason =
  | "missing_trace_binding"
  | "run_binding_mismatch"
  | "chain_binding_mismatch"
  | "protocol_binding_mismatch"
  | "block_binding_mismatch"
  | "transaction_binding_mismatch"
  | "prepared_transaction_mismatch";

/**
 * Fail-closed refusal to compare. A portability claim is only meaningful when
 * both sources were bound to the same run, chain, protocol, prepared
 * transaction, and pinned block context.
 */
export class EvidencePortabilityError extends Error {
  public readonly name = "EvidencePortabilityError";

  public constructor(public readonly reason: EvidencePortabilityFailureReason) {
    super(`Evidence portability comparison refused: ${reason}`);
  }
}

export function compareEvidencePortability<Intent extends NativeRpcIntent>(
  input: EvidencePortabilityInput<Intent>,
): EvidencePortabilityRecord {
  const binding = validateBinding(input);
  const nativeRpc = input.nativeRpc;
  const traceRpc = input.traceRpc;

  const nativeCall = nativeCallObservation(nativeRpc);
  const traceCall = traceCallObservation(traceRpc.capabilities.callTracer);
  const nativeGas = nativeGasObservation(nativeRpc);
  const traceGas = traceGasObservation(traceRpc.capabilities.callTracer);
  const nativeBlock = nativeBlockObservation(nativeRpc);
  const traceBlock = traceBlockObservation(traceRpc);
  const nativeFreshness = nativeFreshnessObservation(nativeRpc);
  const traceFreshness = traceFreshnessObservation(traceRpc.freshness);

  const facts: readonly PortabilityFact[] = Object.freeze([
    Object.freeze({
      fact: "call",
      nativeRpc: nativeCall,
      traceRpc: traceCall,
      agreement: callAgreement(nativeCall, traceCall),
    }),
    Object.freeze({
      fact: "gas",
      nativeRpc: nativeGas,
      traceRpc: traceGas,
      agreement: valueAgreement(nativeGas, traceGas, "gasUnits"),
    }),
    Object.freeze({
      fact: "trace",
      nativeRpc: nativeScopeObservation(nativeRpc, "traces"),
      traceRpc: traceCall,
      agreement: "not_comparable",
    }),
    Object.freeze({
      fact: "stateDiff",
      nativeRpc: nativeScopeObservation(nativeRpc, "state-diff"),
      traceRpc: traceStateDiffObservation(
        traceRpc.capabilities.prestateTracerDiff,
      ),
      agreement: "not_comparable",
    }),
    Object.freeze({
      fact: "block",
      nativeRpc: nativeBlock,
      traceRpc: traceBlock,
      agreement: blockAgreement(nativeBlock, traceBlock),
    }),
    Object.freeze({
      fact: "freshness",
      nativeRpc: nativeFreshness,
      traceRpc: traceFreshness,
      agreement: valueAgreement(
        nativeFreshness,
        traceFreshness,
        "freshnessStatus",
      ),
    }),
    Object.freeze({
      fact: "provenance",
      nativeRpc: nativeProvenanceObservation(nativeRpc),
      traceRpc: traceProvenanceObservation(traceRpc),
      // Source identity is source-specific by design; provenance is published
      // side by side and is never an agreement or preference claim.
      agreement: "not_comparable",
    }),
  ]);

  const scope: EvidencePortabilityScope = {
    nativeRpcPrimaryBaseline: true,
    traceSupplementaryOnly: true,
    providerRanking: false,
    providerScoring: false,
    providerVoting: false,
    providerConsensus: false,
    automaticFallback: false,
    unsignedReadOnly: true,
  };

  const record: EvidencePortabilityRecord = {
    version: EVIDENCE_PORTABILITY_VERSION,
    binding,
    sources: {
      nativeRpc: nativeSourceSummary(nativeRpc, facts),
      traceRpc: traceSourceSummary(traceRpc, facts),
    },
    facts,
    scope,
  };

  return Object.freeze(record);
}

/**
 * Stable fingerprint of one hex observation. Both sources are normalized with
 * this same helper before comparison so agreement never depends on hex casing,
 * JSON shape, or a provider-specific serialization.
 */
export function fingerprintHexData(value: string): string {
  return `sha256:${createHash("sha256")
    .update(value.toLowerCase())
    .digest("hex")}`;
}

function validateBinding<Intent extends NativeRpcIntent>(
  input: EvidencePortabilityInput<Intent>,
): EvidencePortabilityBinding {
  const prepared = input.preparedExecution;
  const trace = input.traceRpc.binding;

  if (trace === undefined) {
    throw new EvidencePortabilityError("missing_trace_binding");
  }
  if (trace.runId !== prepared.runId) {
    throw new EvidencePortabilityError("run_binding_mismatch");
  }
  // The primary result carries its run binding inside its redacted snapshot.
  // When it is present it must name the same run; both sources were handed the
  // same evaluation envelope, so an absent snapshot runId is not a divergence.
  const nativeRunId = nativeSnapshotRunId(input.nativeRpc);
  if (nativeRunId !== undefined && nativeRunId !== prepared.runId) {
    throw new EvidencePortabilityError("run_binding_mismatch");
  }
  if (trace.chainId !== prepared.chainId) {
    throw new EvidencePortabilityError("chain_binding_mismatch");
  }
  if (trace.protocol !== prepared.protocol) {
    throw new EvidencePortabilityError("protocol_binding_mismatch");
  }
  if (trace.blockContext.blockNumber !== prepared.blockContext.blockNumber) {
    throw new EvidencePortabilityError("block_binding_mismatch");
  }
  if (
    prepared.blockContext.blockHash !== undefined &&
    trace.blockContext.blockHash?.toLowerCase() !==
      prepared.blockContext.blockHash.toLowerCase()
  ) {
    throw new EvidencePortabilityError("block_binding_mismatch");
  }

  const payload = normalizeUnsignedPayload(
    prepared.unsignedTransaction.payload,
  );
  const preparedTransactionFingerprint =
    fingerprintUnsignedTransaction(payload);

  if (preparedTransactionFingerprint !== trace.transactionFingerprint) {
    throw new EvidencePortabilityError("prepared_transaction_mismatch");
  }

  const observedBlockNumber = observedValue(
    input.nativeRpc,
    "nativeRpc.blockContext.blockNumber",
  );
  if (
    observedBlockNumber !== undefined &&
    observedBlockNumber !== prepared.blockContext.blockNumber
  ) {
    throw new EvidencePortabilityError("block_binding_mismatch");
  }
  const observedBlockHash = observedValue(
    input.nativeRpc,
    "nativeRpc.blockContext.blockHash",
  );
  if (
    typeof observedBlockHash === "string" &&
    prepared.blockContext.blockHash !== undefined &&
    observedBlockHash.toLowerCase() !==
      prepared.blockContext.blockHash.toLowerCase()
  ) {
    throw new EvidencePortabilityError("block_binding_mismatch");
  }

  return Object.freeze({
    runId: prepared.runId,
    chainId: prepared.chainId,
    protocol: prepared.protocol,
    preparedTransactionFingerprint,
    preparedTransaction: Object.freeze({
      from: payload.from as string,
      to: payload.to as string,
      data: payload.data as string,
      value: payload.value as string,
    }),
    blockContext: Object.freeze({ ...prepared.blockContext }),
  });
}

/**
 * Mirrors the supplementary source's own normalization so the prepared
 * transaction fingerprint is comparable: the exact payload keys in insertion
 * order, with JSON-undefined entries dropped by serialization.
 */
function normalizeUnsignedPayload(
  payload: unknown,
): Record<string, string | undefined> {
  if (!isRecord(payload)) {
    throw new EvidencePortabilityError("transaction_binding_mismatch");
  }

  const normalized: Record<string, string | undefined> = {};

  for (const [key, entry] of Object.entries(payload)) {
    if (entry === undefined) {
      normalized[key] = undefined;
      continue;
    }
    if (typeof entry !== "string") {
      throw new EvidencePortabilityError("transaction_binding_mismatch");
    }
    normalized[key] = entry;
  }

  if (
    !isAddress(normalized.from) ||
    !isAddress(normalized.to) ||
    !isHexData(normalized.data) ||
    !isHexQuantity(normalized.value)
  ) {
    throw new EvidencePortabilityError("transaction_binding_mismatch");
  }

  return normalized;
}

function fingerprintUnsignedTransaction(
  payload: Record<string, string | undefined>,
): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ kind: "unsigned", payload }))
    .digest("hex")}`;
}

function nativeCallObservation(
  result: ProviderEvaluationResult,
): PortabilityFactObservation {
  const field = candidateField(result, "nativeRpc.ethCall.returnData");

  if (field?.status === "observed" && isHexData(field.value)) {
    return Object.freeze({
      state: "checked",
      detail: Object.freeze({
        returnDataFingerprint: fingerprintHexData(field.value),
      }),
    });
  }

  return nativeUnobservedObservation(result, field);
}

function nativeGasObservation(
  result: ProviderEvaluationResult,
): PortabilityFactObservation {
  const field = candidateField(result, "nativeRpc.estimateGas.gasUnits");

  if (field?.status === "observed" && isDecimal(field.value)) {
    return Object.freeze({
      state: "checked",
      detail: Object.freeze({
        gasUnits: field.value,
        measurement: "eth_estimateGas",
      }),
    });
  }

  return nativeUnobservedObservation(result, field);
}

function nativeBlockObservation(
  result: ProviderEvaluationResult,
): PortabilityFactObservation {
  const number = candidateField(result, "nativeRpc.blockContext.blockNumber");
  const hash = candidateField(result, "nativeRpc.blockContext.blockHash");

  if (number?.status === "observed" && typeof number.value === "string") {
    return Object.freeze({
      state: "checked",
      detail: Object.freeze({
        blockNumber: number.value,
        ...(hash?.status === "observed" && typeof hash.value === "string"
          ? { blockHash: hash.value }
          : {}),
      }),
    });
  }

  return nativeUnobservedObservation(result, number);
}

function nativeFreshnessObservation(
  result: ProviderEvaluationResult,
): PortabilityFactObservation {
  const field = candidateField(result, "nativeRpc.freshness");

  if (field === undefined) {
    return Object.freeze({
      state: "unavailable",
      reason: "source_did_not_check_freshness",
      detail: Object.freeze({ freshnessStatus: "not_checked" }),
    });
  }

  if (
    field.status === "observed" &&
    isRecord(field.value) &&
    (field.value.status === "fresh" || field.value.status === "stale")
  ) {
    return Object.freeze({
      state: "checked",
      detail: Object.freeze({
        freshnessStatus: field.value.status,
        ...(typeof field.value.pinnedBlock === "string"
          ? { pinnedBlock: field.value.pinnedBlock }
          : {}),
        ...(typeof field.value.headBlock === "string"
          ? { headBlock: field.value.headBlock }
          : {}),
        ...(typeof field.value.lag === "string"
          ? { lag: field.value.lag }
          : {}),
        ...(typeof field.value.maxBlockLag === "number"
          ? { maxBlockLag: field.value.maxBlockLag }
          : {}),
      }),
    });
  }

  return Object.freeze({
    state: "unknown",
    reason: "freshness_metadata_incomplete",
    detail: Object.freeze({ fieldStatus: field.status }),
  });
}

/**
 * A capability the primary source does not exercise. It stays `unavailable`
 * with an explicit reason (or `unknown` when the source declares the
 * capability without producing a comparable observation) rather than being
 * padded to parity with the supplementary source.
 */
function nativeScopeObservation(
  result: ProviderEvaluationResult,
  capability: string,
): PortabilityFactObservation {
  const declared = result.capabilities;

  if (declared === undefined) {
    return Object.freeze({
      state: "unknown",
      reason: "source_capabilities_undeclared",
      detail: Object.freeze({ capability }),
    });
  }

  if (declared.includes(capability)) {
    return Object.freeze({
      state: "unknown",
      reason: "capability_declared_without_observation",
      detail: Object.freeze({ capability }),
    });
  }

  return Object.freeze({
    state: "unavailable",
    reason: "capability_not_in_source_scope",
    detail: Object.freeze({
      capability,
      declaredUnchecked: NATIVE_RPC_UNCHECKED_CAPABILITIES.includes(
        capability as (typeof NATIVE_RPC_UNCHECKED_CAPABILITIES)[number],
      ),
    }),
  });
}

function nativeProvenanceObservation(
  result: ProviderEvaluationResult,
): PortabilityFactObservation {
  return Object.freeze({
    state: "checked",
    detail: Object.freeze({
      sourceId: result.provider.providerId,
      ...(result.provider.providerVersion === undefined
        ? {}
        : { sourceVersion: result.provider.providerVersion }),
      mode: result.mode,
      observedAt: result.provider.observedAt,
    }),
  });
}

function nativeUnobservedObservation(
  result: ProviderEvaluationResult,
  field: ProvisionalCandidateFieldInput | undefined,
): PortabilityFactObservation {
  if (field === undefined) {
    return Object.freeze({
      state: "unknown",
      reason: "source_stopped_before_observation",
      detail: Object.freeze({ sourceStatus: result.status }),
    });
  }

  if (result.status === "unsupported") {
    return Object.freeze({
      state: "unavailable",
      reason: "capability_not_supported",
      detail: Object.freeze({ fieldStatus: field.status }),
    });
  }

  if (field.status === "observed") {
    return Object.freeze({
      state: "unknown",
      reason: "invalid_observation",
      detail: Object.freeze({ fieldStatus: field.status }),
    });
  }

  if (result.status === "timeout") {
    return Object.freeze({
      state: "unknown",
      reason: "rpc_timeout",
      detail: Object.freeze({ fieldStatus: field.status }),
    });
  }

  return Object.freeze({
    state: "unknown",
    reason:
      field.status === "invalid" ? "invalid_observation" : "observation_failed",
    detail: Object.freeze({ fieldStatus: field.status }),
  });
}

function traceCallObservation(
  call: TraceCallEvidence,
): PortabilityFactObservation {
  if (call.status === "observed") {
    return Object.freeze({
      state: "checked",
      detail: Object.freeze({
        executionStatus: call.executionStatus,
        gasUsed: BigInt(call.gasUsed).toString(),
        gasUsedHex: call.gasUsed,
        measurement: "debug_traceCall.callTracer.gasUsed",
        ...(call.output === undefined
          ? {}
          : { outputFingerprint: fingerprintHexData(call.output) }),
        resultFingerprint: call.resultFingerprint,
      }),
    });
  }

  return Object.freeze({
    state: call.status === "unavailable" ? "unavailable" : "unknown",
    reason: call.reason,
  });
}

function traceGasObservation(
  call: TraceCallEvidence,
): PortabilityFactObservation {
  if (call.status === "observed") {
    return Object.freeze({
      state: "checked",
      detail: Object.freeze({
        gasUnits: BigInt(call.gasUsed).toString(),
        gasUsedHex: call.gasUsed,
        measurement: "debug_traceCall.callTracer.gasUsed",
      }),
    });
  }

  return Object.freeze({
    state: call.status === "unavailable" ? "unavailable" : "unknown",
    reason: call.reason,
  });
}

function traceStateDiffObservation(
  diff: TraceStateDiffEvidence,
): PortabilityFactObservation {
  if (diff.status === "observed") {
    return Object.freeze({
      state: "checked",
      detail: Object.freeze({
        diffMode: diff.diffMode,
        preAddressCount: diff.preAddressCount,
        postAddressCount: diff.postAddressCount,
        changedAddressCount: diff.changedAddresses.length,
        resultFingerprint: diff.resultFingerprint,
      }),
    });
  }

  return Object.freeze({
    state: diff.status === "unavailable" ? "unavailable" : "unknown",
    reason: diff.reason,
  });
}

function traceBlockObservation(
  result: TraceRpcEvidenceResult,
): PortabilityFactObservation {
  const blockContext = result.binding?.blockContext;

  if (blockContext === undefined) {
    return Object.freeze({
      state: "unknown",
      reason: "trace_block_binding_missing",
    });
  }

  return Object.freeze({
    state: "checked",
    detail: Object.freeze({
      blockNumber: blockContext.blockNumber,
      ...(blockContext.blockHash === undefined
        ? {}
        : { blockHash: blockContext.blockHash }),
    }),
  });
}

function traceFreshnessObservation(
  freshness: TraceRpcFreshness,
): PortabilityFactObservation {
  if (freshness.status === "not_checked") {
    return Object.freeze({
      state: "unavailable",
      reason: "source_did_not_check_freshness",
      detail: Object.freeze({ freshnessStatus: "not_checked" }),
    });
  }

  return Object.freeze({
    state: "unknown",
    reason: "freshness_metadata_incomplete",
  });
}

function traceProvenanceObservation(
  result: TraceRpcEvidenceResult,
): PortabilityFactObservation {
  return Object.freeze({
    state: "checked",
    detail: Object.freeze({
      sourceId: result.source.sourceId,
      sourceVersion: result.source.sourceVersion,
      mode: result.source.mode,
      observedAt: result.source.observedAt,
    }),
  });
}

function callAgreement(
  nativeRpc: PortabilityFactObservation,
  traceRpc: PortabilityFactObservation,
): PortabilityAgreement {
  if (nativeRpc.state !== "checked" || traceRpc.state !== "checked") {
    return "not_comparable";
  }

  const nativeFingerprint = nativeRpc.detail?.returnDataFingerprint;
  const traceFingerprint = traceRpc.detail?.outputFingerprint;

  if (
    typeof nativeFingerprint !== "string" ||
    typeof traceFingerprint !== "string"
  ) {
    return "not_comparable";
  }

  return nativeFingerprint === traceFingerprint ? "equal" : "different";
}

function valueAgreement(
  nativeRpc: PortabilityFactObservation,
  traceRpc: PortabilityFactObservation,
  key: string,
): PortabilityAgreement {
  if (nativeRpc.state !== "checked" || traceRpc.state !== "checked") {
    return "not_comparable";
  }

  const nativeValue = nativeRpc.detail?.[key];
  const traceValue = traceRpc.detail?.[key];

  if (nativeValue === undefined || traceValue === undefined) {
    return "not_comparable";
  }

  return nativeValue === traceValue ? "equal" : "different";
}

function blockAgreement(
  nativeRpc: PortabilityFactObservation,
  traceRpc: PortabilityFactObservation,
): PortabilityAgreement {
  if (nativeRpc.state !== "checked" || traceRpc.state !== "checked") {
    return "not_comparable";
  }

  const nativeNumber = nativeRpc.detail?.blockNumber;
  const traceNumber = traceRpc.detail?.blockNumber;

  if (nativeNumber === undefined || traceNumber === undefined) {
    return "not_comparable";
  }

  const numbersMatch = nativeNumber === traceNumber;

  if (!numbersMatch) {
    return "different";
  }

  const nativeHash = nativeRpc.detail?.blockHash;
  const traceHash = traceRpc.detail?.blockHash;

  if (typeof nativeHash !== "string" || typeof traceHash !== "string") {
    // The pinned block number matched, but at least one source did not bind a
    // block hash, so full block identity cannot be compared.
    return "not_comparable";
  }

  return nativeHash.toLowerCase() === traceHash.toLowerCase()
    ? "equal"
    : "different";
}

function nativeSourceSummary(
  result: ProviderEvaluationResult,
  facts: readonly PortabilityFact[],
): PortabilitySourceSummary {
  return Object.freeze({
    sourceId: result.provider.providerId,
    sourceVersion: result.provider.providerVersion ?? "unspecified",
    mode: result.mode,
    observedAt: result.provider.observedAt,
    status: result.status,
    capabilities: Object.freeze([...(result.capabilities ?? [])]),
    ...scopeFromFacts(facts, "nativeRpc"),
  });
}

function traceSourceSummary(
  result: TraceRpcEvidenceResult,
  facts: readonly PortabilityFact[],
): PortabilitySourceSummary {
  return Object.freeze({
    sourceId: result.source.sourceId,
    sourceVersion: result.source.sourceVersion,
    mode: result.source.mode,
    observedAt: result.source.observedAt,
    status: result.status,
    capabilities: Object.freeze([]),
    ...scopeFromFacts(facts, "traceRpc"),
  });
}

function scopeFromFacts(
  facts: readonly PortabilityFact[],
  side: "nativeRpc" | "traceRpc",
): {
  readonly checkedScope: readonly string[];
  readonly unknownScope: readonly string[];
  readonly unavailableScope: readonly string[];
} {
  const checkedScope: string[] = [];
  const unknownScope: string[] = [];
  const unavailableScope: string[] = [];

  for (const entry of facts) {
    const scope = `portability.${entry.fact}`;
    const state = entry[side].state;

    if (state === "checked") checkedScope.push(scope);
    else if (state === "unknown") unknownScope.push(scope);
    else unavailableScope.push(scope);
  }

  return {
    checkedScope: Object.freeze(checkedScope),
    unknownScope: Object.freeze(unknownScope),
    unavailableScope: Object.freeze(unavailableScope),
  };
}

function candidateField(
  result: ProviderEvaluationResult,
  candidatePath: string,
): ProvisionalCandidateFieldInput | undefined {
  return result.candidateFields.find(
    (field) => field.candidatePath === candidatePath,
  );
}

function observedValue(
  result: ProviderEvaluationResult,
  candidatePath: string,
): unknown {
  const field = candidateField(result, candidatePath);
  return field?.status === "observed" ? field.value : undefined;
}

/**
 * Reads the run binding from the primary result's controlled redacted snapshot.
 *
 * This is the provider-neutral observation context, not a raw RPC payload: the
 * snapshot is produced by the Provider boundary's own redaction profile.
 */
function nativeSnapshotRunId(
  result: ProviderEvaluationResult,
): string | undefined {
  const evidence = result.responseEvidence;
  if (evidence.kind !== "redacted_snapshot") return undefined;
  const snapshot = evidence.snapshot;
  if (!isRecord(snapshot)) return undefined;
  return typeof snapshot.runId === "string" && snapshot.runId.trim() !== ""
    ? snapshot.runId
    : undefined;
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
