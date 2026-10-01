import type { NormalizedSwapIntent } from "./intent.js";

/**
 * Public response DTO for POST /api/account-state and
 * GET /api/account-state/:snapshotId.
 *
 * The API remains authoritative for runtime validation and response creation.
 * Keep this type aligned with apps/api/src/account-state-model.ts.
 */
export type AccountStateContext = Pick<
  NormalizedSwapIntent,
  | "chainId"
  | "protocol"
  | "sender"
  | "recipient"
  | "tokenIn"
  | "tokenOut"
  | "amountInAtomic"
>;

export type AccountStateMetadata = {
  symbol: string;
  decimals: number;
  decimalsSource: "chain_config" | "onchain_verified";
  verifiedAtBlock?: string;
};

export type AccountStateExplorerUrls = {
  account?: string;
  asset?: string;
};

type AccountStateBalanceIdentity = {
  account: string;
  asset: AccountStateContext["tokenIn"];
  metadata: AccountStateMetadata;
  explorerUrls: AccountStateExplorerUrls;
};

export type AccountStateBalanceUnavailableReason =
  | "RPC_UNAVAILABLE"
  | "RPC_TIMEOUT"
  | "INVALID_RPC_RESPONSE"
  | "BLOCK_HASH_MISMATCH"
  | "BLOCK_RECHECK_FAILED"
  | "BLOCK_CONTEXT_UNAVAILABLE";

export type AccountStateBalance =
  | (AccountStateBalanceIdentity & {
      status: "AVAILABLE";
      amountAtomic: string;
    })
  | (AccountStateBalanceIdentity & {
      status: "UNAVAILABLE";
      reason: AccountStateBalanceUnavailableReason;
    });

export type AccountStateQualifiedSpender = {
  status: "QUALIFIED";
  address: string;
  qualificationRef: string;
};

export type AccountStateAllowanceSpender =
  | AccountStateQualifiedSpender
  | { status: "UNAVAILABLE"; reason: "SPENDER_NOT_QUALIFIED" }
  | { status: "NOT_APPLICABLE" };

type AccountStateAllowanceIdentity = {
  owner: string;
  tokenAddress: string;
  requiredAmountAtomic: string;
  blockNumber?: string;
};

type AccountStateMeasuredAllowance<
  Status extends "SUFFICIENT" | "INSUFFICIENT",
> = AccountStateAllowanceIdentity & {
  status: Status;
  spender: AccountStateQualifiedSpender;
  allowanceAtomic: string;
};

export type AccountStateAllowance =
  | {
      status: "NOT_APPLICABLE";
      owner: string;
      spender: { status: "NOT_APPLICABLE" };
      reason: "NATIVE_INPUT";
      blockNumber?: string;
    }
  | AccountStateMeasuredAllowance<"SUFFICIENT">
  | AccountStateMeasuredAllowance<"INSUFFICIENT">
  | (AccountStateAllowanceIdentity & {
      status: "UNAVAILABLE";
      spender: AccountStateAllowanceSpender;
      reason:
        | "SPENDER_NOT_QUALIFIED"
        | "RPC_UNAVAILABLE"
        | "RPC_TIMEOUT"
        | "INVALID_RPC_RESPONSE"
        | "BLOCK_HASH_MISMATCH"
        | "BLOCK_RECHECK_FAILED"
        | "BLOCK_CONTEXT_UNAVAILABLE";
    });

export type AccountStateBlockContext =
  | {
      status: "VERIFIED";
      chainId: number;
      blockNumber: string;
      blockHash: string;
      observedAt: string;
    }
  | {
      status: "STALE";
      chainId: number;
      blockNumber: string;
      blockHash: string;
      recheckedBlockHash: string;
      observedAt: string;
      reason: "BLOCK_HASH_MISMATCH";
    }
  | {
      status: "UNAVAILABLE";
      chainId: number;
      blockNumber?: string;
      blockHash?: string;
      observedAt: string;
      reason:
        | "CHAIN_MISMATCH"
        | "RPC_UNAVAILABLE"
        | "RPC_TIMEOUT"
        | "INVALID_RPC_RESPONSE"
        | "BLOCK_CONTEXT_UNAVAILABLE"
        | "BLOCK_RECHECK_FAILED";
    };

export type AccountStateSnapshot = {
  context: AccountStateContext;
  block: AccountStateBlockContext;
  balances: {
    inputToken: AccountStateBalance;
    outputToken: AccountStateBalance;
    native: AccountStateBalance;
  };
  allowance: AccountStateAllowance;
  snapshotId: string;
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
};
