import type { Copy } from "@/lib/i18n";

export type BoundarySource =
  | "original_swap"
  | "user_declared"
  | "demo_preset"
  | "unavailable";

export type Protocol = "kuru" | "pancake" | "camelot-v3";
export type SystemStatus = "OK" | "INTEGRATION_ERROR";
export type ProductRunMode = "LIVE" | "RECORDED_REPLAY";
export type Verdict = "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";

export type AdjustableField =
  | "amountIn"
  | "tokenPair"
  | "protocol"
  | "slippage"
  | "minimumReceived";

export type ActionSuggestion = {
  field: AdjustableField;
  category: "TRANSACTION_CONDITION" | "ACCEPTANCE_BOUNDARY";
  relevance: "RELEVANT" | "IRRELEVANT" | "UNKNOWN";
  recommendable: boolean;
  reasonCode?: string;
  reason: Copy;
  proposedChange?: { before: string; after: string; unit: string };
};

export type CheckSwapInput = {
  parentRunId?: string;
  sender?: string;
  chainId?: number;
  protocol: Protocol;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minimumReceived?: string;
  minimumReceivedSource?: BoundarySource;
  slippage?: string;
  expectationBaseline?: {
    chainId: number;
    protocol: Protocol;
    tokenIn: { kind: "native" } | { kind: "erc20"; address: string };
    tokenOut: { kind: "native" } | { kind: "erc20"; address: string };
    amountIn: string;
    quote: QuotePreview;
  };
};

/** `/api/quote` accepts the exact-input pair only, without boundary or rerun fields. */
export type QuoteSwapInput = {
  sender?: string;
  protocol: Protocol;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
};

export type QuotePreview = {
  source: "quote";
  estimatedAmountOut: string;
  minimumAmountOut?: string;
  blockNumber: string;
  fetchedAt?: string;
  runtimeVersion: string;
  runtimeRevision: string;
};

export type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "available";
      quote: QuotePreview;
      requestIdentity: {
        protocol: Protocol;
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
      };
      tokenMetadata?: TokenMetadataPair;
    }
  | {
      status: "unavailable";
      reason: "NO_ROUTE" | "QUOTE_UNAVAILABLE";
      tokenMetadata?: TokenMetadataPair;
    }
  | { status: "error"; apiFailure: ApiFailure };

export type EvidenceStatus = "checked" | "unknown" | "unavailable";
export type EvidenceSource =
  | "native_rpc"
  | "trace_rpc"
  | "account_allowance"
  | "explorer"
  | "quote"
  | "simulation"
  | "unknown";
export type EvidencePresentationMode = "LIVE" | "RECORDED_REPLAY" | "MOCK";
export type EvidenceBlockContext = {
  blockNumber: string;
  blockHash?: string;
  status: "observed" | "requested";
};
export type EvidenceCapabilityStatus =
  | "checked"
  | "not_checked"
  | "unknown"
  | "unavailable";
export type EvidenceCapabilityPresentation = {
  key: string;
  summary: string;
  stage: "SIMULATE";
  status: EvidenceCapabilityStatus;
  sourceCategory: EvidenceSource;
  observedAt?: string;
  reason?: string;
  mode?: EvidencePresentationMode;
  blockContext?: EvidenceBlockContext;
};
export type EvidencePresentation = {
  version: 1;
  items: Array<{
    evidenceKey: string;
    status: EvidenceStatus;
    sourceCategory: EvidenceSource;
    observedAt?: string;
    reason?: string;
    mode?: EvidencePresentationMode;
  }>;
  capabilities: EvidenceCapabilityPresentation[];
};
export type EvidenceOrigin = "live" | "replay" | "derived" | "mock";
export type EvidenceCapability = {
  id: string;
  status: EvidenceCapabilityStatus;
  reason?: string;
};
export type EvidenceItem = {
  id: string;
  stage:
    | "discover"
    | "load"
    | "quote"
    | "action"
    | "simulate"
    | "rpc"
    | "unknown";
  label: Copy;
  value?: string;
  origin: EvidenceOrigin;
  status: EvidenceStatus;
  source: EvidenceSource;
  observedAt?: string;
  mode?: EvidencePresentationMode;
  blockNumber?: string;
  runtimeVersion?: string;
  runtimeRevision?: string;
  capabilities?: EvidenceCapability[];
  reason?: Copy;
  fixtureId?: string;
  reproducibility?: string;
  isMock?: boolean;
};

export type RuleResult = {
  id: string;
  group: "execution" | "economicBoundary" | "evidenceCompleteness";
  label: Copy;
  outcome: "PASS" | "FAIL" | "SKIPPED" | "UNKNOWN";
  detail: Copy;
};

export type UnknownItem = { id: string; label: Copy; reason: Copy };
export type IntentSummary = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
};

export type RunDiff = {
  field: Copy;
  previous: Copy;
  next: Copy;
  direction: "improved" | "worsened" | "changed";
}[];

/** Field-level rejections the backend reports alongside a failure code. */
export type ApiFailureIssue = {
  code?: string;
  field?: string;
  message?: string;
};

export type ApiFailure = {
  httpStatus?: number;
  code: string;
  reason?: string;
  stage?: string;
  retryable: boolean;
  message?: string;
  issues?: ApiFailureIssue[];
};

export type RunRecovery =
  | { kind: "terminal"; result: CheckSwapResult }
  | { kind: "started"; runId: string }
  | { kind: "error"; failure: ApiFailure };

export type BasicSimulation = {
  call: {
    status: string;
    blockNumber?: string;
    blockHash?: string;
    returnDataFingerprint?: string;
  };
  gasEstimate: { status: string; value?: string; gasUnits?: string };
  blockNumber?: string;
  blockHash?: string;
  observedAt?: string;
};

export type TokenMetadata = {
  chainId: number;
  asset: { kind: "native" } | { kind: "erc20"; address: string };
  symbol: string;
  decimals: number;
  decimalsSource: string;
  verifiedAtBlock?: string;
};

/** Backend-owned display metadata for the exact input and output assets. */
export type TokenMetadataPair = {
  tokenIn: TokenMetadata;
  tokenOut: TokenMetadata;
};

/**
 * Read-only P0 configuration. AVAILABLE means the configured route and
 * registry metadata resolved; it is not a live quote, RPC, or Product pass.
 */
export type P0ConfigState =
  | {
      status: "AVAILABLE";
      chainId: 421614;
      protocol: "camelot-v3";
      tokenMetadata: TokenMetadataPair;
    }
  | {
      status: "UNAVAILABLE";
      reason: "ROUTE_NOT_CONFIGURED" | "TOKEN_METADATA_UNAVAILABLE";
    }
  | { status: "error"; apiFailure: ApiFailure };

export type ProviderCapabilitySummary = {
  id: string;
  summary: string;
  stage: "SIMULATE";
  status: EvidenceCapabilityStatus;
  sourceCategory: EvidenceSource;
  observedAt?: string;
  reason?: string;
  mode?: EvidencePresentationMode;
  blockContext?: EvidenceBlockContext;
};

export type ProviderEvidenceSummary = {
  status: string;
  source?: string;
  observedAt?: string;
  blockNumber?: string;
  blockHash?: string;
  checkedScope?: string[];
  unknownScope?: string[];
  unavailableScope?: string[];
  capabilities?: ProviderCapabilitySummary[];
};

export type ExecutionEvidenceSummary = {
  status: string;
};

export type ExpectationBaselineSummary = {
  quoteId?: string;
  amountOutAtomic?: string;
  source?: string;
  estimatedAmountOut?: string;
  minimumAmountOut?: string;
  blockNumber?: string;
  observedAt?: string;
  provenance?: string;
  fetchedAt?: string;
};

export type CheckSwapResult = {
  runId: string;
  parentRunId?: string;
  systemStatus: SystemStatus;
  verdict: Verdict;
  summary: Copy;
  recommendedActions: ActionSuggestion[];
  irrelevantActions: ActionSuggestion[];
  checked: Copy[];
  notChecked: Copy[];
  evidence: EvidenceItem[];
  ruleResults: RuleResult[];
  capabilities?: EvidenceCapabilityPresentation[];
  unknowns: UnknownItem[];
  unavailable?: Copy[];
  intent: IntentSummary;
  diff?: RunDiff;
  quote: { expectedOutput: string; route: Copy; blockNumber: string };
  simulatedOutput: string;
  minimumReceivedSource: BoundarySource;
  createdAt: string;
  ruleVersion: string;
  mossVersion: string;
  productRunMode: ProductRunMode;
  replayMode: boolean;
  simulatorPinnedBlock?: string;
  apiFailure?: ApiFailure;
  rawResponse: unknown;
  quoteFidelity?: QuoteFidelity;
  remediationOptions?: RemediationOption[];
  executionEconomics?: ExecutionEconomics;
  chainId?: number;
  protocol?: string;
  evidenceState?: string;
  basicSimulation?: BasicSimulation;
  tokenMetadata?: TokenMetadataPair;
  providerEvidence?: ProviderEvidenceSummary;
  executionEvidence?: ExecutionEvidenceSummary;
  remediationStatus?: string;
  expectationBaseline?: ExpectationBaselineSummary;
};

/** Optional swap-form patch when a user chooses this option. */
export type RemediationSwapIntent = {
  amountIn: string;
  tokenIn?: string;
  tokenOut?: string;
};

/** Enhanced remediation option with quantification per P0 Economic spec */
export type RemediationOption = {
  id: string;
  objective: Copy;
  candidateAdjustment: Copy;
  quantification: {
    variable: string;
    before: string;
    after: string;
    unit: string;
  };
  predictedOutcome: Copy;
  tradeOff?: Copy;
  verificationStatus: "VERIFIED" | "UNVERIFIED" | "CONDITIONAL";
  evidenceRefs?: string[];
  swapIntent?: RemediationSwapIntent;
};

/** Quote fidelity comparison when selected quote differs from current simulation */
export type QuoteFidelity = {
  selectedQuote: string;
  currentSimulation: string;
  difference: string;
  relativeDelta: string;
  observation: Copy;
  primaryCause: Copy;
  contributingFactors?: Copy[];
};

/** Execution economics decomposition */
export type ExecutionEconomics = {
  referencePrice?: string;
  quotedExecutionPrice?: string;
  effectiveRate?: string;
  priceImpact?: string;
  usableLiquidity?: string;
  protocolFee?: string;
  commission?: string;
  gasEstimate?: string;
  routeInfo?: Copy;
  allInCost?: string;
};
