import type {
  EvidenceSource,
  IntegrationStatus,
  JsonValue,
  KuruSwapIntent,
  NormalizedKuruEvidence,
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
}): NormalizedKuruEvidence {
  const integrationStatus = input.integrationStatus ?? "OK";
  const quote = queryData(input.raw.quote);
  const action = actionSummary(input.raw.action);
  const simulation = simulationSummary(input.raw.simulation);
  const approval = approvalStatus(input.raw.action, input.intent.tokenIn);
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
    intent: input.intent,
    integrationStatus,
    executionStatus: executionStatus(integrationStatus, simulation),
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
      "Derived from the recorded Moss capability tree.",
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
  input: { blockNumber: string | null },
  formula?: string,
): Sourced<T> {
  return {
    value,
    source,
    ...(input.blockNumber ? { blockNumber: input.blockNumber } : {}),
    ...(formula ? { formula } : {}),
    ...(value === null
      ? { limitation: "No corresponding recorded evidence is available." }
      : {}),
  };
}

function queryData(value: JsonValue | null): JsonValue | null {
  if (!record(value)) return null;
  return record(value.data) ? value.data : null;
}

function actionSummary(value: JsonValue | null): JsonValue | null {
  if (!record(value)) return null;
  const transactions = transactionNodes(value);
  if (transactions.length === 0) return null;
  return transactions.map((transaction) => ({
    protocol: transaction.protocol,
    method: transaction.method,
    target: transaction.target,
    nativeValue: transaction.nativeValue,
    calldataBytes: transaction.calldataBytes,
  }));
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

function simulationSummary(value: JsonValue | null): {
  receipt: JsonValue | null;
  outcome: JsonValue | null;
  assetChanges: JsonValue[];
  warnings: JsonValue[];
  revertReason: string | null;
  gas: JsonValue;
  reverted: boolean;
  unsupportedReceipt: boolean;
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
    };
  }
  const results = value.results.filter(record);
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
  const reverted = results.some((result) => result.reverted === true);
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
  };
}

function executionStatus(
  integrationStatus: IntegrationStatus,
  simulation: ReturnType<typeof simulationSummary>,
): NormalizedKuruEvidence["executionStatus"] {
  if (integrationStatus !== "OK") return "UNKNOWN";
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

function transactionNodes(value: JsonValue): Array<{
  protocol: string;
  method: string;
  target: string | null;
  nativeValue: string | null;
  calldataBytes: number | null;
}> {
  if (!record(value)) return [];
  const protocol =
    typeof value.protocol === "string" ? value.protocol : "unknown";
  const method = typeof value.method === "string" ? value.method : "unknown";
  const transaction = record(value.transaction) ? value.transaction : null;
  const own = transaction
    ? [
        {
          protocol,
          method,
          target: typeof transaction.to === "string" ? transaction.to : null,
          nativeValue:
            typeof transaction.value === "string" ? transaction.value : null,
          calldataBytes:
            typeof transaction.data === "string"
              ? Math.max(0, (transaction.data.length - 2) / 2)
              : null,
        },
      ]
    : [];
  const children = Array.isArray(value.children)
    ? value.children.flatMap(transactionNodes)
    : [];
  return [...own, ...children];
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
    evidence.blockNumber,
    evidence.approval,
  ];
}

function record(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
