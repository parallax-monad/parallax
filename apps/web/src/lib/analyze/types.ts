import type { Copy } from "@/lib/i18n";

export type BoundarySource =
  | "original_swap"
  | "user_declared"
  | "demo_preset"
  | "unavailable";

export type Protocol = "kuru" | "pancake";

export type SystemStatus = "OK" | "INTEGRATION_ERROR";

/**
 * How the product presented this run, which is deliberately not the same axis as
 * evidence provenance.
 *
 * `DEMO` means the result was produced by local demo logic: it may be shown as a
 * preset, but it must never claim recorded or live provenance. `RECORDED_REPLAY`
 * is only valid when an actual recorded fixture was loaded and its real verdict
 * and provenance are preserved end to end. A single result carries exactly one
 * of these, so demo and recorded semantics can never be mixed.
 */
export type ProductRunMode = "DEMO" | "RECORDED_REPLAY";

export type Verdict = "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";

export type AdjustableField =
  | "amountIn"
  | "tokenPair"
  | "protocol"
  | "slippage"
  | "minimumReceived";

/**
 * Prose the user reads is paired copy, not a bare string. The decision layer
 * builds both languages at generation time, so interpolated numbers stay inline
 * and the UI never has to re-derive a reason it did not compute.
 */
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
  /** BigInt-derived values cross the API as strings. */
  amountIn: string;
  minimumReceived?: string;
  minimumReceivedSource?: BoundarySource;
  slippage?: string;
};

/**
 * Where a single piece of evidence actually came from. Provenance only: it never
 * encodes how the product framed the run. `replay` is reserved for data read out
 * of a recorded fixture, so locally computed demo data must use `mock` rather
 * than borrowing recorded credibility.
 */
export type EvidenceOrigin = "live" | "replay" | "derived" | "mock";

export type EvidenceItem = {
  id: string;
  stage: "discover" | "load" | "action" | "simulate" | "rpc";
  label: Copy;
  /** Raw data (routes, amounts, status codes), so it stays language-neutral. */
  value: string;
  /** Replay, derived, and mock data must never look like a live call. */
  origin: EvidenceOrigin;
  blockNumber?: string;
};

export type RuleResult = {
  id: string;
  group: "execution" | "economicBoundary" | "evidenceCompleteness";
  label: Copy;
  outcome: "PASS" | "FAIL" | "SKIPPED" | "UNKNOWN";
  detail: Copy;
};

export type UnknownItem = { id: string; label: Copy; reason: Copy };

/** Echoed back so result cards can draw the pair without re-reading the form. */
export type IntentSummary = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
};

/**
 * Values are paired copy too. Most rows carry language-neutral data (a verdict
 * code, a number), but the route row is prose, and a reader in Chinese must not
 * be shown the English route.
 */
export type RunDiff = {
  field: Copy;
  previous: Copy;
  next: Copy;
  direction: "improved" | "worsened" | "changed";
}[];

type ResultRunMode =
  | { productRunMode: "DEMO"; replayMode: false }
  | { productRunMode: "RECORDED_REPLAY"; replayMode: true };

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
} & ResultRunMode;
