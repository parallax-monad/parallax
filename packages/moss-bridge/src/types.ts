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

export type Sourced<T> = {
  value: T | null;
  source: EvidenceSource;
  blockNumber?: string;
  fetchedAt?: string;
  formula?: string;
  limitation?: string;
  isReplay?: boolean;
};

export type KuruSwapIntent = {
  chainId: string;
  sender: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minimumReceived?: string;
};

export type IntegrationStatus =
  | "OK"
  | "INTEGRATION_ERROR"
  | "UNAVAILABLE"
  | "TIMEOUT";

export type ExecutionStatus = "SUCCESS" | "NO_ROUTE" | "REVERTED" | "UNKNOWN";

export type SimulationCoverage = {
  expectedTransactions: number;
  observedResults: number;
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
};

export type NormalizedKuruEvidence = {
  protocol: "kuru";
  intent: KuruSwapIntent;
  integrationStatus: IntegrationStatus;
  executionStatus: ExecutionStatus;
  quote: Sourced<JsonValue>;
  action: Sourced<JsonValue>;
  receipt: Sourced<JsonValue>;
  outcome: Sourced<JsonValue>;
  assetChanges: Sourced<JsonValue[]>;
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
};

export type RawKuruEvidence = {
  discover: JsonValue | null;
  load: JsonValue | null;
  quote: JsonValue | null;
  action: JsonValue | null;
  simulation: JsonValue | null;
  errors?: Record<string, JsonValue>;
};
