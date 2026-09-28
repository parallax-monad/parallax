import type { Copy } from "@/lib/i18n";
import type { EvidenceCoverage, UnknownItem } from "./types";

const cp = (en: string, zh = en): Copy => ({ en, zh });
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const token = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value);
const block = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  !Number.isNaN(Date.parse(value)) &&
  /^\d{4}-\d\d-\d\dT/.test(value);

const SCOPE_LABELS: Record<string, Copy> = {
  "native-rpc.eth_call": cp("Contract call", "合约调用"),
  "native-rpc.estimateGas": cp("Gas estimate", "Gas 估算"),
  "native-rpc.pinned-block": cp("Pinned block", "固定区块"),
  "native-rpc.freshness": cp("Block freshness", "区块时效"),
  "trace-rpc.chain": cp("Chain identity", "链身份"),
  "trace-rpc.pinned-block": cp("Pinned block", "固定区块"),
  "trace-rpc.callTracer": cp("Execution trace", "执行追踪"),
  "trace-rpc.prestateTracer.diffMode": cp("State changes", "状态变化"),
  receipt: cp("Transaction receipt", "交易回执"),
  outcome: cp("Final outcome", "最终结果"),
  assetChanges: cp("Asset changes", "资产变化"),
  "state-diff": cp("State changes", "状态变化"),
  logs: cp("Event logs", "事件日志"),
  traces: cp("Execution trace", "执行追踪"),
  simulation: cp("Complete simulation", "完整模拟"),
  freshness: cp("Block freshness", "区块时效"),
  quote: cp("Quote", "报价"),
  action: cp("Prepared action", "已准备操作"),
};

const REASON_LABELS: Record<string, Copy> = {
  method_unsupported: cp("This method is not supported", "此方法不受支持"),
  invalid_parameters: cp(
    "The source could not use these parameters",
    "来源无法使用这些参数",
  ),
  timeout: cp("The check timed out", "检查超时"),
  cancelled: cp("The check was cancelled", "检查已取消"),
  rpc_unavailable: cp("The source was unavailable", "来源不可用"),
  malformed_response: cp("The response could not be verified", "无法验证响应"),
  binding_mismatch: cp(
    "The transaction context did not match",
    "交易上下文不匹配",
  ),
  context_unverified: cp(
    "The check context could not be verified",
    "无法验证检查上下文",
  ),
};

const TRACE_SCOPES = [
  "trace-rpc.chain",
  "trace-rpc.pinned-block",
  "trace-rpc.callTracer",
  "trace-rpc.prestateTracer.diffMode",
] as const;
const CAPABILITY_SCOPES = [TRACE_SCOPES[2], TRACE_SCOPES[3]] as const;
const STATUS = ["success", "partial", "unknown", "unavailable", "invalid"];

function scopes(
  value: unknown,
  allowed?: readonly string[],
): string[] | undefined {
  if (!Array.isArray(value) || value.length > 40) return undefined;
  if (!value.every(token)) return undefined;
  if (allowed && !value.every((item) => allowed.includes(item)))
    return undefined;
  return new Set(value).size === value.length ? value : undefined;
}

function label(value: string): Copy {
  return SCOPE_LABELS[value] ?? cp(value.replaceAll(/[._-]/g, " "));
}

function listed(values: readonly string[]): Copy[] {
  return values.map(label);
}

function unknownItems(
  values: readonly string[],
  reasons: Readonly<Record<string, Copy>> = {},
): UnknownItem[] {
  return values.map((value) => ({
    id: value,
    label: label(value),
    reason:
      reasons[value] ?? cp("The result is not established", "结果尚未确定"),
  }));
}

function disjoint(...groups: readonly string[][]): boolean {
  const all = groups.flat();
  return new Set(all).size === all.length;
}

function parsePrimary(
  run: Record<string, unknown>,
  evidence: Record<string, unknown>,
): EvidenceCoverage | undefined {
  const provider = record(evidence.provider);
  const provenance = record(evidence.provenance);
  const checked = scopes(evidence.checkedScope);
  const unknown = scopes(evidence.unknownScope);
  if (
    !provider ||
    !provenance ||
    !token(provider.providerId) ||
    !["LIVE", "RECORDED_REPLAY", "MOCK"].includes(String(provenance.mode)) ||
    !checked ||
    !unknown
  )
    return undefined;

  const simulation = record(record(run.p0)?.basicSimulation);
  const unchecked =
    simulation?.uncheckedCapabilities === undefined
      ? []
      : scopes(simulation.uncheckedCapabilities);
  if (!unchecked || !disjoint(checked, unknown)) return undefined;
  const notChecked = unchecked.filter((item) => !checked.includes(item));
  const unknownOnly = unknown.filter((item) => !notChecked.includes(item));
  const number = simulation?.blockNumber ?? provenance.simulationBlock;
  const observed = simulation?.observedAt ?? provenance.fetchedAt;
  if (
    (number !== undefined && !block(number)) ||
    (observed !== undefined && !timestamp(observed))
  )
    return undefined;

  const sourceId = provider.providerId as string;
  return {
    sourceId,
    source:
      sourceId === "native-rpc-arbitrum"
        ? cp("Native RPC", "原生 RPC")
        : cp(sourceId),
    role: "primary",
    mode: provenance.mode as EvidenceCoverage["mode"],
    blockNumber: number as string | undefined,
    observedAt: observed as string | undefined,
    checked: listed(checked),
    notChecked: listed(notChecked),
    unknown: unknownItems(unknownOnly),
    unavailable: [],
  };
}

function parseTrace(
  run: Record<string, unknown>,
  trace: Record<string, unknown>,
): EvidenceCoverage | undefined {
  const source = record(trace.source);
  const binding = record(trace.binding);
  const context = record(binding?.blockContext);
  const capabilities = record(trace.capabilities);
  const freshness = record(trace.freshness);
  const checked = scopes(trace.checkedScope, TRACE_SCOPES);
  const unknown = scopes(trace.unknownScope, TRACE_SCOPES);
  const unavailable = scopes(trace.unavailableScope, TRACE_SCOPES);
  if (
    !STATUS.includes(String(trace.status)) ||
    !source ||
    source.sourceId !== "trace-rpc" ||
    !["LIVE", "RECORDED_REPLAY", "MOCK"].includes(String(source.mode)) ||
    !timestamp(source.observedAt) ||
    freshness?.status !== "not_checked" ||
    !capabilities ||
    !checked ||
    !unknown ||
    !unavailable ||
    !disjoint(checked, unknown, unavailable)
  )
    return undefined;

  const reasons: Record<string, Copy> = {};
  let observedCount = 0;
  let unknownCount = 0;
  for (const [key, scope] of [
    ["callTracer", CAPABILITY_SCOPES[0]],
    ["prestateTracerDiff", CAPABILITY_SCOPES[1]],
  ] as const) {
    const capability = record(capabilities[key]);
    const state = capability?.status;
    const expected = checked.includes(scope)
      ? "observed"
      : unknown.includes(scope)
        ? "unknown"
        : unavailable.includes(scope)
          ? "unavailable"
          : undefined;
    if (state !== expected || expected === undefined) return undefined;
    if (state === "observed") observedCount += 1;
    if (state === "unknown") unknownCount += 1;
    if (state !== "observed") {
      const reason = capability?.reason;
      if (!token(reason) || !REASON_LABELS[reason]) return undefined;
      reasons[scope] = REASON_LABELS[reason];
    }
  }

  const expectedStatus =
    observedCount === 2
      ? "success"
      : observedCount > 0
        ? "partial"
        : unknownCount > 0
          ? "unknown"
          : "unavailable";
  if (trace.status !== "invalid" && trace.status !== expectedStatus)
    return undefined;

  if (trace.status !== "invalid") {
    const simulation = record(record(run.p0)?.basicSimulation);
    if (
      !binding ||
      !context ||
      binding.runId !== run.runId ||
      binding.chainId !== record(run.intent)?.chainId ||
      binding.protocol !== record(run.intent)?.protocol ||
      !block(context.blockNumber) ||
      !simulation ||
      binding.transactionFingerprint !==
        simulation.preparedTransactionFingerprint ||
      context.blockNumber !== simulation.blockNumber ||
      !checked.includes(TRACE_SCOPES[0]) ||
      !checked.includes(TRACE_SCOPES[1])
    )
      return undefined;
  } else {
    if (
      observedCount !== 0 ||
      unknownCount !== 2 ||
      checked.some((item) =>
        CAPABILITY_SCOPES.includes(item as (typeof CAPABILITY_SCOPES)[number]),
      ) ||
      (binding !== undefined &&
        (binding.runId !== run.runId ||
          binding.chainId !== record(run.intent)?.chainId ||
          binding.protocol !== record(run.intent)?.protocol))
    )
      return undefined;
  }

  if (context?.blockNumber !== undefined && !block(context.blockNumber))
    return undefined;

  return {
    sourceId: "trace-rpc",
    source: cp("Trace RPC", "追踪 RPC"),
    role: "supplementary",
    mode: source.mode as EvidenceCoverage["mode"],
    status: trace.status as EvidenceCoverage["status"],
    blockNumber:
      trace.status === "invalid"
        ? undefined
        : (context?.blockNumber as string | undefined),
    observedAt: source.observedAt as string,
    checked: listed(checked),
    notChecked: [label("freshness")],
    unknown: unknownItems(unknown, reasons),
    unavailable: unknownItems(unavailable, reasons),
  };
}

const NOTICE = cp(
  "Some source details could not be verified, so they are not shown as checked.",
  "部分来源详情无法验证，因此不会显示为已检查。",
);

/** Parse only the public #119 fields used by the UI. Never forward providerData. */
export function evidenceCoverage(raw: unknown): {
  sources: EvidenceCoverage[];
  notice?: Copy;
} {
  const run = record(raw);
  const evidence = record(run?.providerEvidence);
  if (!run || run.providerEvidence === undefined) return { sources: [] };
  if (!evidence) return { sources: [], notice: NOTICE };

  const primary = parsePrimary(run, evidence);
  if (!primary) return { sources: [], notice: NOTICE };
  const traceRaw = record(evidence.providerData)?.traceRpc;
  if (traceRaw === undefined) return { sources: [primary] };
  if (primary.sourceId !== "native-rpc-arbitrum") {
    return { sources: [primary], notice: NOTICE };
  }
  const trace = record(traceRaw);
  const supplementary = trace && parseTrace(run, trace);
  return supplementary && supplementary.mode === primary.mode
    ? { sources: [primary, supplementary] }
    : { sources: [primary], notice: NOTICE };
}
