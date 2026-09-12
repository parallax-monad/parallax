import type { CheckSwapResult } from "@/lib/analyze/types";

/**
 * Sample data showcasing all new Arbitrum P0 Economic Diagnosis UI components
 * This demonstrates Quote Fidelity, Remediation Options, and Execution Economics
 */
export const arbitrumSampleSuccess: CheckSwapResult = {
  runId: "sample-arbitrum-success-001",
  systemStatus: "OK",
  verdict: "ADJUST",
  summary: {
    en: "Your quote has changed. Multiple verified options are available.",
    zh: "你的报价已改变。有多个经过验证的选项可用。",
  },
  intent: {
    tokenIn: "USDC",
    tokenOut: "ETH",
    amountIn: "10000",
  },
  quote: {
    expectedOutput: "4.812",
    route: { en: "Camelot V3", zh: "Camelot V3" },
    blockNumber: "92820000",
  },
  simulatedOutput: "4.746",
  minimumReceivedSource: "user_declared",
  
  // NEW: Quote Fidelity - showing the quote changed
  quoteFidelity: {
    selectedQuote: "4.812",
    currentSimulation: "4.746",
    difference: "-0.066",
    relativeDelta: "-1.37%",
    observation: {
      en: "You selected 4.812 ETH, but the current simulation estimates 4.746 ETH.",
      zh: "你选择了 4.812 ETH，但当前模拟估算为 4.746 ETH。",
    },
    primaryCause: {
      en: "Market conditions changed after your quote. The pool state moved and this trade now has greater price impact.",
      zh: "报价后市场条件发生变化。池状态已移动，此交易现在具有更大的价格影响。",
    },
    contributingFactors: [
      {
        en: "Pool liquidity decreased due to recent large trades",
        zh: "由于最近的大额交易，池流动性下降",
      },
      {
        en: "Your trade size relative to available liquidity increased",
        zh: "你的交易规模相对于可用流动性增加",
      },
    ],
  },

  // NEW: Multiple Remediation Options - not guessing user intent
  remediationOptions: [
    {
      id: "preserve-input",
      objective: {
        en: "Keep spending 10,000 USDC",
        zh: "继续支付 10,000 USDC",
      },
      candidateAdjustment: {
        en: "Keep amount and accept fresh quote",
        zh: "保持金额并接受最新报价",
      },
      quantification: {
        variable: "amountOut",
        before: "4.812",
        after: "4.746",
        unit: "ETH",
      },
      predictedOutcome: {
        en: "You will receive approximately 4.746 ETH under current market conditions",
        zh: "在当前市场条件下，你将收到约 4.746 ETH",
      },
      tradeOff: {
        en: "You receive less ETH than originally quoted, but spend the same amount",
        zh: "你收到的 ETH 比原始报价少，但花费相同金额",
      },
      verificationStatus: "VERIFIED",
      evidenceRefs: ["evidence-sim-001"],
      swapIntent: { amountIn: "10000", tokenIn: "USDC", tokenOut: "ETH" },
    },
    {
      id: "preserve-rate",
      objective: {
        en: "Preserve a similar effective rate",
        zh: "保持相似的有效汇率",
      },
      candidateAdjustment: {
        en: "Reduce amount to lower price impact",
        zh: "减少金额以降低价格影响",
      },
      quantification: {
        variable: "amountIn",
        before: "10,000",
        after: "7,200",
        unit: "USDC",
      },
      predictedOutcome: {
        en: "Price impact reduces from 1.08% to 0.64%, rate closer to baseline",
        zh: "价格影响从 1.08% 降至 0.64%，汇率更接近基准",
      },
      tradeOff: {
        en: "You trade less total USDC, but get a better rate per unit",
        zh: "你交易的 USDC 总额较少，但单位汇率更好",
      },
      verificationStatus: "VERIFIED",
      evidenceRefs: ["evidence-sim-002"],
      swapIntent: { amountIn: "7200", tokenIn: "USDC", tokenOut: "ETH" },
    },
    {
      id: "preserve-output",
      objective: {
        en: "Still receive approximately 4.812 ETH",
        zh: "仍然接收约 4.812 ETH",
      },
      candidateAdjustment: {
        en: "Increase input to reach target output",
        zh: "增加输入以达到目标输出",
      },
      quantification: {
        variable: "amountIn",
        before: "10,000",
        after: "10,140",
        unit: "USDC",
      },
      predictedOutcome: {
        en: "You will receive approximately 4.812 ETH with increased input",
        zh: "增加输入后，你将收到约 4.812 ETH",
      },
      tradeOff: {
        en: "You pay more USDC to receive the same ETH amount",
        zh: "你支付更多 USDC 以接收相同的 ETH 金额",
      },
      verificationStatus: "VERIFIED",
      evidenceRefs: ["evidence-sim-003"],
      swapIntent: { amountIn: "10140", tokenIn: "USDC", tokenOut: "ETH" },
    },
    {
      id: "wait-condition",
      objective: {
        en: "Wait for the previous economics",
        zh: "等待之前的经济条件",
      },
      candidateAdjustment: {
        en: "Re-check when quote reaches approximately 4.812 ETH or better",
        zh: "当报价达到约 4.812 ETH 或更好时重新检查",
      },
      quantification: {
        variable: "targetQuote",
        before: "4.746",
        after: "≥4.812",
        unit: "ETH",
      },
      predictedOutcome: {
        en: "Wait until market conditions improve to match your original quote",
        zh: "等待市场条件改善以匹配你的原始报价",
      },
      tradeOff: {
        en: "Requires waiting and market conditions may not improve",
        zh: "需要等待，市场条件可能不会改善",
      },
      verificationStatus: "CONDITIONAL",
      evidenceRefs: [],
    },
    {
      id: "alternative-path",
      objective: {
        en: "Use a bounded verified alternative",
        zh: "使用已验证的替代路径",
      },
      candidateAdjustment: {
        en: "Try alternative routing path",
        zh: "尝试替代路由路径",
      },
      quantification: {
        variable: "route",
        before: "Path A",
        after: "Path B",
        unit: "",
      },
      predictedOutcome: {
        en: "Alternative path currently estimates 4.785 ETH",
        zh: "替代路径当前估算为 4.785 ETH",
      },
      tradeOff: {
        en: "Better output but may have different fee structure",
        zh: "更好的输出，但可能有不同的费用结构",
      },
      verificationStatus: "VERIFIED",
      evidenceRefs: ["evidence-route-alt"],
      swapIntent: { amountIn: "10000", tokenIn: "USDC", tokenOut: "ETH" },
    },
  ],

  // NEW: Execution Economics Decomposition
  executionEconomics: {
    referencePrice: "0.0004812 ETH/USDC",
    quotedExecutionPrice: "0.0004746 ETH/USDC",
    effectiveRate: "0.0004746 ETH/USDC",
    priceImpact: "1.08%",
    usableLiquidity: "High (over $500K)",
    protocolFee: "0.30%",
    commission: "0 (no commission)",
    gasEstimate: "~0.002 ETH ($4.50)",
    routeInfo: {
      en: "Direct swap via Camelot V3 concentrated liquidity pool",
      zh: "通过 Camelot V3 集中流动性池直接兑换",
    },
    allInCost: "0.64% total (fees + impact)",
  },

  recommendedActions: [
    {
      field: "amountIn",
      category: "TRANSACTION_CONDITION",
      relevance: "RELEVANT",
      recommendable: true,
      reasonCode: "AMOUNT_ADJUSTMENT_VERIFIED",
      reason: {
        en: "Multiple verified amount adjustments available - see options above",
        zh: "有多个经过验证的金额调整可用 - 请查看上方选项",
      },
      proposedChange: {
        before: "10000",
        after: "7200 or 10140",
        unit: "USDC",
      },
    },
  ],

  irrelevantActions: [
    {
      field: "slippage",
      category: "TRANSACTION_CONDITION",
      relevance: "IRRELEVANT",
      recommendable: false,
      reasonCode: "SLIPPAGE_DOES_NOT_IMPROVE",
      reason: {
        en: "Increasing slippage tolerance does not improve execution economics - it only allows a worse result",
        zh: "增加滑点容忍度不会改善执行经济学 - 它只允许更差的结果",
      },
    },
    {
      field: "minimumReceived",
      category: "ACCEPTANCE_BOUNDARY",
      relevance: "IRRELEVANT",
      recommendable: false,
      reasonCode: "BOUNDARY_CHANGE_NOT_IMPROVEMENT",
      reason: {
        en: "Lowering Minimum Received is an acceptance boundary change, not a transaction improvement",
        zh: "降低最低接收量是接受边界的变化，不是交易改进",
      },
    },
  ],

  checked: [
    { en: "Execution viability", zh: "执行可行性" },
    { en: "Quote fidelity", zh: "报价保真度" },
    { en: "Price impact estimation", zh: "价格影响估算" },
    { en: "Liquidity availability", zh: "流动性可用性" },
    { en: "Route quality", zh: "路径质量" },
  ],

  notChecked: [
    { en: "Complete protocol security audit", zh: "完整的协议安全审计" },
    { en: "Token contract analysis", zh: "代币合约分析" },
    { en: "Future market changes", zh: "未来市场变化" },
  ],

  unknowns: [],

  evidence: [],
  ruleResults: [],

  createdAt: new Date().toISOString(),
  ruleVersion: "0.2.0",
  mossVersion: "0.1.0",
  productRunMode: "LIVE",
  replayMode: false,
  simulatorPinnedBlock: "92820000",
  rawResponse: {},
};
