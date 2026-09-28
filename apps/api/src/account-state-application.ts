import { randomUUID } from "node:crypto";
import {
  normalizedSwapIntentSchema,
  quoteRequestSchema,
  type TrustedTokenRegistry,
} from "@parallax/contracts";
import { normalizeArbitrumQuoteRequest } from "./normalization.js";
import {
  accountStateSnapshotIdSchema,
  accountStateRequestSchema,
  accountStateObservationSchema,
  accountStateSnapshotSchema,
  sameAccountStateAsset,
  summarizeAccountState,
  type AccountStateApplicationResponse,
  type AccountStateObservation,
  type AccountStateReader,
  type AccountStateSnapshot,
  type AccountStateStore,
} from "./account-state-model.js";

export type AccountStateApplicationServiceDependencies = {
  readonly tokenRegistry: TrustedTokenRegistry;
  readonly reader?: AccountStateReader;
  readonly store?: AccountStateStore;
  readonly createSnapshotId?: () => string;
};

/** Read-only Backend boundary for normalized, persisted account snapshots. */
export class AccountStateApplicationService {
  private readonly createSnapshotId: () => string;

  public constructor(
    private readonly dependencies: AccountStateApplicationServiceDependencies,
  ) {
    this.createSnapshotId = dependencies.createSnapshotId ?? randomUUID;
  }

  public async query(request: unknown): Promise<AccountStateApplicationResponse> {
    const parsedRequest = accountStateRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      return errorResponse(400, "INVALID_REQUEST", parsedRequest.error.issues);
    }
    const reader = this.dependencies.reader;
    if (reader === undefined) {
      return errorResponse(503, "UNSUPPORTED");
    }
    const store = this.dependencies.store;
    if (store === undefined) {
      return errorResponse(503, "ACCOUNT_STATE_STORAGE_UNAVAILABLE");
    }

    const quoteRequest = quoteRequestSchema.safeParse({
      chainId: parsedRequest.data.chainId,
      protocol: parsedRequest.data.protocol,
      sender: parsedRequest.data.sender,
      tokenIn: parsedRequest.data.tokenIn,
      tokenOut: parsedRequest.data.tokenOut,
      amountIn: parsedRequest.data.amountIn,
    });
    if (!quoteRequest.success) {
      return errorResponse(400, "INVALID_REQUEST", quoteRequest.error.issues);
    }

    const normalized = normalizeArbitrumQuoteRequest(
      quoteRequest.data,
      this.dependencies.tokenRegistry,
    );
    if (!normalized.success) {
      return errorResponse(400, "NORMALIZATION_FAILED", normalized.error);
    }
    const intent = normalizedSwapIntentSchema.parse({
      ...normalized.intent,
      recipient: parsedRequest.data.recipient ?? normalized.intent.sender,
      recipientSource:
        parsedRequest.data.recipient === undefined
          ? "defaulted_from_sender"
          : "explicit",
    });

    let observation: AccountStateObservation;
    try {
      observation = await reader.readAccountState({
        intent,
      });
    } catch {
      // The chain adapter normally converts each failed read into an explicit
      // unavailable field. Keep unexpected adapter failures provider-neutral.
      return errorResponse(503, "ACCOUNT_STATE_READ_ERROR");
    }

    let snapshot: AccountStateSnapshot;
    try {
      const parsedObservation = accountStateObservationSchema.parse(observation);
      if (
        !observationMatchesIntent(
          parsedObservation,
          intent,
          this.dependencies.tokenRegistry,
        )
      ) {
        return errorResponse(503, "ACCOUNT_STATE_READ_ERROR");
      }
      snapshot = accountStateSnapshotSchema.parse({
        ...parsedObservation,
        snapshotId: this.createSnapshotId(),
        status: summarizeAccountState(parsedObservation),
      });
    } catch {
      return errorResponse(503, "ACCOUNT_STATE_READ_ERROR");
    }
    try {
      await store.saveAccountState(snapshot);
    } catch {
      return errorResponse(500, "ACCOUNT_STATE_STORE_ERROR");
    }

    return { status: 200, body: snapshot };
  }

  /** Returns the immutable recorded observation; it never re-queries RPC. */
  public async getSnapshot(
    snapshotId: string,
  ): Promise<AccountStateApplicationResponse> {
    const parsedSnapshotId = accountStateSnapshotIdSchema.safeParse(snapshotId);
    if (!parsedSnapshotId.success) {
      return errorResponse(404, "SNAPSHOT_NOT_FOUND");
    }
    const store = this.dependencies.store;
    if (store === undefined) {
      return errorResponse(503, "ACCOUNT_STATE_STORAGE_UNAVAILABLE");
    }
    try {
      const snapshot = await store.getAccountState(parsedSnapshotId.data);
      return snapshot === undefined
        ? errorResponse(404, "SNAPSHOT_NOT_FOUND")
        : { status: 200, body: accountStateSnapshotSchema.parse(snapshot) };
    } catch {
      return errorResponse(500, "ACCOUNT_STATE_STORE_ERROR");
    }
  }
}

function observationMatchesIntent(
  observation: AccountStateObservation,
  intent: import("@parallax/contracts").NormalizedSwapIntent,
  tokenRegistry: TrustedTokenRegistry,
): boolean {
  const context = observation.context;
  const contextMatches =
    context.chainId === intent.chainId &&
    context.protocol === intent.protocol &&
    context.sender.toLowerCase() === intent.sender.toLowerCase() &&
    context.recipient.toLowerCase() === intent.recipient.toLowerCase() &&
    sameAccountStateAsset(context.tokenIn, intent.tokenIn) &&
    sameAccountStateAsset(context.tokenOut, intent.tokenOut) &&
    context.amountInAtomic === intent.amountInAtomic;
  if (!contextMatches) return false;

  const balanceBindings = [
    { balance: observation.balances.inputToken, asset: intent.tokenIn },
    { balance: observation.balances.outputToken, asset: intent.tokenOut },
    { balance: observation.balances.native, asset: { kind: "native" as const } },
  ];
  return balanceBindings.every(({ balance, asset }) => {
    const trustedMetadata = tokenRegistry.resolve(intent.chainId, asset);
    return (
      trustedMetadata !== undefined &&
      balance.metadata.symbol === trustedMetadata.symbol &&
      balance.metadata.decimals === trustedMetadata.decimals &&
      balance.metadata.decimalsSource === trustedMetadata.decimalsSource &&
      (trustedMetadata.decimalsSource !== "onchain_verified" ||
        balance.metadata.verifiedAtBlock === trustedMetadata.verifiedAtBlock)
    );
  });
}

function errorResponse(
  status: 400 | 404 | 500 | 503,
  code:
    | "INVALID_REQUEST"
    | "NORMALIZATION_FAILED"
    | "UNSUPPORTED"
    | "ACCOUNT_STATE_READ_ERROR"
    | "ACCOUNT_STATE_STORAGE_UNAVAILABLE"
    | "SNAPSHOT_NOT_FOUND"
    | "ACCOUNT_STATE_STORE_ERROR",
  issues?: unknown,
): AccountStateApplicationResponse {
  const message =
    code === "INVALID_REQUEST"
      ? "The account-state request does not match the public API contract"
      : code === "NORMALIZATION_FAILED"
        ? "The account-state request could not be normalized using trusted metadata"
        : code === "SNAPSHOT_NOT_FOUND"
          ? "The requested account-state snapshot does not exist"
          : code === "ACCOUNT_STATE_STORE_ERROR"
            ? "The account-state snapshot could not be persisted or loaded"
            : code === "ACCOUNT_STATE_STORAGE_UNAVAILABLE"
              ? "Account-state snapshot storage is not configured"
              : code === "ACCOUNT_STATE_READ_ERROR"
                ? "The account-state read could not be completed"
                : "Live account-state reads are not configured for this chain";

  return {
    status,
    body: {
      error: {
        code,
        message,
        ...(issues === undefined ? {} : { issues }),
      },
    },
  };
}
