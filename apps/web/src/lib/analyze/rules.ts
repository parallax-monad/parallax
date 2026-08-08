import type { Copy } from "@/lib/i18n";
import type { ExecutionStatus, NormalizedEvidence } from "./fixtures";
import type {
  ActionSuggestion,
  BoundarySource,
  RuleResult,
  UnknownItem,
  Verdict,
} from "./types";

export const RULE_VERSION = "p0.1.0";
export const MOSS_VERSION = "local-demo-rules-2026.08";

export type RuleInput = {
  evidence: NormalizedEvidence;
  minimumReceived?: number;
  minimumReceivedSource: BoundarySource;
  tokenOut: string;
};

export type Decision = {
  verdict: Verdict;
  summary: Copy;
  ruleResults: RuleResult[];
  unknowns: UnknownItem[];
  recommendedActions: ActionSuggestion[];
  irrelevantActions: ActionSuggestion[];
  checked: Copy[];
  notChecked: Copy[];
};

const CHECKED_BASE: Copy[] = [
  {
    en: "Execution result (quote, action, simulation)",
    zh: "执行结果（报价、构建、模拟）",
  },
  {
    en: "Moss warnings raised during this run",
    zh: "本次运行中 Moss 提出的警告",
  },
];

const NOT_CHECKED: Copy[] = [
  { en: "Full protocol security review", zh: "完整的协议安全审计" },
  { en: "Complete malicious token coverage", zh: "全部恶意代币的覆盖" },
  { en: "All asset semantics", zh: "所有资产的语义差异" },
  { en: "Future market movement", zh: "未来的市场波动" },
];

function action(
  field: ActionSuggestion["field"],
  relevance: ActionSuggestion["relevance"],
  reason: Copy,
): ActionSuggestion {
  return {
    field,
    category:
      field === "minimumReceived"
        ? "ACCEPTANCE_BOUNDARY"
        : "TRANSACTION_CONDITION",
    relevance,
    // Local reasoning carries no backend Action Gate attestation.
    recommendable: false,
    reason,
  };
}

const EXECUTION_LABEL: Copy = { en: "Execution result", zh: "执行结果" };

/** Execution rule group (PRD 10.1). Integration faults never become FAIL. */
function executionRule(evidence: NormalizedEvidence): RuleResult {
  const map: Record<
    ExecutionStatus,
    { outcome: RuleResult["outcome"]; detail: Copy }
  > = {
    SUCCESS: {
      outcome: "PASS",
      detail: {
        en: "Simulation completed against the built action.",
        zh: "已针对构建出的交易完成模拟执行。",
      },
    },
    NO_ROUTE: {
      outcome: "FAIL",
      detail: {
        en: `No executable route: ${evidence.route.en}.`,
        zh: `没有可执行的路径：${evidence.route.zh}。`,
      },
    },
    REVERTED: {
      outcome: "FAIL",
      detail: {
        en: "Simulation reverted before completion.",
        zh: "模拟执行在完成前被回滚。",
      },
    },
    UNKNOWN: {
      outcome: "UNKNOWN",
      detail: {
        en: "Execution result could not be established.",
        zh: "无法确认执行结果。",
      },
    },
  };
  const hit = map[evidence.executionStatus];

  return {
    id: "execution",
    group: "execution",
    label: EXECUTION_LABEL,
    outcome: hit.outcome,
    detail: hit.detail,
  };
}

const BOUNDARY_LABEL: Copy = {
  en: "Declared minimum received",
  zh: "你声明的最低收到量",
};

/**
 * Economic boundary rule (PRD 10.2). Runs only when the user declared a
 * boundary, and states compliance with that boundary, never "safe" or "good".
 */
function boundaryRule(input: RuleInput): RuleResult {
  const { evidence, minimumReceived, minimumReceivedSource, tokenOut } = input;

  if (
    minimumReceived === undefined ||
    minimumReceivedSource === "unavailable"
  ) {
    return {
      id: "boundary",
      group: "economicBoundary",
      label: BOUNDARY_LABEL,
      outcome: "SKIPPED",
      detail: {
        en: "No explicit boundary was declared, so this rule did not run.",
        zh: "你没有声明明确的边界，因此这条规则没有执行。",
      },
    };
  }

  if (evidence.executionStatus !== "SUCCESS") {
    return {
      id: "boundary",
      group: "economicBoundary",
      label: BOUNDARY_LABEL,
      outcome: "SKIPPED",
      detail: {
        en: "No executable output to compare against the boundary.",
        zh: "没有可执行的输出，无法与边界比较。",
      },
    };
  }

  const quoted = evidence.expectedOutput.toFixed(4);
  return {
    id: "boundary",
    group: "economicBoundary",
    label: BOUNDARY_LABEL,
    outcome: evidence.expectedOutput >= minimumReceived ? "PASS" : "FAIL",
    detail: {
      en: `Quoted ${quoted} ${tokenOut} against your declared ${minimumReceived} ${tokenOut}.`,
      zh: `报价为 ${quoted} ${tokenOut}，你声明的下限是 ${minimumReceived} ${tokenOut}。`,
    },
  };
}

const COMPLETENESS_LABEL: Copy = {
  en: "Evidence completeness",
  zh: "证据完整度",
};

/** Evidence completeness rule (PRD 10.3). Missing fields drive UNKNOWN. */
function completenessRule(evidence: NormalizedEvidence): RuleResult {
  if (evidence.missingFields.length > 0) {
    const fields = evidence.missingFields.join(", ");
    return {
      id: "completeness",
      group: "evidenceCompleteness",
      label: COMPLETENESS_LABEL,
      outcome: "UNKNOWN",
      detail: {
        en: `Missing fields: ${fields}.`,
        zh: `缺少字段：${fields}。`,
      },
    };
  }

  if (evidence.warnings.length > 0) {
    return {
      id: "completeness",
      group: "evidenceCompleteness",
      label: COMPLETENESS_LABEL,
      outcome: "FAIL",
      detail: {
        en: `Moss raised: ${evidence.warnings.map((w) => w.en).join("; ")}.`,
        zh: `Moss 提出：${evidence.warnings.map((w) => w.zh).join("；")}。`,
      },
    };
  }

  return {
    id: "completeness",
    group: "evidenceCompleteness",
    label: COMPLETENESS_LABEL,
    outcome: "PASS",
    detail: {
      en: "All fields required for this decision were present.",
      zh: "本次决策所需的字段都已具备。",
    },
  };
}

/**
 * Reason-to-action mapping (PRD 11). Each cause yields one evidence-backed
 * relevant adjustment and one evidence-backed irrelevant adjustment.
 */
function actionsFor(
  evidence: NormalizedEvidence,
  boundary: RuleResult,
): Pick<Decision, "recommendedActions" | "irrelevantActions"> {
  if (evidence.executionStatus === "NO_ROUTE") {
    return {
      recommendedActions: [
        action("protocol", "RELEVANT", {
          en: "No pool was found on this protocol.",
          zh: "在这个协议上找不到资金池。",
        }),
        action("tokenPair", "RELEVANT", {
          en: "A different pair may have liquidity.",
          zh: "换一个代币对可能有流动性。",
        }),
      ],
      irrelevantActions: [
        action("slippage", "IRRELEVANT", {
          en: "Slippage cannot create a route that does not exist.",
          zh: "滑点无法创造出并不存在的路径。",
        }),
      ],
    };
  }

  if (evidence.executionStatus === "REVERTED") {
    return {
      recommendedActions: [
        action("amountIn", "RELEVANT", {
          en: "Requested amount exceeds the balance.",
          zh: "输入数量超过了可用余额。",
        }),
      ],
      irrelevantActions: [
        action("slippage", "IRRELEVANT", {
          en: "Raising slippage does not add funds to the sender.",
          zh: "提高滑点不会让发送方多出资金。",
        }),
      ],
    };
  }

  if (boundary.outcome === "FAIL") {
    return {
      recommendedActions: [
        action("protocol", "RELEVANT", {
          en: "Another route may quote a better output.",
          zh: "换一条路径可能报出更好的输出。",
        }),
        action("amountIn", "RELEVANT", {
          en: "Amount changes the quoted output.",
          zh: "输入数量会改变报价的输出。",
        }),
      ],
      // Lowering the boundary is never framed as improving the trade (PRD 12).
      irrelevantActions: [
        action("minimumReceived", "IRRELEVANT", {
          en: "Lowering your boundary only widens what you accept; the quote is unchanged.",
          zh: "降低你的下限只是放宽了你能接受的范围，报价本身不会变。",
        }),
      ],
    };
  }

  return { recommendedActions: [], irrelevantActions: [] };
}

function unknownsFor(evidence: NormalizedEvidence): UnknownItem[] {
  return evidence.missingFields.map((field) => ({
    id: field,
    label: { en: field, zh: field },
    reason: {
      en: "Not returned by this run, so it cannot support a conclusion.",
      zh: "本次运行没有返回这个字段，因此无法支撑结论。",
    },
  }));
}

/**
 * Deterministic verdict (FR-04). Ordering matters: a blocked execution outranks
 * a boundary miss, and UNKNOWN is never collapsed into PROCEED (PRD 10).
 */
export function decide(input: RuleInput): Decision {
  const { evidence, minimumReceived, minimumReceivedSource, tokenOut } = input;
  const execution = executionRule(evidence);
  const boundary = boundaryRule(input);
  const completeness = completenessRule(evidence);
  const { recommendedActions, irrelevantActions } = actionsFor(
    evidence,
    boundary,
  );

  const checked = [...CHECKED_BASE];
  if (
    minimumReceived !== undefined &&
    minimumReceivedSource !== "unavailable"
  ) {
    checked.push({
      en: `Your declared minimum of ${minimumReceived} ${tokenOut}`,
      zh: `你声明的最低收到量 ${minimumReceived} ${tokenOut}`,
    });
  }

  let verdict: Verdict = "PROCEED";
  let summary: Copy = {
    en: "No blocking evidence found in the checked scope. This is not a safety guarantee.",
    zh: "在已检查的范围内没有发现阻断性证据。这不等于安全保证。",
  };

  if (evidence.executionStatus === "NO_ROUTE") {
    verdict = "STOP";
    summary = {
      en: `This path cannot execute: ${evidence.route.en}.`,
      zh: `这条路径无法执行：${evidence.route.zh}。`,
    };
  } else if (evidence.executionStatus === "REVERTED") {
    verdict = "ADJUST";
    summary = {
      en: "Simulation reverted before completion, so one condition must change.",
      zh: "模拟执行被回滚，因此必须修改一个条件。",
    };
  } else if (boundary.outcome === "FAIL") {
    verdict = "ADJUST";
    summary = {
      en: `Quoted output falls below the boundary you declared for ${tokenOut}.`,
      zh: `报价输出低于你为 ${tokenOut} 声明的下限。`,
    };
  } else if (completeness.outcome === "UNKNOWN") {
    verdict = "UNKNOWN";
    summary = {
      en: "Evidence is incomplete, so no trustworthy conclusion is available.",
      zh: "证据不完整，因此无法给出可信的结论。",
    };
  } else if (completeness.outcome === "FAIL") {
    verdict = "ADJUST";
    summary = {
      en: `Moss raised a warning on this run: ${evidence.warnings.map((w) => w.en).join("; ")}.`,
      zh: `本次运行 Moss 提出了警告：${evidence.warnings.map((w) => w.zh).join("；")}。`,
    };
  } else if (boundary.outcome === "PASS") {
    summary = {
      en: "No blocking evidence found in the checked scope, and the result meets your declared boundary.",
      zh: "在已检查的范围内没有发现阻断性证据，而且结果满足你声明的边界。",
    };
  }

  return {
    verdict,
    summary,
    ruleResults: [execution, boundary, completeness],
    unknowns: unknownsFor(evidence),
    recommendedActions,
    irrelevantActions,
    checked,
    notChecked: NOT_CHECKED,
  };
}
