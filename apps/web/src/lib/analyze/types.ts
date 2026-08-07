import type { Copy } from "@/lib/i18n";

export type BoundarySource =
  | "original_swap"
  | "user_declared"
  | "demo_preset"
  | "unavailable";

export type Protocol = "kuru" | "pancake";
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
  reason: Copy;
};

export type CheckSwapInput = {
  parentRunId?: string;
  sender?: string;
  protocol: Protocol;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minimumReceived?: string;
  minimumReceivedSource?: BoundarySource;
  slippage?: string;
};

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

export type ApiFailure = {
  httpStatus?: number;
  code: string;
  reason?: string;
  stage?: string;
  retryable: boolean;
  message?: string;
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
  unknowns: UnknownItem[];
  intent: IntentSummary;
  diff?: RunDiff;
  quote: { expectedOutput: string; route: Copy; blockNumber: string };
  minimumReceivedSource: BoundarySource;
  createdAt: string;
  ruleVersion: string;
  mossVersion: string;
  productRunMode: ProductRunMode;
  replayMode: boolean;
  simulatorPinnedBlock?: string;
  apiFailure?: ApiFailure;
  rawResponse: unknown;
};
