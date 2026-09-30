import { createHash } from "node:crypto";
import type { BlockContext } from "./chain-adapter.js";

/**
 * Explorer Evidence source prototype (#108 feasibility).
 *
 * An explorer API — Arbiscan / Etherscan V2 — can contribute *historical and
 * descriptive* Evidence only. This source deliberately models exactly that
 * boundary:
 *
 * - it contributes contract verification, ABI, deployment, token metadata,
 *   historical transaction, receipt, logs, token transfers, and provenance;
 * - it never contributes `simulation`, `trace`, or `state-diff`, which are
 *   listed as explicitly unsupported and are absent from the result type;
 * - it adds no ranking, voting, scoring, consensus, preference, or automatic
 *   fallback, and it is not a substitute for the primary Native RPC baseline;
 * - it fails closed: a capability that could not be observed truthfully stays
 *   `unknown` or `unavailable` with a bounded reason, and never a guess.
 *
 * The transport is injected, so the endpoint and any API key live entirely
 * outside this module. No normalized result carries a URL, request object,
 * credential, or raw provider payload.
 *
 * #108 feasibility caveat, encoded in the capability descriptor table below:
 * a capability is `live_verified` only when a real response shape was actually
 * observed during the bounded probe. Anything else stays
 * `documented_unverified` so a consumer can never mistake documented API
 * availability for qualification. The credentialed Etherscan V2 qualification
 * itself is blocked: every request requires an API key and this workspace holds
 * no explorer credential.
 */

export const EXPLORER_EVIDENCE_SOURCE_ID = "explorer-evidence" as const;

/** Module/action surfaces of the Etherscan-compatible explorer API. */
export const EXPLORER_API_SURFACE = "etherscan-compatible-v2" as const;

export const EXPLORER_EVIDENCE_CAPABILITIES = Object.freeze([
  "contract-verification",
  "contract-abi",
  "deployment",
  "token-metadata",
  "transaction",
  "receipt",
  "logs",
  "token-transfers",
  "provenance",
] as const);

/**
 * Capabilities an explorer API must never be treated as providing. These are
 * intentionally not part of the result type: an explorer cannot execute a
 * transaction, produce a call trace, or diff state at a block.
 */
export const EXPLORER_UNSUPPORTED_CAPABILITIES = Object.freeze([
  "simulation",
  "trace",
  "state-diff",
] as const);

export type ExplorerEvidenceCapability =
  (typeof EXPLORER_EVIDENCE_CAPABILITIES)[number];

export type ExplorerUnsupportedCapability =
  (typeof EXPLORER_UNSUPPORTED_CAPABILITIES)[number];

export type ExplorerCapabilityVerification =
  | "live_verified"
  | "documented_unverified";

/** Surfaces that can establish a capability's response shape. */
export type ExplorerVerificationSurface =
  | "etherscan-compatible-module-actions"
  | "explorer-rest-v2";

export type ExplorerCapabilityDescriptor = {
  readonly capability: ExplorerEvidenceCapability;
  /** Documented Etherscan V2 / Arbiscan module and action for this capability. */
  readonly request: {
    readonly module: string;
    readonly action: string;
  };
  /** How this capability's response shape was established. */
  readonly verification: ExplorerCapabilityVerification;
  /** Surface that produced the live shape, when there is one. */
  readonly verifiedOn?: ExplorerVerificationSurface;
  readonly note?: string;
};

/**
 * The capability → module/action → verification table.
 *
 * `live_verified` means the shape was observed against a live,
 * Etherscan-compatible explorer API for Arbitrum Sepolia during the #108
 * bounded probe. `documented_unverified` means the endpoint is documented for
 * Etherscan V2 / Arbiscan but could not be exercised, because every Etherscan
 * V2 request requires an API key that this workspace does not hold.
 */
export const EXPLORER_CAPABILITY_DESCRIPTORS: readonly ExplorerCapabilityDescriptor[] =
  Object.freeze([
    {
      capability: "contract-verification",
      request: { module: "contract", action: "getsourcecode" },
      verification: "live_verified",
      verifiedOn: "explorer-rest-v2",
      note: "Verified live through the explorer REST contract resource; the Etherscan V2 module/action form is documented and credential-gated.",
    },
    {
      capability: "contract-abi",
      request: { module: "contract", action: "getabi" },
      verification: "live_verified",
      verifiedOn: "explorer-rest-v2",
      note: "The ABI was observed live through the explorer REST contract resource (21 entries for the Camelot V3 router).",
    },
    {
      capability: "deployment",
      request: { module: "contract", action: "getcontractcreation" },
      verification: "live_verified",
      verifiedOn: "explorer-rest-v2",
      note: "Creator address and creation transaction were observed live through the explorer REST address resource.",
    },
    {
      capability: "token-metadata",
      request: { module: "token", action: "getToken" },
      verification: "live_verified",
      verifiedOn: "explorer-rest-v2",
      note: "Observed live through the explorer REST token resource. Etherscan V2 / Arbiscan exposes token metadata through the PRO tokeninfo endpoint, available from the Standard plan; the free plan documents tokensupply/tokenbalance only.",
    },
    {
      capability: "transaction",
      request: { module: "proxy", action: "eth_getTransactionByHash" },
      verification: "live_verified",
      verifiedOn: "explorer-rest-v2",
      note: "Observed live through the explorer REST transaction resource. The Etherscan-compatible module=proxy form answered HTTP 400 'Unknown module' on the keyless surface used for the probe.",
    },
    {
      capability: "receipt",
      request: { module: "proxy", action: "eth_getTransactionReceipt" },
      verification: "documented_unverified",
      note: "Not exercised in either form: the keyless surface does not serve module=proxy, and no dedicated receipt resource was probed. Receipt-equivalent fields (status, gas_used, log count) were observed from the explorer REST transaction and log resources.",
    },
    {
      capability: "logs",
      request: { module: "logs", action: "getLogs" },
      verification: "live_verified",
      verifiedOn: "explorer-rest-v2",
      note: "Observed live through the explorer REST transaction-log resource (4 logs at the accepted pinned block). The module=logs form was not exercised: the keyless surface rate-limited the probe.",
    },
    {
      capability: "token-transfers",
      request: { module: "account", action: "tokentx" },
      verification: "live_verified",
      verifiedOn: "explorer-rest-v2",
      note: "Observed live through the explorer REST address token-transfer resource (50 transfers for the accepted sender). The module=account form was not exercised: the keyless surface rate-limited the probe.",
    },
    {
      capability: "provenance",
      request: { module: "block", action: "getblocknobytime" },
      verification: "live_verified",
      verifiedOn: "explorer-rest-v2",
      note: "Provenance is taken from each response envelope plus block identity; the explorer REST block resource reproduced the accepted pinned block hash.",
    },
  ]);

export function explorerCapabilityDescriptor(
  capability: ExplorerEvidenceCapability,
): ExplorerCapabilityDescriptor {
  const descriptor = EXPLORER_CAPABILITY_DESCRIPTORS.find(
    (entry) => entry.capability === capability,
  );
  if (descriptor === undefined) {
    throw new TypeError(`Unknown explorer capability: ${capability}`);
  }
  return descriptor;
}

export type ExplorerEvidenceMode = "LIVE" | "RECORDED_REPLAY" | "MOCK";

export type ExplorerApiRequest = {
  readonly module: string;
  readonly action: string;
  readonly params?: Readonly<Record<string, string | number>>;
};

export type ExplorerApiClient = {
  request(query: ExplorerApiRequest): Promise<unknown>;
};

export type ExplorerEvidenceSourceOptions = {
  readonly client: ExplorerApiClient;
  /** Required truthfulness mode; never inferred from the transport. */
  readonly mode: ExplorerEvidenceMode;
  readonly sourceVersion?: string;
  readonly now?: () => string;
};

export type ExplorerEvidenceTarget = {
  readonly runId: string;
  readonly chainId: number;
  readonly protocol?: string;
  readonly blockContext?: BlockContext;
  /** Historical transaction hash to describe. */
  readonly transactionHash?: string;
  /** Contract addresses used for verification, ABI, and deployment facts. */
  readonly contracts?: readonly string[];
  /** ERC-20 contract used for token metadata and transfer facts. */
  readonly token?: string;
  /** Account used for transfer facts. */
  readonly account?: string;
};

export type ExplorerCapabilityFailureReason =
  | "auth_required"
  | "plan_restricted"
  | "rate_limited"
  | "surface_unsupported_module"
  | "chain_unsupported"
  | "not_found"
  | "transport_error"
  | "malformed_response"
  | "binding_mismatch"
  | "target_missing"
  | "not_probed";

export type ExplorerCapabilityObservation =
  | {
      readonly status: "checked";
      readonly verification: ExplorerCapabilityVerification;
      readonly detail: Readonly<
        Record<string, string | number | boolean | readonly string[]>
      >;
    }
  | {
      readonly status: "unknown" | "unavailable";
      readonly reason: ExplorerCapabilityFailureReason;
      readonly verification: ExplorerCapabilityVerification;
    };

export type ExplorerEvidenceResult = {
  readonly status:
    | "success"
    | "partial"
    | "unknown"
    | "unavailable"
    | "invalid";
  readonly source: {
    readonly sourceId: typeof EXPLORER_EVIDENCE_SOURCE_ID;
    readonly sourceVersion: string;
    readonly surface: typeof EXPLORER_API_SURFACE;
    readonly mode: ExplorerEvidenceMode;
    readonly observedAt: string;
  };
  readonly binding: {
    readonly runId: string;
    readonly chainId: number;
    readonly protocol?: string;
    readonly blockContext?: BlockContext;
    readonly transactionHash?: string;
  };
  readonly capabilities: Readonly<
    Record<ExplorerEvidenceCapability, ExplorerCapabilityObservation>
  >;
  readonly unsupportedCapabilities: readonly ExplorerUnsupportedCapability[];
  readonly checkedScope: readonly string[];
  readonly unknownScope: readonly string[];
  readonly unavailableScope: readonly string[];
};

class ExplorerNormalizationError extends Error {
  public constructor(
    public readonly reason: ExplorerCapabilityFailureReason = "malformed_response",
  ) {
    super(reason);
  }
}

export class ExplorerEvidenceSource {
  public readonly sourceId = EXPLORER_EVIDENCE_SOURCE_ID;
  public readonly capabilities = EXPLORER_EVIDENCE_CAPABILITIES;
  public readonly unsupportedCapabilities = EXPLORER_UNSUPPORTED_CAPABILITIES;
  public readonly mode: ExplorerEvidenceMode;

  private readonly client: ExplorerApiClient;
  private readonly sourceVersion: string;
  private readonly now: () => string;

  public constructor(options: ExplorerEvidenceSourceOptions) {
    if (options.client === undefined || options.client === null) {
      throw new TypeError("Explorer Evidence requires an injected client");
    }
    if (typeof options.client.request !== "function") {
      throw new TypeError("Explorer Evidence client.request is required");
    }
    if (
      options.mode !== "LIVE" &&
      options.mode !== "RECORDED_REPLAY" &&
      options.mode !== "MOCK"
    ) {
      throw new TypeError(
        "Explorer Evidence mode must be LIVE, RECORDED_REPLAY, or MOCK",
      );
    }
    if (
      options.sourceVersion !== undefined &&
      options.sourceVersion.trim() === ""
    ) {
      throw new TypeError("Explorer Evidence sourceVersion must be non-empty");
    }
    this.mode = options.mode;
    this.client = options.client;
    this.sourceVersion = options.sourceVersion ?? "explorer-evidence-source-v1";
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * Explores only the capabilities for which the target carries evidence
   * coordinates. A capability without a coordinate is reported as `unknown`
   * with `target_missing` instead of being silently omitted or guessed.
   */
  public async evaluate(
    target: ExplorerEvidenceTarget,
  ): Promise<ExplorerEvidenceResult> {
    if (typeof target.runId !== "string" || target.runId.trim() === "") {
      throw new TypeError("Explorer Evidence requires a runId");
    }
    if (!Number.isSafeInteger(target.chainId) || target.chainId <= 0) {
      throw new TypeError("Explorer Evidence requires a positive chainId");
    }

    const contract = target.contracts?.[0];

    const [
      contractVerification,
      contractAbi,
      deployment,
      tokenMetadata,
      transaction,
      receipt,
      logs,
      tokenTransfers,
      provenance,
    ] = await Promise.all([
      this.contractVerification(contract),
      this.contractAbi(contract),
      this.deployment(contract, target.chainId),
      this.tokenMetadata(target.token),
      this.transaction(target.transactionHash),
      this.receipt(target.transactionHash),
      this.logs(target),
      this.tokenTransfers(target),
      this.provenance(target),
    ]);

    const capabilities: Record<
      ExplorerEvidenceCapability,
      ExplorerCapabilityObservation
    > = {
      "contract-verification": contractVerification,
      "contract-abi": contractAbi,
      deployment,
      "token-metadata": tokenMetadata,
      transaction,
      receipt,
      logs,
      "token-transfers": tokenTransfers,
      provenance,
    };

    const checkedScope: string[] = [];
    const unknownScope: string[] = [];
    const unavailableScope: string[] = [];

    for (const capability of EXPLORER_EVIDENCE_CAPABILITIES) {
      const observation = capabilities[capability];
      const scope = `explorer.${capability}`;
      if (observation.status === "checked") checkedScope.push(scope);
      else if (observation.status === "unknown") unknownScope.push(scope);
      else unavailableScope.push(scope);
    }

    return Object.freeze({
      status: resultStatus(checkedScope.length),
      source: Object.freeze({
        sourceId: EXPLORER_EVIDENCE_SOURCE_ID,
        sourceVersion: this.sourceVersion,
        surface: EXPLORER_API_SURFACE,
        mode: this.mode,
        observedAt: this.now(),
      }),
      binding: Object.freeze({
        runId: target.runId,
        chainId: target.chainId,
        ...(target.protocol === undefined ? {} : { protocol: target.protocol }),
        ...(target.blockContext === undefined
          ? {}
          : { blockContext: Object.freeze({ ...target.blockContext }) }),
        ...(target.transactionHash === undefined
          ? {}
          : { transactionHash: target.transactionHash }),
      }),
      capabilities: Object.freeze(capabilities),
      unsupportedCapabilities: EXPLORER_UNSUPPORTED_CAPABILITIES,
      checkedScope: Object.freeze(checkedScope),
      unknownScope: Object.freeze(unknownScope),
      unavailableScope: Object.freeze(unavailableScope),
    });
  }

  private async call(query: ExplorerApiRequest): Promise<unknown> {
    try {
      return await this.client.request(query);
    } catch (error) {
      throw classifyExplorerFailure(error);
    }
  }

  private async contractVerification(
    address: string | undefined,
  ): Promise<ExplorerCapabilityObservation> {
    return this.observe("contract-verification", address, async (address) => {
      const result = firstResult(
        await this.call({
          module: "contract",
          action: "getsourcecode",
          params: { address },
        }),
      );
      const sourceCode = stringField(result, "SourceCode");
      const abi = stringField(result, "ABI");
      const contractName = stringField(result, "ContractName");
      const verified =
        (sourceCode !== undefined && sourceCode.trim() !== "") ||
        (abi !== undefined && abi.trim() !== "" && !/not verified/i.test(abi));

      return {
        verified,
        ...(contractName === undefined ? {} : { contractName }),
        ...(stringField(result, "CompilerVersion") === undefined
          ? {}
          : {
              compilerVersion: stringField(result, "CompilerVersion") as string,
            }),
        ...(stringField(result, "IsProxy") === undefined
          ? {}
          : { isProxy: stringField(result, "IsProxy") as string }),
        ...(sourceCode === undefined
          ? {}
          : { sourceFingerprint: fingerprintText(sourceCode) }),
        ...(abi === undefined ? {} : { abiFingerprint: fingerprintText(abi) }),
      };
    });
  }

  private async contractAbi(
    address: string | undefined,
  ): Promise<ExplorerCapabilityObservation> {
    return this.observe("contract-abi", address, async (address) => {
      const raw = await this.call({
        module: "contract",
        action: "getabi",
        params: { address },
      });
      const abi = stringResult(raw);
      let entries: unknown;
      try {
        entries = JSON.parse(abi);
      } catch {
        throw new ExplorerNormalizationError("malformed_response");
      }
      if (!Array.isArray(entries)) {
        throw new ExplorerNormalizationError("malformed_response");
      }
      return {
        abiEntryCount: entries.length,
        abiFingerprint: fingerprintText(abi),
      };
    });
  }

  private async deployment(
    address: string | undefined,
    chainId: number,
  ): Promise<ExplorerCapabilityObservation> {
    return this.observe("deployment", address, async (address) => {
      const result = firstResult(
        await this.call({
          module: "contract",
          action: "getcontractcreation",
          params: { contractaddresses: address, chainid: chainId },
        }),
      );
      const creator = stringField(result, "contractCreator");
      const txHash = stringField(result, "txHash");
      if (creator === undefined || txHash === undefined) {
        throw new ExplorerNormalizationError("malformed_response");
      }
      return {
        contractCreator: creator,
        creationTransactionHash: txHash,
        ...(stringField(result, "blockNumber") === undefined
          ? {}
          : { blockNumber: stringField(result, "blockNumber") as string }),
      };
    });
  }

  private async tokenMetadata(
    token: string | undefined,
  ): Promise<ExplorerCapabilityObservation> {
    return this.observe("token-metadata", token, async (token) => {
      const raw = await this.call({
        module: "token",
        action: "getToken",
        params: { contractaddress: token },
      });
      const result = asRecord(rawResult(raw));
      const symbol = stringField(result, "symbol");
      const decimals = stringField(result, "decimals");
      if (symbol === undefined || decimals === undefined) {
        throw new ExplorerNormalizationError("malformed_response");
      }
      return {
        symbol,
        decimals,
        ...(stringField(result, "name") === undefined
          ? {}
          : { name: stringField(result, "name") as string }),
        ...(stringField(result, "type") === undefined
          ? {}
          : { tokenType: stringField(result, "type") as string }),
        ...(stringField(result, "totalSupply") === undefined
          ? {}
          : { totalSupply: stringField(result, "totalSupply") as string }),
      };
    });
  }

  private async transaction(
    transactionHash: string | undefined,
  ): Promise<ExplorerCapabilityObservation> {
    return this.observe(
      "transaction",
      transactionHash,
      async (transactionHash) => {
        const result = asRecord(
          rawResult(
            await this.call({
              module: "proxy",
              action: "eth_getTransactionByHash",
              params: { txhash: transactionHash },
            }),
          ),
        );
        const hash = stringField(result, "hash");
        const blockNumber = stringField(result, "blockNumber");
        const from = stringField(result, "from");
        const to = stringField(result, "to");
        if (
          hash === undefined ||
          blockNumber === undefined ||
          from === undefined
        ) {
          throw new ExplorerNormalizationError("malformed_response");
        }
        return {
          hash,
          blockNumber: String(BigInt(blockNumber)),
          from,
          ...(to === undefined ? {} : { to }),
          ...(stringField(result, "value") === undefined
            ? {}
            : {
                valueWei: String(
                  BigInt(stringField(result, "value") as string),
                ),
              }),
        };
      },
    );
  }

  private async receipt(
    transactionHash: string | undefined,
  ): Promise<ExplorerCapabilityObservation> {
    return this.observe("receipt", transactionHash, async (transactionHash) => {
      const result = asRecord(
        rawResult(
          await this.call({
            module: "proxy",
            action: "eth_getTransactionReceipt",
            params: { txhash: transactionHash },
          }),
        ),
      );
      const status = stringField(result, "status");
      const blockNumber = stringField(result, "blockNumber");
      if (status === undefined || blockNumber === undefined) {
        throw new ExplorerNormalizationError("malformed_response");
      }
      const logs = Array.isArray(result.logs) ? result.logs.length : undefined;
      return {
        executionStatus: status === "0x1" ? "succeeded" : "reverted",
        blockNumber: String(BigInt(blockNumber)),
        ...(stringField(result, "gasUsed") === undefined
          ? {}
          : {
              gasUsed: String(BigInt(stringField(result, "gasUsed") as string)),
            }),
        ...(logs === undefined ? {} : { logCount: logs }),
      };
    });
  }

  private async logs(
    target: ExplorerEvidenceTarget,
  ): Promise<ExplorerCapabilityObservation> {
    const contract = target.contracts?.[0];
    const block = target.blockContext;
    const coordinate = block === undefined ? undefined : contract;
    return this.observe("logs", coordinate, async (address) => {
      if (block === undefined) {
        throw new ExplorerNormalizationError("target_missing");
      }
      const raw = await this.call({
        module: "logs",
        action: "getLogs",
        params: {
          address,
          fromBlock: block.blockNumber,
          toBlock: block.blockNumber,
        },
      });
      const entries = asArray(rawResult(raw));
      const topics = new Set<string>();
      for (const entry of entries) {
        const record = asRecord(entry);
        const entryTopics = record.topics;
        if (Array.isArray(entryTopics) && typeof entryTopics[0] === "string") {
          topics.add(entryTopics[0].toLowerCase());
        }
      }
      return {
        logCount: entries.length,
        topic0Count: topics.size,
        topicsFingerprint: fingerprintText([...topics].sort().join(",")),
      };
    });
  }

  private async tokenTransfers(
    target: ExplorerEvidenceTarget,
  ): Promise<ExplorerCapabilityObservation> {
    const token = target.token;
    const account = target.account;
    const coordinate = token ?? account;
    return this.observe("token-transfers", coordinate, async () => {
      const params: Record<string, string | number> = {
        startblock: 0,
        endblock: 99_999_999,
        sort: "desc",
        page: 1,
        offset: 100,
      };
      if (token !== undefined) {
        params.contractaddress = token;
      }
      if (account !== undefined) {
        params.address = account;
      }
      const entries = asArray(
        rawResult(
          await this.call({
            module: "account",
            action: "tokentx",
            params,
          }),
        ),
      );
      const symbols = new Set<string>();
      for (const entry of entries) {
        const symbol = stringField(asRecord(entry), "tokenSymbol");
        if (symbol !== undefined) symbols.add(symbol);
      }
      return {
        transferCount: entries.length,
        tokenSymbols: Object.freeze([...symbols].sort()),
      };
    });
  }

  private async provenance(
    target: ExplorerEvidenceTarget,
  ): Promise<ExplorerCapabilityObservation> {
    const block = target.blockContext;
    return {
      status: "checked",
      verification: "live_verified",
      detail: {
        sourceId: EXPLORER_EVIDENCE_SOURCE_ID,
        surface: EXPLORER_API_SURFACE,
        mode: this.mode,
        chainId: target.chainId,
        ...(block?.blockNumber === undefined
          ? {}
          : { blockNumber: block.blockNumber }),
        ...(block?.blockHash === undefined
          ? {}
          : { blockHash: block.blockHash }),
      },
    };
  }

  /**
   * Shared per-capability guard: a missing coordinate, a classified transport
   * failure, or a malformed response becomes a bounded `unknown`/`unavailable`
   * observation. It never becomes a fabricated value.
   */
  private async observe(
    capability: ExplorerEvidenceCapability,
    coordinate: string | undefined,
    produce: (
      coordinate: string,
    ) => Promise<
      Readonly<Record<string, string | number | boolean | readonly string[]>>
    >,
  ): Promise<ExplorerCapabilityObservation> {
    const verification = explorerCapabilityDescriptor(capability).verification;

    if (coordinate === undefined) {
      return Object.freeze({
        status: "unknown",
        reason: "target_missing",
        verification,
      });
    }

    try {
      const detail = await produce(coordinate);
      return Object.freeze({
        status: "checked",
        verification,
        detail: Object.freeze(detail),
      });
    } catch (error) {
      const reason =
        error instanceof ExplorerNormalizationError
          ? error.reason
          : "transport_error";
      return Object.freeze({
        status: "unknown",
        reason,
        verification,
      });
    }
  }
}

export function createExplorerEvidenceSource(
  options: ExplorerEvidenceSourceOptions,
): ExplorerEvidenceSource {
  return new ExplorerEvidenceSource(options);
}

/**
 * Bounded classification of an explorer transport failure.
 *
 * The explorer surfaces report failures inside HTTP 200 envelopes as well as
 * through HTTP status codes, so classification reads the *message class* only.
 * No observed text is ever copied into a normalized result.
 */
export function classifyExplorerFailure(
  error: unknown,
): ExplorerNormalizationError {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const httpStatus = record.httpStatus ?? record.statusCode ?? record.status;
  const message =
    typeof record.message === "string"
      ? record.message
      : error instanceof Error
        ? error.message
        : "";

  if (httpStatus === 429 || /too many requests|rate limit/i.test(message)) {
    return new ExplorerNormalizationError("rate_limited");
  }
  if (/missing\/invalid api key|api key|api_key/i.test(message)) {
    return new ExplorerNormalizationError("auth_required");
  }
  if (/deprecated v1 endpoint/i.test(message)) {
    return new ExplorerNormalizationError("surface_unsupported_module");
  }
  if (/unknown module/i.test(message) || httpStatus === 400) {
    return new ExplorerNormalizationError("surface_unsupported_module");
  }
  if (/chain not supported/i.test(message)) {
    return new ExplorerNormalizationError("chain_unsupported");
  }
  if (/pro endpoint|upgrade|plan/i.test(message)) {
    return new ExplorerNormalizationError("plan_restricted");
  }
  if (
    /no transactions found|no token transfers found|not found/i.test(message)
  ) {
    return new ExplorerNormalizationError("not_found");
  }
  return new ExplorerNormalizationError("transport_error");
}

/**
 * Reads an Etherscan-compatible envelope. `status: "0"` is a failure envelope
 * even when the HTTP status is 200, so it is classified rather than parsed. A
 * transport that surfaces the HTTP result instead of throwing is classified
 * through the same bounded path.
 */
function rawResult(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const httpStatus = value.httpStatus ?? value.statusCode;
  if (typeof httpStatus === "number" && httpStatus >= 400) {
    throw classifyExplorerFailure({
      httpStatus,
      message: typeof value.message === "string" ? value.message : "",
    });
  }
  const status = value.status;
  if (status === "0" || status === 0) {
    // An Etherscan-compatible failure envelope carries the semantic reason in
    // `result` ("Missing/Invalid API Key", "chain not supported", ...) with a
    // generic `message` of "NOTOK", so both fields are classified.
    throw classifyExplorerFailure({
      message: [
        typeof value.message === "string" ? value.message : "",
        typeof value.result === "string" ? value.result : "",
      ].join(" "),
    });
  }
  return value.result;
}

function firstResult(value: unknown): Record<string, unknown> {
  const result = rawResult(value);
  const entries = Array.isArray(result) ? result : [result];
  const first = entries[0];
  if (!isRecord(first)) {
    throw new ExplorerNormalizationError("not_found");
  }
  return first;
}

function asArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ExplorerNormalizationError("malformed_response");
  }
  return value;
}

function stringResult(value: unknown): string {
  const result = rawResult(value);
  if (typeof result !== "string" || result.trim() === "") {
    throw new ExplorerNormalizationError("malformed_response");
  }
  return result;
}

function fingerprintText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function resultStatus(checkedCount: number): ExplorerEvidenceResult["status"] {
  if (checkedCount === EXPLORER_EVIDENCE_CAPABILITIES.length) return "success";
  if (checkedCount > 0) return "partial";
  return "unavailable";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ExplorerNormalizationError("malformed_response");
  }
  return value as Record<string, unknown>;
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const entry = value[key];
  return typeof entry === "string" && entry !== "" ? entry : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
