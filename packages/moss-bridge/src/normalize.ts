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
  const assetChangeAssessment = assessAssetChanges(simulation.assetChanges, {
    intent: input.intent,
    quote,
    outcome: simulation.outcome,
  });
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

/**
 * Normalize a live Moss run into the shared evidence shape. Live evidence is
 * never a replay and never a mock; reproducibility is driven by the immutable
 * runtime revision plus per-stage block provenance.
 */
export function normalizeLiveKuruEvidence(input: {
  intent: NormalizedKuruSwapIntent;
  raw: RawKuruEvidence;
  runtime: import("./types.js").RuntimeIdentity;
  fetchedAt: string;
  stages: import("./types.js").StageRecord[];
  initialBlock?: string;
  simulatorPinnedBlock?: string;
}): NormalizedKuruEvidence {
  const errors = normalizedErrors(input.raw.errors);
  const integrationStatus = aggregateIntegrationStatus("OK", errors);
  const quote = queryData(input.raw.quote);
  const transactions = transactionNodes(input.raw.action);
  const action = transactions.length === 0 ? null : transactions.map(summary);
  const simulation = simulationSummary(input.raw.simulation, transactions);
  const approval = approvalStatus(input.raw.action, input.intent.tokenIn);
  const assetChangeAssessment = assessAssetChanges(simulation.assetChanges, {
    intent: input.intent,
    quote,
    outcome: simulation.outcome,
  });
  const blockNumber = liveBlockNumber(input.stages, input.initialBlock);
  const live: {
    blockNumber: string | null;
    fetchedAt: string;
    mossCommit?: string;
  } = {
    blockNumber,
    fetchedAt: input.fetchedAt,
    mossCommit: input.runtime.runtimeRevision,
  };
  const limitations = [
    "Moss trace simulation synthetic-prefunds native MON only and does not prove ERC-20 affordability.",
    "No signing, broadcast, custody, or wallet mutation occurred; the action stage only constructed unsigned calldata.",
  ];
  if (simulation.unsupportedReceipt) {
    limitations.push(
      "Kuru receipt evidence is unsupported for FlipOrderUpdated on the pinned Moss runtime; execution is UNKNOWN, not success.",
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
    executionStatus: executionStatus(integrationStatus, errors, simulation),
    quote: sourced(
      quote,
      quote ? "quote" : "unknown",
      live,
      "Quote returned by the live Moss query.",
      "REPRODUCIBLE",
    ),
    action: sourced(
      action,
      action ? "moss" : "unknown",
      live,
      undefined,
      "REPRODUCIBLE",
    ),
    receipt: sourced(
      simulation.receipt,
      simulation.receipt ? "moss" : "unknown",
      live,
      undefined,
      "REPRODUCIBLE",
    ),
    outcome: sourced(
      simulation.outcome,
      simulation.outcome ? "moss" : "unknown",
      live,
      undefined,
      "REPRODUCIBLE",
    ),
    assetChanges: sourced(
      simulation.assetChanges,
      input.raw.simulation ? "moss" : "unknown",
      live,
      undefined,
      "REPRODUCIBLE",
    ),
    assetChangeAssessment,
    warnings: sourced(
      simulation.warnings,
      input.raw.simulation ? "moss" : "unknown",
      live,
      undefined,
      "REPRODUCIBLE",
    ),
    revertReason: sourced(
      simulation.revertReason,
      simulation.revertReason ? "moss" : "unknown",
      live,
      undefined,
      "REPRODUCIBLE",
    ),
    gas: sourced(
      simulation.gas,
      input.raw.simulation ? "moss" : "unknown",
      live,
      undefined,
      "REPRODUCIBLE",
    ),
    simulationCoverage: sourced(
      simulation.coverage,
      input.raw.action ? "derived" : "unknown",
      live,
      "Expected transactions are derived from the action capability tree; observed results are derived from the simulator result list.",
      "REPRODUCIBLE",
    ),
    errors: sourced(
      errors,
      input.raw.errors ? "moss" : "unknown",
      live,
      "Structured errors are normalized from live stage errors.",
      "REPRODUCIBLE",
    ),
    blockNumber: sourced(
      blockNumber,
      blockNumber ? "rpc" : "unknown",
      live,
      "Latest block read across live stages; simulatorPinnedBlock records the simulator's exact pinned block when the runtime exposes it.",
      "REPRODUCIBLE",
    ),
    mossVersion: `@themoss/protocol-kuru@${
      input.runtime.packageVersions["@themoss/protocol-kuru"] ??
      input.runtime.runtimeVersion
    }`,
    mossCommit: input.runtime.runtimeRevision,
    runtimeVersion: input.runtime.runtimeVersion,
    runtimeRevision: input.runtime.runtimeRevision,
    ...(input.simulatorPinnedBlock
      ? { simulatorPinnedBlock: input.simulatorPinnedBlock }
      : {}),
    fetchedAt: input.fetchedAt,
    isReplay: false,
    isMock: false,
    source: "moss",
    replayMode: false,
    approval: sourced(
      approval,
      action ? "derived" : "unknown",
      live,
      approvalFormula(approval),
      "REPRODUCIBLE",
    ),
    walletAffordabilityChecked: false,
    limitations,
  };
}

function liveBlockNumber(
  stages: import("./types.js").StageRecord[],
  initialBlock?: string,
): string | null {
  const simulate = [...stages]
    .reverse()
    .find((stage) => stage.stage === "SIMULATE");
  if (simulate?.blockNumber) return simulate.blockNumber;
  const last = [...stages].reverse().find((stage) => stage.blockNumber);
  return last?.blockNumber ?? initialBlock ?? null;
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
  reproducibilityOverride?: EvidenceReproducibility,
): Sourced<T> {
  return {
    value,
    source,
    reproducibility:
      reproducibilityOverride ?? reproducibilityOf(source, input),
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
  if (!isRecord(value)) return null;
  return isRecord(value.data) ? value.data : null;
}

function assessAssetChanges(
  changes: JsonValue[],
  input: {
    intent: { sender: string; tokenIn: string; tokenOut: string };
    quote: JsonValue | null;
    outcome: JsonValue | null;
  },
): AssetChangeAssessment {
  if (changes.length === 0) return "NOT_APPLICABLE";

  // Authoritative swap accounting must come from the simulated outcome, never
  // from a Quote. Without it the value movements cannot be proven.
  const outcome = parseSwapOutcome(input.outcome);
  if (!outcome) return "UNKNOWN";

  const sender = input.intent.sender.toLowerCase();
  const tokenIn = tokenKey(input.intent.tokenIn);
  const tokenOut = tokenKey(input.intent.tokenOut);
  if (
    outcome.sender.toLowerCase() !== sender ||
    tokenKey(outcome.tokenIn) !== tokenIn ||
    tokenKey(outcome.tokenOut) !== tokenOut ||
    outcome.amountOut === 0n
  ) {
    return "UNKNOWN";
  }

  // Asset universe: the quoted route path when available; otherwise the
  // intended input/output assets. Any value movement outside this universe is
  // an unexpected third asset.
  const universe = assetUniverse(input.quote, tokenIn, tokenOut);
  if (!universe) return "UNKNOWN";

  const movements: ValueMovement[] = [];
  for (const change of changes) {
    const parsed = parseValueMovement(change);
    if (parsed === "UNKNOWN") return "UNKNOWN";
    if (parsed === null) continue;
    movements.push(parsed);
  }
  if (movements.length === 0) return "UNKNOWN";

  for (const movement of movements) {
    if (!universe.has(movement.asset)) return "UNKNOWN";
  }

  if (!conservesAcrossExpectedAssets(movements, [...universe], sender)) {
    return "UNKNOWN";
  }

  if (netFlow(movements, tokenIn, sender) !== -outcome.amountIn) {
    return "UNKNOWN";
  }
  if (netFlow(movements, tokenOut, sender) !== outcome.amountOut) {
    return "UNKNOWN";
  }

  return "EXPLAINED";
}

/** ERC20 Transfer(address,address,uint256) topic — asset-bearing value movement. */
const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Kuru order-book / router events carrying no asset value (corroborating only). */
const KURU_NON_VALUE_TOPICS = new Set([
  "0xf16924fba1c18c108912fcacaac7450c98eb3f2d8c0a3cdf3df7066c08f21581", // Trade
  "0xb74e966bc873b8c144fab39c9981210f50130885e89caf4556c0840cec741dcd", // FlipOrderUpdated
  "0x49496a41b922bdba3ff7f57bb0992ab1a1a3ee95b5ae5bd7271c67861f018352", // FlippedOrderCreated
  "0xae71e8ae9695e4f3523d27453a24d99edc4738fea8130c1cb33eb9ef95f53354", // KuruRouterSwap
]);

type ValueMovement = {
  asset: string;
  from: string;
  to: string;
  amount: bigint;
};

type SwapOutcome = {
  sender: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
};

function parseSwapOutcome(value: JsonValue | null): SwapOutcome | null {
  if (!isRecord(value)) return null;
  const sender = value.sender;
  const tokenIn = value.tokenIn;
  const tokenOut = value.tokenOut;
  const amountIn = atomicAmount(value.amountIn);
  const amountOut = atomicAmount(value.amountOut);
  if (
    typeof sender !== "string" ||
    typeof tokenIn !== "string" ||
    typeof tokenOut !== "string" ||
    amountIn === null ||
    amountOut === null
  ) {
    return null;
  }
  return { sender, tokenIn, tokenOut, amountIn, amountOut };
}

function atomicAmount(value: JsonValue): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function tokenKey(value: string): string {
  return value === "native" ? "native" : value.toLowerCase();
}

function topicAddress(topic: JsonValue): string | null {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) {
    return null;
  }
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function hexUint256(value: string): bigint | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  return BigInt(value);
}

/**
 * Classify one structured Moss change:
 * - an asset-bearing ValueMovement (native transfer, ERC-20 Transfer),
 * - null for a recognized non-value Kuru event (corroborating only), or
 * - "UNKNOWN" for anything malformed or not provably value-irrelevant.
 */
function parseValueMovement(
  change: JsonValue,
): ValueMovement | "UNKNOWN" | null {
  if (!isRecord(change)) return "UNKNOWN";
  if (change.kind === "nativeTransfer") {
    const from = change.from;
    const to = change.to;
    const amount = atomicAmount(change.value);
    if (typeof from !== "string" || typeof to !== "string" || amount === null) {
      return "UNKNOWN";
    }
    return {
      asset: "native",
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      amount,
    };
  }
  if (change.kind === "event") {
    const address = change.address;
    const topics = change.topics;
    const data = change.data;
    if (
      typeof address !== "string" ||
      !Array.isArray(topics) ||
      topics.some((topic) => typeof topic !== "string") ||
      typeof data !== "string"
    ) {
      return "UNKNOWN";
    }
    const topic0 = topics[0] as string;
    if (topic0 === ERC20_TRANSFER_TOPIC) {
      const from = topicAddress(topics[1]);
      const to = topicAddress(topics[2]);
      const amount = hexUint256(data);
      if (from === null || to === null || amount === null) return "UNKNOWN";
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return "UNKNOWN";
      return { asset: address.toLowerCase(), from, to, amount };
    }
    if (KURU_NON_VALUE_TOPICS.has(topic0)) return null;
    return "UNKNOWN";
  }
  return "UNKNOWN";
}

function assetUniverse(
  quote: JsonValue | null,
  tokenIn: string,
  tokenOut: string,
): Set<string> | null {
  const universe = new Set<string>([tokenIn, tokenOut]);
  if (!isRecord(quote) || !Array.isArray(quote.path)) return universe;
  for (const entry of quote.path) {
    if (
      typeof entry !== "string" ||
      (entry !== "native" && !/^0x[0-9a-fA-F]{40}$/.test(entry))
    ) {
      return null;
    }
    universe.add(tokenKey(entry));
  }
  return universe;
}

function netFlow(
  movements: ValueMovement[],
  asset: string,
  address: string,
): bigint {
  let net = 0n;
  for (const movement of movements) {
    if (movement.asset !== asset) continue;
    if (movement.to === address) net += movement.amount;
    if (movement.from === address) net -= movement.amount;
  }
  return net;
}

/**
 * Conservation: within each expected asset, every non-sender address with a
 * net outflow must be an exchange counterparty backed by a net inflow of
 * another expected asset (a maker naturally exchanges one asset for another).
 * Any other net outflow is an unexplained mint/shortfall.
 */
function conservesAcrossExpectedAssets(
  movements: ValueMovement[],
  expectedAssets: readonly string[],
  sender: string,
): boolean {
  for (const asset of expectedAssets) {
    const debtors = new Set<string>();
    for (const movement of movements) {
      if (movement.asset !== asset) continue;
      if (netFlow(movements, asset, movement.from) < 0n) {
        debtors.add(movement.from);
      }
    }
    for (const address of debtors) {
      if (address === sender) continue;
      const backedByAnotherAsset = expectedAssets.some(
        (other) => other !== asset && netFlow(movements, other, address) > 0n,
      );
      if (!backedByAnotherAsset) return false;
    }
  }
  return true;
}

function approvalStatus(
  value: JsonValue | null,
  tokenIn: string,
): "REQUIRED" | "NOT_APPLICABLE" | "UNKNOWN" {
  if (!isRecord(value)) return "UNKNOWN";
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
  if (!isRecord(value) || !Array.isArray(value.results)) {
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
  const results = value.results.filter(isRecord);
  const halted = value.halted !== undefined && value.halted !== false;
  const haltReason = haltReasonOf(value.halted);
  const warnings = results.flatMap((result) =>
    Array.isArray(result.warnings) ? result.warnings : [],
  );
  const receipt =
    [...results].reverse().find((result) => isRecord(result.receipt))
      ?.receipt ?? null;
  const outcome =
    isRecord(receipt) && receipt.outcome !== undefined ? receipt.outcome : null;
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
  if (!isRecord(value)) return [];
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
  if (!isRecord(value)) return [];
  const protocol =
    typeof value.protocol === "string" ? value.protocol : parent.protocol;
  const method =
    typeof value.method === "string" ? value.method : parent.method;
  const transaction = isRecord(value.transaction) ? value.transaction : null;
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
  if (!result || !transaction || !isRecord(result.transaction)) return false;
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
  if (!isRecord(value)) return undefined;
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
  if (!isRecord(value)) return null;
  if (typeof value.message !== "string") return null;

  const code = normalizeErrorCode(value.code);
  const stage = normalizeErrorStage(value.stage) ?? fallbackStage;
  const integrationStatus = normalizeIntegrationStatus(value.integrationStatus);
  const source = normalizeErrorSource(value.source);

  // A structured non-OK integration status is authoritative even when the
  // code is missing, schema-invalid, or inconsistent with the message or
  // stage. It must never be downgraded to OK by message heuristics.
  if (integrationStatus && integrationStatus !== "OK") {
    return {
      stage,
      code: code ?? integrationStatus,
      message: value.message,
      integrationStatus,
      source,
      normalization: "PRESERVED",
    };
  }

  // A fully preserved OK record still requires a valid code so that we do
  // not manufacture a structured record from an arbitrary message object.
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
  if (!isRecord(value)) return [JSON.stringify(value)];
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

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
