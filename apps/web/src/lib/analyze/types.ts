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
  | { status: "available"; quote: QuotePreview }
  | { status: "unavailable"; reason: "NO_ROUTE" | "QUOTE_UNAVAILABLE" }
  | { status: "error"; apiFailure: ApiFailure };

/** Trusted decimals provenance as published by the Backend account state. */
export type TrustedDecimalsSource = "chain_config" | "onchain_verified";

/**
 * One side of the checked account state. Only normalized public fields are kept:
 * never a Provider or RPC payload. `decimals` is undefined when the Backend did
 * not publish a trusted value, so callers must not guess one.
 */
export type AccountTokenBalance = {
  status: "AVAILABLE" | "UNAVAILABLE";
  symbol?: string;
  decimals?: number;
  decimalsSource?: TrustedDecimalsSource;
  amountAtomic?: string;
  reason?: string;
};

export type AllowanceSpender =
  | { status: "QUALIFIED"; address: string; qualificationRef: string }
  | { status: "UNAVAILABLE"; reason: string }
  | { status: "NOT_APPLICABLE" };

export type AccountAllowance =
  | {
      status: "SUFFICIENT" | "INSUFFICIENT";
      allowanceAtomic: string;
      requiredAmountAtomic: string;
      spender: AllowanceSpender;
      blockNumber?: string;
    }
  | {
      status: "UNAVAILABLE";
      reason: string;
      requiredAmountAtomic?: string;
      spender?: AllowanceSpender;
      blockNumber?: string;
    }
  | { status: "NOT_APPLICABLE"; reason: "NATIVE_INPUT" };

export type AccountBlockBinding =
  | {
      status: "VERIFIED";
      chainId: number;
      blockNumber: string;
      blockHash: string;
      observedAt: string;
    }
  | {
      status: "STALE";
      chainId: number;
      blockNumber: string;
      blockHash: string;
      observedAt: string;
      reason: string;
    }
  | {
      status: "UNAVAILABLE";
      chainId?: number;
      blockNumber?: string;
      blockHash?: string;
      observedAt?: string;
      reason?: string;
    };

/**
 * Provider-neutral read of `POST /api/account-state` for one checked intent.
 * Deliberately separate from `CheckSwapResult` so the shared Check contract is
 * not widened.
 */
export type AccountStateView = {
  /** Top-level snapshot status. */
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  /** Trusted decimals per published symbol; a missing symbol means unknown. */
  decimalsBySymbol: Record<string, number>;
  inputToken: AccountTokenBalance;
  outputToken: AccountTokenBalance;
  allowance: AccountAllowance;
  block: AccountBlockBinding;
};

/** Why a trusted account state is not available. Never a provider detail. */
export type AccountStateUnavailableReason =
  | "REQUEST_FAILED"
  | "INVALID_RESPONSE"
  | "SNAPSHOT_UNAVAILABLE";

/** Lifecycle the UI holds for the optional account-state read. */
export type AccountStateState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "available"; view: AccountStateView }
  | { status: "unavailable"; reason: AccountStateUnavailableReason };

export type EvidenceOrigin = "live" | "replay" | "derived" | "mock";
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
  value: string;
  origin: EvidenceOrigin;
  blockNumber?: string;
  runtimeVersion?: string;
  runtimeRevision?: string;
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

/** Display-only, provider-neutral coverage. No provider payload is retained. */
export type EvidenceCoverage = {
  sourceId: string;
  source: Copy;
  role: "primary" | "supplementary";
  mode: ProductRunMode | "MOCK";
  status?: "success" | "partial" | "unknown" | "unavailable" | "invalid";
  blockNumber?: string;
  observedAt?: string;
  checked: Copy[];
  notChecked: Copy[];
  unknown: UnknownItem[];
  unavailable: UnknownItem[];
};
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
  unknowns: UnknownItem[];
  evidenceCoverage?: EvidenceCoverage[];
  evidenceCoverageNotice?: Copy;
  intent: IntentSummary;
  diff?: RunDiff;
  quote: { expectedOutput: string; route: Copy; blockNumber: string };
  simulatedOutput: string;
  minimumReceivedSource: BoundarySource;
  createdAt: string;
  ruleVersion: string;
  mossVersion: string;
  productRunMode: ProductRunMode;
  /** Frontend-only preset marker; never inferred from a Backend Run. */
  presentationOrigin?: "sample";
  replayMode: boolean;
  simulatorPinnedBlock?: string;
  apiFailure?: ApiFailure;
  /** Only the normalized fields needed for saved-Run recovery are retained. */
  backendRunId?: string;
  recoveryInput?: { protocol: Protocol; minimumReceived: string };
  quoteFidelity?: QuoteFidelity;
  remediationOptions?: RemediationOption[];
  executionEconomics?: ExecutionEconomics;
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
