import { isDeepStrictEqual } from "node:util";
import type { ArbitrumTransaction } from "./arbitrum-chain-adapter.js";
import type { ChainOperationOptions } from "./chain-adapter.js";
import {
  createNativeRpcClient,
  NativeRpcClientError,
} from "./native-rpc-client.js";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  NATIVE_RPC_ARBITRUM_PROVIDER_ID,
  NATIVE_RPC_CAPABILITIES,
  type NativeRpcIntent,
  type NativeRpcPreparedExecution,
  type NativeRpcProviderMode,
} from "./native-rpc-evidence.js";
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

export {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  NATIVE_RPC_ARBITRUM_PROVIDER_ID,
  NATIVE_RPC_CAPABILITIES,
  type NativeRpcIntent,
  type NativeRpcPreparedExecution,
  type NativeRpcProviderMode,
} from "./native-rpc-evidence.js";

export type NativeRpcClient = {
  request(
    method: string,
    params?: readonly unknown[],
    options?: ChainOperationOptions,
  ): Promise<unknown>;
};

export type NativeRpcProviderOptions = {
  readonly client?: NativeRpcClient;
  /** Explicit runtime endpoint. Never serialized into a Provider result. */
  readonly rpcUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  /** Explicit truthfulness mode used by the Generic Evidence mapper. */
  readonly mode?: NativeRpcProviderMode;
  readonly providerVersion?: string;
  readonly now?: () => string;
  /** Opt-in head read used to classify pinned-block freshness. */
  readonly checkFreshness?: boolean;
  /** Maximum allowed head minus pinned block lag when freshness is checked. */
  readonly maxBlockLag?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
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
  observedChainId?: string;
  readonly callReturnData?: string;
  readonly gasUnits?: string;
  freshness: Freshness;
  readonly fields: ProvisionalCandidateFieldInput[];
};

/**
 * Provider-owned, replaceable Native RPC implementation.
 *
 * This class intentionally exposes only a factory-created ProviderAdapter to
 * the registry. The injected client is a controlled fixture/runtime seam and
 * an explicit rpcUrl creates a real JSON-RPC client. No endpoint is guessed.
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
  private readonly client: NativeRpcClient;

  public constructor(private readonly options: NativeRpcProviderOptions) {
    if (options.client !== undefined && options.rpcUrl !== undefined) {
      throw new TypeError("Native RPC accepts either client or rpcUrl");
    }
    if (
      options.client !== undefined &&
      (options.client === null || typeof options.client.request !== "function")
    ) {
      throw new TypeError("Native RPC client.request is required");
    }
    this.client =
      options.client ??
      createNativeRpcClient({
        rpcUrl: options.rpcUrl ?? "",
        fetchImplementation: options.fetchImplementation,
      });
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
    this.providerVersion = options.providerVersion ?? "native-rpc-provider-v1";
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
    const invalid = validatePreparedExecution(input);
    if (invalid !== undefined) {
      return this.result(input.runId, "unknown", {
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

    const transaction = input.input.unsignedTransaction
      .payload as ArbitrumTransaction;
    const blockTag = decimalToHex(input.input.blockContext.blockNumber);
    const state: EvaluationState = {
      fields: [],
      freshness: { status: "not_checked" },
    };

    try {
      const response = await this.request("eth_chainId", []);
      if (!isHexQuantity(response)) {
        return this.result(input.runId, "unknown", {
          ...state,
          fields: [
            candidate(
              "nativeRpc.chainId",
              "hex_quantity",
              "invalid",
              "eth_chainId returned an invalid quantity",
            ),
          ],
          freshness: {
            status: "unknown",
            reason: "RPC chain identity is invalid",
          },
        });
      }
      state.observedChainId = response;
      state.fields.push(
        candidate(
          "nativeRpc.chainId",
          "hex_quantity",
          "observed",
          response,
          "$.result",
        ),
      );
      if (BigInt(response) !== BigInt(ARBITRUM_SEPOLIA_CHAIN_ID)) {
        return this.result(input.runId, "unknown", {
          ...state,
          freshness: {
            status: "unknown",
            reason: "RPC chain identity does not match Arbitrum Sepolia",
          },
        });
      }
    } catch (error) {
      const classified = classifyRpcFailure(error);
      return this.result(
        input.runId,
        classified.status,
        {
          ...state,
          fields: [
            candidate(
              "nativeRpc.chainId",
              "hex_quantity",
              "missing",
              undefined,
              "$.result",
              classified.message,
            ),
          ],
          freshness: {
            status: "unknown",
            reason: "RPC chain identity unavailable",
          },
        },
        { failure: classified },
      );
    }

    try {
      const observed = await this.request("eth_getBlockByNumber", [
        blockTag,
        false,
      ]);
      if (
        !isRecord(observed) ||
        observed.number !== blockTag ||
        !isBlockHash(observed.hash) ||
        (input.input.blockContext.blockHash !== undefined &&
          observed.hash.toLowerCase() !==
            input.input.blockContext.blockHash.toLowerCase())
      ) {
        return this.result(input.runId, "unknown", {
          ...state,
          fields: [
            candidate(
              "nativeRpc.pinnedBlock",
              "block",
              "invalid",
              "Pinned block could not be verified",
            ),
          ],
          freshness: {
            status: "unknown",
            reason: "Pinned block could not be verified",
          },
        });
      }
      state.fields.push(
        candidate(
          "nativeRpc.blockContext.blockNumber",
          "decimal_string",
          "observed",
          input.input.blockContext.blockNumber,
          "$.result.number",
        ),
        candidate(
          "nativeRpc.blockContext.blockHash",
          "hex_string",
          "observed",
          observed.hash,
          "$.result.hash",
        ),
      );
    } catch (error) {
      const classified = classifyRpcFailure(error);
      return this.result(
        input.runId,
        classified.status,
        {
          ...state,
          fields: [
            candidate(
              "nativeRpc.pinnedBlock",
              "block",
              "missing",
              undefined,
              "$.result",
              classified.message,
            ),
          ],
          freshness: { status: "unknown", reason: "Pinned block unavailable" },
        },
        { failure: classified },
      );
    }

    let callReturnData: string;
    try {
      const response = await this.request("eth_call", [transaction, blockTag]);
      if (!isHexData(response)) {
        return this.result(input.runId, "unknown", {
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
      return this.result(input.runId, classified.status, state, {
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
      return this.result(input.runId, classified.status, state, {
        failure: classified,
      });
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
          return this.result(input.runId, "unknown", state);
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
          return this.result(input.runId, "stale", state);
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
        return this.result(input.runId, "unknown", state, {
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
    return this.result(input.runId, "success", {
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
      const controller = new AbortController();
      const externalSignal = this.options.signal;
      const onAbort = () => {
        controller.abort();
        settle(() =>
          reject(
            new NativeRpcClientError(
              "ABORTED",
              "Native RPC request was cancelled",
            ),
          ),
        );
      };
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onAbort);
        callback();
      };
      const timer = setTimeout(() => {
        controller.abort();
        settle(() =>
          reject(
            new NativeRpcClientError("TIMEOUT", "Native RPC request timed out"),
          ),
        );
      }, this.timeoutMs);
      externalSignal?.addEventListener("abort", onAbort, { once: true });
      if (externalSignal?.aborted) onAbort();
      if (settled) return;
      void Promise.resolve()
        .then(() =>
          this.client.request(method, params, {
            timeoutMs: this.timeoutMs,
            signal: controller.signal,
          }),
        )
        .then(
          (value) => settle(() => resolve(value)),
          (error: unknown) => settle(() => reject(error)),
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
    status: NativeRpcStatus,
    state: EvaluationState,
    options: { readonly failure?: ClassifiedRpcFailure } = {},
  ): ProviderEvaluationResult {
    const observedAt = this.observedAt();
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
            eth_chainId: state.observedChainId ?? null,
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
                  ...(options.failure.rpcCode === undefined
                    ? {}
                    : {
                        rpcCode: options.failure.rpcCode,
                      }),
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
    !isAddress(prepared.intent.sender)
  ) {
    return "Native RPC requires a prepared sender intent";
  }
  if (!isRecord(prepared.blockContext)) {
    return "Native RPC requires a pinned block context";
  }
  if (!isDecimalQuantity(prepared.blockContext.blockNumber)) {
    return "Native RPC requires a decimal pinned block number";
  }
  if (
    prepared.blockContext.blockHash !== undefined &&
    !isBlockHash(prepared.blockContext.blockHash)
  ) {
    return "Native RPC requires a valid pinned block hash";
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
    !isAddress(payload.from) ||
    !isAddress(payload.to) ||
    !isHexData(payload.data) ||
    !isHexQuantity(payload.value)
  ) {
    return "Native RPC requires exact from, to, calldata, and value";
  }
  if (payload.from.toLowerCase() !== prepared.intent.sender.toLowerCase()) {
    return "Native RPC requires the prepared transaction sender to match the intent";
  }
  if (
    payload.chainId !== undefined &&
    payload.chainId !== decimalToHex(String(prepared.chainId))
  ) {
    return "Native RPC transaction chainId differs from prepared execution";
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
  const message =
    error instanceof NativeRpcClientError
      ? error.message
      : "Native RPC request failed";
  if (error instanceof NativeRpcClientError) {
    if (error.kind === "TIMEOUT")
      return { status: "timeout", message, retryable: true };
    if (error.kind === "ABORTED")
      return { status: "unknown", message, retryable: false };
    if (
      error.kind === "ID_MISMATCH" ||
      error.kind === "INVALID_ENVELOPE" ||
      error.kind === "MISSING_RESULT" ||
      error.kind === "JSON_PARSE_FAILURE"
    ) {
      return { status: "unknown", message, retryable: false };
    }
  }
  if (candidate?.rpcCode === -32601) {
    return {
      status: "unsupported",
      message,
      retryable: false,
      rpcCode: -32601,
    };
  }
  if (candidate?.rpcCode === -32602) {
    return { status: "unknown", message, retryable: false, rpcCode: -32602 };
  }
  if (
    /invalid (?:hex|quantity)|execution reverted|revert/i.test(
      error instanceof Error ? error.message : "",
    )
  ) {
    return {
      status: "unknown",
      message,
      retryable: false,
      rpcCode: candidate?.rpcCode,
    };
  }
  if (
    candidate?.name === "AbortError" ||
    /timeout|timed out/i.test(error instanceof Error ? error.message : "")
  ) {
    return { status: "timeout", message, retryable: true };
  }
  return {
    status: "failed",
    message,
    retryable: false,
    rpcCode: candidate?.rpcCode,
  };
}

type ClassifiedRpcFailure = {
  readonly status: FailureStatus;
  readonly message: string;
  readonly retryable: boolean;
  readonly rpcCode?: number;
};

function normalizeQuantity(value: unknown): string {
  if (isHexQuantity(value)) return BigInt(value).toString();
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
  return typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(value);
}

function isHexQuantity(value: unknown): value is string {
  return (
    typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)
  );
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
}

function isBlockHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
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
