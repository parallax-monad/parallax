export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EvidenceSource =
  | "moss"
  | "rpc"
  | "quote"
  | "external"
  | "derived"
  | "mock"
  | "unknown";

export type EvidenceReproducibility =
  | "REPRODUCIBLE"
  | "NOT_REPRODUCIBLE"
  | "UNKNOWN";

export type Sourced<T> = {
  value: T | null;
  source: EvidenceSource;
  reproducibility: EvidenceReproducibility;
  blockNumber?: string;
  fetchedAt?: string;
  formula?: string;
  limitation?: string;
  isReplay?: boolean;
};

export type BoundarySource =
  | "original_swap"
  | "user_declared"
  | "demo_preset"
  | "unavailable";

export type KuruSwapIntent = {
  chainId: string;
  sender: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minimumReceived?: string;
  minimumReceivedSource?: BoundarySource;
};

export type NormalizedKuruSwapIntent = {
  chainId: string;
  sender: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minimumReceived?: string;
  minimumReceivedSource: BoundarySource;
};

export type IntegrationStatus =
  | "OK"
  | "INTEGRATION_ERROR"
  | "UNAVAILABLE"
  | "TIMEOUT";

export type ExecutionStatus = "SUCCESS" | "NO_ROUTE" | "REVERTED" | "UNKNOWN";

export type AssetChangeAssessment =
  | "EXPLAINED"
  | "UNEXPLAINED"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

export type SimulationCoverage = {
  expectedTransactions: number;
  observedResults: number;
  unmatchedResultIndexes: number[];
  halted: boolean;
  complete: boolean;
  missingTransactionIndexes: number[];
  haltReason?: string;
};

export type NormalizedMossError = {
  stage?: "DISCOVER" | "LOAD" | "QUOTE" | "ACTION" | "SIMULATE";
  code:
    | "NO_ROUTE"
    | "REVERTED"
    | "TIMEOUT"
    | "UNAVAILABLE"
    | "INTEGRATION_ERROR"
    | "UNKNOWN";
  message: string;
  integrationStatus: IntegrationStatus;
  source: "moss" | "rpc" | "quote" | "unknown";
  normalization: "PRESERVED" | "DERIVED";
  /** Whether a retry against the same runtime may resolve the error. */
  retryable?: boolean;
};

export type NormalizedKuruEvidence = {
  protocol: "kuru";
  intent: NormalizedKuruSwapIntent;
  integrationStatus: IntegrationStatus;
  executionStatus: ExecutionStatus;
  quote: Sourced<JsonValue>;
  action: Sourced<JsonValue>;
  receipt: Sourced<JsonValue>;
  outcome: Sourced<JsonValue>;
  assetChanges: Sourced<JsonValue[]>;
  assetChangeAssessment: AssetChangeAssessment;
  warnings: Sourced<JsonValue[]>;
  revertReason: Sourced<string>;
  gas: Sourced<JsonValue>;
  simulationCoverage: Sourced<SimulationCoverage>;
  errors: Sourced<NormalizedMossError[]>;
  blockNumber: Sourced<string>;
  mossVersion: string;
  mossCommit?: string;
  source: EvidenceSource;
  replayMode: boolean;
  approval: Sourced<"REQUIRED" | "NOT_APPLICABLE" | "UNKNOWN">;
  walletAffordabilityChecked: false;
  limitations: string[];
  /**
   * Live-only runtime provenance (absent on recorded fixtures). `runtimeRevision`
   * must be an immutable identity: a Moss git commit or a verifiable package
   * integrity/version identity - never "latest", "main", or "workspace baseline".
   */
  runtimeVersion?: string;
  runtimeRevision?: string;
  fetchedAt?: string;
  isReplay?: boolean;
  isMock?: boolean;
};

export type RawKuruEvidence = {
  discover: JsonValue | null;
  load: JsonValue | null;
  quote: JsonValue | null;
  action: JsonValue | null;
  simulation: JsonValue | null;
  errors?: Record<string, JsonValue>;
};

export type StageName = "DISCOVER" | "LOAD" | "QUOTE" | "ACTION" | "SIMULATE";

/** Exact version identity of every Moss workspace package used by a run. */
export type RuntimeIdentity = {
  runtimeVersion: string;
  runtimeRevision: string;
  packageVersions: Record<string, string>;
};

/** Per-stage execution record with raw output, timing, and block provenance. */
export type StageRecord = {
  stage: StageName;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  error?: NormalizedMossError;
  raw: JsonValue | null;
  runtime: RuntimeIdentity;
  /** Block read for this stage (quote/simulation may pin different blocks). */
  blockNumber?: string;
};

export type LiveKuruAdapterInput = {
  runId: string;
  intent: NormalizedKuruSwapIntent;
  rpcUrl: string;
  /** Exact Moss checkout path containing the built workspace packages. */
  runtimePath: string;
  runtimeVersion: string;
  runtimeRevision: string;
  fetchedAt?: string;
  /**
   * Per-stage deadline in ms (default 30000). Applied with Promise.race; the
   * underlying request may still be terminating after the race resolves.
   */
  stageTimeoutMs?: number;
  /** Whole-chain deadline in ms (default 90000). Must stay below the Vitest testTimeout. */
  overallTimeoutMs?: number;
  /** Structured, redacted stage logging. Defaults to no-op. */
  logger?: (line: string) => void;
};

export type LiveKuruResult = {
  runId: string;
  evidence: NormalizedKuruEvidence;
  raw: RawKuruEvidence;
  stages: StageRecord[];
  runtime: RuntimeIdentity;
};
