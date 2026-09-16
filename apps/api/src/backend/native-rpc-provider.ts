import { isDeepStrictEqual } from "node:util";
import {
  convertAtomicAmountToHuman,
  type GenericEvidence,
  type GenericEvidenceMode,
  type GenericProviderStatus,
  type GenericSwapIntent,
  genericEvidenceSchema,
  type NormalizedSwapIntent,
} from "@parallax/contracts";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  type ArbitrumTransaction,
} from "./arbitrum-chain-adapter.js";
import type {
  BlockContext,
  ChainOperationOptions,
  GasEstimate,
} from "./chain-adapter.js";

export { ARBITRUM_SEPOLIA_CHAIN_ID };

import {
  createProviderAdapter,
  type ProviderAdapter,
  type ProviderAdapterRawImplementation,
  type ProviderEvaluationInput,
  type ProviderEvaluationResult,
  type ProviderSupportQuery,
} from "./provider-adapter.js";
import {
  createProvisionalProviderResult,
  type ProvisionalCandidateFieldInput,
  type ProvisionalJsonValue,
  type ProvisionalProviderResultInput,
} from "./provider-result-boundary.js";

export const NATIVE_RPC_ARBITRUM_PROVIDER_ID = "native-rpc-arbitrum" as const;
export const NATIVE_RPC_CAPABILITIES = Object.freeze([
  "simulate",
  "eth_call",
  "estimateGas",
  "pinned-block",
] as const);

export type NativeRpcClient = {
  request(
    method: string,
    params?: readonly unknown[],
    options?: ChainOperationOptions,
  ): Promise<unknown>;
};

export type NativeRpcIntent = {
  readonly chainId: number;
  readonly protocol: string;
  readonly sender: string;
};

/**
 * Exact execution material accepted by the fixture-first Native RPC seam.
 * Protocol-specific transaction details stay behind the unsigned transaction
 * payload; this provider never builds, signs, or broadcasts a transaction.
 */
export type NativeRpcPreparedExecution<
  Intent extends NativeRpcIntent = NativeRpcIntent,
> = {
  readonly runId: string;
  readonly intent: Intent;
  readonly chainId: number;
  readonly protocol: string;
  readonly blockContext: BlockContext;
  readonly quote: unknown;
  readonly unsignedTransaction: {
    readonly kind: "unsigned";
    readonly payload: ArbitrumTransaction | Readonly<Record<string, unknown>>;
  };
  readonly gasEstimate: GasEstimate;
  readonly finality: {
    readonly status: "unknown" | "pending" | "confirmed" | "finalized";
    readonly blockContext?: BlockContext;
  };
};

export type NativeRpcProviderMode = GenericEvidenceMode;

export type NativeRpcProviderOptions = {
  readonly client: NativeRpcClient;
  /** Explicit truthfulness mode used by the Generic Evidence mapper. */
  readonly mode?: NativeRpcProviderMode;
  readonly providerVersion?: string;
  readonly now?: () => string;
  /** Opt-in head read used to classify pinned-block freshness. */
  readonly checkFreshness?: boolean;
  /** Maximum allowed head minus pinned block lag when freshness is checked. */
  readonly maxBlockLag?: number;
  readonly timeoutMs?: number;
};

type NativeRpcStatus = ProvisionalProviderResultInput["status"];
type FailureStatus = Exclude<NativeRpcStatus, "success">;
type NativeRpcProviderInput<Intent extends NativeRpcIntent> =
  ProviderEvaluationInput<Intent, NativeRpcPreparedExecution<Intent>>;

type RpcError = Error & { readonly rpcCode?: number };

type Freshness =
  | {
      readonly status: "fresh";
      readonly pinnedBlock: string;
      readonly headBlock: string;
      readonly lag: string;
      readonly maxBlockLag: number;
    }
  | {
      readonly status: "stale";
      readonly pinnedBlock: string;
      readonly headBlock: string;
      readonly lag: string;
      readonly maxBlockLag: number;
    }
  | { readonly status: "unknown"; readonly reason: string }
  | { readonly status: "not_checked" };

type EvaluationState = {
  readonly callReturnData?: string;
  readonly gasUnits?: string;
  freshness: Freshness;
  readonly fields: ProvisionalCandidateFieldInput[];
};

/**
 * Backend-owned, replaceable Native RPC implementation.
 *
 * This class intentionally exposes only a factory-created ProviderAdapter to
 * the registry. The injected client is a controlled fixture/runtime seam and
 * no default endpoint or fabricated chain response is supplied.
 */
export class NativeRpcProvider<Intent extends NativeRpcIntent = NativeRpcIntent>
  implements
    ProviderAdapterRawImplementation<Intent, NativeRpcPreparedExecution<Intent>>
{
  public readonly providerId = NATIVE_RPC_ARBITRUM_PROVIDER_ID;
  public readonly capabilities = NATIVE_RPC_CAPABILITIES;
  public readonly adapter: ProviderAdapter<
    Intent,
    NativeRpcPreparedExecution<Intent>
  >;
  private readonly mode: NativeRpcProviderMode;
  private readonly providerVersion: string;
  private readonly now: () => string;
  private readonly checkFreshness: boolean;
  private readonly maxBlockLag: number;
  private readonly timeoutMs: number;

  public constructor(private readonly options: NativeRpcProviderOptions) {
    if (
      options.client === null ||
      typeof options.client !== "object" ||
      typeof options.client.request !== "function"
    ) {
      throw new TypeError("Native RPC client.request is required");
    }
    if (
      options.maxBlockLag !== undefined &&
      (!Number.isSafeInteger(options.maxBlockLag) || options.maxBlockLag < 0)
    ) {
      throw new TypeError(
        "Native RPC maxBlockLag must be a non-negative integer",
      );
    }
    if (
      options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      throw new TypeError("Native RPC timeoutMs must be a positive integer");
    }
    this.mode = options.mode ?? "MOCK";
    this.providerVersion =
      options.providerVersion ?? "native-rpc-fixture-seam-v1";
    this.now = options.now ?? (() => new Date().toISOString());
    this.checkFreshness = options.checkFreshness ?? false;
    this.maxBlockLag = options.maxBlockLag ?? 0;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.adapter = createProviderAdapter(this);
  }

  public supports(query: ProviderSupportQuery<Intent>): boolean {
    return (
      query.chainId === ARBITRUM_SEPOLIA_CHAIN_ID &&
      query.protocol === "camelot-v3" &&
      (query.capability === undefined ||
        NATIVE_RPC_CAPABILITIES.includes(
          query.capability as (typeof NATIVE_RPC_CAPABILITIES)[number],
        )) &&
      (query.intent === undefined ||
        (query.intent.chainId === ARBITRUM_SEPOLIA_CHAIN_ID &&
          query.intent.protocol === "camelot-v3"))
    );
  }

  public async evaluateRaw(
    input: NativeRpcProviderInput<Intent>,
  ): Promise<ProviderEvaluationResult> {
    const observedAt = this.observedAt();
    const invalid = validatePreparedExecution(input);
    if (invalid !== undefined) {
      return this.result(input.runId, observedAt, "unknown", {
        fields: [
          candidate(
            "nativeRpc.preparedExecution",
            "prepared_execution",
            "invalid",
            invalid,
          ),
        ],
        freshness: { status: "unknown", reason: invalid },
      });
    }

    const transaction = transactionForRpc(input.input.intent, input.input);
    const blockTag = decimalToHex(input.input.blockContext.blockNumber);
    const state: EvaluationState = {
      fields: [],
      freshness: { status: "not_checked" },
    };

    let callReturnData: string;
    try {
      const response = await this.request("eth_call", [transaction, blockTag]);
      if (!isHexData(response)) {
        return this.result(input.runId, observedAt, "unknown", {
          ...state,
          fields: [
            candidate(
              "nativeRpc.ethCall.returnData",
              "hex_string",
              "invalid",
              "eth_call returned a non-hex result",
            ),
          ],
          freshness: { status: "unknown", reason: "invalid eth_call result" },
        });
      }
      callReturnData = response;
      state.fields.push(
        candidate(
          "nativeRpc.ethCall.returnData",
          "hex_string",
          "observed",
          response,
          "$.result",
        ),
      );
    } catch (error) {
      const classified = classifyRpcFailure(error);
      state.fields.push(
        candidate(
          "nativeRpc.ethCall.returnData",
          "hex_string",
          "missing",
          undefined,
          "$.result",
          classified.message,
        ),
      );
      return this.result(input.runId, observedAt, classified.status, state, {
        failure: classified,
      });
    }

    let gasUnits: string;
    try {
      const response = await this.request("eth_estimateGas", [
        transaction,
        blockTag,
      ]);
      gasUnits = normalizeQuantity(response);
      state.fields.push(
        candidate(
          "nativeRpc.estimateGas.gasUnits",
          "decimal_string",
          "observed",
          gasUnits,
          "$.result",
        ),
      );
    } catch (error) {
      const classified = classifyRpcFailure(error);
      state.fields.push(
        candidate(
          "nativeRpc.estimateGas.gasUnits",
          "decimal_string",
          "missing",
          undefined,
          "$.result",
          classified.message,
        ),
      );
      return this.result(input.runId, observedAt, classified.status, state, {
        failure: classified,
      });
    }

    state.fields.push(
      candidate(
        "nativeRpc.blockContext.blockNumber",
        "decimal_string",
        "observed",
        input.input.blockContext.blockNumber,
        "$.blockContext.blockNumber",
      ),
    );
    if (input.input.blockContext.blockHash !== undefined) {
      state.fields.push(
        candidate(
          "nativeRpc.blockContext.blockHash",
          "string",
          "observed",
          input.input.blockContext.blockHash,
          "$.blockContext.blockHash",
        ),
      );
    }

    if (this.checkFreshness) {
      try {
        const response = await this.request("eth_blockNumber", []);
        const headBlock = normalizeQuantity(response);
        const pinned = BigInt(input.input.blockContext.blockNumber);
        const head = BigInt(headBlock);
        if (head < pinned) {
          state.freshness = {
            status: "unknown",
            reason: "RPC head is behind the pinned block",
          };
          state.fields.push(
            candidate(
              "nativeRpc.freshness",
              "freshness",
              "invalid",
              "RPC head is behind the pinned block",
            ),
          );
          return this.result(input.runId, observedAt, "unknown", state);
        }
        const lag = head - pinned;
        const status = lag > BigInt(this.maxBlockLag) ? "stale" : "fresh";
        state.freshness = {
          status,
          pinnedBlock: input.input.blockContext.blockNumber,
          headBlock,
          lag: lag.toString(),
          maxBlockLag: this.maxBlockLag,
        };
        state.fields.push(
          candidate(
            "nativeRpc.freshness",
            "freshness",
            "observed",
            state.freshness,
          ),
        );
        if (status === "stale") {
          return this.result(input.runId, observedAt, "stale", state);
        }
      } catch (error) {
        const classified = classifyRpcFailure(error);
        state.freshness = { status: "unknown", reason: classified.message };
        state.fields.push(
          candidate(
            "nativeRpc.freshness",
            "freshness",
            "invalid",
            classified.message,
          ),
        );
        return this.result(input.runId, observedAt, "unknown", state, {
          failure: classified,
        });
      }
    }

    state.fields.push(
      candidate(
        "nativeRpc.preparedExecution",
        "prepared_execution",
        "observed",
        {
          chainId: input.input.chainId,
          protocol: input.input.protocol,
          quote: jsonValueOrNull(input.input.quote),
          gasEstimate: input.input.gasEstimate.gasUnits,
          finality: input.input.finality.status,
        },
      ),
    );
    return this.result(input.runId, observedAt, "success", {
      ...state,
      callReturnData,
      gasUnits,
    });
  }

  private async request(
    method: string,
    params: readonly unknown[],
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          Object.assign(new Error("Native RPC request timed out"), {
            name: "AbortError",
          }),
        );
      }, this.timeoutMs);
      void Promise.resolve()
        .then(() =>
          this.options.client.request(method, params, {
            timeoutMs: this.timeoutMs,
          }),
        )
        .then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error);
          },
        );
    });
  }

  private observedAt(): string {
    const observedAt = this.now();
    if (
      typeof observedAt !== "string" ||
      Number.isNaN(Date.parse(observedAt))
    ) {
      throw new TypeError("Native RPC now() must return a valid timestamp");
    }
    return observedAt;
  }

  private result(
    runId: string,
    observedAt: string,
    status: NativeRpcStatus,
    state: EvaluationState,
    options: { readonly failure?: ClassifiedRpcFailure } = {},
  ): ProviderEvaluationResult {
    const result = createProvisionalProviderResult({
      provider: {
        providerId: this.providerId,
        providerVersion: this.providerVersion,
        observedAt,
      },
      status,
      responseEvidence: {
        kind: "redacted_snapshot",
        redactionProfile: "native-rpc-method-results-v1",
        snapshot: {
          providerId: this.providerId,
          runId,
          mode: this.mode,
          status,
          methods: {
            eth_call: state.callReturnData ?? null,
            eth_estimateGas: state.gasUnits ?? null,
          },
          freshness: state.freshness,
          ...(options.failure === undefined
            ? {}
            : {
                failure: {
                  status: options.failure.status,
                  message: options.failure.message,
                },
              }),
        },
      },
      candidateFields: state.fields,
    });
    return {
      ...result,
      capabilities: this.capabilities,
    };
  }
}

export function createNativeRpcProvider<
  Intent extends NativeRpcIntent = NativeRpcIntent,
>(
  options: NativeRpcProviderOptions,
): ProviderAdapter<Intent, NativeRpcPreparedExecution<Intent>> {
  return new NativeRpcProvider<Intent>(options).adapter;
}

export const createNativeRpcProviderAdapter = createNativeRpcProvider;

export type NativeRpcGenericEvidenceInput = {
  readonly intent: NormalizedSwapIntent | GenericSwapIntent;
  readonly tokenInDecimals: number;
  readonly tokenOutDecimals: number;
  readonly preparedExecution: NativeRpcPreparedExecution;
  readonly providerResult: ProviderEvaluationResult;
  readonly mode?: NativeRpcProviderMode;
};

/**
 * Explicit provisional ProviderEvaluationResult → GenericEvidence projection.
 *
 * The projection keeps Native RPC's partial surface fail-closed: a successful
 * `eth_call` and gas estimate do not become a complete simulation receipt,
 * outcome, or asset-change assertion. Those scopes remain visible as unknown.
 */
export function toNativeRpcGenericEvidence(
  input: NativeRpcGenericEvidenceInput,
): GenericEvidence {
  const mode =
    input.mode ?? providerModeFromResult(input.providerResult) ?? "MOCK";
  const source = mode === "MOCK" ? "mock" : "rpc";
  const candidate = new Map(
    input.providerResult.candidateFields.map((field) => [
      field.candidatePath,
      field,
    ]),
  );
  const blockNumber = input.preparedExecution.blockContext.blockNumber;
  const fetchedAt = input.providerResult.provider.observedAt;
  const callField = candidate.get("nativeRpc.ethCall.returnData");
  const gasField = candidate.get("nativeRpc.estimateGas.gasUnits");
  const freshnessField = candidate.get("nativeRpc.freshness");
  const callChecked = callField?.status === "observed";
  const gasChecked = gasField?.status === "observed";
  const blockChecked =
    candidate.get("nativeRpc.blockContext.blockNumber")?.status === "observed";
  const freshness = freshnessFromCandidate(freshnessField);
  const genericStatus = genericProviderStatus(input.providerResult.status);
  const integrationStatus =
    input.providerResult.status === "timeout"
      ? "TIMEOUT"
      : input.providerResult.status === "failed" ||
          input.providerResult.status === "invalid"
        ? "INTEGRATION_ERROR"
        : "OK";
  const failure =
    genericStatus === "FAILED"
      ? {
          code:
            input.providerResult.status === "timeout"
              ? "TIMEOUT"
              : "INTEGRATION_ERROR",
          message: "Native RPC could not produce a verified provider result",
          integrationStatus,
          source: "rpc" as const,
          normalization: "DERIVED" as const,
          retryable: input.providerResult.status === "timeout",
        }
      : undefined;
  const intent = toGenericIntent(
    input.intent,
    input.tokenInDecimals,
    input.tokenOutDecimals,
  );
  const quote = quoteField(
    input.preparedExecution.quote,
    source,
    blockNumber,
    fetchedAt,
  );
  const actionValue = jsonValueOrNull(
    input.preparedExecution.unsignedTransaction.payload,
  );
  const checkedScope = [
    ...(callChecked ? ["native-rpc.eth_call"] : []),
    ...(gasChecked ? ["native-rpc.estimateGas"] : []),
    ...(blockChecked ? ["native-rpc.pinned-block"] : []),
    ...(freshness.status === "fresh" ? ["native-rpc.freshness"] : []),
  ];
  const unknownScope = [
    ...(quote.value === null ? ["quote"] : []),
    ...(actionValue === null ? ["action"] : []),
    ...(callField !== undefined && !callChecked ? ["native-rpc.eth_call"] : []),
    ...(gasField !== undefined && !gasChecked
      ? ["native-rpc.estimateGas"]
      : []),
    "receipt",
    "outcome",
    "assetChanges",
    "simulation",
    ...(freshness.status !== "fresh" ? ["freshness"] : []),
  ];
  const notChecked = [
    ...(callField === undefined ? ["native-rpc.eth_call"] : []),
    ...(gasField === undefined ? ["native-rpc.estimateGas"] : []),
    "receipt",
    "outcome",
    "assetChanges",
    "state-diff",
    "logs",
    "traces",
    ...(freshness.status === "not_checked" ? ["freshness"] : []),
  ];
  const providerData = {
    nativeRpc: {
      status: input.providerResult.status,
      checked: checkedScope,
      notChecked,
      unknown: unknownScope,
      freshness,
      ...(callField?.value === undefined
        ? {}
        : { callReturnData: callField.value }),
      ...(gasField?.value === undefined ? {} : { gasUnits: gasField.value }),
    },
  };
  const evidence = genericEvidenceSchema.parse({
    intent,
    provider: {
      providerId: input.providerResult.provider.providerId,
      status: genericStatus,
      integrationStatus,
      ...(failure === undefined ? {} : { failure }),
      errors: jsonField(
        failure === undefined ? [] : [failure],
        source,
        blockNumber,
        fetchedAt,
      ),
    },
    execution: {
      status: input.providerResult.status === "success" ? "SUCCESS" : "UNKNOWN",
    },
    quote,
    action: arrayField(
      actionValue === null ? null : [actionValue],
      source,
      blockNumber,
      fetchedAt,
    ),
    receipt: jsonField(null, source, blockNumber, fetchedAt),
    outcome: jsonField(null, source, blockNumber, fetchedAt),
    assetChanges: arrayField(null, source, blockNumber, fetchedAt),
    assetChangeAssessment: "UNKNOWN",
    warnings: arrayField([], source, blockNumber, fetchedAt),
    simulation: {
      value: {
        expectedTransactions: 1,
        observedResults: 0,
        unmatchedResultIndexes: [],
        halted: input.providerResult.status !== "success",
        complete: false,
        missingTransactionIndexes: [0],
        ...(input.providerResult.status === "success"
          ? {}
          : {
              haltReason: `Native RPC result was ${input.providerResult.status}`,
            }),
      },
      source: "derived",
      reproducibility: reproducibility(mode),
      blockNumber,
      fetchedAt,
      limitation:
        "Standard eth_call does not produce a receipt or generic asset-change set",
    },
    blockNumber: stringField(blockNumber, source, blockNumber, fetchedAt),
    capabilities: [
      ...(input.providerResult.capabilities ?? NATIVE_RPC_CAPABILITIES),
    ],
    provenance: {
      observedChainId: input.preparedExecution.chainId,
      fetchedAt,
      mode,
      source,
      simulationBlock: blockNumber,
    },
    checkedScope,
    unknownScope,
    providerData,
  });
  return evidence;
}

export const mapNativeRpcProviderResult = toNativeRpcGenericEvidence;

function genericProviderStatus(status: NativeRpcStatus): GenericProviderStatus {
  switch (status) {
    case "success":
      // The Native RPC surface is deliberately partial even when both methods
      // return successfully; no receipt/outcome/asset changes were observed.
      return "UNKNOWN";
    case "unknown":
      return "UNKNOWN";
    case "unsupported":
      return "UNSUPPORTED";
    case "stale":
      return "STALE";
    case "timeout":
    case "failed":
    case "invalid":
      return "FAILED";
  }
}

function toGenericIntent(
  intent: NormalizedSwapIntent | GenericSwapIntent,
  tokenInDecimals: number,
  tokenOutDecimals: number,
): GenericSwapIntent {
  if (!("economicBoundary" in intent)) return { ...intent };
  const boundary = intent.economicBoundary;
  return {
    chainId: intent.chainId,
    protocol: intent.protocol,
    sender: intent.sender,
    tokenIn:
      intent.tokenIn.kind === "native" ? "native" : intent.tokenIn.address,
    tokenOut:
      intent.tokenOut.kind === "native" ? "native" : intent.tokenOut.address,
    amountIn: convertAtomicAmountToHuman(
      intent.amountInAtomic,
      tokenInDecimals,
    ),
    ...(boundary.availability === "available"
      ? {
          minimumReceived: convertAtomicAmountToHuman(
            boundary.minimumReceivedAtomic,
            tokenOutDecimals,
          ),
          minimumReceivedSource: boundary.source,
        }
      : { minimumReceivedSource: "unavailable" }),
  };
}

function quoteField(
  quote: unknown,
  source: "mock" | "rpc",
  blockNumber: string,
  fetchedAt: string,
) {
  if (!isRecord(quote)) return jsonField(null, source, blockNumber, fetchedAt);
  const estimatedAmountOut = quote.estimatedAmountOut;
  const minimumAmountOut = quote.minimumAmountOut;
  if (
    typeof estimatedAmountOut !== "string" ||
    !/^\d+(?:\.\d+)?$/.test(estimatedAmountOut) ||
    (minimumAmountOut !== undefined &&
      (typeof minimumAmountOut !== "string" ||
        !/^\d+(?:\.\d+)?$/.test(minimumAmountOut)))
  ) {
    return jsonField(null, source, blockNumber, fetchedAt);
  }
  return {
    value: {
      estimatedAmountOut,
      ...(minimumAmountOut === undefined ? {} : { minimumAmountOut }),
    },
    source: source === "mock" ? "mock" : "quote",
    reproducibility: source === "mock" ? "NOT_REPRODUCIBLE" : "REPRODUCIBLE",
    blockNumber,
    fetchedAt,
  };
}

function jsonField(
  value: ProvisionalJsonValue | null,
  source: "mock" | "rpc",
  blockNumber: string,
  fetchedAt: string,
) {
  return {
    value,
    source,
    reproducibility: source === "mock" ? "NOT_REPRODUCIBLE" : "REPRODUCIBLE",
    blockNumber,
    fetchedAt,
  } as const;
}

function arrayField(
  value: readonly ProvisionalJsonValue[] | null,
  source: "mock" | "rpc",
  blockNumber: string,
  fetchedAt: string,
) {
  return jsonField(
    value === null ? null : [...value],
    source,
    blockNumber,
    fetchedAt,
  );
}

function stringField(
  value: string,
  source: "mock" | "rpc",
  blockNumber: string,
  fetchedAt: string,
) {
  return jsonField(value, source, blockNumber, fetchedAt);
}

function reproducibility(mode: NativeRpcProviderMode) {
  return mode === "MOCK" ? "NOT_REPRODUCIBLE" : "REPRODUCIBLE";
}

function providerModeFromResult(
  result: ProviderEvaluationResult,
): NativeRpcProviderMode | undefined {
  if (result.responseEvidence?.kind !== "redacted_snapshot") return undefined;
  const snapshot = result.responseEvidence.snapshot;
  if (!isRecord(snapshot)) return undefined;
  const mode = snapshot.mode;
  return mode === "LIVE" || mode === "RECORDED_REPLAY" || mode === "MOCK"
    ? mode
    : undefined;
}

function freshnessFromCandidate(
  field: ProvisionalCandidateFieldInput | undefined,
): Freshness {
  if (field === undefined) {
    return { status: "not_checked" };
  }
  if (field.status !== "observed") {
    return {
      status: "unknown",
      reason:
        typeof field.value === "string"
          ? field.value
          : (field.semanticNote ??
            "Native RPC freshness metadata is unavailable"),
    };
  }
  if (!isRecord(field.value)) {
    return {
      status: "unknown",
      reason: "Native RPC freshness metadata is incomplete",
    };
  }
  const status = field.value.status;
  if (status === "fresh" || status === "stale") {
    const pinnedBlock = field.value.pinnedBlock;
    const headBlock = field.value.headBlock;
    const lag = field.value.lag;
    const maxBlockLag = field.value.maxBlockLag;
    if (
      typeof pinnedBlock === "string" &&
      typeof headBlock === "string" &&
      typeof lag === "string" &&
      typeof maxBlockLag === "number"
    ) {
      return { status, pinnedBlock, headBlock, lag, maxBlockLag };
    }
  }
  return {
    status: "unknown",
    reason: "Native RPC freshness metadata is incomplete",
  };
}

function validatePreparedExecution<Intent extends NativeRpcIntent>(
  input: NativeRpcProviderInput<Intent>,
): string | undefined {
  if (!isRecord(input) || !isRecord(input.input)) {
    return "Native RPC requires a prepared execution object";
  }
  const prepared = input.input;
  if (!isRecord(prepared.intent)) {
    return "Native RPC requires a prepared intent";
  }
  if (
    typeof input.runId !== "string" ||
    input.runId.trim() === "" ||
    typeof prepared.runId !== "string" ||
    prepared.runId !== input.runId
  ) {
    return "Native RPC requires a prepared execution for the requested run";
  }
  if (
    input.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID ||
    input.protocol !== "camelot-v3" ||
    prepared.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID ||
    prepared.protocol !== "camelot-v3" ||
    prepared.intent.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID ||
    prepared.intent.protocol !== "camelot-v3" ||
    !isDeepStrictEqual(prepared.intent, input.intent)
  ) {
    return "Native RPC requires a matching Arbitrum Sepolia Camelot V3 execution";
  }
  if (
    typeof prepared.intent.sender !== "string" ||
    prepared.intent.sender.trim() === ""
  ) {
    return "Native RPC requires a prepared sender intent";
  }
  if (!isRecord(prepared.blockContext)) {
    return "Native RPC requires a pinned block context";
  }
  if (!isDecimalQuantity(prepared.blockContext.blockNumber)) {
    return "Native RPC requires a decimal pinned block number";
  }
  if (prepared.quote === undefined || prepared.quote === null) {
    return "Native RPC requires a prepared quote";
  }
  const unsignedTransaction = prepared.unsignedTransaction;
  if (
    !isRecord(unsignedTransaction) ||
    unsignedTransaction.kind !== "unsigned" ||
    !isRecord(unsignedTransaction.payload)
  ) {
    return "Native RPC requires a prepared unsigned transaction";
  }
  const payload = unsignedTransaction.payload;
  if (
    Object.values(payload).some(
      (value) => value !== undefined && typeof value !== "string",
    )
  ) {
    return "Native RPC requires string-valued transaction fields";
  }
  if (
    typeof payload.to !== "string" ||
    payload.to.trim() === "" ||
    typeof payload.data !== "string" ||
    !isHexData(payload.data)
  ) {
    return "Native RPC requires transaction to and calldata";
  }
  if (
    typeof payload.from === "string" &&
    payload.from.toLowerCase() !== prepared.intent.sender.toLowerCase()
  ) {
    return "Native RPC requires the prepared transaction sender to match the intent";
  }
  if (
    !isRecord(prepared.gasEstimate) ||
    !isDecimalQuantity(prepared.gasEstimate.gasUnits)
  ) {
    return "Native RPC requires a prepared decimal gas estimate";
  }
  if (
    !isRecord(prepared.finality) ||
    !isFinalityStatus(prepared.finality.status)
  ) {
    return "Native RPC requires a prepared finality status";
  }
  return undefined;
}

function transactionForRpc<Intent extends NativeRpcIntent>(
  intent: Intent,
  prepared: NativeRpcPreparedExecution<Intent>,
): ArbitrumTransaction {
  const payload = prepared.unsignedTransaction.payload;
  const transaction: Record<string, string | undefined> = {
    from: intent.sender,
  };
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    if (typeof value === "string") transaction[key] = value;
  }
  if (transaction.value === undefined) transaction.value = "0x0";
  return transaction;
}

function candidate(
  candidatePath: string,
  observedShape: string,
  status: ProvisionalCandidateFieldInput["status"],
  value?: ProvisionalJsonValue,
  sourcePath?: string,
  semanticNote?: string,
): ProvisionalCandidateFieldInput {
  return {
    candidatePath,
    ...(sourcePath === undefined ? {} : { sourcePath }),
    observedShape,
    nullable: status !== "observed",
    ...(semanticNote === undefined ? {} : { semanticNote }),
    status,
    confidence: status === "observed" ? "medium" : "unassessed",
    ...(value === undefined ? {} : { value }),
  };
}

function classifyRpcFailure(error: unknown): ClassifiedRpcFailure {
  const candidate = error as RpcError | undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (candidate?.rpcCode === -32601) {
    return { status: "unsupported", message, retryable: false };
  }
  if (candidate?.rpcCode === -32602) {
    return { status: "unknown", message, retryable: false };
  }
  if (/invalid (?:hex|quantity)|execution reverted|revert/i.test(message)) {
    return { status: "unknown", message, retryable: false };
  }
  if (candidate?.name === "AbortError" || /timeout|timed out/i.test(message)) {
    return { status: "timeout", message, retryable: true };
  }
  return { status: "failed", message, retryable: false };
}

type ClassifiedRpcFailure = {
  readonly status: FailureStatus;
  readonly message: string;
  readonly retryable: boolean;
};

function normalizeQuantity(value: unknown): string {
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value !== "string")
    throw new Error("RPC returned an invalid quantity");
  if (/^\d+$/.test(value)) return BigInt(value).toString();
  if (/^0x[0-9a-f]+$/i.test(value)) return BigInt(value).toString();
  throw new Error("RPC returned an invalid quantity");
}

function decimalToHex(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function isDecimalQuantity(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isFinalityStatus(
  value: unknown,
): value is NativeRpcPreparedExecution["finality"]["status"] {
  return (
    value === "unknown" ||
    value === "pending" ||
    value === "confirmed" ||
    value === "finalized"
  );
}

function isHexData(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]*$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValueOrNull(value: unknown): ProvisionalJsonValue | null {
  return toJsonValue(value) ?? null;
}

function toJsonValue(value: unknown): ProvisionalJsonValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const values = value.map(toJsonValue);
    return values.some((entry) => entry === undefined)
      ? undefined
      : (values as ProvisionalJsonValue[]);
  }
  if (isRecord(value)) {
    const result: Record<string, ProvisionalJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalized = toJsonValue(entry);
      if (normalized === undefined) return undefined;
      result[key] = normalized;
    }
    return result;
  }
  return undefined;
}
