import {
  type EvidenceCapabilityPresentation,
  type EvidencePresentation,
  evidencePresentationSchema,
  type GenericEvidence,
  type RunResult,
} from "@parallax/contracts";
import { projectTraceRpcEvidence } from "./trace-rpc-public.js";

const fieldNames = {
  quote: "quote",
  action: "action",
  receipt: "receipt",
  outcome: "outcome",
  "asset-changes": "assetChanges",
  "simulation-coverage": "simulation",
  completeness: "simulation",
  warnings: "warnings",
} as const;

/** Derives an allowlisted display view before persistence. No RPC or Risk. */
export function projectEvidencePresentation(
  result: RunResult,
): EvidencePresentation {
  const provider = result.providerEvidence;
  return evidencePresentationSchema.parse({
    version: 1,
    items: result.evidence.map((item) => {
      const candidate = fieldForKey(item.key, provider);
      const field =
        candidate?.source === item.source &&
        candidate?.blockNumber === item.blockNumber
          ? candidate
          : undefined;
      // A missing timestamp stays missing. In particular, never substitute the
      // pinned block's timestamp, Run creation time or another field's fetchedAt.
      const known =
        item.status !== "unknown" &&
        item.source !== "unknown" &&
        item.source !== "mock" &&
        !item.isMock &&
        item.reproducibility === "REPRODUCIBLE";
      return {
        evidenceKey: item.key,
        status:
          known && item.status !== "not_applicable" ? "checked" : "unknown",
        sourceCategory:
          item.source === "unknown"
            ? "unknown"
            : item.stage === "QUOTE"
              ? "quote"
              : item.stage === "SIMULATE"
                ? "simulation"
                : "unknown",
        ...(field?.fetchedAt === undefined
          ? {}
          : { observedAt: field.fetchedAt }),
        ...(item.isMock
          ? { mode: "MOCK" }
          : item.isReplay
            ? { mode: "RECORDED_REPLAY" }
            : field !== undefined && provider !== undefined
              ? { mode: provider.provenance.mode }
              : {}),
        ...(item.status === "not_applicable"
          ? { reason: "not_applicable" }
          : known
            ? {}
            : { reason: "evidence_unknown" }),
      };
    }),
    capabilities: [...nativeCapabilities(result), ...traceCapabilities(result)],
  });
}

function fieldForKey(key: string, evidence: GenericEvidence | undefined) {
  if (evidence === undefined) return undefined;
  const prefix = `${evidence.provenance.runtime?.commit ?? "live"}:`;
  for (const [suffix, fieldName] of Object.entries(fieldNames)) {
    if (key === `${prefix}${suffix}`) return evidence[fieldName];
  }
  return undefined;
}

function nativeCapabilities(
  result: RunResult,
): EvidenceCapabilityPresentation[] {
  const simulation = result.p0?.basicSimulation;
  // This is an explicitly typed Native RPC fact, not a provider-ID heuristic.
  if (simulation === undefined) return [];
  const common = {
    sourceCategory: "native_rpc" as const,
    stage: "SIMULATE" as const,
    ...(result.providerEvidence === undefined
      ? {}
      : { mode: result.providerEvidence.provenance.mode }),
    blockContext: {
      blockNumber: simulation.blockNumber,
      ...(simulation.blockHash === undefined
        ? {}
        : { blockHash: simulation.blockHash }),
      status:
        simulation.blockHash === undefined
          ? ("requested" as const)
          : ("observed" as const),
    },
  };
  const capability = (
    key: string,
    summary: string,
    status: string,
  ): EvidenceCapabilityPresentation => ({
    ...common,
    key,
    summary,
    ...(status === "NOT_RUN" ? {} : { observedAt: simulation.observedAt }),
    status:
      status === "NOT_RUN"
        ? "not_checked"
        : status === "UNAVAILABLE"
          ? "unavailable"
          : "checked",
    ...(status === "NOT_RUN"
      ? { reason: "check_not_run" as const }
      : status === "UNAVAILABLE"
        ? {
            reason:
              simulation.failureStage === "PREPARE"
                ? ("binding_mismatch" as const)
                : simulation.failureStage === "BLOCK"
                  ? ("context_unverified" as const)
                  : result.providerEvidence?.provider.failure?.code ===
                      "TIMEOUT"
                    ? ("timeout" as const)
                    : ("rpc_unavailable" as const),
          }
        : {}),
  });
  return [
    capability(
      "native-rpc.eth_call",
      "Pinned transaction call",
      simulation.call.status,
    ),
    capability(
      "native-rpc.estimateGas",
      "Pinned transaction gas estimate",
      simulation.gasEstimate.status,
    ),
    ...["receipt", "outcome", "assetChanges", "state-diff", "logs", "traces"]
      .filter((key) => simulation.uncheckedCapabilities.includes(key))
      .map(
        (key): EvidenceCapabilityPresentation => ({
          key: `native-rpc.${key}`,
          summary: `Native RPC ${key} coverage`,
          stage: "SIMULATE",
          sourceCategory: "native_rpc",
          status: "not_checked",
          reason: "outside_baseline",
          // No observation time/block for operations that were never performed.
        }),
      ),
  ];
}

function traceCapabilities(
  result: RunResult,
): EvidenceCapabilityPresentation[] {
  const trace = projectTraceRpcEvidence(
    result.providerEvidence?.providerData.traceRpc,
  );
  if (trace === undefined) return [];
  // Only consume the previously validated public allowlist; never raw trace data.
  const source = trace.source as {
    observedAt: string;
    mode: EvidenceCapabilityPresentation["mode"];
  };
  const binding = trace.binding as
    | { blockContext: { blockNumber: string; blockHash?: string } }
    | undefined;
  const capabilities = trace.capabilities as Record<
    string,
    { status: string; reason?: EvidenceCapabilityPresentation["reason"] }
  >;
  const checked = trace.checkedScope as string[];
  const unknown = trace.unknownScope as string[];
  const unavailable = trace.unavailableScope as string[];
  const operations: readonly (readonly [
    string,
    string,
    (typeof capabilities)[string] | undefined,
  ])[] = [
    ["trace-rpc.chain", "Trace chain identity", undefined],
    ["trace-rpc.pinned-block", "Trace pinned block", undefined],
    [
      "trace-rpc.callTracer",
      "Supplementary call trace",
      capabilities.callTracer,
    ],
    [
      "trace-rpc.prestateTracer.diffMode",
      "Supplementary state diff",
      capabilities.prestateTracerDiff,
    ],
  ];
  return operations.map(
    ([scopeKey, summary, operation]): EvidenceCapabilityPresentation => {
      const status = checked.includes(scopeKey)
        ? "checked"
        : unknown.includes(scopeKey)
          ? "unknown"
          : unavailable.includes(scopeKey)
            ? "unavailable"
            : "unknown";
      return {
        key: scopeKey,
        summary,
        stage: "SIMULATE",
        sourceCategory: "trace_rpc",
        status,
        observedAt: source.observedAt,
        mode: source.mode,
        ...(binding === undefined
          ? {}
          : {
              blockContext: {
                blockNumber: binding.blockContext.blockNumber,
                ...(binding.blockContext.blockHash === undefined
                  ? {}
                  : { blockHash: binding.blockContext.blockHash }),
                status: checked.includes("trace-rpc.pinned-block")
                  ? "observed"
                  : "requested",
              },
            }),
        ...(status === "checked"
          ? {}
          : {
              reason:
                !unknown.includes(scopeKey) && !unavailable.includes(scopeKey)
                  ? "not_recorded"
                  : (operation?.reason ?? "context_unverified"),
            }),
      };
    },
  );
}
