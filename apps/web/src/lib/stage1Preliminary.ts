import { formatBps } from "./format";
import { findOperation, findProfile } from "./protocols";
import { fixtureQuote } from "./sources/fixtures";
import type {
  PreliminaryAssessment,
  RiskDimension,
  RiskDimensionAssessment,
  RiskFinding,
  RiskLevel,
  RiskPolicy,
  TradeIntent,
  TradeRequest,
} from "./types";

const now = () => new Date().toISOString();
const levels: RiskLevel[] = ["high", "elevated", "moderate", "low"];

const level = (findings: RiskFinding[]): RiskLevel =>
  findings.some((f) => f.severity === "critical" || f.severity === "high")
    ? "high"
    : findings.some((f) => f.severity === "medium")
      ? "elevated"
      : findings.some((f) => f.severity === "low")
        ? "moderate"
        : "low";

const item = (
  dimension: RiskDimension,
  severity: RiskFinding["severity"],
  title: string,
  detail: string,
): RiskFinding => ({
  id: `${dimension}-${title}`,
  dimension,
  severity,
  title,
  detail,
});

const dimension = (
  key: RiskDimension,
  label: string,
  findings: RiskFinding[],
): RiskDimensionAssessment => ({
  dimension: key,
  label,
  level: level(findings),
  findings,
  summary: `${label}：${level(findings)}`,
});

export function buildIntent(request: TradeRequest): TradeIntent {
  const profile = findProfile(request.protocolId);
  if (!profile) throw new Error("未收錄該協議。");
  const operation = findOperation(profile, request.action);
  if (!operation) throw new Error("該協議不支援此操作。");

  return {
    walletAddress: request.walletAddress,
    protocolId: request.protocolId,
    action: request.action,
    tokenIn: operation.tokenIn,
    tokenOut: operation.tokenOut,
    amountIn: request.amountIn,
    slippageToleranceBps: operation.slippageToleranceBps,
    walletContext: request.walletContext,
  };
}

function assessWalletContext(intent: TradeIntent): RiskFinding[] {
  const context = intent.walletContext;
  if (!context) return [];
  const findings: RiskFinding[] = [];

  if (
    context.tokenBalance !== null &&
    Number(context.tokenBalance) < Number(intent.amountIn)
  ) {
    findings.push(
      item(
        "transaction",
        "high",
        "餘額不足",
        `錢包 ${intent.tokenIn.symbol} 餘額 ${context.tokenBalance} 低於交易金額 ${intent.amountIn}，交易將回滾。`,
      ),
    );
  }

  if (context.allowanceIsUnlimited) {
    findings.push(
      item(
        "transaction",
        "high",
        "已存在無限授權",
        `錢包對該合約的 ${intent.tokenIn.symbol} 授權為無限額度。`,
      ),
    );
  } else if (
    context.existingAllowance !== null &&
    Number(context.existingAllowance) < Number(intent.amountIn)
  ) {
    findings.push(
      item(
        "transaction",
        "medium",
        "需要新增授權",
        `當前 ${intent.tokenIn.symbol} 授權不足本次交易。`,
      ),
    );
  }

  return findings;
}

export async function runPreliminary(
  intent: TradeIntent,
  policy: RiskPolicy,
): Promise<PreliminaryAssessment> {
  const profile = findProfile(intent.protocolId);
  if (!profile) throw new Error("未收錄該協議。");

  const quote = fixtureQuote(intent);

  const protocol: RiskFinding[] = [];
  if (!profile.openSourceVerified) {
    protocol.push(
      item("protocol", "high", "未開源驗證", "無法核對公開源碼與實際執行邏輯。"),
    );
  }
  if (profile.auditCount === 0) {
    protocol.push(item("protocol", "high", "無公開審計", "未找到第三方審計記錄。"));
  }
  if (profile.upgradeable && profile.timelockHours === 0) {
    protocol.push(
      item("protocol", "critical", "升級無時間鎖", "模擬後邏輯仍可能被即時更改。"),
    );
  }

  const ratio =
    quote.poolLiquidityUsd.value > 0
      ? Math.round((quote.notionalUsd.value / quote.poolLiquidityUsd.value) * 10_000)
      : Number.POSITIVE_INFINITY;

  const liquidity: RiskFinding[] = [];
  if (ratio >= 1000) {
    liquidity.push(
      item(
        "liquidity",
        "critical",
        "交易規模相對流動性過大",
        `佔池內流動性 ${(ratio / 100).toFixed(2)}%。`,
      ),
    );
  } else if (ratio >= 200) {
    liquidity.push(
      item(
        "liquidity",
        "high",
        "交易規模佔比偏高",
        `佔池內流動性 ${(ratio / 100).toFixed(2)}%。`,
      ),
    );
  }
  if (quote.priceImpactBps.value >= 100) {
    liquidity.push(
      item("liquidity", "high", "價格影響偏高", formatBps(quote.priceImpactBps.value)),
    );
  } else if (quote.priceImpactBps.value >= 30) {
    liquidity.push(
      item("liquidity", "medium", "價格影響中等", formatBps(quote.priceImpactBps.value)),
    );
  }

  const transaction: RiskFinding[] = [];
  if (intent.slippageToleranceBps >= 500) {
    transaction.push(
      item(
        "transaction",
        "high",
        "滑點容忍度過寬",
        formatBps(intent.slippageToleranceBps),
      ),
    );
  }
  if (quote.expectedSlippageBps.value > intent.slippageToleranceBps) {
    transaction.push(
      item(
        "transaction",
        "high",
        "預期滑點超出容忍度",
        `${formatBps(quote.expectedSlippageBps.value)} > ${formatBps(intent.slippageToleranceBps)}`,
      ),
    );
  }
  transaction.push(...assessWalletContext(intent));

  const dimensions = [
    dimension("protocol", "協議風險", protocol),
    dimension("liquidity", "流動性風險", liquidity),
    dimension("transaction", "交易風險", transaction),
  ];

  return {
    intent,
    policy,
    profile,
    quote,
    dimensions,
    findings: dimensions.flatMap((entry) => entry.findings),
    liquidityRatioBps: ratio,
    generatedAt: now(),
    marketType: profile.category,
    dataCompleteness: "medium",
    evidenceSources: ["fixture", "static"],
  };
}

export const highestLevel = (items: RiskDimensionAssessment[]): RiskLevel =>
  levels.find((risk) => items.some((entry) => entry.level === risk)) ?? "low";
