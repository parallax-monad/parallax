import type {
  TraceCallEvidence,
  TraceRpcEvidenceMode,
  TraceRpcEvidenceResult,
  TraceRpcEvidenceStatus,
  TraceStateDiffEvidence,
} from "./trace-rpc-evidence-source.js";
import {
  TRACE_RPC_FAILURE_REASONS,
  TRACE_RPC_SCOPES,
  type TraceCapabilityFailureReason,
} from "./trace-rpc-evidence-source.js";

/**
 * Copies only normalized Trace facts across the Backend public projection
 * boundary. Both composition and application use this same allowlist so a
 * new Trace field cannot silently drift between the two redaction layers.
 */
export function projectTraceRpcEvidence(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isTraceRpcEvidenceShape(value)) return undefined;

  const result = value as TraceRpcEvidenceResult;
  const binding = result.binding;
  return {
    status: result.status,
    source: {
      sourceId: result.source.sourceId,
      sourceVersion: result.source.sourceVersion,
      mode: result.source.mode,
      observedAt: result.source.observedAt,
    },
    freshness: { status: result.freshness.status },
    ...(binding === undefined
      ? {}
      : {
          binding: {
            runId: binding.runId,
            chainId: binding.chainId,
            protocol: binding.protocol,
            transactionFingerprint: binding.transactionFingerprint,
            blockContext: {
              blockNumber: binding.blockContext.blockNumber,
              ...(binding.blockContext.blockHash === undefined
                ? {}
                : { blockHash: binding.blockContext.blockHash }),
              ...(binding.blockContext.observedAt === undefined
                ? {}
                : { observedAt: binding.blockContext.observedAt }),
            },
          },
        }),
    capabilities: {
      callTracer: projectTraceCapability(result.capabilities.callTracer),
      prestateTracerDiff: projectTraceCapability(
        result.capabilities.prestateTracerDiff,
      ),
    },
    checkedScope: [...result.checkedScope],
    unknownScope: [...result.unknownScope],
    unavailableScope: [...result.unavailableScope],
  };
}

function projectTraceCapability(
  value: TraceCallEvidence | TraceStateDiffEvidence,
): Record<string, unknown> {
  if (value.status !== "observed") {
    return { status: value.status, reason: value.reason };
  }

  if ("executionStatus" in value) {
    return {
      status: value.status,
      executionStatus: value.executionStatus,
      gasUsed: value.gasUsed,
      resultFingerprint: value.resultFingerprint,
    };
  }

  return {
    status: value.status,
    diffMode: value.diffMode,
    preAddressCount: value.preAddressCount,
    postAddressCount: value.postAddressCount,
    changedAddresses: [...value.changedAddresses],
    resultFingerprint: value.resultFingerprint,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTraceRpcEvidenceShape(
  value: unknown,
): value is TraceRpcEvidenceResult {
  if (!isRecord(value)) return false;
  const source = value.source;
  const freshness = value.freshness;
  const capabilities = value.capabilities;
  return (
    isTraceStatus(value.status) &&
    isRecord(source) &&
    source.sourceId === "trace-rpc" &&
    isSafeIdentifier(source.sourceVersion) &&
    isTraceMode(source.mode) &&
    isIsoTimestamp(source.observedAt) &&
    isRecord(freshness) &&
    freshness.status === "not_checked" &&
    isRecord(capabilities) &&
    isTraceCapabilityShape(capabilities.callTracer, "call") &&
    isTraceCapabilityShape(capabilities.prestateTracerDiff, "diff") &&
    isStringArray(value.checkedScope) &&
    isStringArray(value.unknownScope) &&
    isStringArray(value.unavailableScope) &&
    (value.status === "invalid" || value.binding !== undefined) &&
    (value.binding === undefined || isTraceBindingShape(value.binding)) &&
    isKnownScopeList(value.checkedScope) &&
    isKnownScopeList(value.unknownScope) &&
    isKnownScopeList(value.unavailableScope) &&
    isTraceStatusConsistent(value as unknown as TraceRpcEvidenceResult)
  );
}

function isTraceCapabilityShape(
  value: unknown,
  kind: "call" | "diff",
): boolean {
  if (!isRecord(value) || !isTraceCapabilityStatus(value.status)) {
    return false;
  }
  if (value.status !== "observed") {
    return isTraceCapabilityFailureReason(value.reason);
  }
  if (kind === "call") {
    return (
      isTraceExecutionStatus(value.executionStatus) &&
      isHexQuantity(value.gasUsed) &&
      isFingerprint(value.resultFingerprint) &&
      (value.output === undefined || isHexData(value.output))
    );
  }
  return (
    value.diffMode === true &&
    isNonNegativeSafeInteger(value.preAddressCount) &&
    isNonNegativeSafeInteger(value.postAddressCount) &&
    isCanonicalAddressList(value.changedAddresses) &&
    isFingerprint(value.resultFingerprint)
  );
}

function isTraceBindingShape(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.blockContext)) return false;
  return (
    isSafeIdentifier(value.runId) &&
    isNonNegativeSafeInteger(value.chainId) &&
    isSafeIdentifier(value.protocol) &&
    isFingerprint(value.transactionFingerprint) &&
    isDecimalQuantity(value.blockContext.blockNumber) &&
    (value.blockContext.blockHash === undefined ||
      isBlockHash(value.blockContext.blockHash)) &&
    (value.blockContext.observedAt === undefined ||
      isIsoTimestamp(value.blockContext.observedAt))
  );
}

function isTraceStatusConsistent(result: TraceRpcEvidenceResult): boolean {
  const callStatus = result.capabilities.callTracer.status;
  const diffStatus = result.capabilities.prestateTracerDiff.status;

  if (result.status === "invalid") {
    return (
      callStatus === "unknown" &&
      diffStatus === "unknown" &&
      result.checkedScope.length === 0 &&
      sameScopeList(result.unknownScope, [
        TRACE_RPC_SCOPES.callTracer,
        TRACE_RPC_SCOPES.prestateTracerDiff,
      ]) &&
      result.unavailableScope.length === 0
    );
  }

  const observedCount =
    Number(callStatus === "observed") + Number(diffStatus === "observed");
  const unknownCount =
    Number(callStatus === "unknown") + Number(diffStatus === "unknown");
  const expectedStatus =
    observedCount === 2
      ? "success"
      : observedCount > 0
        ? "partial"
        : unknownCount > 0
          ? "unknown"
          : "unavailable";

  if (result.status !== expectedStatus) return false;

  const expectedChecked = [
    TRACE_RPC_SCOPES.chain,
    TRACE_RPC_SCOPES.pinnedBlock,
    ...(callStatus === "observed" ? [TRACE_RPC_SCOPES.callTracer] : []),
    ...(diffStatus === "observed" ? [TRACE_RPC_SCOPES.prestateTracerDiff] : []),
  ];
  const expectedUnknown = [
    ...(callStatus === "unknown" ? [TRACE_RPC_SCOPES.callTracer] : []),
    ...(diffStatus === "unknown" ? [TRACE_RPC_SCOPES.prestateTracerDiff] : []),
  ];
  const expectedUnavailable = [
    ...(callStatus === "unavailable" ? [TRACE_RPC_SCOPES.callTracer] : []),
    ...(diffStatus === "unavailable"
      ? [TRACE_RPC_SCOPES.prestateTracerDiff]
      : []),
  ];

  if (
    sameScopeList(result.checkedScope, expectedChecked) &&
    sameScopeList(result.unknownScope, expectedUnknown) &&
    sameScopeList(result.unavailableScope, expectedUnavailable)
  ) {
    return true;
  }

  // A context failure happens before chain/pinned-block observation, so the
  // source legitimately returns no checked scope. This form is only valid
  // when both capabilities inherit the same failure.
  return (
    observedCount === 0 &&
    callStatus === diffStatus &&
    (callStatus === "unknown" || callStatus === "unavailable") &&
    result.checkedScope.length === 0 &&
    sameScopeList(result.unknownScope, expectedUnknown) &&
    sameScopeList(result.unavailableScope, expectedUnavailable)
  );
}

function isKnownScopeList(value: readonly string[]): boolean {
  return (
    new Set(value).size === value.length &&
    value.every((scope) =>
      (
        [
          TRACE_RPC_SCOPES.chain,
          TRACE_RPC_SCOPES.pinnedBlock,
          TRACE_RPC_SCOPES.callTracer,
          TRACE_RPC_SCOPES.prestateTracerDiff,
        ] as readonly string[]
      ).includes(scope),
    )
  );
}

function sameScopeList(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((scope, index) => scope === expected[index])
  );
}

function isTraceMode(value: unknown): value is TraceRpcEvidenceMode {
  return value === "LIVE" || value === "RECORDED_REPLAY" || value === "MOCK";
}

function isTraceStatus(value: unknown): value is TraceRpcEvidenceStatus {
  return (
    value === "success" ||
    value === "partial" ||
    value === "unknown" ||
    value === "unavailable" ||
    value === "invalid"
  );
}

function isTraceCapabilityStatus(
  value: unknown,
): value is "observed" | "unknown" | "unavailable" {
  return value === "observed" || value === "unknown" || value === "unavailable";
}

function isTraceCapabilityFailureReason(
  value: unknown,
): value is TraceCapabilityFailureReason {
  return TRACE_RPC_FAILURE_REASONS.includes(
    value as TraceCapabilityFailureReason,
  );
}

function isTraceExecutionStatus(
  value: unknown,
): value is "succeeded" | "reverted" {
  return value === "succeeded" || value === "reverted";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isCanonicalAddressList(value: unknown): value is string[] {
  if (!isStringArray(value)) return false;
  const addresses = value;
  if (!addresses.every((address) => /^0x[0-9a-f]{40}$/.test(address))) {
    return false;
  }
  return (
    new Set(addresses).size === addresses.length &&
    addresses.every(
      (address, index) => index === 0 || addresses[index - 1] < address,
    )
  );
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)
  );
}

function isDecimalQuantity(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value);
}

function isHexQuantity(value: unknown): value is string {
  return (
    typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  );
}

function isHexData(value: unknown): value is string {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isBlockHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    !Number.isNaN(Date.parse(value)) &&
    value === new Date(value).toISOString()
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
