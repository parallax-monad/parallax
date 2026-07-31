import type {
  PolicyRuleResult,
  PreliminaryAssessment,
  RiskPolicy,
  RuleStatus,
  SimulationResult,
} from "./types";

export const POLICY_TEMPLATES: Record<
  Exclude<RiskPolicy["template"], "custom">,
  RiskPolicy
> = {
  standard: {
    template: "standard",
    maxSlippageBps: 50,
    maxPriceImpactBps: 100,
    failOnSimulationWarning: true,
    requireVerifiedContract: false,
    unknownEvidenceBehavior: "warn",
  },
  conservative: {
    template: "conservative",
    maxSlippageBps: 30,
    maxPriceImpactBps: 50,
    failOnSimulationWarning: true,
    requireVerifiedContract: true,
    unknownEvidenceBehavior: "fail",
  },
};

function result(
  id: string,
  label: string,
  observed: string,
  threshold: string,
  status: RuleStatus,
  evidence: string,
): PolicyRuleResult {
  return { id, label, observed, threshold, status, evidence };
}

export function evaluatePolicy(
  pre: PreliminaryAssessment,
  simulation: SimulationResult,
): PolicyRuleResult[] {
  const { policy, quote, profile } = pre;
  const rules: PolicyRuleResult[] = [
    result(
      "POLICY-SLIPPAGE-001",
      "預期滑點",
      `${quote.expectedSlippageBps.value} bps`,
      `≤ ${policy.maxSlippageBps} bps`,
      quote.expectedSlippageBps.value <= policy.maxSlippageBps ? "pass" : "fail",
      `Quote · ${quote.expectedSlippageBps.source}`,
    ),
    result(
      "POLICY-PRICE-IMPACT-001",
      "價格影響",
      `${quote.priceImpactBps.value} bps`,
      `≤ ${policy.maxPriceImpactBps} bps`,
      quote.priceImpactBps.value <= policy.maxPriceImpactBps ? "pass" : "fail",
      `Quote · ${quote.priceImpactBps.source}`,
    ),
    result(
      "POLICY-CONTRACT-001",
      "已驗證合約",
      profile.openSourceVerified ? "已驗證" : "未驗證",
      policy.requireVerifiedContract ? "必需" : "建議",
      profile.openSourceVerified
        ? "pass"
        : policy.requireVerifiedContract
          ? "fail"
          : "warn",
      "協議事實註冊表",
    ),
    result(
      "POLICY-WARNING-001",
      "Moss 告警",
      `${simulation.warnings.length} 條告警`,
      policy.failOnSimulationWarning ? "必須為 0" : "需審查",
      simulation.warnings.length === 0
        ? "pass"
        : policy.failOnSimulationWarning
          ? "fail"
          : "warn",
      `Moss 模擬 · ${simulation.simulatorVersion ?? "未知版本"}`,
    ),
    result(
      "POLICY-SIMULATION-001",
      "模擬執行",
      simulation.success ? "通過" : "回滾",
      "必須通過",
      simulation.success ? "pass" : "fail",
      "Moss 模擬回執",
    ),
  ];

  if (pre.dataCompleteness === "low") {
    rules.push(
      result(
        "DATA-UNKNOWN-001",
        "證據完整性",
        "覆蓋率低",
        policy.unknownEvidenceBehavior === "fail" ? "不允許未知證據" : "需審查未知證據",
        policy.unknownEvidenceBehavior === "fail" ? "fail" : "warn",
        "候選證據覆蓋",
      ),
    );
  }

  return rules;
}

export function overallPolicyStatus(rules: PolicyRuleResult[]): RuleStatus {
  if (rules.some((rule) => rule.status === "fail")) return "fail";
  if (rules.some((rule) => rule.status === "warn" || rule.status === "unknown"))
    return "warn";
  return "pass";
}
