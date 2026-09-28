import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  type AssetReference,
  addressSchema,
  type NormalizedSwapIntent,
  type TrustedTokenMetadata,
  type TrustedTokenRegistry,
} from "@parallax/contracts";
import {
  type AccountStateAllowance,
  type AccountStateBalance,
  type AccountStateBlockContext,
  type AccountStateObservation,
  type AccountStateReader,
  type AccountStateReaderInput,
  accountStateObservationSchema,
} from "../account-state-model.js";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";

const UINT256_MAX = (1n << 256n) - 1n;
const BALANCE_OF_SELECTOR = "70a08231";
const ALLOWANCE_SELECTOR = "dd62ed3e";
const DEFAULT_TIMEOUT_MS = 8_000;
const BLOCK_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type QualifiedAllowanceSpender = {
  readonly address: string;
  /** Evidence identifier supplied by a trusted backend qualification boundary. */
  readonly qualificationRef: string;
};

export type QualifiedAllowanceSpenderResolver = (input: {
  readonly intent: NormalizedSwapIntent;
}) => QualifiedAllowanceSpender | undefined;

export type ArbitrumAccountStateReaderOptions = {
  readonly client: ArbitrumRpcClient;
  readonly tokenRegistry: TrustedTokenRegistry;
  /** Not populated until a protocol spender is qualified; never request-controlled. */
  readonly resolveQualifiedSpender?: QualifiedAllowanceSpenderResolver;
  readonly timeoutMs?: number;
  readonly now?: () => string;
};

type RpcReadFailure = "RPC_UNAVAILABLE" | "RPC_TIMEOUT";
type BlockUnavailableReason =
  | "CHAIN_MISMATCH"
  | RpcReadFailure
  | "INVALID_RPC_RESPONSE"
  | "BLOCK_CONTEXT_UNAVAILABLE"
  | "BLOCK_RECHECK_FAILED";

type PinnedBlock = {
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly blockTag: string;
};

/**
 * Read-only Arbitrum Sepolia account state. Every balance and allowance read
 * uses one explicit block number, and a changed block hash invalidates all of
 * the observations rather than returning a mixed snapshot.
 */
export class ArbitrumAccountStateReader implements AccountStateReader {
  private readonly now: () => string;
  private readonly timeoutMs: number;

  public constructor(
    private readonly options: ArbitrumAccountStateReaderOptions,
  ) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("Account-state timeoutMs must be a positive integer");
    }
    this.timeoutMs = timeoutMs;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async readAccountState(
    input: AccountStateReaderInput,
  ): Promise<AccountStateObservation> {
    const intent = input.intent;
    const sender = intent.sender.toLowerCase();
    const recipient = intent.recipient.toLowerCase();
    const context = {
      chainId: intent.chainId,
      protocol: intent.protocol,
      sender,
      recipient,
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      amountInAtomic: intent.amountInAtomic,
    };
    const metadata = {
      input: this.requireMetadata(intent.chainId, intent.tokenIn),
      output: this.requireMetadata(intent.chainId, intent.tokenOut),
      native: this.requireMetadata(intent.chainId, { kind: "native" }),
    };

    let observedAt = this.now();
    const chainIdResult = await this.readChainId();
    observedAt = this.now();
    if (chainIdResult !== "OK") {
      return this.unavailableObservation({
        context,
        intent,
        observedAt,
        reason: chainIdResult,
        metadata,
      });
    }
    if (intent.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
      return this.unavailableObservation({
        context,
        intent,
        observedAt,
        reason: "CHAIN_MISMATCH",
        metadata,
      });
    }

    let pinnedBlock: PinnedBlock;
    try {
      pinnedBlock = parsePinnedBlock(
        await this.request("eth_getBlockByNumber", ["latest", false]),
      );
      observedAt = this.now();
    } catch (error) {
      return this.unavailableObservation({
        context,
        intent,
        observedAt,
        reason: isInvalidRpcResponse(error)
          ? "INVALID_RPC_RESPONSE"
          : readFailureReason(error),
        metadata,
      });
    }

    const block: AccountStateBlockContext = {
      status: "VERIFIED",
      chainId: intent.chainId,
      blockNumber: pinnedBlock.blockNumber,
      blockHash: pinnedBlock.blockHash,
      observedAt,
    };
    const balanceCache = new Map<string, Promise<AccountStateBalance>>();
    const readBalance = (
      account: string,
      asset: AssetReference,
      tokenMetadata: TrustedTokenMetadata,
    ): Promise<AccountStateBalance> => {
      const key = accountAssetKey(intent.chainId, account, asset);
      let result = balanceCache.get(key);
      if (result === undefined) {
        result = this.readBalance({
          account,
          asset,
          metadata: tokenMetadata,
          chainId: intent.chainId,
          blockTag: pinnedBlock.blockTag,
        });
        balanceCache.set(key, result);
      }
      return result;
    };

    const [inputToken, outputToken, native, allowance] = await Promise.all([
      readBalance(sender, intent.tokenIn, metadata.input),
      readBalance(recipient, intent.tokenOut, metadata.output),
      readBalance(sender, { kind: "native" }, metadata.native),
      this.readAllowance({
        intent,
        owner: sender,
        blockTag: pinnedBlock.blockTag,
        blockNumber: pinnedBlock.blockNumber,
      }),
    ]);

    // Check the chain identity again so an endpoint/network switch cannot
    // accidentally bind reads from a different chain to this block context.
    const finalChainId = await this.readChainId();
    if (finalChainId !== "OK") {
      const reason =
        finalChainId === "CHAIN_MISMATCH"
          ? "CHAIN_MISMATCH"
          : "BLOCK_RECHECK_FAILED";
      return this.invalidateObservation({
        context,
        balances: { inputToken, outputToken, native },
        allowance,
        pinnedBlock,
        observedAt,
        blockReason: reason,
        readReason:
          reason === "CHAIN_MISMATCH"
            ? "BLOCK_CONTEXT_UNAVAILABLE"
            : "BLOCK_RECHECK_FAILED",
      });
    }

    let recheckedBlock: PinnedBlock;
    try {
      recheckedBlock = parsePinnedBlock(
        await this.request("eth_getBlockByNumber", [
          pinnedBlock.blockTag,
          false,
        ]),
      );
    } catch {
      return this.invalidateObservation({
        context,
        balances: { inputToken, outputToken, native },
        allowance,
        pinnedBlock,
        observedAt,
        blockReason: "BLOCK_RECHECK_FAILED",
        readReason: "BLOCK_RECHECK_FAILED",
      });
    }

    if (recheckedBlock.blockNumber !== pinnedBlock.blockNumber) {
      return this.invalidateObservation({
        context,
        balances: { inputToken, outputToken, native },
        allowance,
        pinnedBlock,
        observedAt,
        blockReason: "BLOCK_RECHECK_FAILED",
        readReason: "BLOCK_RECHECK_FAILED",
      });
    }

    if (
      recheckedBlock.blockHash.toLowerCase() !==
      pinnedBlock.blockHash.toLowerCase()
    ) {
      return this.invalidateObservation({
        context,
        balances: { inputToken, outputToken, native },
        allowance,
        pinnedBlock,
        observedAt,
        blockReason: "BLOCK_HASH_MISMATCH",
        readReason: "BLOCK_HASH_MISMATCH",
        recheckedBlockHash: recheckedBlock.blockHash,
      });
    }

    const completedAt = this.now();
    return accountStateObservationSchema.parse({
      context,
      block: { ...block, observedAt: completedAt },
      balances: { inputToken, outputToken, native },
      allowance,
    });
  }

  private async readBalance(input: {
    readonly account: string;
    readonly asset: AssetReference;
    readonly metadata: TrustedTokenMetadata;
    readonly chainId: number;
    readonly blockTag: string;
  }): Promise<AccountStateBalance> {
    const identity = balanceIdentity(input);
    try {
      const amountAtomic =
        input.asset.kind === "native"
          ? parseRpcQuantity(
              await this.request("eth_getBalance", [
                input.account,
                input.blockTag,
              ]),
            )
          : parseUint256Word(
              await this.request("eth_call", [
                {
                  to: input.asset.address,
                  data: `0x${BALANCE_OF_SELECTOR}${addressWord(input.account)}`,
                },
                input.blockTag,
              ]),
            );
      return { ...identity, status: "AVAILABLE", amountAtomic };
    } catch (error) {
      return {
        ...identity,
        status: "UNAVAILABLE",
        reason: isInvalidRpcResponse(error)
          ? "INVALID_RPC_RESPONSE"
          : readFailureReason(error),
      };
    }
  }

  private async readAllowance(input: {
    readonly intent: NormalizedSwapIntent;
    readonly owner: string;
    readonly blockTag: string;
    readonly blockNumber: string;
  }): Promise<AccountStateAllowance> {
    if (input.intent.tokenIn.kind === "native") {
      return {
        status: "NOT_APPLICABLE",
        owner: input.owner,
        spender: { status: "NOT_APPLICABLE" },
        reason: "NATIVE_INPUT",
        blockNumber: input.blockNumber,
      };
    }

    const tokenAddress = input.intent.tokenIn.address.toLowerCase();
    const requiredAmountAtomic = input.intent.amountInAtomic;
    const qualifiedSpender = this.resolveQualifiedSpender(input.intent);
    if (qualifiedSpender === undefined) {
      return {
        status: "UNAVAILABLE",
        owner: input.owner,
        tokenAddress,
        spender: { status: "UNAVAILABLE", reason: "SPENDER_NOT_QUALIFIED" },
        requiredAmountAtomic,
        blockNumber: input.blockNumber,
        reason: "SPENDER_NOT_QUALIFIED",
      };
    }

    try {
      const allowanceAtomic = parseUint256Word(
        await this.request("eth_call", [
          {
            to: tokenAddress,
            data:
              `0x${ALLOWANCE_SELECTOR}${addressWord(input.owner)}` +
              addressWord(qualifiedSpender.address),
          },
          input.blockTag,
        ]),
      );
      return {
        status:
          BigInt(allowanceAtomic) >= BigInt(requiredAmountAtomic)
            ? "SUFFICIENT"
            : "INSUFFICIENT",
        owner: input.owner,
        tokenAddress,
        spender: qualifiedSpender,
        requiredAmountAtomic,
        blockNumber: input.blockNumber,
        allowanceAtomic,
      };
    } catch (error) {
      return {
        status: "UNAVAILABLE",
        owner: input.owner,
        tokenAddress,
        spender: qualifiedSpender,
        requiredAmountAtomic,
        blockNumber: input.blockNumber,
        reason: isInvalidRpcResponse(error)
          ? "INVALID_RPC_RESPONSE"
          : readFailureReason(error),
      };
    }
  }

  private resolveQualifiedSpender(
    intent: NormalizedSwapIntent,
  ):
    | Extract<AccountStateAllowance, { status: "SUFFICIENT" }>["spender"]
    | undefined {
    let candidate: QualifiedAllowanceSpender | undefined;
    try {
      candidate = this.options.resolveQualifiedSpender?.({ intent });
    } catch {
      return undefined;
    }
    const parsedAddress = addressSchema.safeParse(candidate?.address);
    if (
      candidate === undefined ||
      !parsedAddress.success ||
      parsedAddress.data.toLowerCase() ===
        "0x0000000000000000000000000000000000000000" ||
      typeof candidate.qualificationRef !== "string" ||
      candidate.qualificationRef.trim() === ""
    ) {
      return undefined;
    }
    return {
      status: "QUALIFIED",
      address: parsedAddress.data.toLowerCase(),
      qualificationRef: candidate.qualificationRef.trim(),
    };
  }

  private requireMetadata(
    chainId: number,
    asset: AssetReference,
  ): TrustedTokenMetadata {
    const metadata = this.options.tokenRegistry.resolve(chainId, asset);
    if (metadata === undefined) {
      throw new Error(
        "Account-state asset is missing trusted registry metadata",
      );
    }
    return metadata;
  }

  private async readChainId(): Promise<"OK" | BlockUnavailableReason> {
    try {
      const value = await this.request("eth_chainId", []);
      if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
        return "INVALID_RPC_RESPONSE";
      }
      return BigInt(value) === BigInt(ARBITRUM_SEPOLIA_CHAIN_ID)
        ? "OK"
        : "CHAIN_MISMATCH";
    } catch (error) {
      return isInvalidRpcResponse(error)
        ? "INVALID_RPC_RESPONSE"
        : readFailureReason(error);
    }
  }

  private async request(
    method: string,
    params: readonly unknown[],
  ): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const request = Promise.resolve().then(() =>
      this.options.client.request(method, params, {
        signal: controller.signal,
        timeoutMs: this.timeoutMs,
      }),
    );
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        const failure = new AccountStateRpcFailure("RPC_TIMEOUT");
        controller.abort(failure);
        reject(failure);
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([request, timeout]);
    } catch (error) {
      if (timedOut || isRpcTimeout(error)) {
        throw new AccountStateRpcFailure("RPC_TIMEOUT");
      }
      throw new AccountStateRpcFailure("RPC_UNAVAILABLE");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private unavailableObservation(input: {
    readonly context: AccountStateObservation["context"];
    readonly intent: NormalizedSwapIntent;
    readonly observedAt: string;
    readonly reason: BlockUnavailableReason;
    readonly metadata: {
      readonly input: TrustedTokenMetadata;
      readonly output: TrustedTokenMetadata;
      readonly native: TrustedTokenMetadata;
    };
  }): AccountStateObservation {
    const balances = {
      inputToken: unavailableBalanceForMetadata({
        account: input.context.sender,
        asset: input.context.tokenIn,
        metadata: input.metadata.input,
        chainId: input.context.chainId,
        reason: input.reason,
      }),
      outputToken: unavailableBalanceForMetadata({
        account: input.context.recipient,
        asset: input.context.tokenOut,
        metadata: input.metadata.output,
        chainId: input.context.chainId,
        reason: input.reason,
      }),
      native: unavailableBalanceForMetadata({
        account: input.context.sender,
        asset: { kind: "native" },
        metadata: input.metadata.native,
        chainId: input.context.chainId,
        reason: input.reason,
      }),
    };
    return accountStateObservationSchema.parse({
      context: input.context,
      block: {
        status: "UNAVAILABLE",
        chainId: input.context.chainId,
        observedAt: input.observedAt,
        reason: input.reason,
      },
      balances,
      allowance: unavailableAllowanceForIntent({
        intent: input.intent,
        owner: input.context.sender,
        reason: input.reason,
        resolveSpender: (intent) => this.resolveQualifiedSpender(intent),
      }),
    });
  }

  private invalidateObservation(input: {
    readonly context: AccountStateObservation["context"];
    readonly balances: AccountStateObservation["balances"];
    readonly allowance: AccountStateAllowance;
    readonly pinnedBlock: PinnedBlock;
    readonly observedAt: string;
    readonly blockReason:
      | "CHAIN_MISMATCH"
      | "BLOCK_RECHECK_FAILED"
      | "BLOCK_HASH_MISMATCH";
    readonly readReason:
      | "BLOCK_RECHECK_FAILED"
      | "BLOCK_HASH_MISMATCH"
      | "BLOCK_CONTEXT_UNAVAILABLE";
    readonly recheckedBlockHash?: string;
  }): AccountStateObservation {
    const completedAt = this.now();
    const block =
      input.blockReason === "BLOCK_HASH_MISMATCH" &&
      input.recheckedBlockHash !== undefined
        ? {
            status: "STALE" as const,
            chainId: input.context.chainId,
            blockNumber: input.pinnedBlock.blockNumber,
            blockHash: input.pinnedBlock.blockHash,
            recheckedBlockHash: input.recheckedBlockHash,
            observedAt: completedAt,
            reason: "BLOCK_HASH_MISMATCH" as const,
          }
        : {
            status: "UNAVAILABLE" as const,
            chainId: input.context.chainId,
            blockNumber: input.pinnedBlock.blockNumber,
            blockHash: input.pinnedBlock.blockHash,
            observedAt: completedAt,
            reason:
              input.blockReason === "CHAIN_MISMATCH"
                ? ("CHAIN_MISMATCH" as const)
                : ("BLOCK_RECHECK_FAILED" as const),
          };
    return accountStateObservationSchema.parse({
      context: input.context,
      block,
      balances: {
        inputToken: unavailableBalance(
          input.balances.inputToken,
          input.readReason,
        ),
        outputToken: unavailableBalance(
          input.balances.outputToken,
          input.readReason,
        ),
        native: unavailableBalance(input.balances.native, input.readReason),
      },
      allowance: unavailableAllowance(input.allowance, input.readReason),
    });
  }
}

class AccountStateRpcFailure extends Error {
  public constructor(public readonly code: RpcReadFailure) {
    super(code);
  }
}

function parsePinnedBlock(value: unknown): PinnedBlock {
  if (!isRecord(value)) throw new Error("RPC block response is malformed");
  const blockNumber = parseRpcQuantity(value.number);
  if (typeof value.hash !== "string" || !BLOCK_HASH_PATTERN.test(value.hash)) {
    throw new Error("RPC block hash is malformed");
  }
  return {
    blockNumber,
    blockHash: value.hash,
    blockTag: `0x${BigInt(blockNumber).toString(16)}`,
  };
}

function parseRpcQuantity(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  ) {
    throw new Error("RPC quantity is malformed");
  }
  const quantity = BigInt(value);
  if (quantity > UINT256_MAX) throw new Error("RPC quantity exceeds uint256");
  return quantity.toString();
}

function parseUint256Word(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("RPC ABI uint256 result is malformed");
  }
  return BigInt(value).toString();
}

function addressWord(address: string): string {
  return addressSchema.parse(address).slice(2).toLowerCase().padStart(64, "0");
}

function accountAssetKey(
  chainId: number,
  account: string,
  asset: AssetReference,
): string {
  const assetId =
    asset.kind === "native" ? "native" : `erc20:${asset.address.toLowerCase()}`;
  return `${chainId}:${account.toLowerCase()}:${assetId}`;
}

function balanceIdentity(input: {
  readonly account: string;
  readonly asset: AssetReference;
  readonly metadata: TrustedTokenMetadata;
  readonly chainId: number;
}) {
  return {
    account: input.account.toLowerCase(),
    asset: input.asset,
    metadata: metadataProjection(input.metadata),
    explorerUrls: explorerUrls(input.chainId, input.account, input.asset),
  };
}

function metadataProjection(metadata: TrustedTokenMetadata) {
  return {
    symbol: metadata.symbol,
    decimals: metadata.decimals,
    decimalsSource: metadata.decimalsSource,
    ...(metadata.decimalsSource === "onchain_verified"
      ? { verifiedAtBlock: metadata.verifiedAtBlock }
      : {}),
  };
}

function explorerUrls(
  chainId: number,
  account: string,
  asset: AssetReference,
): { account?: string; asset?: string } {
  if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) return {};
  const base = "https://sepolia.arbiscan.io";
  return {
    account: `${base}/address/${account.toLowerCase()}`,
    ...(asset.kind === "erc20"
      ? { asset: `${base}/token/${asset.address.toLowerCase()}` }
      : {}),
  };
}

function unavailableBalanceForMetadata(input: {
  readonly account: string;
  readonly asset: AssetReference;
  readonly metadata: TrustedTokenMetadata;
  readonly chainId: number;
  readonly reason:
    | Extract<AccountStateBalance, { status: "UNAVAILABLE" }>["reason"]
    | "CHAIN_MISMATCH";
}): AccountStateBalance {
  return {
    account: input.account.toLowerCase(),
    asset: input.asset,
    metadata: metadataProjection(input.metadata),
    explorerUrls: explorerUrls(input.chainId, input.account, input.asset),
    status: "UNAVAILABLE",
    reason:
      input.reason === "CHAIN_MISMATCH"
        ? "BLOCK_CONTEXT_UNAVAILABLE"
        : input.reason,
  };
}

function unavailableAllowanceForIntent(input: {
  readonly intent: NormalizedSwapIntent;
  readonly owner: string;
  readonly reason: BlockUnavailableReason;
  readonly resolveSpender: (
    intent: NormalizedSwapIntent,
  ) =>
    | Extract<AccountStateAllowance, { status: "SUFFICIENT" }>["spender"]
    | undefined;
}): AccountStateAllowance {
  if (input.intent.tokenIn.kind === "native") {
    return {
      status: "NOT_APPLICABLE",
      owner: input.owner,
      spender: { status: "NOT_APPLICABLE" },
      reason: "NATIVE_INPUT",
    };
  }
  const qualifiedSpender = input.resolveSpender(input.intent);
  return {
    status: "UNAVAILABLE",
    owner: input.owner,
    tokenAddress: input.intent.tokenIn.address.toLowerCase(),
    spender: qualifiedSpender ?? {
      status: "UNAVAILABLE",
      reason: "SPENDER_NOT_QUALIFIED",
    },
    requiredAmountAtomic: input.intent.amountInAtomic,
    reason:
      qualifiedSpender === undefined
        ? "SPENDER_NOT_QUALIFIED"
        : input.reason === "CHAIN_MISMATCH"
          ? "BLOCK_CONTEXT_UNAVAILABLE"
          : input.reason,
  };
}

function unavailableBalance(
  balance: AccountStateBalance,
  reason: Extract<AccountStateBalance, { status: "UNAVAILABLE" }>["reason"],
): AccountStateBalance {
  const identity = {
    account: balance.account,
    asset: balance.asset,
    metadata: balance.metadata,
    explorerUrls: balance.explorerUrls,
  };
  return { ...identity, status: "UNAVAILABLE", reason };
}

function unavailableAllowance(
  allowance: AccountStateAllowance,
  reason: Extract<AccountStateAllowance, { status: "UNAVAILABLE" }>["reason"],
): AccountStateAllowance {
  if (allowance.status === "NOT_APPLICABLE") return allowance;
  return {
    status: "UNAVAILABLE",
    owner: allowance.owner,
    tokenAddress: allowance.tokenAddress,
    spender: allowance.spender,
    requiredAmountAtomic: allowance.requiredAmountAtomic,
    ...(allowance.blockNumber === undefined
      ? {}
      : { blockNumber: allowance.blockNumber }),
    reason:
      allowance.spender.status === "UNAVAILABLE"
        ? "SPENDER_NOT_QUALIFIED"
        : reason,
  };
}

function readFailureReason(error: unknown): RpcReadFailure {
  return error instanceof AccountStateRpcFailure && error.code === "RPC_TIMEOUT"
    ? "RPC_TIMEOUT"
    : "RPC_UNAVAILABLE";
}

function isInvalidRpcResponse(error: unknown): boolean {
  return !(error instanceof AccountStateRpcFailure);
}

function isRpcTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === "TIMEOUT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
