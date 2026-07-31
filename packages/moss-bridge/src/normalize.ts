import { normalizeMossError } from "./errors.js";
import type {
  AssetChangeAssessment,
  BoundarySource,
  EvidenceReproducibility,
  EvidenceSource,
  IntegrationStatus,
  JsonValue,
  KuruSwapIntent,
  NormalizedKuruEvidence,
  NormalizedKuruSwapIntent,
  NormalizedMossError,
  RawKuruEvidence,
  Sourced,
} from "./types.js";

export function normalizeRecordedKuruEvidence(input: {
  intent: KuruSwapIntent;
  raw: RawKuruEvidence;
  blockNumber: string | null;
  mossVersion: string;
  mossCommit?: string;
  integrationStatus?: IntegrationStatus;
  fetchedAt?: string;
}): NormalizedKuruEvidence {
  const errors = normalizedErrors(input.raw.errors);
  const integrationStatus = aggregateIntegrationStatus(
    input.integrationStatus ?? "OK",
    errors,
  );
  const quote = queryData(input.raw.quote);
  const transactions = transactionNodes(input.raw.action);
  const action = transactions.length === 0 ? null : transactions.map(summary);
  const simulation = simulationSummary(input.raw.simulation, transactions);
  const approval = approvalStatus(input.raw.action, input.intent.tokenIn);
  const assetChangeAssessment = assessAssetChanges(simulation.assetChanges);
  const limitations = [
    "Recorded simulation synthetic-prefunds native MON only and does not prove ERC-20 affordability.",
    "No signing, broadcast, custody, or wallet mutation occurred while recording this evidence.",
  ];
  if (simulation.unsupportedReceipt) {
    limitations.push(
      "Kuru receipt evidence is unsupported for FlipOrderUpdated on the recorded Moss baseline.",
    );
  }
  if (simulation.reverted && !simulation.revertReason) {
    limitations.push(
      "Simulation reverted without an attributable wallet-state cause.",
    );
  }
  return {
    protocol: "kuru",
    intent: normalizeIntent(input.intent),
    integrationStatus,
    executionStatus: executionStatus(integrationStatus, errors, simulation),
    quote: sourced(
      quote,
      quote ? "quote" : "unknown",
      input,
      "Quote returned by the recorded Moss query.",
    ),
    action: sourced(action, action ? "moss" : "unknown", input),
    receipt: sourced(
      simulation.receipt,
      simulation.receipt ? "moss" : "unknown",
      input,
    ),
    outcome: sourced(
      simulation.outcome,
      simulation.outcome ? "moss" : "unknown",
      input,
    ),
    assetChanges: sourced(
      simulation.assetChanges,
      input.raw.simulation ? "moss" : "unknown",
      input,
    ),
    assetChangeAssessment,
    warnings: sourced(
      simulation.warnings,
      input.raw.simulation ? "moss" : "unknown",
      input,
    ),
    revertReason: sourced(
      simulation.revertReason,
      simulation.revertReason ? "moss" : "unknown",
      input,
    ),
    gas: sourced(
      simulation.gas,
      input.raw.simulation ? "moss" : "unknown",
      input,
    ),
    simulationCoverage: sourced(
      simulation.coverage,
      input.raw.action ? "derived" : "unknown",
      input,
      "Expected transactions are derived from the action capability tree; observed results are derived from the simulator result list.",
    ),
    errors: sourced(
      errors,
      input.raw.errors ? "moss" : "unknown",
      input,
      "Structured errors are normalized from recorded stage errors.",
    ),
    blockNumber: sourced(
      input.blockNumber,
      input.blockNumber ? "rpc" : "unknown",
      input,
    ),
    mossVersion: input.mossVersion,
    ...(input.mossCommit ? { mossCommit: input.mossCommit } : {}),
    source: "moss",
    replayMode: false,
    approval: sourced(
      approval,
      action ? "derived" : "unknown",
      input,
      approvalFormula(approval),
    ),
    walletAffordabilityChecked: false,
    limitations,
  };
}

export function replayKuruEvidence(
  evidence: NormalizedKuruEvidence,
): NormalizedKuruEvidence {
  const replay = structuredClone(evidence);
  for (const field of sourcedFields(replay)) field.isReplay = true;
  replay.replayMode = true;
  return replay;
}

function sourced<T>(
  value: T | null,
  source: EvidenceSource,
  input: {
    blockNumber: string | null;
    fetchedAt?: string;
    mossCommit?: string;
  },
  formula?: string,
): Sourced<T> {
  return {
    value,
    source,
    reproducibility: reproducibilityOf(source, input),
    ...(input.blockNumber ? { blockNumber: input.blockNumber } : {}),
    ...(input.fetchedAt ? { fetchedAt: input.fetchedAt } : {}),
    ...(formula ? { formula } : {}),
    ...(value === null
      ? { limitation: "No corresponding recorded evidence is available." }
      : {}),
  };
}

function reproducibilityOf(
  source: EvidenceSource,
  input: {
    blockNumber: string | null;
    fetchedAt?: string;
    mossCommit?: string;
  },
): EvidenceReproducibility {
  if (source === "mock") return "NOT_REPRODUCIBLE";
  if (source === "unknown") return "UNKNOWN";
  if (input.blockNumber && input.mossCommit) return "REPRODUCIBLE";
  if (input.blockNumber || input.fetchedAt) return "UNKNOWN";
  return "NOT_REPRODUCIBLE";
}

function queryData(value: JsonValue | null): JsonValue | null {
  if (!record(value)) return null;
  return record(value.data) ? value.data : null;
}

function assessAssetChanges(changes: JsonValue[]): AssetChangeAssessment {
  if (changes.length === 0) return "NOT_APPLICABLE";
  // P0: a full asset-change predicate is not yet available. Any non-empty
  // recorded change set is treated as unknown until it can be explicitly
  // explained against the expected swap intent.
  return "UNKNOWN";
}

function approvalStatus(
  value: JsonValue | null,
  tokenIn: string,
): "REQUIRED" | "NOT_APPLICABLE" | "UNKNOWN" {
  if (!record(value)) return "UNKNOWN";
  if (tokenIn === "MON" || tokenIn === "native") return "NOT_APPLICABLE";
  return capabilityNodes(value).some(
    (node) => node.protocol === "erc20" && node.method === "approve",
  )
    ? "REQUIRED"
    : "UNKNOWN";
}

function simulationSummary(
  value: JsonValue | null,
  transactions: TransactionNode[],
): {
  receipt: JsonValue | null;
  outcome: JsonValue | null;
  assetChanges: JsonValue[];
  warnings: JsonValue[];
  revertReason: string | null;
  gas: JsonValue;
  reverted: boolean;
  unsupportedReceipt: boolean;
  coverage: import("./types.js").SimulationCoverage;
} {
  if (!record(value) || !Array.isArray(value.results)) {
    return {
      receipt: null,
      outcome: null,
      assetChanges: [],
      warnings: [],
      revertReason: null,
      gas: [],
      reverted: false,
      unsupportedReceipt: false,
      coverage: coverageSummary(transactions, [], false, undefined),
    };
  }
  const results = value.results.filter(record);
  const halted = value.halted !== undefined && value.halted !== false;
  const haltReason = haltReasonOf(value.halted);
  const warnings = results.flatMap((result) =>
    Array.isArray(result.warnings) ? result.warnings : [],
  );
  const receipt =
    [...results].reverse().find((result) => record(result.receipt))?.receipt ??
    null;
  const outcome =
    record(receipt) && receipt.outcome !== undefined ? receipt.outcome : null;
  const assetChanges = results.flatMap((result) =>
    Array.isArray(result.changes) ? result.changes : [],
  );
  const coverage = coverageSummary(transactions, results, halted, haltReason);
  const reverted = results.some(
    (result) =>
      result.reverted === true &&
      transactions.some((transaction) =>
        resultMatchesTransaction(result, transaction),
      ),
  );
  const revertReason = results.find(
    (result) => typeof result.revertReason === "string",
  )?.revertReason;
  const unsupportedReceipt = warnings.some((warning) =>
    JSON.stringify(warning).includes("FlipOrderUpdated"),
  );
  return {
    receipt,
    outcome,
    assetChanges,
    warnings,
    revertReason: typeof revertReason === "string" ? revertReason : null,
    gas: results.map((result) => result.gas ?? null),
    reverted,
    unsupportedReceipt,
    coverage,
  };
}

function executionStatus(
  integrationStatus: IntegrationStatus,
  errors: import("./types.js").NormalizedMossError[],
  simulation: ReturnType<typeof simulationSummary>,
): NormalizedKuruEvidence["executionStatus"] {
  if (integrationStatus !== "OK") return "UNKNOWN";
  if (errors.some((error) => error.code === "NO_ROUTE")) return "NO_ROUTE";
  if (!simulation.coverage.complete) return "UNKNOWN";
  if (simulation.reverted) return "REVERTED";
  if (simulation.unsupportedReceipt || simulation.receipt === null)
    return "UNKNOWN";
  return "SUCCESS";
}

function capabilityNodes(
  value: JsonValue,
): Array<{ protocol: string; method: string }> {
  if (!record(value)) return [];
  const own =
    typeof value.protocol === "string" && typeof value.method === "string"
      ? [{ protocol: value.protocol, method: value.method }]
      : [];
  const children = Array.isArray(value.children)
    ? value.children.flatMap(capabilityNodes)
    : [];
  return [...own, ...children];
}

type TransactionNode = {
  protocol: string;
  method: string;
  sender: string | null;
  target: string | null;
  nativeValue: string | null;
  calldataBytes: number | null;
  transaction: Record<string, JsonValue>;
};

function transactionNodes(
  value: JsonValue | null,
  parent: Pick<TransactionNode, "protocol" | "method"> = {
    protocol: "unknown",
    method: "unknown",
  },
): TransactionNode[] {
  if (!record(value)) return [];
  const protocol =
    typeof value.protocol === "string" ? value.protocol : parent.protocol;
  const method =
    typeof value.method === "string" ? value.method : parent.method;
  const transaction = record(value.transaction) ? value.transaction : null;
  const own = transaction
    ? [
        {
          protocol,
          method,
          sender:
            typeof transaction.from === "string" ? transaction.from : null,
          target: typeof transaction.to === "string" ? transaction.to : null,
          nativeValue:
            typeof transaction.value === "string" ? transaction.value : null,
          calldataBytes:
            typeof transaction.data === "string"
              ? Math.max(0, (transaction.data.length - 2) / 2)
              : null,
          transaction,
        },
      ]
    : [];
  const children = Array.isArray(value.children)
    ? value.children.flatMap((child) =>
        transactionNodes(child, { protocol, method }),
      )
    : [];
  return [...own, ...children];
}

function summary(transaction: TransactionNode): JsonValue {
  return {
    protocol: transaction.protocol,
    method: transaction.method,
    sender: transaction.sender,
    target: transaction.target,
    nativeValue: transaction.nativeValue,
    calldataBytes: transaction.calldataBytes,
  };
}

function coverageSummary(
  transactions: TransactionNode[],
  results: Record<string, JsonValue>[],
  halted: boolean,
  haltReason: string | undefined,
): import("./types.js").SimulationCoverage {
  const usedResultIndexes = new Set<number>();
  const missingTransactionIndexes: number[] = [];

  for (let index = 0; index < transactions.length; index++) {
    const transaction = transactions[index];
    const matchIndex = results.findIndex(
      (result, resultIndex) =>
        !usedResultIndexes.has(resultIndex) &&
        resultMatchesTransaction(result, transaction),
    );
    if (matchIndex === -1) {
      missingTransactionIndexes.push(index);
    } else {
      usedResultIndexes.add(matchIndex);
    }
  }

  const unmatchedResultIndexes = results
    .map((_, index) => index)
    .filter((index) => !usedResultIndexes.has(index));

  return {
    expectedTransactions: transactions.length,
    observedResults: usedResultIndexes.size,
    unmatchedResultIndexes,
    halted,
    complete:
      transactions.length > 0 &&
      usedResultIndexes.size === transactions.length &&
      unmatchedResultIndexes.length === 0 &&
      !halted &&
      missingTransactionIndexes.length === 0,
    missingTransactionIndexes,
    ...(haltReason ? { haltReason } : {}),
  };
}

function resultMatchesTransaction(
  result: Record<string, JsonValue> | undefined,
  transaction: TransactionNode | undefined,
): boolean {
  if (!result || !transaction || !record(result.transaction)) return false;
  const resultTransaction = result.transaction;
  const keys = ["from", "to", "data", "value"] as const;
  return keys.every((key) => {
    const left = comparable(resultTransaction[key]);
    const right = comparable(transaction.transaction[key]);
    if (left === null || right === null) return false;
    return left === right;
  });
}

function comparable(value: JsonValue | undefined): string | null {
  if (typeof value !== "string") return null;
  return value.toLowerCase();
}

function haltReasonOf(value: JsonValue | undefined): string | undefined {
  if (!record(value)) return undefined;
  return typeof value.reason === "string" ? value.reason : undefined;
}

function normalizedErrors(
  errors: RawKuruEvidence["errors"],
): NormalizedMossError[] {
  if (!errors) return [];
  return Object.entries(errors).flatMap(([key, value]) => {
    const stage = stageOf(key);
    const items = Array.isArray(value) ? value : [value];
    return items.flatMap((item) => {
      const structured = parseStructuredError(item, stage);
      if (structured) return [structured];
      return errorMessages(item).map((message) =>
        normalizeMossError(message, {
          ...(stage ? { stage } : {}),
          source: errorSource(stage),
        }),
      );
    });
  });
}

function parseStructuredError(
  value: JsonValue,
  fallbackStage?: NormalizedMossError["stage"],
): NormalizedMossError | null {
  if (!record(value)) return null;
  if (typeof value.message !== "string") return null;

  const code = normalizeErrorCode(value.code);
  const stage = normalizeErrorStage(value.stage) ?? fallbackStage;
  const integrationStatus = normalizeIntegrationStatus(value.integrationStatus);
  const source = normalizeErrorSource(value.source);

  // A fully preserved record requires a valid code and integration status.
  // Missing stage or source are tolerated and filled from context.
  if (!code || !integrationStatus) return null;

  return {
    stage,
    code,
    message: value.message,
    integrationStatus,
    source,
    normalization: "PRESERVED",
  };
}

function normalizeErrorCode(
  value: JsonValue,
): NormalizedMossError["code"] | null {
  const code = typeof value === "string" ? value : null;
  if (
    code &&
    [
      "NO_ROUTE",
      "REVERTED",
      "TIMEOUT",
      "UNAVAILABLE",
      "INTEGRATION_ERROR",
      "UNKNOWN",
    ].includes(code)
  ) {
    return code as NormalizedMossError["code"];
  }
  return null;
}

function normalizeErrorStage(
  value: JsonValue,
): NormalizedMossError["stage"] | undefined {
  const stage = typeof value === "string" ? value : undefined;
  if (
    stage &&
    ["DISCOVER", "LOAD", "QUOTE", "ACTION", "SIMULATE"].includes(stage)
  ) {
    return stage as NormalizedMossError["stage"];
  }
  return undefined;
}

function normalizeIntegrationStatus(
  value: JsonValue,
): IntegrationStatus | null {
  const status = typeof value === "string" ? value : null;
  if (
    status &&
    ["OK", "INTEGRATION_ERROR", "UNAVAILABLE", "TIMEOUT"].includes(status)
  ) {
    return status as IntegrationStatus;
  }
  return null;
}

function normalizeErrorSource(value: JsonValue): NormalizedMossError["source"] {
  const source = typeof value === "string" ? value : null;
  if (source && ["moss", "rpc", "quote"].includes(source)) {
    return source as NormalizedMossError["source"];
  }
  return "unknown";
}

function errorMessages(value: JsonValue): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(errorMessages);
  if (!record(value)) return [JSON.stringify(value)];
  if (typeof value.message === "string") return [value.message];
  if (typeof value.error === "string") return [value.error];
  return [JSON.stringify(value)];
}

function stageOf(
  key: string,
): import("./types.js").NormalizedMossError["stage"] {
  const normalized = key.toUpperCase();
  return ["DISCOVER", "LOAD", "QUOTE", "ACTION", "SIMULATE"].includes(
    normalized,
  )
    ? (normalized as import("./types.js").NormalizedMossError["stage"])
    : undefined;
}

function errorSource(
  stage: import("./types.js").NormalizedMossError["stage"],
): import("./types.js").NormalizedMossError["source"] {
  if (stage === "QUOTE") return "quote";
  if (stage === "SIMULATE") return "rpc";
  return stage ? "moss" : "unknown";
}

function aggregateIntegrationStatus(
  baseline: IntegrationStatus,
  errors: import("./types.js").NormalizedMossError[],
): IntegrationStatus {
  const ranked = [baseline, ...errors.map((error) => error.integrationStatus)];
  return ranked.reduce((current, candidate) =>
    integrationRank(candidate) > integrationRank(current) ? candidate : current,
  );
}

function integrationRank(status: IntegrationStatus): number {
  return {
    OK: 0,
    UNAVAILABLE: 1,
    TIMEOUT: 2,
    INTEGRATION_ERROR: 3,
  }[status];
}

function approvalFormula(
  approval: "REQUIRED" | "NOT_APPLICABLE" | "UNKNOWN",
): string {
  if (approval === "REQUIRED") {
    return "Derived from the recorded ERC-20 approval capability preceding the Kuru swap action.";
  }
  if (approval === "NOT_APPLICABLE") {
    return "Native MON input has no ERC-20 approval action.";
  }
  return "The recorded action capability tree does not establish an ERC-20 approval requirement.";
}

function normalizeIntent(intent: KuruSwapIntent): NormalizedKuruSwapIntent {
  const hasValue = intent.minimumReceived !== undefined;
  const source = intent.minimumReceivedSource;

  if (!hasValue && source === undefined) {
    return { ...intent, minimumReceivedSource: "unavailable" };
  }

  // Inconsistent states are materialized explicitly so the risk layer can fail
  // closed. A value without a source, or a value with an unavailable source,
  // is treated as an unavailable boundary and evaluates to UNKNOWN.
  if (hasValue && (source === undefined || source === "unavailable")) {
    return { ...intent, minimumReceivedSource: "unavailable" };
  }

  // A missing value with a source that requires a value is kept as-is; the
  // risk layer will return UNKNOWN because the boundary cannot be evaluated.
  if (!hasValue && source !== undefined && source !== "unavailable") {
    return { ...intent, minimumReceivedSource: source };
  }

  return { ...intent, minimumReceivedSource: source as BoundarySource };
}

function sourcedFields(
  evidence: NormalizedKuruEvidence,
): Array<Sourced<unknown>> {
  return [
    evidence.quote,
    evidence.action,
    evidence.receipt,
    evidence.outcome,
    evidence.assetChanges,
    evidence.warnings,
    evidence.revertReason,
    evidence.gas,
    evidence.simulationCoverage,
    evidence.errors,
    evidence.blockNumber,
    evidence.approval,
  ];
}

function record(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
