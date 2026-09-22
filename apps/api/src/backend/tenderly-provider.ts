import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
} from "@parallax/contracts";
import type { BackendPipelinePreparedExecution } from "./pipeline.js";
import {
  createProviderAdapter,
  type ProviderAdapter,
  ProviderAdapterError,
  type ProviderEvaluationInput,
} from "./provider-adapter.js";
import type { ProvisionalCandidateFieldInput } from "./provider-result-boundary.js";

export const TENDERLY_ARBITRUM_PROVIDER_ID = "tenderly-arbitrum" as const;

type TenderlyIntent = {
  readonly chainId: number;
  readonly protocol: string;
  readonly sender: string;
};

/** This is the exact Backend pipeline payload; no Provider transaction builder exists. */
export type TenderlyPreparedExecution<
  Intent extends TenderlyIntent = TenderlyIntent,
> = BackendPipelinePreparedExecution<Intent>;

export type TenderlyProviderOptions = {
  readonly accountSlug: string;
  readonly projectSlug: string;
  readonly accessKey: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
};

type TenderlyRequest = {
  readonly network_id: string;
  readonly from: string;
  readonly to: string;
  readonly input: string;
  readonly value: string;
  readonly block_number: number;
  readonly gas?: number;
  readonly save: false;
  readonly save_if_fails: false;
  readonly simulation_type: "full";
};

type ExactTransaction = {
  readonly from: string;
  readonly to: string;
  readonly data: string;
  readonly value: bigint;
  readonly gas?: number;
};

const address = /^0x[0-9a-fA-F]{40}$/;
const bytes = /^0x(?:[0-9a-fA-F]{2})*$/;
const quantity = /^(?:0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/;
const blockHash = /^0x[0-9a-fA-F]{64}$/;
const slug = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function failure(
  code: "UNSUPPORTED" | "FAILED" | "TIMEOUT" | "UNKNOWN" | "STALE",
  message: string,
  retryable = false,
): ProviderAdapterError {
  return new ProviderAdapterError({
    providerId: TENDERLY_ARBITRUM_PROVIDER_ID,
    code,
    message,
    retryable,
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQuantity(value: unknown): bigint | undefined {
  if (value === "0x") return 0n;
  if (typeof value !== "string" || !quantity.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function parseTenderlyQuantity(value: unknown): bigint | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0
      ? BigInt(value)
      : undefined;
  }
  return parseQuantity(value);
}

function sameTenderlyIntent(left: unknown, right: unknown): boolean {
  return (
    record(left) &&
    record(right) &&
    left.chainId === right.chainId &&
    left.protocol === right.protocol &&
    typeof left.sender === "string" &&
    typeof right.sender === "string" &&
    left.sender.toLowerCase() === right.sender.toLowerCase()
  );
}

function exactTransaction(
  prepared: TenderlyPreparedExecution,
): ExactTransaction {
  const unsigned = prepared.unsignedTransaction;
  if (
    !record(unsigned) ||
    unsigned.kind !== "unsigned" ||
    !record(unsigned.payload)
  ) {
    throw failure("UNKNOWN", "Prepared unsigned transaction is missing");
  }
  const tx = unsigned.payload;
  if (
    Object.keys(tx).some(
      (key) => !["from", "to", "data", "value", "gas"].includes(key),
    )
  ) {
    throw failure(
      "UNSUPPORTED",
      "Prepared transaction contains unsupported fields",
    );
  }
  const value = parseQuantity(tx.value);
  const gas = tx.gas === undefined ? undefined : parseQuantity(tx.gas);
  if (
    typeof tx.from !== "string" ||
    !address.test(tx.from) ||
    typeof tx.to !== "string" ||
    !address.test(tx.to) ||
    typeof tx.data !== "string" ||
    !bytes.test(tx.data) ||
    value === undefined ||
    value < 0n ||
    (gas !== undefined &&
      (gas <= 0n || gas > BigInt(Number.MAX_SAFE_INTEGER))) ||
    (tx.gas !== undefined && gas === undefined)
  ) {
    throw failure(
      "UNKNOWN",
      "Prepared transaction fields are missing or invalid",
    );
  }
  if (tx.from.toLowerCase() !== prepared.intent.sender.toLowerCase()) {
    throw failure("UNKNOWN", "Prepared transaction sender differs from Intent");
  }
  return {
    from: tx.from,
    to: tx.to,
    data: tx.data,
    value,
    ...(gas === undefined ? {} : { gas: Number(gas) }),
  };
}

function prepare(
  input: ProviderEvaluationInput<TenderlyIntent, TenderlyPreparedExecution>,
): {
  request: TenderlyRequest;
  expectedHash: string;
  tx: ExactTransaction;
} {
  const prepared = input.input;
  if (
    !record(prepared) ||
    !record(prepared.intent) ||
    !record(prepared.blockContext) ||
    prepared.quote === undefined ||
    prepared.quote === null ||
    !record(prepared.gasEstimate) ||
    !record(prepared.finality) ||
    typeof prepared.runId !== "string" ||
    !prepared.runId ||
    prepared.runId !== input.runId ||
    prepared.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID ||
    prepared.protocol !== CAMELOT_V3_PROTOCOL_ID ||
    prepared.intent.chainId !== prepared.chainId ||
    prepared.intent.protocol !== prepared.protocol ||
    typeof prepared.intent.sender !== "string" ||
    !address.test(prepared.intent.sender) ||
    (input.chainId !== undefined && input.chainId !== prepared.chainId) ||
    (input.protocol !== undefined && input.protocol !== prepared.protocol) ||
    (input.intent !== undefined &&
      !sameTenderlyIntent(input.intent, prepared.intent))
  ) {
    throw failure(
      "UNKNOWN",
      "Prepared execution identity is missing or mismatched",
    );
  }
  const block = parseQuantity(prepared.blockContext.blockNumber);
  const expectedHash = prepared.blockContext.blockHash;
  if (
    block === undefined ||
    block > BigInt(Number.MAX_SAFE_INTEGER) ||
    block <= 0n ||
    typeof expectedHash !== "string" ||
    !blockHash.test(expectedHash)
  ) {
    throw failure("UNKNOWN", "Prepared block provenance is missing or invalid");
  }
  const tx = exactTransaction(prepared as TenderlyPreparedExecution);
  return {
    expectedHash,
    tx,
    request: {
      network_id: String(ARBITRUM_SEPOLIA_CHAIN_ID),
      from: tx.from,
      to: tx.to,
      input: tx.data,
      value: tx.value.toString(),
      block_number: Number(block),
      ...(tx.gas === undefined ? {} : { gas: tx.gas }),
      save: false,
      save_if_fails: false,
      simulation_type: "full",
    },
  };
}

function candidate(
  path: string,
  sourcePath: string,
  value: string | boolean | number | undefined,
): ProvisionalCandidateFieldInput {
  return {
    candidatePath: `tenderly.${path}`,
    sourcePath,
    observedShape: typeof value,
    nullable: false,
    status: value === undefined ? "missing" : "observed",
    confidence: "unassessed",
    ...(value === undefined ? {} : { value }),
  };
}

/** Only this module knows the Tenderly wire schema. No raw response leaves it. */
function normalize(
  raw: unknown,
  request: TenderlyRequest,
  expectedHash: string,
  observedAt: string,
) {
  const body = record(raw) ? raw : {};
  const transaction = record(body.transaction) ? body.transaction : {};
  const simulation = record(body.simulation) ? body.simulation : {};
  const transactionBlock = transaction.block_number;
  const simulationBlock = simulation.block_number;
  const hash = transaction.block_hash;
  const transactionValue = parseQuantity(transaction.value);
  const simulationValue = parseQuantity(simulation.value);
  const requestedGas =
    request.gas === undefined ? undefined : BigInt(request.gas);
  const transactionGas = parseTenderlyQuantity(transaction.gas);
  const simulationGas = parseTenderlyQuantity(simulation.gas);
  const gasBound =
    requestedGas === undefined ||
    (transactionGas === requestedGas && simulationGas === requestedGas);
  const bound =
    transaction.from === request.from &&
    transaction.to === request.to &&
    transaction.input === request.input &&
    transactionValue === BigInt(request.value) &&
    simulation.from === request.from &&
    simulation.to === request.to &&
    simulation.input === request.input &&
    simulationValue === BigInt(request.value) &&
    transaction.network_id === request.network_id &&
    simulation.network_id === request.network_id &&
    transactionBlock === request.block_number &&
    simulationBlock === request.block_number &&
    gasBound &&
    typeof hash === "string" &&
    hash.toLowerCase() === expectedHash.toLowerCase();
  const status =
    bound && transaction.status === true && simulation.status === true
      ? "success"
      : bound && transaction.status === false && simulation.status === false
        ? "failed"
        : "unknown";
  const gasUsed = transaction.gas_used;
  const info = record(transaction.transaction_info)
    ? transaction.transaction_info
    : {};
  const complete =
    typeof gasUsed === "number" &&
    Number.isSafeInteger(gasUsed) &&
    gasUsed >= 0 &&
    Array.isArray(info.asset_changes) &&
    Array.isArray(info.balance_changes);
  const controlledStatus =
    status === "success" && !complete ? "unknown" : status;
  const candidateFields = [
    candidate(
      "execution.status",
      "transaction.status",
      typeof transaction.status === "boolean" ? transaction.status : undefined,
    ),
    candidate(
      "gas.used",
      "transaction.gas_used",
      typeof gasUsed === "number" &&
        Number.isSafeInteger(gasUsed) &&
        gasUsed >= 0
        ? gasUsed
        : undefined,
    ),
    candidate(
      "block.number",
      "transaction.block_number",
      typeof transactionBlock === "number" ? transactionBlock : undefined,
    ),
    candidate(
      "block.hash",
      "transaction.block_hash",
      typeof hash === "string" && blockHash.test(hash) ? hash : undefined,
    ),
    candidate(
      "assetChanges.available",
      "transaction.transaction_info.asset_changes",
      Array.isArray(info.asset_changes) ? true : undefined,
    ),
    candidate(
      "balanceChanges.available",
      "transaction.transaction_info.balance_changes",
      Array.isArray(info.balance_changes) ? true : undefined,
    ),
  ];
  return {
    provider: { providerId: TENDERLY_ARBITRUM_PROVIDER_ID, observedAt },
    status: controlledStatus,
    responseEvidence: {
      kind: "redacted_snapshot" as const,
      redactionProfile: "tenderly-allowlist-v1",
      snapshot: {
        outcome: controlledStatus,
        blockMatched: bound,
        gasUsedPresent: candidateFields[1]?.status === "observed",
      },
    },
    candidateFields,
    capabilities: ["simulate", "execution-result", "gas-used", "pinned-block"],
  };
}

export function createTenderlyProvider<
  Intent extends TenderlyIntent = TenderlyIntent,
>(
  options: TenderlyProviderOptions,
): ProviderAdapter<Intent, TenderlyPreparedExecution<Intent>> {
  if (
    !slug.test(options.accountSlug) ||
    !slug.test(options.projectSlug) ||
    !options.accessKey ||
    !Number.isSafeInteger(options.timeoutMs ?? 10_000) ||
    (options.timeoutMs ?? 10_000) <= 0
  ) {
    throw new TypeError(
      "Tenderly account, project, access key and positive timeout are required",
    );
  }
  const fetcher = options.fetchImplementation ?? fetch;
  const endpoint = `https://api.tenderly.co/api/v1/account/${options.accountSlug}/project/${options.projectSlug}/simulate`;
  return createProviderAdapter<Intent, TenderlyPreparedExecution<Intent>>({
    providerId: TENDERLY_ARBITRUM_PROVIDER_ID,
    capabilities: ["simulate", "execution-result", "gas-used", "pinned-block"],
    supports: ({ chainId, protocol }) =>
      chainId === ARBITRUM_SEPOLIA_CHAIN_ID &&
      protocol === CAMELOT_V3_PROTOCOL_ID,
    evaluateRaw: async (input) => {
      const { request, expectedHash } = prepare(
        input as ProviderEvaluationInput<
          TenderlyIntent,
          TenderlyPreparedExecution
        >,
      );
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Access-Key": options.accessKey,
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError")
        ) {
          throw failure("TIMEOUT", "Tenderly simulation timed out", true);
        }
        throw failure("FAILED", "Tenderly simulation network failure", true);
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw failure(
            "FAILED",
            "Tenderly authentication or authorization failure",
          );
        if (response.status === 429)
          throw failure("FAILED", "Tenderly rate limit", true);
        if (response.status === 400 || response.status === 404)
          throw failure(
            "UNKNOWN",
            "Tenderly rejected request or resource was not found",
          );
        throw failure(
          "FAILED",
          "Tenderly HTTP failure",
          response.status >= 500,
        );
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw failure("UNKNOWN", "Tenderly response is malformed");
      }
      return normalize(
        raw,
        request,
        expectedHash,
        (options.now ?? (() => new Date()))().toISOString(),
      );
    },
  });
}
