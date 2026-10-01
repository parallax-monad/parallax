import type { Copy } from "@/lib/i18n";
import { getChainIdForProtocol, symbolToAsset } from "./api-helpers";
import { type FormState, INITIAL_FORM, validateForm } from "./form";
import type {
  ActionSuggestion,
  ApiFailure,
  ApiFailureIssue,
  CheckSwapInput,
  CheckSwapResult,
  EvidenceItem,
  QuotePreview,
  QuoteState,
  QuoteSwapInput,
  RuleResult,
  RunDiff,
  RunRecovery,
  TokenMetadata,
  Verdict,
} from "./types";

export const DEFAULT_SENDER = "0x1111111111111111111111111111111111111111";
const API_BASE = "";
const cp = (value: string) => ({ en: value, zh: value });
const obj = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const unavailable = cp("unavailable");

function metadataAssetKey(value: unknown): string {
  const asset = obj(value);
  if (asset?.kind === "native") return "native";
  return str(asset?.address)?.toLowerCase() ?? "unknown";
}

function symbol(
  value: unknown,
  chainId: number,
  metadata: Map<string, TokenMetadata>,
): string {
  const resolved = metadata.get(`${chainId}:${metadataAssetKey(value)}`);
  if (resolved) return resolved.symbol;
  const asset = obj(value);
  if (asset?.kind === "native") return "unknown";
  const address = str(asset?.address)?.toLowerCase();
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "unknown";
}

function requestAsset(
  value: string,
  chainId: number,
): { kind: "native" } | { kind: "erc20"; address: string } {
  return symbolToAsset(value, chainId);
}

/**
 * Converts atomic token amounts to human-readable decimal strings using trusted
 * Backend token metadata. Returns "unavailable" if metadata is missing or the
 * atomic value is malformed.
 */
function decimal(value: unknown, decimals: number | undefined): string {
  const atomic = str(value);
  if (!atomic || !/^\d+$/.test(atomic) || decimals === undefined)
    return "unavailable";
  if (decimals === 0) return atomic;
  const padded = atomic.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Plain-language Action reasons. OUTPUT_IMPROVEMENT_VERIFIED stays deliberately
 * narrow: the handoff states it proves only that an attested verification child
 * passed the unchanged Economic Boundary, never an optimal amount, best price or
 * route, protocol safety, or guaranteed live execution.
 */
const ACTION_REASON: Record<string, Copy> = {
  OUTPUT_IMPROVEMENT_VERIFIED: {
    en: "A verification run confirmed this amount can meet your minimum received. It is not an optimal amount, a best price, or a safety or execution guarantee.",
    zh: "验证运行确认这个数量可以满足你的最低收到量。这不是最优数量或最佳价格，也不构成安全或上链保证。",
  },
  ALTERNATIVE_PATH_VERIFIED: {
    en: "A verification run confirmed an alternative path for this condition.",
    zh: "验证运行确认了这个条件存在可行的替代路径。",
  },
  CANNOT_CREATE_MISSING_ROUTE: {
    en: "Changing this cannot create a route that does not exist.",
    zh: "改这个无法创造出不存在的路径。",
  },
  CHANGES_ACCEPTANCE_BOUNDARY_ONLY: {
    en: "This only changes what you accept, not what the transaction would do.",
    zh: "这只会改变你接受的条件，不会改变交易本身的结果。",
  },
  EFFECT_NOT_VERIFIED: {
    en: "The effect of changing this was not verified in this run.",
    zh: "本次运行没有验证修改这个条件的效果。",
  },
  RESTORES_CHECK_ONLY: {
    en: "This only retries the check itself; it does not change the transaction.",
    zh: "这只会重试检查本身，不会改变交易。",
  },
};

/**
 * Looks up decimals from the trusted Run tokenMetadata map. Missing metadata
 * must stay unavailable; the frontend never invents ETH/MON/USDC decimals.
 */
function decimalsFor(
  value: string,
  metadata: Map<string, number>,
): number | undefined {
  return metadata.get(value.toLowerCase());
}

/**
 * Converts an atomic `proposedChange` into display units. The handoff requires
 * rendering human copy from the Intent plus token registry rather than showing
 * atomic strings or reverse-engineering Diff values.
 */
function displayChange(
  value: unknown,
  field: string,
  unit: string,
  metadata: Map<string, number>,
) {
  const change = obj(value);
  const before = str(change?.before);
  const after = str(change?.after);
  if (before === undefined || after === undefined) return undefined;

  // Only amount fields are atomic; pair and protocol changes are identities.
  const isAmount = field === "amountIn" || field === "minimumReceived";
  if (!isAmount) return { before, after, unit: "" };

  return {
    before: decimal(before, decimalsFor(unit, metadata)),
    after: decimal(after, decimalsFor(unit, metadata)),
    unit,
  };
}

function suggestion(
  value: unknown,
  tokenIn: string,
  tokenOut: string,
  metadata: Map<string, number>,
): ActionSuggestion | undefined {
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
  const reasonCode = str(evaluation?.actionReasonCode);
  // Amounts are quoted in the asset the field refers to, not always tokenIn.
  const unit = field === "minimumReceived" ? tokenOut : tokenIn;
  return {
    field: field as ActionSuggestion["field"],
    category:
      action?.kind === "ACCEPTANCE_BOUNDARY_CHANGE"
        ? "ACCEPTANCE_BOUNDARY"
        : "TRANSACTION_CONDITION",
    relevance: relevance as ActionSuggestion["relevance"],
    recommendable: evaluation?.recommendable === true,
    reasonCode,
    reason:
      ACTION_REASON[reasonCode ?? ""] ??
      cp("This action carries no recognized reason code."),
    proposedChange: displayChange(
      evaluation?.proposedChange,
      field,
      unit,
      metadata,
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

/**
 * The wire Diff names the amount field `amountInAtomic` and carries atomic
 * strings. The handoff requires human copy from the Intent plus token registry,
 * so the row is relabeled `amountIn` and converted with trusted decimals.
 */
function diff(
  value: unknown,
  tokenIn: string,
  metadata: Map<string, number>,
): RunDiff | undefined {
  const rows = arr(obj(value)?.changedFields).flatMap((raw) => {
    const item = obj(raw);
    const field = str(item?.field);
    const before = str(item?.before);
    const after = str(item?.after);
    if (!field || before === undefined || after === undefined) return [];

    const isAmount = field === "amountInAtomic";
    const show = (atomic: string) =>
      isAmount
        ? `${decimal(atomic, decimalsFor(tokenIn, metadata))} ${tokenIn}`
        : atomic;

    return [
      {
        field: cp(isAmount ? "amountIn" : field),
        previous: cp(show(before)),
        next: cp(show(after)),
        direction: "changed" as const,
      },
    ];
  });
  return rows.length ? rows : undefined;
}

/** The backend sends a single issue object or a list; normalize to a list. */
function failureIssues(value: unknown): ApiFailureIssue[] | undefined {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const issues = raw.flatMap((entry) => {
    const item = obj(entry);
    if (!item) return [];
    const code = str(item.code);
    // Zod-style rejections carry `path` segments; normalized ones carry `field`.
    const field =
      str(item.field) ??
      (Array.isArray(item.path)
        ? item.path.filter((part) => typeof part === "string").join(".") ||
          undefined
        : undefined);
    const message = str(item.message);
    return code || field || message ? [{ code, field, message }] : [];
  });
  return issues.length ? issues : undefined;
}

function failureCopy(failure: ApiFailure) {
  if (failure.code === "EXECUTION_REVERT") {
    return {
      en: "The transaction reverted during gas preflight. The check was not completed, so this is not a transaction-risk verdict.",
      zh: "交易在 Gas 预检阶段发生回退，检查未完成；这不是交易风险结论。",
    };
  }
  if (failure.code === "INSUFFICIENT_NATIVE_BALANCE") {
    return {
      en: "The sender does not have enough native currency to cover the transaction amount and gas. The check was not completed, so this is not a transaction-risk verdict.",
      zh: "该地址的原生币余额不足以支付交易金额和 Gas。检查尚未完成，因此这不是交易风险结论。",
    };
  }
  const label = failure.code.replaceAll("_", " ").toLowerCase();
  const reason = failure.reason ? ` (${failure.reason})` : "";
  const detail = failure.issues
    ?.map((issue) =>
      [issue.field, issue.message ?? issue.code].filter(Boolean).join(": "),
    )
    .filter(Boolean)
    .join("; ");
  const suffix = detail ? ` ${detail}.` : "";
  return {
    en: `The check failed with ${label}${reason}.${suffix} This is a system result, not a transaction-risk verdict.`,
    zh: `检查因 ${label}${reason} 失败。${suffix}这是系统结果，不是交易风险结论。`,
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
    simulatedOutput: "unavailable",
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
  createdAtOverride?: string,
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
          issues: failureIssues(runError?.issues) ?? transportFailure?.issues,
        }
      : undefined;
  const mappedEvidence = arr(run?.evidence)
    .map((item) => evidence(item, replayMode))
    .filter((item): item is EvidenceItem => !!item);
  const scope = arr(run?.scope)
    .map(obj)
    .filter((item): item is Record<string, unknown> => !!item);
  const route = obj(run?.route);
  const runQuote = obj(run?.quote);
  const tokenMetadata = arr(run?.tokenMetadata)
    .map(obj)
    .filter((item): item is Record<string, unknown> => !!item);
  const decimalMetadata = new Map<string, number>();
  tokenMetadata.forEach((item) => {
    const metadataAsset = obj(item.asset);
    const symbolValue = str(item.symbol);
    const decimalsValue = item.decimals;
    if (typeof decimalsValue !== "number") return;
    if (symbolValue)
      decimalMetadata.set(symbolValue.toLowerCase(), decimalsValue);
    if (metadataAsset?.kind === "native") {
      decimalMetadata.set("native", decimalsValue);
    } else {
      const address = str(metadataAsset?.address)?.toLowerCase();
      if (address) decimalMetadata.set(address, decimalsValue);
    }
  });
  const metadataByAsset = new Map<string, TokenMetadata>();
  tokenMetadata.forEach((item) => {
    const metadataAsset = obj(item.asset);
    const chain = item.chainId;
    const decimalsValue = item.decimals;
    const symbolValue = str(item.symbol);
    if (
      typeof chain !== "number" ||
      typeof decimalsValue !== "number" ||
      !symbolValue
    )
      return;
    metadataByAsset.set(`${chain}:${metadataAssetKey(metadataAsset)}`, {
      chainId: chain,
      asset: metadataAsset as TokenMetadata["asset"],
      symbol: symbolValue,
      decimals: decimalsValue,
      decimalsSource: str(item.decimalsSource) ?? "unknown",
      verifiedAtBlock: str(item.verifiedAtBlock),
    });
  });
  const chainId =
    typeof intent?.chainId === "number" ? intent.chainId : undefined;
  const routePath = arr(route?.path)
    .map((item) => symbol(item, chainId ?? 0, metadataByAsset))
    .join(" → ");
  const output = arr(run?.evidence)
    .map(obj)
    .find((item) => item?.kind === "simulated_token_out");
  const tokenIn = symbol(intent?.tokenIn, chainId ?? 0, metadataByAsset);
  const tokenOut = symbol(intent?.tokenOut, chainId ?? 0, metadataByAsset);
  const boundary = obj(intent?.economicBoundary);
  const p0 = obj(run?.p0);
  const basicSimulation = obj(p0?.basicSimulation);
  const call = obj(basicSimulation?.call);
  const gasEstimate = obj(basicSimulation?.gasEstimate);
  const providerEvidence = obj(run?.providerEvidence);
  const provider = obj(providerEvidence?.provider);
  const execution = obj(providerEvidence?.execution);
  const providerProvenance = obj(providerEvidence?.provenance);
  const remediation = obj(p0?.remediation);
  const baseline = obj(p0?.expectationBaseline);
  const basicSimulationBlockNumber = str(basicSimulation?.blockNumber);
  const basicSimulationBlockHash = str(basicSimulation?.blockHash);
  const basicSimulationObservedAt = str(basicSimulation?.observedAt);
  return {
    runId,
    parentRunId: str(run?.parentRunId),
    systemStatus: systemStatus as CheckSwapResult["systemStatus"],
    verdict: verdict as Verdict,
    summary:
      apiFailure?.code === "INSUFFICIENT_NATIVE_BALANCE" ||
      apiFailure?.code === "EXECUTION_REVERT"
        ? failureCopy(apiFailure)
        : cp(
            str(run?.summary) ??
              (apiFailure ? failureCopy(apiFailure).en : "No summary provided"),
          ),
    recommendedActions: arr(run?.recommendedActions)
      .map((item) => suggestion(item, tokenIn, tokenOut, decimalMetadata))
      .filter((item): item is ActionSuggestion => !!item),
    irrelevantActions: arr(run?.irrelevantActions)
      .map((item) => suggestion(item, tokenIn, tokenOut, decimalMetadata))
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
      amountIn: decimal(
        intent?.amountInAtomic,
        decimalsFor(tokenIn, decimalMetadata),
      ),
    },
    diff: diff(run?.diff, tokenIn, decimalMetadata),
    quote: {
      // The handoff separates the QUOTE-stage observation from the simulated
      // output, so the top-level Quote wins for the "expected" figure and the
      // simulation value stays available on its own field.
      expectedOutput:
        str(runQuote?.estimatedAmountOut) ??
        (output
          ? decimal(
              output.amountReceivedAtomic,
              decimalsFor(tokenOut, decimalMetadata),
            )
          : "unavailable"),
      route: routePath ? cp(routePath) : unavailable,
      blockNumber:
        str(runQuote?.blockNumber) ??
        str(route?.blockNumber) ??
        str(run?.simulatorPinnedBlock) ??
        "unavailable",
    },
    simulatedOutput: output
      ? decimal(
          output.amountReceivedAtomic,
          decimalsFor(tokenOut, decimalMetadata),
        )
      : "unavailable",
    minimumReceivedSource: (str(boundary?.source) ??
      "unavailable") as CheckSwapResult["minimumReceivedSource"],
    createdAt:
      str(run?.createdAt) ?? createdAtOverride ?? new Date().toISOString(),
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
    chainId,
    protocol: str(intent?.protocol),
    tokenMetadata: tokenMetadata.length
      ? (tokenMetadata as unknown as TokenMetadata[])
      : undefined,
    evidenceState: str(p0?.evidenceState),
    basicSimulation:
      call || gasEstimate
        ? {
            call: {
              status: str(call?.status) ?? "UNKNOWN",
              blockNumber: str(call?.blockNumber),
              blockHash: str(call?.blockHash),
              returnDataFingerprint: str(call?.returnDataFingerprint),
            },
            gasEstimate: {
              status: str(gasEstimate?.status) ?? "UNKNOWN",
              value: str(gasEstimate?.value),
              gasUnits: str(gasEstimate?.gasUnits),
            },
            blockNumber: basicSimulationBlockNumber,
            blockHash: basicSimulationBlockHash,
            observedAt: basicSimulationObservedAt,
          }
        : undefined,
    providerEvidence: provider
      ? {
          status: str(provider?.status) ?? "UNKNOWN",
          source: str(provider?.providerId),
          observedAt: str(providerProvenance?.fetchedAt),
          blockNumber: str(providerProvenance?.blockNumber),
        }
      : undefined,
    executionEvidence: execution
      ? {
          status: str(execution?.status) ?? "UNKNOWN",
        }
      : undefined,
    remediationStatus: str(remediation?.status),
    expectationBaseline: baseline
      ? {
          quoteId: str(baseline?.quoteId),
          amountOutAtomic: str(baseline?.amountOutAtomic),
          source: str(baseline?.source),
          blockNumber: str(baseline?.blockNumber),
          observedAt: str(baseline?.observedAt),
          provenance: str(baseline?.provenance),
        }
      : undefined,
  };
}

function body(input: CheckSwapInput) {
  const baseline = input.expectationBaseline;
  const chainId = getChainIdForProtocol(input.protocol);
  return {
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    chainId,
    protocol: input.protocol,
    sender: input.sender ?? DEFAULT_SENDER,
    tokenIn: requestAsset(input.tokenIn, chainId),
    tokenOut: requestAsset(input.tokenOut, chainId),
    amountIn: input.amountIn,
    economicBoundary: input.minimumReceived
      ? {
          availability: "available",
          minimumReceived: input.minimumReceived,
          source: "user_declared",
        }
      : { availability: "unavailable", source: "unavailable" },
    ...(baseline ? { expectationBaseline: baseline } : {}),
  };
}

export type CheckOptions = { fetch?: typeof fetch; signal?: AbortSignal };

export function expectationBaseline(
  input: QuoteSwapInput,
  quote: QuotePreview,
): NonNullable<CheckSwapInput["expectationBaseline"]> {
  const chainId = getChainIdForProtocol(input.protocol);
  return {
    chainId,
    protocol: input.protocol,
    tokenIn: requestAsset(input.tokenIn, chainId),
    tokenOut: requestAsset(input.tokenOut, chainId),
    amountIn: input.amountIn,
    quote,
  };
}

/** `/api/quote` is a strict exact-input body: no boundary, no parent, no slippage. */
function quoteBody(input: QuoteSwapInput) {
  const chainId = getChainIdForProtocol(input.protocol);
  return {
    chainId,
    protocol: input.protocol,
    sender: input.sender ?? DEFAULT_SENDER,
    tokenIn: requestAsset(input.tokenIn, chainId),
    tokenOut: requestAsset(input.tokenOut, chainId),
    amountIn: input.amountIn,
  };
}

function quotePreview(value: unknown): QuotePreview | undefined {
  const quote = obj(value);
  const source = str(quote?.source);
  const estimatedAmountOut = str(quote?.estimatedAmountOut);
  const blockNumber = str(quote?.blockNumber);
  const runtimeVersion = str(quote?.runtimeVersion);
  const runtimeRevision = str(quote?.runtimeRevision);
  // An available Quote is only publishable with its stage block and runtime
  // identity, so a partial payload is treated as an invalid response instead.
  if (
    source !== "quote" ||
    !estimatedAmountOut ||
    !blockNumber ||
    !runtimeVersion ||
    !runtimeRevision
  )
    return;
  return {
    source: "quote",
    estimatedAmountOut,
    minimumAmountOut: str(quote?.minimumAmountOut),
    blockNumber,
    fetchedAt: str(quote?.fetchedAt),
    runtimeVersion,
    runtimeRevision,
  };
}

/**
 * Reads the pre-submit Quote. A backend `unavailable` state is a real product
 * state, not an error, and never blocks submitting the full Check.
 */
export async function fetchQuote(
  input: QuoteSwapInput,
  options: CheckOptions = {},
): Promise<QuoteState> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${API_BASE}/api/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(quoteBody(input)),
      signal: options.signal,
    });
  } catch (error) {
    const aborted =
      error instanceof DOMException && error.name === "AbortError";
    return {
      status: "error",
      apiFailure: {
        code: aborted ? "REQUEST_ABORTED" : "NETWORK_ERROR",
        retryable: !aborted,
        message: error instanceof Error ? error.message : undefined,
      },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      status: "error",
      apiFailure: {
        httpStatus: response.status,
        code: "INVALID_JSON_RESPONSE",
        retryable: response.status >= 500,
      },
    };
  }

  if (!response.ok) {
    const error = obj(obj(payload)?.error);
    const code = str(error?.code) ?? `HTTP_${response.status}`;
    return {
      status: "error",
      apiFailure: {
        httpStatus: response.status,
        code,
        reason: str(error?.reason),
        retryable: response.status >= 500 && code !== "UNSUPPORTED",
        message: str(error?.message),
        issues: failureIssues(error?.issues),
      },
    };
  }

  const result = obj(payload);
  if (result?.status === "unavailable") {
    const reason = str(result.reason);
    return {
      status: "unavailable",
      reason: reason === "NO_ROUTE" ? "NO_ROUTE" : "QUOTE_UNAVAILABLE",
    };
  }

  const preview =
    result?.status === "available" ? quotePreview(result.quote) : undefined;
  if (!preview)
    return {
      status: "error",
      apiFailure: {
        httpStatus: response.status,
        code: "INVALID_RESPONSE",
        retryable: false,
      },
    };

  return {
    status: "available",
    quote: preview,
    requestIdentity: {
      protocol: input.protocol,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: input.amountIn,
    },
  };
}

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
    issues: failureIssues(error?.issues),
  };
  return (
    mapRun(envelope?.run, apiFailure, payload) ??
    failed(input, apiFailure, payload)
  );
}

/** Loads a recorded Run without modification. */
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
    if (response.ok) {
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
    }
    const error = obj(obj(payload)?.error);
    return failed(
      input,
      {
        httpStatus: response.status,
        code: str(error?.code) ?? `HTTP_${response.status}`,
        retryable: response.status >= 500,
        message: str(error?.message),
        issues: failureIssues(error?.issues),
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

/** Loads one persisted Check Run for page-refresh receipt recovery. */
export async function loadRun(
  runId: string,
  options: CheckOptions = {},
): Promise<RunRecovery> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(
      `${API_BASE}/api/runs/${encodeURIComponent(runId)}`,
      { signal: options.signal },
    );
  } catch (error) {
    const aborted =
      error instanceof DOMException && error.name === "AbortError";
    return {
      kind: "error",
      failure: {
        code: aborted ? "REQUEST_ABORTED" : "NETWORK_ERROR",
        retryable: !aborted,
        message: error instanceof Error ? error.message : undefined,
      },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      kind: "error",
      failure: {
        httpStatus: response.status,
        code: "INVALID_JSON_RESPONSE",
        retryable: response.status >= 500,
      },
    };
  }

  if (!response.ok) {
    const error = obj(obj(payload)?.error);
    return {
      kind: "error",
      failure: {
        httpStatus: response.status,
        code: str(error?.code) ?? `HTTP_${response.status}`,
        retryable: response.status >= 500,
        message: str(error?.message),
        issues: failureIssues(error?.issues),
      },
    };
  }

  const record = obj(payload);
  const status = str(record?.status);
  const storedRunId = str(record?.runId);
  if (status === "started" && storedRunId !== undefined) {
    return { kind: "started", runId: storedRunId };
  }

  // A persisted failure describes the RunStore lifecycle, which is deliberately
  // coarse. Keep the specific native-balance error during recovery instead of
  // replacing it with the lifecycle code (for example, AGENT_FLOW_ERROR).
  const storedResult = obj(record?.result);
  const storedErrorCode = str(obj(storedResult?.error)?.code);
  const persistedFailure =
    status === "failed" &&
    storedErrorCode !== "INSUFFICIENT_NATIVE_BALANCE" &&
    storedErrorCode !== "EXECUTION_REVERT"
      ? str(record?.failure)
      : undefined;
  const result = mapRun(
    record?.result,
    persistedFailure === undefined
      ? undefined
      : { code: persistedFailure, retryable: false },
    payload,
    str(record?.createdAt),
  );
  if (result !== undefined && (status === "completed" || status === "failed")) {
    return { kind: "terminal", result };
  }

  return {
    kind: "error",
    failure: {
      httpStatus: response.status,
      code: "INVALID_RESPONSE",
      retryable: false,
    },
  };
}

/** Reconstructs the editable fields needed to continue a persisted Run. */
export function formFromRunResult(result: CheckSwapResult): FormState {
  const envelope = obj(result.rawResponse);
  const rawRun =
    obj(envelope?.result) ?? obj(envelope?.run) ?? envelope ?? undefined;
  const rawIntent = obj(rawRun?.intent);
  const rawBoundary = obj(rawIntent?.economicBoundary);
  const protocol = str(rawIntent?.protocol);
  const decimalMetadata = new Map<string, number>();
  result.tokenMetadata?.forEach((item) => {
    decimalMetadata.set(item.symbol.toLowerCase(), item.decimals);
    if (item.asset.kind === "erc20") {
      decimalMetadata.set(item.asset.address.toLowerCase(), item.decimals);
    }
  });

  return {
    ...INITIAL_FORM,
    protocol:
      protocol === "kuru" || protocol === "pancake" || protocol === "camelot-v3"
        ? protocol
        : INITIAL_FORM.protocol,
    tokenIn: result.intent.tokenIn,
    tokenOut: result.intent.tokenOut,
    amountIn: result.intent.amountIn,
    minimumReceived:
      rawBoundary?.availability === "available"
        ? decimal(
            rawBoundary.minimumReceivedAtomic,
            decimalsFor(result.intent.tokenOut, decimalMetadata),
          )
        : "",
  };
}
