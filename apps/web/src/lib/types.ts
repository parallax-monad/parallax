export type SourceKind = "kuru" | "moss" | "onchain" | "static" | "fixture";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type RiskLevel = "low" | "moderate" | "elevated" | "high" | "unknown";
export type RiskDimension = "protocol" | "liquidity" | "transaction" | "simulation";
export type TradeAction = "swap";
export type PolicyTemplate = "standard" | "conservative" | "custom";
export type RuleStatus = "pass" | "warn" | "fail" | "unknown";

export interface Sourced<T> {
  value: T;
  source: SourceKind;
  fetchedAt: string;
  detail?: string;
}

export interface TokenRef {
  address: string;
  symbol: string;
  decimals: number;
}

export interface WalletContextInput {
  tokenBalance: string | null;
  existingAllowance: string | null;
  allowanceIsUnlimited: boolean;
}

export interface RiskPolicy {
  template: PolicyTemplate;
  maxSlippageBps: number;
  maxPriceImpactBps: number;
  failOnSimulationWarning: boolean;
  requireVerifiedContract: boolean;
  unknownEvidenceBehavior: "warn" | "fail";
}

export interface TradeIntent {
  walletAddress: string;
  protocolId: string;
  action: TradeAction;
  tokenIn: TokenRef;
  tokenOut?: TokenRef;
  amountIn: string;
  slippageToleranceBps: number;
  walletContext?: WalletContextInput;
}

export interface TradeRequest {
  walletAddress: string;
  protocolId: string;
  action: TradeAction;
  amountIn: string;
  policy?: RiskPolicy;
  parentRunId?: string | null;
  walletContext?: WalletContextInput;
}

export interface FinalAssessment {
  receiptVersion: "0.1";
  receiptId: string;
  runId: string;
  parentRunId: string | null;
  chainId: number;
  analyzedAt: string;
  preliminary: PreliminaryAssessment;
  simulation: SimulationResult;
  dimensions: RiskDimensionAssessment[];
  findings: RiskFinding[];
  overallRisk: RiskLevel;
  overallStatus: RuleStatus;
  policyRules: PolicyRuleResult[];
  coverage: Coverage;
  quoteVsSimulationDeltaBps: number | null;
  summary: string;
  unverified: string[];
  generatedAt: string;
}

export interface AnalysisRun {
  runId: string;
  parentRunId: string | null;
  createdAt: string;
  intent: Pick<TradeIntent, "action" | "tokenIn" | "tokenOut" | "amountIn">;
  policy: RiskPolicy;
  receipts: FinalAssessment[];
}

export interface RiskDiff {
  parentRunId: string;
  changes: string[];
  quoteChanges: string[];
  riskChanges: string[];
  ruleChanges: string[];
  warningChanges: string[];
  assetChanges: string[];
}

export interface AssetDelta {
  token: string;
  symbol: string;
  amount: string;
  direction: "in" | "out";
}

export interface SimulationWarning {
  code: string;
  severity: Severity;
  message: string;
  raw?: unknown;
}

export interface SimulationReceipt {
  status: "success" | "reverted";
  blockNumber: string | null;
  logsCount: number;
  effectiveGasPriceWei: string | null;
  rawLogs?: unknown[];
}

export interface SimulationResult {
  success: boolean;
  revertReason?: string;
  gasUsed: string;
  gasLimit: string;
  gasPriceWei: string;
  gasCostNative: string;
  gasCostUsd: number | null;
  warnings: SimulationWarning[];
  receipt: SimulationReceipt;
  assetDeltas: AssetDelta[];
  simulatedAt: string;
  simulatorVersion?: string;
}

export interface PolicyRuleResult {
  id: string;
  label: string;
  observed: string;
  threshold: string;
  status: RuleStatus;
  evidence: string;
}

export interface Coverage {
  known: number;
  unknown: number;
  notApplicable: number;
}

export interface RiskFinding {
  id: string;
  severity: Severity;
  dimension: RiskDimension;
  title: string;
  detail: string;
  evidence?: string;
}

export interface RiskDimensionAssessment {
  dimension: RiskDimension;
  label: string;
  level: RiskLevel;
  findings: RiskFinding[];
  summary: string;
}

export interface PreliminaryAssessment {
  intent: TradeIntent;
  policy: RiskPolicy;
  profile: ProtocolProfile;
  quote: QuoteSnapshot;
  dimensions: RiskDimensionAssessment[];
  findings: RiskFinding[];
  liquidityRatioBps: number;
  generatedAt: string;
  marketType: string;
  dataCompleteness: "high" | "medium" | "low";
  evidenceSources: SourceKind[];
}

export interface AnalysisSession {
  id: string;
  runId: string;
  createdAt: string;
  expiresAt: string;
  parentRunId: string | null;
  preliminary: PreliminaryAssessment;
}

export interface ProtocolProfile {
  id: string;
  name: string;
  category: string;
  maturity: "established" | "new";
  contracts: { label: string; address: string }[];
  operations: OperationTemplate[];
  auditCount: number;
  topAuditor: boolean;
  daysLive: number;
  upgradeable: boolean;
  timelockHours: number;
  adminControl: string;
  oracleProvider: string;
  oracleRedundancy: number;
  pastExploitLossUsd: number;
  openSourceVerified: boolean;
  notes?: string;
}

export interface QuoteSnapshot {
  amountOut: Sourced<string>;
  executionPrice: Sourced<number>;
  midPrice: Sourced<number>;
  priceImpactBps: Sourced<number>;
  expectedSlippageBps: Sourced<number>;
  poolLiquidityUsd: Sourced<number>;
  notionalUsd: Sourced<number>;
  route: Sourced<string[]>;
}

export interface OperationTemplate {
  id: string;
  action: TradeAction;
  label: string;
  tokenIn: TokenRef;
  tokenOut?: TokenRef;
  defaultAmount: string;
  slippageToleranceBps: number;
}
