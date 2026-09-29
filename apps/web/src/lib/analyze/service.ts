import type { Copy } from "@/lib/i18n";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  getChainIdForProtocol,
} from "./api-helpers";
import { evidenceCoverage } from "./evidence-coverage";
import { type FormState, INITIAL_FORM, validateForm } from "./form";
import { fetchP0Metadata, matchesToken, type P0Metadata } from "./p0-metadata";
import type {
  AccountAllowance,
  AccountBlockBinding,
  AccountStateState,
  AccountStateView,
  AccountTokenBalance,
  ActionSuggestion,
  AllowanceSpender,
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
  Verdict,
} from "./types";

export const DEFAULT_SENDER = "0x1111111111111111111111111111111111111111";
export const ARBITRUM_DEMO_SENDER =
  "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396";
export const MONAD_USDC_ADDRESS = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
export const ARBITRUM_SEPOLIA_USDC_ADDRESS =
  "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
/** Canonical WETH on Arbitrum Sepolia, the reverse leg of the qualified pair. */
export const ARBITRUM_SEPOLIA_WETH_ADDRESS =
  "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const API_BASE = "";
const cp = (value: string) => ({ en: value, zh: value });
const obj = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const unavailable = cp("unavailable");

function symbol(value: unknown, chainId = 143, metadata?: P0Metadata): string {
  const asset = obj(value);
  // The Backend registry metadata is the single primary naming source for the
  // qualified P0 pair; nothing else may claim a P0 symbol for those assets.
  if (chainId === 421614 && metadata) {
    if (matchesToken(value, metadata.tokenIn)) return metadata.tokenIn.symbol;
    if (matchesToken(value, metadata.tokenOut)) return metadata.tokenOut.symbol;
  }
  if (asset?.kind === "native") {
    return chainId === ARBITRUM_SEPOLIA_CHAIN_ID ? "ETH" : "MON";
  }
  const address = str(asset?.address)?.toLowerCase();
  if (address === MONAD_USDC_ADDRESS.toLowerCase()) return "USDC";
  // The reverse leg's WETH is outside the canonical P0 pair, so it is named from
  // its canonical Arbitrum Sepolia address rather than invented.
  if (address === ARBITRUM_SEPOLIA_USDC_ADDRESS.toLowerCase()) return "USDC";
  if (address === ARBITRUM_SEPOLIA_WETH_ADDRESS.toLowerCase()) return "WETH";
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "unknown";
}

function asset(value: string, chainId: number, metadata?: P0Metadata) {
  if (chainId === 421614) {
    // Trusted metadata stays primary for the canonical pair.
    if (metadata && value === metadata.tokenIn.symbol)
      return metadata.tokenIn.asset;
    if (metadata && value === metadata.tokenOut.symbol)
      return metadata.tokenOut.asset;
    // The reverse flow must still be able to build its own request when metadata
    // does not cover the symbol; every other symbol fails closed.
    if (value === "MON" || value === "ETH") return { kind: "native" };
    if (value === "USDC")
      return { kind: "erc20", address: ARBITRUM_SEPOLIA_USDC_ADDRESS };
    if (value === "WETH")
      return { kind: "erc20", address: ARBITRUM_SEPOLIA_WETH_ADDRESS };
    throw new Error("Trusted P0 token metadata is unavailable");
  }
  if (value === "MON" || value === "ETH") return { kind: "native" };
  if (value === "USDC") return { kind: "erc20", address: MONAD_USDC_ADDRESS };
  if (value === "WETH") {
    // WETH exists only on the Arbitrum Sepolia leg; mapping it on Monad would
    // silently point the intent at a foreign chain's token.
    throw new Error(`Unsupported token: WETH on chain ${chainId}`);
  }
  throw new Error(`Unsupported token: ${value}`);
}

function decimal(value: unknown, decimals: number | undefined): string {
  const atomic = str(value);
  // An atomic integer without a trusted scale is never guessed: applying the
  // Monad registry's 6-decimal USDC to Arbitrum Sepolia's 18-decimal test token
  // would be wrong by 10^12.
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
 * Historical Monad display only. Arbitrum always uses Backend registry metadata.
 * The 6-decimal USDC entry below must never be applied on Arbitrum Sepolia,
 * whose test USDC publishes 18 decimals.
 */
const MONAD_DECIMALS: Record<string, number> = { MON: 18, USDC: 6 };

/**
 * The single ordered trusted-decimals resolution:
 *   1. Backend registry `metadata`, when it covers the symbol;
 *   2. the trusted decimals read from `/api/account-state`, which covers the
 *      reverse USDC -> WETH pair the canonical metadata does not carry;
 *   3. the Monad-only historical fallback (never applied on chain 421614).
 */
function decimalsFor(
  symbol: string,
  chainId: number,
  metadata?: P0Metadata,
  accountDecimals?: Record<string, number>,
): number | undefined {
  if (chainId === 421614) {
    if (metadata?.tokenIn.symbol === symbol) return metadata.tokenIn.decimals;
    if (metadata?.tokenOut.symbol === symbol) return metadata.tokenOut.decimals;
    return accountDecimals?.[symbol];
  }
  return accountDecimals?.[symbol] ?? MONAD_DECIMALS[symbol];
}

/**
 * Converts an atomic integer for display using trusted decimals. With no
 * trusted value the atomic integer is returned verbatim with an explicit marker
 * so no screen implies a scale the Backend did not publish.
 */
export function atomicToDisplay(
  amountAtomic: string,
  decimals: number | undefined,
): string {
  if (decimals === undefined) return `${amountAtomic} (atomic)`;
  return decimal(amountAtomic, decimals);
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
  chainId: number,
  metadata?: P0Metadata,
  accountDecimals?: Record<string, number>,
) {
  const change = obj(value);
  const before = str(change?.before);
  const after = str(change?.after);
  if (before === undefined || after === undefined) return undefined;

  // Only amount fields are atomic; pair and protocol changes are identities.
  const isAmount = field === "amountIn" || field === "minimumReceived";
  if (!isAmount) return { before, after, unit: "" };

  return {
    before: decimal(
      before,
      decimalsFor(unit, chainId, metadata, accountDecimals),
    ),
    after: decimal(
      after,
      decimalsFor(unit, chainId, metadata, accountDecimals),
    ),
    unit,
  };
}

function suggestion(
  value: unknown,
  tokenIn: string,
  tokenOut: string,
  chainId: number,
  metadata?: P0Metadata,
  accountDecimals?: Record<string, number>,
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
      chainId,
      metadata,
      accountDecimals,
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
    // The drawer must never serialize an Evidence or Provider object.
    label: cp("Backend evidence record"),
    value: "Recorded at this stage",
    origin: replay
      ? "replay"
      : isMock
        ? "mock"
        : source === "derived"
          ? "derived"
          : "live",
    blockNumber: [item?.blockNumber, item?.simulatorPinnedBlock].find(
      (value): value is string =>
        typeof value === "string" && /^(0|[1-9]\d*)$/.test(value),
    ),
    runtimeVersion: safeToken(item?.runtimeVersion),
    runtimeRevision: safeToken(item?.runtimeRevision),
    fixtureId: str(item?.fixtureId),
    reproducibility: str(item?.reproducibility),
    isMock,
  };
}

const safeToken = (value: unknown): string | undefined => {
  const text = str(value);
  return text && /^[a-zA-Z0-9][a-zA-Z0-9._@+-]{0,79}$/.test(text)
    ? text
    : undefined;
};

/**
 * The wire Diff names the amount field `amountInAtomic` and carries atomic
 * strings. The handoff requires human copy from the Intent plus token registry,
 * so the row is relabeled `amountIn` and converted with trusted decimals.
 */
function diff(
  value: unknown,
  tokenIn: string,
  chainId: number,
  metadata?: P0Metadata,
  accountDecimals?: Record<string, number>,
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
        ? `${decimal(
            atomic,
            decimalsFor(tokenIn, chainId, metadata, accountDecimals),
          )} ${tokenIn}`
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
  _rawResponse: unknown,
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
  };
}

function basicSimulation(value: unknown): CheckSwapResult["basicSimulation"] {
  const simulation = obj(value);
  const call = str(obj(simulation?.call)?.status);
  const gasEstimate = str(obj(simulation?.gasEstimate)?.status);
  const blockNumber = str(simulation?.blockNumber);
  const observedAt = str(simulation?.observedAt);
  const fingerprint = str(simulation?.preparedTransactionFingerprint);
  const validity = str(simulation?.validityAtExecution);
  if (
    !simulation ||
    !["SUCCEEDED", "REVERTED", "UNAVAILABLE", "NOT_RUN"].includes(call ?? "") ||
    !["AVAILABLE", "UNAVAILABLE", "NOT_RUN"].includes(gasEstimate ?? "") ||
    !blockNumber ||
    !observedAt ||
    !fingerprint ||
    !["VALID", "INVALID", "UNKNOWN"].includes(validity ?? "")
  )
    return undefined;
  return {
    call: call as NonNullable<CheckSwapResult["basicSimulation"]>["call"],
    gasEstimate: gasEstimate as NonNullable<
      CheckSwapResult["basicSimulation"]
    >["gasEstimate"],
    gasUnits: str(obj(simulation.gasEstimate)?.gasUnits),
    blockNumber,
    observedAt,
    validityAtExecution: validity as NonNullable<
      CheckSwapResult["basicSimulation"]
    >["validityAtExecution"],
    preparedTransactionFingerprint: fingerprint,
    transactionBound: obj(simulation.transactionBinding) !== undefined,
    sender: str(obj(simulation.transactionBinding)?.sender),
    router: str(obj(simulation.transactionBinding)?.router),
    failureStage: str(simulation.failureStage),
    reason: str(simulation.reason),
  };
}

function mapRun(
  raw: unknown,
  transportFailure?: ApiFailure,
  _rawResponse: unknown = raw,
  createdAtOverride?: string,
  metadata?: P0Metadata,
  accountDecimals?: Record<string, number>,
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
  const p0 = obj(run?.p0);
  const providerEvidence = obj(run?.providerEvidence);
  // The public Check/Run wire shape is the provider-neutral Evidence contract
  // (`providerEvidence.provider.status` / `providerEvidence.execution.status`,
  // see packages/contracts/src/generic-evidence.ts). Read those direct fields
  // only; never infer either status from another execution fact, and never
  // treat a flattened `providerStatus`/`executionStatus` as the wire shape.
  const providerStatus = str(obj(providerEvidence?.provider)?.status);
  const executionStatus = str(obj(providerEvidence?.execution)?.status);
  const chainId = typeof intent?.chainId === "number" ? intent.chainId : 143;
  const routePath = arr(route?.path)
    .map((item) => symbol(item, chainId, metadata))
    .join(" → ");
  const output = arr(run?.evidence)
    .map(obj)
    .find((item) => item?.kind === "simulated_token_out");
  const tokenIn = symbol(intent?.tokenIn, chainId, metadata);
  const tokenOut = symbol(intent?.tokenOut, chainId, metadata);
  const boundary = obj(intent?.economicBoundary);
  const coverage = evidenceCoverage(run);
  const protocol = str(intent.protocol);
  const recoveryInput =
    protocol === "kuru" || protocol === "pancake" || protocol === "camelot-v3"
      ? {
          protocol: protocol as CheckSwapInput["protocol"],
          minimumReceived:
            boundary?.availability === "available"
              ? decimal(
                  boundary.minimumReceivedAtomic,
                  decimalsFor(tokenOut, chainId, metadata, accountDecimals),
                )
              : "",
        }
      : undefined;
  return {
    runId,
    parentRunId: str(run?.parentRunId),
    chainId,
    protocol: recoveryInput?.protocol,
    systemStatus: systemStatus as CheckSwapResult["systemStatus"],
    verdict: verdict as Verdict,
    summary:
      apiFailure?.code === "INSUFFICIENT_NATIVE_BALANCE"
        ? failureCopy(apiFailure)
        : cp(
            str(run?.summary) ??
              (apiFailure ? failureCopy(apiFailure).en : "No summary provided"),
          ),
    recommendedActions: arr(run?.recommendedActions)
      .map((item) =>
        suggestion(item, tokenIn, tokenOut, chainId, metadata, accountDecimals),
      )
      .filter((item): item is ActionSuggestion => !!item),
    irrelevantActions: arr(run?.irrelevantActions)
      .map((item) =>
        suggestion(item, tokenIn, tokenOut, chainId, metadata, accountDecimals),
      )
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
    ...(coverage.sources.length > 0
      ? { evidenceCoverage: coverage.sources }
      : {}),
    ...(coverage.notice ? { evidenceCoverageNotice: coverage.notice } : {}),
    evidence: mappedEvidence,
    providerStatus: [
      "SUCCESS",
      "UNKNOWN",
      "UNSUPPORTED",
      "FAILED",
      "STALE",
    ].includes(providerStatus ?? "")
      ? (providerStatus as CheckSwapResult["providerStatus"])
      : undefined,
    executionStatus: ["SUCCESS", "NO_ROUTE", "REVERTED", "UNKNOWN"].includes(
      executionStatus ?? "",
    )
      ? (executionStatus as CheckSwapResult["executionStatus"])
      : undefined,
    basicSimulation: basicSimulation(p0?.basicSimulation),
    evidenceState: [
      "VERIFIED",
      "INCOMPLETE",
      "UNAVAILABLE",
      "STALE",
      "UNVERIFIED",
    ].includes(str(p0?.evidenceState) ?? "")
      ? (p0?.evidenceState as CheckSwapResult["evidenceState"])
      : undefined,
    expectationBaselineStatus: ["AVAILABLE", "MISSING"].includes(
      str(obj(p0?.expectationBaseline)?.status) ?? "",
    )
      ? (obj(p0?.expectationBaseline)
          ?.status as CheckSwapResult["expectationBaselineStatus"])
      : undefined,
    quoteFidelityStatus: ["VERIFIED", "UNKNOWN"].includes(
      str(obj(p0?.quoteFidelity)?.status) ?? "",
    )
      ? (obj(p0?.quoteFidelity)
          ?.status as CheckSwapResult["quoteFidelityStatus"])
      : undefined,
    remediationStatus: [
      "NOT_RUN",
      "UNVERIFIED",
      "NO_VALID_CANDIDATE",
      "UNKNOWN",
      "VERIFIED",
    ].includes(str(obj(p0?.remediation)?.status) ?? "")
      ? (obj(p0?.remediation)?.status as CheckSwapResult["remediationStatus"])
      : undefined,
    ruleResults: arr(run?.ruleResults)
      .map(rule)
      .filter((item): item is RuleResult => !!item),
    intent: {
      tokenIn,
      tokenOut,
      amountIn: decimal(
        intent?.amountInAtomic,
        decimalsFor(tokenIn, chainId, metadata, accountDecimals),
      ),
    },
    diff: diff(run?.diff, tokenIn, chainId, metadata, accountDecimals),
    quote: {
      // The handoff separates the QUOTE-stage observation from the simulated
      // output, so the top-level Quote wins for the "expected" figure and the
      // simulation value stays available on its own field.
      expectedOutput:
        str(runQuote?.estimatedAmountOut) ??
        (output
          ? decimal(
              output.amountReceivedAtomic,
              decimalsFor(tokenOut, chainId, metadata, accountDecimals),
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
          decimalsFor(tokenOut, chainId, metadata, accountDecimals),
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
    backendRunId: runId,
    recoveryInput,
  };
}

function body(input: CheckSwapInput, metadata?: P0Metadata) {
  const chainId = getChainIdForProtocol(input.protocol);
  const tokenIn = asset(input.tokenIn, chainId, metadata);
  const tokenOut = asset(input.tokenOut, chainId, metadata);
  return {
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    chainId,
    protocol: input.protocol,
    sender:
      input.sender ??
      (chainId === 421614 ? ARBITRUM_DEMO_SENDER : DEFAULT_SENDER),
    tokenIn,
    tokenOut,
    amountIn: input.amountIn,
    ...(input.expectationBaseline
      ? {
          expectationBaseline: {
            chainId,
            protocol: input.protocol,
            tokenIn,
            tokenOut,
            amountIn: input.amountIn,
            quote: input.expectationBaseline.quote,
          },
        }
      : {}),
    economicBoundary: input.minimumReceived
      ? {
          availability: "available",
          minimumReceived: input.minimumReceived,
          source: "user_declared",
        }
      : { availability: "unavailable", source: "unavailable" },
  };
}

export type CheckOptions = {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /**
   * Trusted decimals observed from `/api/account-state`, keyed by symbol. When
   * present these override the Monad registry fallback for display conversion.
   */
  decimalsBySymbol?: Record<string, number>;
};

/** `/api/quote` is a strict exact-input body: no boundary, no parent, no slippage. */
function quoteBody(input: QuoteSwapInput, metadata?: P0Metadata) {
  const chainId = getChainIdForProtocol(input.protocol);
  return {
    chainId,
    protocol: input.protocol,
    sender:
      input.sender ??
      (chainId === 421614 ? ARBITRUM_DEMO_SENDER : DEFAULT_SENDER),
    tokenIn: asset(input.tokenIn, chainId, metadata),
    tokenOut: asset(input.tokenOut, chainId, metadata),
    amountIn: input.amountIn,
  };
}

function quotePreview(value: unknown): QuotePreview | undefined {
  const quote = obj(value);
  const estimatedAmountOut = str(quote?.estimatedAmountOut);
  const blockNumber = str(quote?.blockNumber);
  const runtimeVersion = str(quote?.runtimeVersion);
  const runtimeRevision = str(quote?.runtimeRevision);
  // An available Quote is only publishable with its stage block and runtime
  // identity, so a partial payload is treated as an invalid response instead.
  if (
    !estimatedAmountOut ||
    !blockNumber ||
    !runtimeVersion ||
    !runtimeRevision
  )
    return;
  return {
    estimatedAmountOut,
    minimumAmountOut: str(quote?.minimumAmountOut),
    source: "quote",
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
  const metadata =
    input.protocol === "camelot-v3"
      ? await fetchP0Metadata(options.fetch ?? fetch, options.signal)
      : undefined;
  if (input.protocol === "camelot-v3" && metadata === undefined) {
    return {
      status: "error",
      apiFailure: { code: "METADATA_UNAVAILABLE", retryable: true },
    };
  }
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${API_BASE}/api/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(quoteBody(input, metadata)),
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
        // UNSUPPORTED means the live Quote flow is not wired, so retrying the
        // same request cannot change the outcome.
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

  return { status: "available", quote: preview, request: input };
}

const int = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;
const digits = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && /^\d+$/.test(text) ? text : undefined;
};

/**
 * Normalizes one balance side. Only the public metadata and amount are kept:
 * the snapshot never carries provider data, and nothing else is copied.
 */
function accountBalance(value: unknown): AccountTokenBalance | undefined {
  const balance = obj(value);
  const status = str(balance?.status);
  if (status !== "AVAILABLE" && status !== "UNAVAILABLE") return undefined;
  const metadata = obj(balance?.metadata);
  const symbolValue = str(metadata?.symbol);
  if (metadata === undefined || !symbolValue) return undefined;
  const decimalsSource = str(metadata?.decimalsSource);
  const view: AccountTokenBalance = {
    status,
    symbol: symbolValue,
    decimals: int(metadata?.decimals),
    decimalsSource:
      decimalsSource === "chain_config" || decimalsSource === "onchain_verified"
        ? decimalsSource
        : undefined,
  };
  if (status === "AVAILABLE") {
    const amountAtomic = digits(balance?.amountAtomic);
    return amountAtomic === undefined ? undefined : { ...view, amountAtomic };
  }
  return { ...view, reason: str(balance?.reason) ?? "UNAVAILABLE" };
}

function allowanceSpender(value: unknown): AllowanceSpender | undefined {
  const spender = obj(value);
  const status = str(spender?.status);
  if (status === "QUALIFIED") {
    const address = str(spender?.address);
    const qualificationRef = str(spender?.qualificationRef);
    if (!address || !qualificationRef) return undefined;
    return { status, address, qualificationRef };
  }
  if (status === "UNAVAILABLE") {
    return {
      status,
      reason: str(spender?.reason) ?? "SPENDER_NOT_QUALIFIED",
    };
  }
  if (status === "NOT_APPLICABLE") return { status };
  return undefined;
}

function accountAllowance(value: unknown): AccountAllowance | undefined {
  const allowance = obj(value);
  const status = str(allowance?.status);
  const spender = allowanceSpender(allowance?.spender);
  if (status === "SUFFICIENT" || status === "INSUFFICIENT") {
    const allowanceAtomic = digits(allowance?.allowanceAtomic);
    const requiredAmountAtomic = digits(allowance?.requiredAmountAtomic);
    if (
      allowanceAtomic === undefined ||
      requiredAmountAtomic === undefined ||
      spender?.status !== "QUALIFIED"
    )
      return undefined;
    return {
      status,
      allowanceAtomic,
      requiredAmountAtomic,
      spender,
      blockNumber: digits(allowance?.blockNumber),
    };
  }
  if (status === "UNAVAILABLE") {
    return {
      status,
      reason: str(allowance?.reason) ?? "UNAVAILABLE",
      requiredAmountAtomic: digits(allowance?.requiredAmountAtomic),
      spender,
      blockNumber: digits(allowance?.blockNumber),
    };
  }
  if (status === "NOT_APPLICABLE") {
    return { status, reason: "NATIVE_INPUT" };
  }
  return undefined;
}

function accountBlock(value: unknown): AccountBlockBinding | undefined {
  const block = obj(value);
  const status = str(block?.status);
  const observedAt = str(block?.observedAt);
  const chainId = int(block?.chainId);
  if (status === "VERIFIED" || status === "STALE") {
    const blockNumber = digits(block?.blockNumber);
    const blockHash = str(block?.blockHash);
    if (
      blockNumber === undefined ||
      !blockHash ||
      !observedAt ||
      chainId === undefined
    )
      return undefined;
    return status === "VERIFIED"
      ? { status, chainId, blockNumber, blockHash, observedAt }
      : {
          status,
          chainId,
          blockNumber,
          blockHash,
          observedAt,
          reason: str(block?.reason) ?? "BLOCK_HASH_MISMATCH",
        };
  }
  if (status === "UNAVAILABLE") {
    return {
      status,
      chainId,
      blockNumber: digits(block?.blockNumber),
      blockHash: str(block?.blockHash),
      observedAt,
      reason: str(block?.reason),
    };
  }
  return undefined;
}

/**
 * Maps a normalized `POST /api/account-state` snapshot. Returns undefined for a
 * payload that cannot be trusted, so the caller fails closed rather than showing
 * a partially invented observation.
 */
export function mapAccountState(
  payload: unknown,
): AccountStateView | undefined {
  const snapshot = obj(payload);
  if (!snapshot) return undefined;
  const status = str(snapshot.status);
  if (
    status !== "AVAILABLE" &&
    status !== "PARTIAL" &&
    status !== "UNAVAILABLE"
  )
    return undefined;
  if (str(snapshot.snapshotId) === undefined) return undefined;
  const balances = obj(snapshot.balances);
  const inputToken = accountBalance(balances?.inputToken);
  const outputToken = accountBalance(balances?.outputToken);
  const allowance = accountAllowance(snapshot.allowance);
  const block = accountBlock(snapshot.block);
  if (!inputToken || !outputToken || !allowance || !block) return undefined;

  const decimalsBySymbol: Record<string, number> = {};
  for (const side of [inputToken, outputToken]) {
    if (side.symbol && side.decimals !== undefined) {
      decimalsBySymbol[side.symbol] = side.decimals;
    }
  }
  return {
    status,
    decimalsBySymbol,
    inputToken,
    outputToken,
    allowance,
    block,
  };
}

/**
 * Reads trusted account state for the same intent `/api/quote` accepts. The
 * endpoint is optional evidence: any transport error, non-200, malformed body,
 * or `UNAVAILABLE` snapshot fails closed with no decimals and no fabricated
 * amount, and never blocks submitting the Check.
 */
export async function fetchAccountState(
  input: QuoteSwapInput,
  options: CheckOptions = {},
): Promise<AccountStateState> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${API_BASE}/api/account-state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(quoteBody(input)),
      signal: options.signal,
    });
  } catch {
    return { status: "unavailable", reason: "REQUEST_FAILED" };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: "unavailable", reason: "INVALID_RESPONSE" };
  }
  if (!response.ok) return { status: "unavailable", reason: "REQUEST_FAILED" };

  const view = mapAccountState(payload);
  if (!view) return { status: "unavailable", reason: "INVALID_RESPONSE" };
  if (view.status === "UNAVAILABLE") {
    return { status: "unavailable", reason: "SNAPSHOT_UNAVAILABLE" };
  }
  return { status: "available", view };
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
  const metadata =
    input.protocol === "camelot-v3"
      ? await fetchP0Metadata(options.fetch ?? fetch, options.signal)
      : undefined;
  if (input.protocol === "camelot-v3" && metadata === undefined) {
    return failed(
      input,
      { code: "METADATA_UNAVAILABLE", retryable: true },
      null,
    );
  }
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${API_BASE}/api/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body(input, metadata)),
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
      mapRun(
        payload,
        undefined,
        payload,
        undefined,
        metadata,
        options.decimalsBySymbol,
      ) ??
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
    mapRun(
      envelope?.run,
      apiFailure,
      payload,
      undefined,
      metadata,
      options.decimalsBySymbol,
    ) ?? failed(input, apiFailure, payload)
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
  const metadata =
    obj(storedResult?.intent)?.chainId === 421614
      ? await fetchP0Metadata(options.fetch ?? fetch, options.signal)
      : undefined;
  const storedErrorCode = str(obj(storedResult?.error)?.code);
  const persistedFailure =
    status === "failed" && storedErrorCode !== "INSUFFICIENT_NATIVE_BALANCE"
      ? str(record?.failure)
      : undefined;
  const result = mapRun(
    record?.result,
    persistedFailure === undefined
      ? undefined
      : { code: persistedFailure, retryable: false },
    payload,
    str(record?.createdAt),
    metadata,
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
  return {
    ...INITIAL_FORM,
    protocol: result.recoveryInput?.protocol ?? INITIAL_FORM.protocol,
    tokenIn: result.intent.tokenIn,
    tokenOut: result.intent.tokenOut,
    amountIn: result.intent.amountIn,
    minimumReceived: result.recoveryInput?.minimumReceived ?? "",
  };
}
