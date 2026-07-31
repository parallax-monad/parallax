import { formatBps } from "./format";
import { evaluatePolicy, overallPolicyStatus } from "./policy";
import type {
  FinalAssessment,
  PreliminaryAssessment,
  RiskDimensionAssessment,
  RiskFinding,
  RiskLevel,
  SimulationResult,
} from "./types";

const order: RiskLevel[] = ["high", "elevated", "moderate", "low", "unknown"];

function level(findings: RiskFinding[]): RiskLevel {
  if (findings.some((f) => f.severity === "critical" || f.severity === "high"))
    return "high";
  if (findings.some((f) => f.severity === "medium")) return "elevated";
  if (findings.some((f) => f.severity === "low")) return "moderate";
  return "low";
}

export function simulationDimension(
  sim: SimulationResult,
): RiskDimensionAssessment {
  const findings: RiskFinding[] = [];

  if (!sim.success) {
    findings.push({
      id: "simulation-reverted",
      dimension: "simulation",
      severity: "critical",
      title: "模擬回滾",
      detail: sim.revertReason ?? "模擬返回回滾狀態。",
    });
  }

  for (const warning of sim.warnings) {
    findings.push({
      id: `simulation-${warning.code}`,
      dimension: "simulation",
      severity: warning.severity,
      title: warning.code,
      detail: warning.message,
    });
  }

  if (Number(sim.gasUsed) / Number(sim.gasLimit) > 0.95) {
    findings.push({
      id: "simulation-gas",
      dimension: "simulation",
      severity: "high",
      title: "Gas 接近上限",
      detail: "Gas 用量超過設定上限的 95%。",
    });
  }

  return {
    dimension: "simulation",
    label: "模擬證據",
    level: level(findings),
    findings,
    summary: sim.success
      ? findings.length
        ? "通過但有告警"
        : "通過"
      : "回滾",
  };
}

export function finalAssessment(
  pre: PreliminaryAssessment,
  sim: SimulationResult,
  runId: string,
  parentRunId: string | null,
): FinalAssessment {
  const token = pre.intent.tokenOut;
  const inflow = token
    ? sim.assetDeltas.find((d) => d.direction === "in" && d.symbol === token.symbol)
    : undefined;
  const quoted = Number(pre.quote.amountOut.value);
  const actual = Number(inflow?.amount);
  const delta =
    Number.isFinite(actual) && quoted > 0
      ? Math.round(((actual - quoted) / quoted) * 10_000)
      : null;

  const simulation = simulationDimension(sim);
  const dimensions = [...pre.dimensions, simulation];
  const findings = [...pre.findings, ...simulation.findings];

  if (delta !== null && -delta >= pre.intent.slippageToleranceBps) {
    findings.push({
      id: "quote-simulation-gap",
      dimension: "simulation",
      severity: "critical",
      title: "模擬輸出低於容忍度",
      detail: `模擬結果與報價偏離 ${formatBps(-delta)}。`,
    });
  }

  const policyRules = evaluatePolicy(pre, sim);
  const overallRisk =
    order.find((risk) => dimensions.some((d) => d.level === risk)) ?? "unknown";
  const unknown = pre.dataCompleteness === "low" ? 1 : 0;

  return {
    receiptVersion: "0.1",
    receiptId: `receipt_${crypto.randomUUID()}`,
    runId,
    parentRunId,
    chainId: 10143,
    analyzedAt: new Date().toISOString(),
    preliminary: pre,
    simulation: sim,
    dimensions,
    findings,
    overallRisk,
    overallStatus: overallPolicyStatus(policyRules),
    policyRules,
    coverage: {
      known: pre.evidenceSources.length + 4,
      unknown,
      notApplicable: 0,
    },
    quoteVsSimulationDeltaBps: delta,
    summary: `模擬${sim.success ? "通過" : "失敗"}。風險發現按維度展示；這不是投資建議。`,
    unverified: ["模擬反映模擬時狀態；執行時狀態可能變化。"],
    generatedAt: new Date().toISOString(),
  };
}
