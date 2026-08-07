import { validateForm } from "./form";
import type {
  ActionSuggestion,
  ApiFailure,
  CheckSwapInput,
  CheckSwapResult,
  EvidenceItem,
  RuleResult,
  RunDiff,
  Verdict,
} from "./types";

export const DEFAULT_SENDER = "0x1111111111111111111111111111111111111111";
export const MONAD_USDC_ADDRESS = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const API_BASE = "";
const cp = (value: string) => ({ en: value, zh: value });
const obj = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const unavailable = cp("unavailable");

function symbol(value: unknown): string {
  const asset = obj(value);
  if (asset?.kind === "native") return "MON";
  const address = str(asset?.address)?.toLowerCase();
  if (address === MONAD_USDC_ADDRESS.toLowerCase()) return "USDC";
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "unknown";
}

function asset(value: string) {
  if (value === "MON") return { kind: "native" };
  if (value === "USDC") return { kind: "erc20", address: MONAD_USDC_ADDRESS };
  throw new Error(`Unsupported token: ${value}`);
}

function decimal(value: unknown, decimals: number): string {
  const atomic = str(value);
  if (!atomic || !/^\d+$/.test(atomic)) return "unavailable";
  const padded = atomic.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}

function suggestion(value: unknown): ActionSuggestion | undefined {
  const evaluation = obj(value);
  const action = obj(evaluation?.action);
  const field = str(action?.field);
  const relevance = str(evaluation?.relevance);
  if (
    !field ||
    !relevance ||
    !["amountIn", "tokenPair", "protocol", "minimumReceived"].includes(field)
  )
    return;
  return {
    field: field as ActionSuggestion["field"],
    category:
      action?.kind === "ACCEPTANCE_BOUNDARY_CHANGE"
        ? "ACCEPTANCE_BOUNDARY"
        : "TRANSACTION_CONDITION",
    relevance: relevance as ActionSuggestion["relevance"],
    reason: cp(
      (str(evaluation?.actionReasonCode) ?? "unknown")
        .replaceAll("_", " ")
        .toLowerCase(),
    ),
  };
}

function rule(value: unknown): RuleResult | undefined {
  const item = obj(value);
  const id = str(item?.ruleId);
  const status = str(item?.status);
  if (!id || !status) return;
  return {
    id,
    group: id.includes("ECONOMIC")
      ? "economicBoundary"
      : id.includes("EVIDENCE")
        ? "evidenceCompleteness"
        : "execution",
    label: cp(id),
    outcome:
      status === "NOT_APPLICABLE"
        ? "SKIPPED"
        : (status as RuleResult["outcome"]),
    detail: cp(
      str(item?.reasonCode) ??
        str(item?.applicabilityReasonCode) ??
        "No reason provided",
    ),
  };
}

function evidence(value: unknown, replay: boolean): EvidenceItem | undefined {
  const item = obj(value);
  const id = str(item?.key);
  if (!id) return;
  const rawStage = str(item?.stage)?.toLowerCase();
  const stage =
    rawStage &&
    ["discover", "load", "quote", "action", "simulate"].includes(rawStage)
      ? (rawStage as EvidenceItem["stage"])
      : "unknown";
  const source = str(item?.source);
  const isMock = item?.isMock === true;
  return {
    id,
    stage,
    label: cp(str(item?.summary) ?? id),
    value: JSON.stringify(item, null, 2),
    origin: replay
      ? "replay"
      : isMock
        ? "mock"
        : source === "derived"
          ? "derived"
          : "live",
    blockNumber: str(item?.blockNumber) ?? str(item?.simulatorPinnedBlock),
    runtimeVersion: str(item?.runtimeVersion),
    runtimeRevision: str(item?.runtimeRevision),
    fixtureId: str(item?.fixtureId),
    reproducibility: str(item?.reproducibility),
    isMock,
  };
}

function diff(value: unknown): RunDiff | undefined {
  const rows = arr(obj(value)?.changedFields).flatMap((raw) => {
    const item = obj(raw);
    const field = str(item?.field);
    const before = str(item?.before);
    const after = str(item?.after);
    return field && before !== undefined && after !== undefined
      ? [
          {
            field: cp(field),
            previous: cp(before),
            next: cp(after),
            direction: "changed" as const,
          },
        ]
      : [];
  });
  return rows.length ? rows : undefined;
}

function failureCopy(failure: ApiFailure) {
  const label = failure.code.replaceAll("_", " ").toLowerCase();
  const reason = failure.reason ? ` (${failure.reason})` : "";
  return {
    en: `The check failed with ${label}${reason}. This is a system result, not a transaction-risk verdict.`,
    zh: `检查因 ${label}${reason} 失败。这是系统结果，不是交易风险结论。`,
  };
}

function failed(
  input: CheckSwapInput,
  apiFailure: ApiFailure,
  rawResponse: unknown,
): CheckSwapResult {
  return {
    runId: `request-${Date.now()}`,
    parentRunId: input.parentRunId,
    systemStatus: "INTEGRATION_ERROR",
    verdict: "UNKNOWN",
    summary: failureCopy(apiFailure),
    recommendedActions: [],
    irrelevantActions: [],
    checked: [],
    notChecked: [],
    evidence: [],
    ruleResults: [],
    unknowns: [
      {
        id: "request",
        label: cp("Check interrupted"),
        reason: failureCopy(apiFailure),
      },
    ],
    intent: {
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: input.amountIn,
    },
    quote: {
      expectedOutput: "unavailable",
      route: unavailable,
      blockNumber: "unavailable",
    },
    minimumReceivedSource: input.minimumReceived
      ? "user_declared"
      : "unavailable",
    createdAt: new Date().toISOString(),
    ruleVersion: "unavailable",
    mossVersion: "unavailable",
    productRunMode: "LIVE",
    replayMode: false,
    apiFailure,
    rawResponse,
  };
}

function mapRun(
  raw: unknown,
  transportFailure?: ApiFailure,
  rawResponse: unknown = raw,
): CheckSwapResult | undefined {
  const run = obj(raw);
  const intent = obj(run?.intent);
  const runId = str(run?.runId);
  const systemStatus = str(run?.systemStatus);
  const verdict = str(run?.verdict) as Verdict | undefined;
  if (!runId || !intent || !systemStatus || !verdict) return;
  const replayMode = run?.replayMode === true;
  const runError = obj(run?.error);
  const apiFailure: ApiFailure | undefined =
    systemStatus === "INTEGRATION_ERROR"
      ? {
          httpStatus: transportFailure?.httpStatus,
          code:
            transportFailure?.code ??
            str(runError?.code) ??
            "INTEGRATION_ERROR",
          reason: transportFailure?.reason,
          stage: str(runError?.stage),
          retryable:
            typeof runError?.retryable === "boolean"
              ? runError.retryable
              : (transportFailure?.retryable ?? false),
          message: str(runError?.message) ?? transportFailure?.message,
        }
      : undefined;
  const mappedEvidence = arr(run?.evidence)
    .map((item) => evidence(item, replayMode))
    .filter((item): item is EvidenceItem => !!item);
  const scope = arr(run?.scope)
    .map(obj)
    .filter((item): item is Record<string, unknown> => !!item);
  const route = obj(run?.route);
  const routePath = arr(route?.path).map(symbol).join(" → ");
  const output = arr(run?.evidence)
    .map(obj)
    .find((item) => item?.kind === "simulated_token_out");
  const tokenIn = symbol(intent?.tokenIn);
  const tokenOut = symbol(intent?.tokenOut);
  const boundary = obj(intent?.economicBoundary);
  const effectiveVerdict: Verdict =
    !replayMode && !str(run?.simulatorPinnedBlock) && verdict !== "UNKNOWN"
      ? "UNKNOWN"
      : verdict;
  const provenanceFailedClosed = effectiveVerdict !== verdict;
  return {
    runId,
    parentRunId: str(run?.parentRunId),
    systemStatus: systemStatus as CheckSwapResult["systemStatus"],
    verdict: effectiveVerdict,
    summary: provenanceFailedClosed
      ? {
          en: "Live provenance is incomplete because simulatorPinnedBlock is missing. The UI has failed closed to UNKNOWN.",
          zh: "实时来源信息不完整：缺少 simulatorPinnedBlock。UI 已保守降级为 UNKNOWN。",
        }
      : cp(
          str(run?.summary) ??
            (apiFailure ? failureCopy(apiFailure).en : "No summary provided"),
        ),
    recommendedActions: arr(run?.recommendedActions)
      .map(suggestion)
      .filter((item): item is ActionSuggestion => !!item),
    irrelevantActions: arr(run?.irrelevantActions)
      .map(suggestion)
      .filter((item): item is ActionSuggestion => !!item),
    checked: scope
      .filter((item) => item.status === "checked")
      .map((item) => cp(str(item.label) ?? str(item.key) ?? "Checked")),
    notChecked: scope
      .filter((item) => item.status === "not_checked")
      .map((item) => cp(str(item.label) ?? str(item.key) ?? "Not checked")),
    unknowns: scope
      .filter((item) => item.status === "unknown")
      .map((item, index) => ({
        id: str(item.key) ?? `unknown-${index}`,
        label: cp(str(item.label) ?? "Unknown"),
        reason: cp(str(item.reason) ?? "No reason provided"),
      })),
    evidence: mappedEvidence,
    ruleResults: arr(run?.ruleResults)
      .map(rule)
      .filter((item): item is RuleResult => !!item),
    intent: {
      tokenIn,
      tokenOut,
      amountIn: decimal(intent?.amountInAtomic, tokenIn === "USDC" ? 6 : 18),
    },
    diff: diff(run?.diff),
    quote: {
      expectedOutput: output
        ? decimal(output.amountReceivedAtomic, tokenOut === "USDC" ? 6 : 18)
        : "unavailable",
      route: routePath ? cp(routePath) : unavailable,
      blockNumber:
        str(route?.blockNumber) ??
        str(run?.simulatorPinnedBlock) ??
        "unavailable",
    },
    minimumReceivedSource: (str(boundary?.source) ??
      "unavailable") as CheckSwapResult["minimumReceivedSource"],
    createdAt: new Date().toISOString(),
    ruleVersion:
      arr(run?.ruleResults)
        .map(obj)
        .map((item) => str(item?.ruleId))
        .filter(Boolean)
        .join(", ") || "unavailable",
    mossVersion:
      mappedEvidence.find((item) => item.runtimeVersion)?.runtimeVersion ??
      "unavailable",
    productRunMode: replayMode ? "RECORDED_REPLAY" : "LIVE",
    replayMode,
    simulatorPinnedBlock: str(run?.simulatorPinnedBlock),
    apiFailure,
    rawResponse,
  };
}

function body(input: CheckSwapInput) {
  return {
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    chainId: 143,
    protocol: input.protocol,
    sender: input.sender ?? DEFAULT_SENDER,
    tokenIn: asset(input.tokenIn),
    tokenOut: asset(input.tokenOut),
    amountIn: input.amountIn,
    economicBoundary: input.minimumReceived
      ? {
          availability: "available",
          minimumReceived: input.minimumReceived,
          source: "user_declared",
        }
      : { availability: "unavailable", source: "unavailable" },
  };
}

export type CheckOptions = { fetch?: typeof fetch; signal?: AbortSignal };

export async function checkSwap(
  input: CheckSwapInput,
  options: CheckOptions = {},
): Promise<CheckSwapResult> {
  const validation = validateForm({
    protocol: input.protocol,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn: input.amountIn,
    slippage: input.slippage ?? "0.5",
    minimumReceived: input.minimumReceived ?? "",
  });
  if (!validation.valid)
    return failed(
      input,
      { code: "INVALID_REQUEST", retryable: false },
      { errors: validation.errors },
    );
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${API_BASE}/api/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body(input)),
      signal: options.signal,
    });
  } catch (error) {
    const aborted =
      error instanceof DOMException && error.name === "AbortError";
    return failed(
      input,
      {
        code: aborted ? "REQUEST_ABORTED" : "NETWORK_ERROR",
        retryable: !aborted,
        message: error instanceof Error ? error.message : undefined,
      },
      null,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return failed(
      input,
      {
        httpStatus: response.status,
        code: "INVALID_JSON_RESPONSE",
        retryable: response.status >= 500,
      },
      null,
    );
  }
  if (response.ok)
    return (
      mapRun(payload) ??
      failed(
        input,
        {
          httpStatus: response.status,
          code: "INVALID_RESPONSE",
          retryable: false,
        },
        payload,
      )
    );
  const envelope = obj(payload);
  const error = obj(envelope?.error);
  const apiFailure = {
    httpStatus: response.status,
    code: str(error?.code) ?? `HTTP_${response.status}`,
    reason: str(error?.reason),
    retryable: response.status >= 500,
    message: str(error?.message),
  };
  return (
    mapRun(envelope?.run, apiFailure, payload) ??
    failed(input, apiFailure, payload)
  );
}

export async function loadReplay(
  fixtureId: "mon-to-usdc" | "usdc-to-mon",
  options: CheckOptions = {},
): Promise<CheckSwapResult> {
  const input: CheckSwapInput = {
    protocol: "kuru",
    tokenIn: fixtureId === "mon-to-usdc" ? "MON" : "USDC",
    tokenOut: fixtureId === "mon-to-usdc" ? "USDC" : "MON",
    amountIn: "unavailable",
  };
  try {
    const response = await (options.fetch ?? fetch)(
      `${API_BASE}/api/replay/${fixtureId}`,
      { signal: options.signal },
    );
    const payload: unknown = await response.json();
    if (response.ok)
      return (
        mapRun(payload) ??
        failed(
          input,
          {
            httpStatus: response.status,
            code: "INVALID_RESPONSE",
            retryable: false,
          },
          payload,
        )
      );
    const error = obj(obj(payload)?.error);
    return failed(
      input,
      {
        httpStatus: response.status,
        code: str(error?.code) ?? `HTTP_${response.status}`,
        retryable: response.status >= 500,
        message: str(error?.message),
      },
      payload,
    );
  } catch (error) {
    return failed(
      input,
      {
        code: "NETWORK_ERROR",
        retryable: true,
        message: error instanceof Error ? error.message : undefined,
      },
      null,
    );
  }
}
