import type { Copy } from "@/lib/i18n";
import { runEvidence } from "./fixtures";
import { decide, MOSS_VERSION, RULE_VERSION } from "./rules";
import type { CheckSwapInput, CheckSwapResult, RunDiff } from "./types";

let runCounter = 0;

function nextRunId() {
  runCounter += 1;
  return `run_${runCounter.toString().padStart(4, "0")}`;
}

const NOT_CHECKED: Copy[] = [
  { en: "Full protocol security review", zh: "完整的协议安全审计" },
  { en: "Complete malicious token coverage", zh: "全部恶意代币的覆盖" },
  { en: "All asset semantics", zh: "所有资产的语义差异" },
  { en: "Future market movement", zh: "未来的市场波动" },
];

const UNAVAILABLE: Copy = { en: "unavailable", zh: "无法取得" };

/**
 * Quote amounts are numeric strings except for the "unavailable" sentinel, so
 * only that sentinel needs translating.
 */
const amountCopy = (value: string): Copy =>
  value === "unavailable" ? UNAVAILABLE : { en: value, zh: value };

/** Integration faults surface as INTEGRATION_ERROR, never protocol risk (FR-09). */
function integrationError(
  input: CheckSwapInput,
  message: Copy,
): CheckSwapResult {
  return {
    runId: nextRunId(),
    parentRunId: input.parentRunId,
    systemStatus: "INTEGRATION_ERROR",
    verdict: "UNKNOWN",
    summary: {
      en: `The check did not complete: ${message.en}. This says nothing about the transaction itself.`,
      zh: `检查没有完成：${message.zh}。这不代表交易本身有问题。`,
    },
    recommendedActions: [],
    irrelevantActions: [],
    checked: [],
    notChecked: NOT_CHECKED,
    evidence: [],
    ruleResults: [],
    unknowns: [
      {
        id: "run",
        label: { en: "Check did not complete", zh: "检查没有完成" },
        reason: message,
      },
    ],
    replayMode: true,
    intent: {
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: input.amountIn,
    },
    quote: {
      expectedOutput: "unavailable",
      route: UNAVAILABLE,
      blockNumber: "unavailable",
    },
    minimumReceivedSource: input.minimumReceivedSource ?? "unavailable",
    createdAt: new Date().toISOString(),
    ruleVersion: RULE_VERSION,
    mossVersion: MOSS_VERSION,
  };
}

const VERDICT_RANK = { STOP: 0, ADJUST: 1, UNKNOWN: 2, PROCEED: 3 };

const DIFF_FIELD = {
  verdict: { en: "Verdict", zh: "结论" },
  expectedOutput: { en: "Expected output", zh: "预期输出" },
  route: { en: "Route", zh: "路径" },
} satisfies Record<string, Copy>;

/** Previous vs New comparison (FR-07). Only fields that moved are listed. */
function buildDiff(
  previous: CheckSwapResult,
  next: CheckSwapResult,
): RunDiff | undefined {
  const rows: RunDiff = [];

  if (previous.verdict !== next.verdict) {
    rows.push({
      field: DIFF_FIELD.verdict,
      previous: { en: previous.verdict, zh: previous.verdict },
      next: { en: next.verdict, zh: next.verdict },
      direction:
        VERDICT_RANK[next.verdict] > VERDICT_RANK[previous.verdict]
          ? "improved"
          : "worsened",
    });
  }

  if (previous.quote.expectedOutput !== next.quote.expectedOutput) {
    const before = Number(previous.quote.expectedOutput);
    const after = Number(next.quote.expectedOutput);
    const comparable = Number.isFinite(before) && Number.isFinite(after);
    rows.push({
      field: DIFF_FIELD.expectedOutput,
      previous: amountCopy(previous.quote.expectedOutput),
      next: amountCopy(next.quote.expectedOutput),
      direction: comparable
        ? after > before
          ? "improved"
          : "worsened"
        : "changed",
    });
  }

  // Compared by content, not identity: route is a fresh Copy object each run,
  // so `!==` on the object would report a change on every single check.
  if (previous.quote.route.en !== next.quote.route.en) {
    rows.push({
      field: DIFF_FIELD.route,
      previous: previous.quote.route,
      next: next.quote.route,
      direction: "changed",
    });
  }

  return rows.length > 0 ? rows : undefined;
}

export type CheckOptions = { previous?: CheckSwapResult };

/**
 * Runs the full pipeline: intent → evidence → normalization → rules → decision.
 * Mirrors POST /api/check so the UI can swap in a real endpoint unchanged.
 */
export function checkSwap(
  input: CheckSwapInput,
  options: CheckOptions = {},
): CheckSwapResult {
  const amountIn = Number(input.amountIn);
  if (!Number.isFinite(amountIn) || amountIn <= 0) {
    return integrationError(input, {
      en: "amount must be a positive number",
      zh: "输入数量必须是大于 0 的数字",
    });
  }

  const parsedSlippage = Number(input.slippage ?? "0.5");
  const evidence = runEvidence({
    protocol: input.protocol,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn,
    slippage: Number.isFinite(parsedSlippage) ? parsedSlippage : 0.5,
  });

  const declared =
    input.minimumReceived === undefined || input.minimumReceived === ""
      ? undefined
      : Number(input.minimumReceived);
  const minimumReceived =
    declared !== undefined && Number.isFinite(declared) ? declared : undefined;
  const minimumReceivedSource =
    minimumReceived === undefined
      ? "unavailable"
      : (input.minimumReceivedSource ?? "user_declared");

  const decision = decide({
    evidence,
    minimumReceived,
    minimumReceivedSource,
    tokenOut: input.tokenOut,
  });

  const result: CheckSwapResult = {
    runId: nextRunId(),
    parentRunId: input.parentRunId,
    systemStatus: "OK",
    verdict: decision.verdict,
    summary: decision.summary,
    recommendedActions: decision.recommendedActions,
    irrelevantActions: decision.irrelevantActions,
    checked: decision.checked,
    notChecked: decision.notChecked,
    evidence: evidence.items,
    ruleResults: decision.ruleResults,
    unknowns: decision.unknowns,
    replayMode: evidence.origin === "replay",
    intent: {
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: input.amountIn,
    },
    quote: {
      expectedOutput:
        evidence.executionStatus === "SUCCESS"
          ? evidence.expectedOutput.toFixed(4)
          : "unavailable",
      route: evidence.route,
      blockNumber: evidence.blockNumber,
    },
    minimumReceivedSource,
    createdAt: new Date().toISOString(),
    ruleVersion: RULE_VERSION,
    mossVersion: MOSS_VERSION,
  };

  const previous = options.previous;
  return previous ? { ...result, diff: buildDiff(previous, result) } : result;
}
