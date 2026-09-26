import type { CheckSwapResult } from "@/lib/analyze/types";

/**
 * Sample data showcasing all P0 verdict paths for testing and demo.
 * Backend API does not support Arbitrum yet; these are frontend-only samples.
 */

/** ADJUST verdict: Quote changed, multiple verified options available */
export { arbitrumSampleSuccess as arbitrumSampleAdjust } from "./arbitrum-sample-data";

/** PROCEED verdict: No blocking evidence, transaction looks viable */
export const arbitrumSampleProceed: CheckSwapResult = {
  runId: "sample-arbitrum-proceed-001",
  systemStatus: "OK",
  verdict: "PROCEED",
  summary: {
    en: "No blocking evidence found. Re-check immediately before signing.",
    zh: "未发现阻塞证据。签名前请立即重新检查。",
  },
  intent: {
    tokenIn: "USDC",
    tokenOut: "ETH",
    amountIn: "100",
  },
  quote: {
    expectedOutput: "0.048",
    route: { en: "Camelot V3", zh: "Camelot V3" },
    blockNumber: "92820100",
  },
  simulatedOutput: "0.048",
  minimumReceivedSource: "unavailable",
  
  executionEconomics: {
    referencePrice: "2083.33",
    quotedExecutionPrice: "2083.33",
    effectiveRate: "2083.33",
    priceImpact: "0.02%",
    protocolFee: "0.3%",
    gasEstimate: "~0.0008 ETH",
    routeInfo: {
      en: "Direct swap through Camelot V3 USDC/ETH pool",
      zh: "通过 Camelot V3 USDC/ETH 池直接兑换",
    },
  },

  recommendedActions: [],
  irrelevantActions: [],

  checked: [
    { en: "Execution viability", zh: "执行可行性" },
    { en: "Quote fidelity", zh: "报价保真度" },
    { en: "Price impact estimation", zh: "价格影响估算" },
    { en: "Route quality", zh: "路径质量" },
  ],

  notChecked: [
    { en: "Complete protocol security audit", zh: "完整的协议安全审计" },
    { en: "Token contract analysis", zh: "代币合约分析" },
  ],

  unknowns: [],
  evidence: [],
  ruleResults: [],

  createdAt: new Date().toISOString(),
  ruleVersion: "0.2.0",
  mossVersion: "0.1.0",
  productRunMode: "LIVE",
  replayMode: false,
  simulatorPinnedBlock: "92820100",
  rawResponse: {},
};

/** STOP verdict: Blocking evidence found, do not proceed */
export const arbitrumSampleStop: CheckSwapResult = {
  runId: "sample-arbitrum-stop-001",
  systemStatus: "OK",
  verdict: "STOP",
  summary: {
    en: "Your simulated output is below your declared minimum. Do not sign this transaction.",
    zh: "你的模拟输出低于声明的最低值。请勿签署此交易。",
  },
  intent: {
    tokenIn: "USDC",
    tokenOut: "ETH",
    amountIn: "50000",
  },
  quote: {
    expectedOutput: "24.00",
    route: { en: "Camelot V3", zh: "Camelot V3" },
    blockNumber: "92820200",
  },
  simulatedOutput: "20.50",
  minimumReceivedSource: "user_declared",

  quoteFidelity: {
    selectedQuote: "24.00",
    currentSimulation: "20.50",
    difference: "-3.50",
    relativeDelta: "-14.58%",
    observation: {
      en: "You selected 24.00 ETH, but the current simulation estimates only 20.50 ETH.",
      zh: "你选择了 24.00 ETH，但当前模拟仅估算为 20.50 ETH。",
    },
    primaryCause: {
      en: "Severe liquidity shortage. This trade size far exceeds available pool depth.",
      zh: "严重流动性不足。此交易规模远超可用池深度。",
    },
  },

  executionEconomics: {
    priceImpact: "14.58%",
    usableLiquidity: "~$80,000",
    routeInfo: {
      en: "Insufficient liquidity for this trade size",
      zh: "此交易规模流动性不足",
    },
  },

  recommendedActions: [
    {
      field: "amountIn",
      category: "TRANSACTION_CONDITION",
      relevance: "RELEVANT",
      recommendable: true,
      reasonCode: "P0-ECONOMIC-BOUNDARY-VIOLATED",
      reason: {
        en: "Reduce trade size to stay within available liquidity",
        zh: "减少交易规模以保持在可用流动性范围内",
      },
      proposedChange: { before: "50000", after: "10000", unit: "USDC" },
    },
  ],

  irrelevantActions: [],

  checked: [
    { en: "Execution viability", zh: "执行可行性" },
    { en: "Quote fidelity", zh: "报价保真度" },
    { en: "Economic boundary", zh: "经济边界" },
  ],

  notChecked: [],
  unknowns: [],
  evidence: [],
  ruleResults: [],

  createdAt: new Date().toISOString(),
  ruleVersion: "0.2.0",
  mossVersion: "0.1.0",
  productRunMode: "LIVE",
  replayMode: false,
  simulatorPinnedBlock: "92820200",
  rawResponse: {},
};

/** UNKNOWN verdict: Missing critical fields, cannot make decision */
export const arbitrumSampleUnknown: CheckSwapResult = {
  runId: "sample-arbitrum-unknown-001",
  systemStatus: "OK",
  verdict: "UNKNOWN",
  summary: {
    en: "Cannot verify this transaction. Critical execution data is unavailable.",
    zh: "无法验证此交易。关键执行数据不可用。",
  },
  intent: {
    tokenIn: "USDC",
    tokenOut: "ETH",
    amountIn: "5000",
  },
  quote: {
    expectedOutput: "unavailable",
    route: { en: "Camelot V3", zh: "Camelot V3" },
    blockNumber: "92820300",
  },
  simulatedOutput: "unavailable",
  minimumReceivedSource: "unavailable",

  recommendedActions: [],
  irrelevantActions: [],

  checked: [],
  notChecked: [
    { en: "Quote fidelity", zh: "报价保真度" },
    { en: "Economic boundary", zh: "经济边界" },
  ],

  unknowns: [
    {
      id: "simulation-output",
      label: { en: "Simulation output", zh: "模拟输出" },
      reason: {
        en: "Simulation engine could not resolve expected output",
        zh: "模拟引擎无法解析预期输出",
      },
    },
    {
      id: "price-impact",
      label: { en: "Price impact", zh: "价格影响" },
      reason: {
        en: "Price impact data unavailable from provider",
        zh: "提供商无法获取价格影响数据",
      },
    },
  ],

  evidence: [],
  ruleResults: [],

  createdAt: new Date().toISOString(),
  ruleVersion: "0.2.0",
  mossVersion: "0.1.0",
  productRunMode: "LIVE",
  replayMode: false,
  simulatorPinnedBlock: "92820300",
  rawResponse: {},
};

/** INTEGRATION_ERROR: System-level failure, not user-actionable */
export const arbitrumSampleIntegrationError: CheckSwapResult = {
  runId: "sample-arbitrum-error-001",
  systemStatus: "INTEGRATION_ERROR",
  verdict: "UNKNOWN",
  summary: {
    en: "System integration error. Parallax cannot complete this check right now.",
    zh: "系统集成错误。Parallax 现在无法完成此检查。",
  },
  intent: {
    tokenIn: "USDC",
    tokenOut: "ETH",
    amountIn: "1000",
  },
  quote: {
    expectedOutput: "unavailable",
    route: { en: "unavailable", zh: "不可用" },
    blockNumber: "unavailable",
  },
  simulatedOutput: "unavailable",
  minimumReceivedSource: "unavailable",

  recommendedActions: [],
  irrelevantActions: [],
  checked: [],
  notChecked: [],
  unknowns: [
    {
      id: "provider-error",
      label: { en: "Evidence provider", zh: "证据提供商" },
      reason: {
        en: "Evidence provider returned an unrecoverable error",
        zh: "证据提供商返回了不可恢复的错误",
      },
    },
  ],

  evidence: [],
  ruleResults: [],

  createdAt: new Date().toISOString(),
  ruleVersion: "0.2.0",
  mossVersion: "0.1.0",
  productRunMode: "LIVE",
  replayMode: false,
  rawResponse: {},
};
