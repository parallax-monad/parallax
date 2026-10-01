import {
  type AccountStateObservation,
  type AccountStateSnapshot,
  addressSchema,
  assetIdentity,
  assetReferenceSchema,
  chainIdSchema,
  positiveDecimalSchema,
  protocolSchema,
} from "@parallax/contracts";
import { z } from "zod";

export type {
  AccountStateAllowance,
  AccountStateAllowanceSpender,
  AccountStateBalance,
  AccountStateBalanceUnavailableReason,
  AccountStateBlockContext,
  AccountStateContext,
  AccountStateExplorerUrls,
  AccountStateMetadata,
  AccountStateObservation,
  AccountStateQualifiedSpender,
  AccountStateSnapshot,
} from "@parallax/contracts";
export {
  accountStateAllowanceSchema,
  accountStateBalanceSchema,
  accountStateBlockContextSchema,
  accountStateObservationSchema,
  accountStateSnapshotIdSchema,
  accountStateSnapshotSchema,
  sameAccountStateAsset,
  summarizeAccountState,
} from "@parallax/contracts";

export const accountStateRequestSchema = z
  .object({
    chainId: chainIdSchema,
    protocol: protocolSchema,
    sender: addressSchema,
    recipient: addressSchema.optional(),
    tokenIn: assetReferenceSchema,
    tokenOut: assetReferenceSchema,
    amountIn: positiveDecimalSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const input = assetIdentity({
      chainId: request.chainId,
      asset: request.tokenIn,
    });
    const output = assetIdentity({
      chainId: request.chainId,
      asset: request.tokenOut,
    });
    if (input === output) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tokenIn and tokenOut must be different assets",
        path: ["tokenOut"],
      });
    }
  });

export type AccountStateRequest = z.infer<typeof accountStateRequestSchema>;

export interface AccountStateStore {
  saveAccountState(snapshot: AccountStateSnapshot): Promise<void>;
  getAccountState(
    snapshotId: string,
  ): Promise<AccountStateSnapshot | undefined>;
}

export type AccountStateApplicationErrorCode =
  | "INVALID_REQUEST"
  | "NORMALIZATION_FAILED"
  | "UNSUPPORTED"
  | "ACCOUNT_STATE_READ_ERROR"
  | "ACCOUNT_STATE_STORAGE_UNAVAILABLE"
  | "SNAPSHOT_NOT_FOUND"
  | "ACCOUNT_STATE_STORE_ERROR";

export type AccountStateApplicationResponse =
  | { status: 200; body: AccountStateSnapshot }
  | {
      status: 400 | 404 | 500 | 503;
      body: {
        error: {
          code: AccountStateApplicationErrorCode;
          message: string;
          issues?: unknown;
        };
      };
    };

export type AccountStateReaderInput = {
  readonly intent: import("@parallax/contracts").NormalizedSwapIntent;
};

export interface AccountStateReader {
  readAccountState(
    input: AccountStateReaderInput,
  ): Promise<AccountStateObservation>;
}
