import {
  addressSchema,
  assetReferenceSchema,
  atomicAmountSchema,
  chainIdSchema,
  positiveDecimalSchema,
  protocolSchema,
  uint256AmountSchema,
} from "@parallax/contracts";
import { z } from "zod";

const blockHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const explorerUrlsSchema = z
  .object({
    account: z.string().url().optional(),
    asset: z.string().url().optional(),
  })
  .strict();

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
    const input = assetIdentity(request.chainId, request.tokenIn);
    const output = assetIdentity(request.chainId, request.tokenOut);
    if (input === output) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tokenIn and tokenOut must be different assets",
        path: ["tokenOut"],
      });
    }
  });

const accountStateContextSchema = z
  .object({
    chainId: chainIdSchema,
    protocol: protocolSchema,
    sender: addressSchema,
    recipient: addressSchema,
    tokenIn: assetReferenceSchema,
    tokenOut: assetReferenceSchema,
    amountInAtomic: atomicAmountSchema,
  })
  .strict();

const accountStateMetadataSchema = z
  .object({
    symbol: z.string().trim().min(1).max(32),
    decimals: z.number().int().min(0).max(255),
    decimalsSource: z.enum(["chain_config", "onchain_verified"]),
    verifiedAtBlock: z.string().regex(/^\d+$/).optional(),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (
      metadata.decimalsSource === "onchain_verified" &&
      metadata.verifiedAtBlock === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Verified ERC-20 decimals require verifiedAtBlock",
        path: ["verifiedAtBlock"],
      });
    }
    if (
      metadata.decimalsSource === "chain_config" &&
      metadata.verifiedAtBlock !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Chain-configured decimals cannot claim an ERC-20 verification block",
        path: ["verifiedAtBlock"],
      });
    }
  });

const accountBalanceIdentitySchema = z.object({
  account: addressSchema,
  asset: assetReferenceSchema,
  metadata: accountStateMetadataSchema,
  explorerUrls: explorerUrlsSchema,
});

export const accountStateBalanceSchema = z.discriminatedUnion("status", [
  accountBalanceIdentitySchema
    .extend({
      status: z.literal("AVAILABLE"),
      amountAtomic: uint256AmountSchema,
    })
    .strict(),
  accountBalanceIdentitySchema
    .extend({
      status: z.literal("UNAVAILABLE"),
      reason: z.enum([
        "RPC_UNAVAILABLE",
        "RPC_TIMEOUT",
        "INVALID_RPC_RESPONSE",
        "BLOCK_HASH_MISMATCH",
        "BLOCK_RECHECK_FAILED",
        "BLOCK_CONTEXT_UNAVAILABLE",
      ]),
    })
    .strict(),
]);

const qualifiedAllowanceSpenderSchema = z
  .object({
    status: z.literal("QUALIFIED"),
    address: addressSchema,
    qualificationRef: z.string().trim().min(1).max(500),
  })
  .strict();

const allowanceSpenderSchema = z.discriminatedUnion("status", [
  qualifiedAllowanceSpenderSchema,
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      reason: z.literal("SPENDER_NOT_QUALIFIED"),
    })
    .strict(),
  z.object({ status: z.literal("NOT_APPLICABLE") }).strict(),
]);

const allowanceIdentitySchema = z.object({
  owner: addressSchema,
  tokenAddress: addressSchema,
  spender: allowanceSpenderSchema,
  requiredAmountAtomic: atomicAmountSchema,
  blockNumber: z.string().regex(/^\d+$/).optional(),
});

export const accountStateAllowanceSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("NOT_APPLICABLE"),
      owner: addressSchema,
      spender: z.object({ status: z.literal("NOT_APPLICABLE") }).strict(),
      reason: z.literal("NATIVE_INPUT"),
      blockNumber: z.string().regex(/^\d+$/).optional(),
    })
    .strict(),
  allowanceIdentitySchema
    .extend({
      status: z.literal("SUFFICIENT"),
      spender: qualifiedAllowanceSpenderSchema,
      allowanceAtomic: uint256AmountSchema,
    })
    .strict(),
  allowanceIdentitySchema
    .extend({
      status: z.literal("INSUFFICIENT"),
      spender: qualifiedAllowanceSpenderSchema,
      allowanceAtomic: uint256AmountSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      owner: addressSchema,
      tokenAddress: addressSchema,
      spender: allowanceSpenderSchema,
      requiredAmountAtomic: atomicAmountSchema,
      blockNumber: z.string().regex(/^\d+$/).optional(),
      reason: z.enum([
        "SPENDER_NOT_QUALIFIED",
        "RPC_UNAVAILABLE",
        "RPC_TIMEOUT",
        "INVALID_RPC_RESPONSE",
        "BLOCK_HASH_MISMATCH",
        "BLOCK_RECHECK_FAILED",
        "BLOCK_CONTEXT_UNAVAILABLE",
      ]),
    })
    .strict(),
]);

const accountStateBlockContextFieldsSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("VERIFIED"),
      chainId: chainIdSchema,
      blockNumber: z.string().regex(/^\d+$/),
      blockHash: blockHashSchema,
      observedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      status: z.literal("STALE"),
      chainId: chainIdSchema,
      blockNumber: z.string().regex(/^\d+$/),
      blockHash: blockHashSchema,
      recheckedBlockHash: blockHashSchema,
      observedAt: z.string().datetime(),
      reason: z.literal("BLOCK_HASH_MISMATCH"),
    })
    .strict(),
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      chainId: chainIdSchema,
      blockNumber: z.string().regex(/^\d+$/).optional(),
      blockHash: blockHashSchema.optional(),
      observedAt: z.string().datetime(),
      reason: z.enum([
        "CHAIN_MISMATCH",
        "RPC_UNAVAILABLE",
        "RPC_TIMEOUT",
        "INVALID_RPC_RESPONSE",
        "BLOCK_CONTEXT_UNAVAILABLE",
        "BLOCK_RECHECK_FAILED",
      ]),
    })
    .strict(),
]);

export const accountStateBlockContextSchema =
  accountStateBlockContextFieldsSchema.superRefine((block, context) => {
    if (
      block.status === "UNAVAILABLE" &&
      (block.blockNumber === undefined) !== (block.blockHash === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Unavailable block context must include both block number and hash or neither",
        path: ["blockHash"],
      });
    }
  });

const accountStateObservationFieldsSchema = z
  .object({
    context: accountStateContextSchema,
    block: accountStateBlockContextSchema,
    balances: z
      .object({
        inputToken: accountStateBalanceSchema,
        outputToken: accountStateBalanceSchema,
        native: accountStateBalanceSchema,
      })
      .strict(),
    allowance: accountStateAllowanceSchema,
  })
  .strict();

export const accountStateObservationSchema =
  accountStateObservationFieldsSchema.superRefine(
    validateAccountStateObservation,
  );

export const accountStateSnapshotIdSchema = z
  .string()
  .uuid()
  .transform((snapshotId) => snapshotId.toLowerCase());

export const accountStateSnapshotSchema = z
  .object({
    ...accountStateObservationFieldsSchema.shape,
    snapshotId: accountStateSnapshotIdSchema,
    status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]),
  })
  .strict()
  .superRefine((snapshot, context) => {
    validateAccountStateObservation(snapshot, context);
    const expectedStatus = summarizeAccountState(snapshot);
    if (snapshot.status !== expectedStatus) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Snapshot status must be ${expectedStatus} for its observations`,
        path: ["status"],
      });
    }
  });

export type AccountStateRequest = z.infer<typeof accountStateRequestSchema>;
export type AccountStateBalance = z.infer<typeof accountStateBalanceSchema>;
export type AccountStateAllowance = z.infer<typeof accountStateAllowanceSchema>;
export type AccountStateBlockContext = z.infer<
  typeof accountStateBlockContextSchema
>;
export type AccountStateObservation = z.infer<
  typeof accountStateObservationSchema
>;
export type AccountStateSnapshot = z.infer<typeof accountStateSnapshotSchema>;

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

export function summarizeAccountState(
  observation: AccountStateObservation,
): "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" {
  if (observation.block.status !== "VERIFIED") return "UNAVAILABLE";

  const balanceStatuses = [
    observation.balances.inputToken.status,
    observation.balances.outputToken.status,
    observation.balances.native.status,
  ];
  const allowanceRequired = observation.allowance.status !== "NOT_APPLICABLE";
  const allowanceAvailable =
    observation.allowance.status === "SUFFICIENT" ||
    observation.allowance.status === "INSUFFICIENT";
  const availableCount =
    balanceStatuses.filter((status) => status === "AVAILABLE").length +
    (allowanceAvailable ? 1 : 0);
  const requiredCount = balanceStatuses.length + (allowanceRequired ? 1 : 0);

  if (availableCount === 0) return "UNAVAILABLE";
  return availableCount === requiredCount ? "AVAILABLE" : "PARTIAL";
}

function validateAccountStateObservation(
  observation: z.infer<typeof accountStateObservationFieldsSchema>,
  context: z.RefinementCtx,
): void {
  if (observation.block.chainId !== observation.context.chainId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Block chain ID must match the requested account-state chain",
      path: ["block", "chainId"],
    });
  }

  const expectedBalances = [
    {
      field: "inputToken",
      account: observation.context.sender,
      asset: observation.context.tokenIn,
    },
    {
      field: "outputToken",
      account: observation.context.recipient,
      asset: observation.context.tokenOut,
    },
    {
      field: "native",
      account: observation.context.sender,
      asset: { kind: "native" as const },
    },
  ] as const;

  for (const expected of expectedBalances) {
    const balance = observation.balances[expected.field];
    if (balance.account.toLowerCase() !== expected.account.toLowerCase()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${expected.field} balance account does not match its execution context`,
        path: ["balances", expected.field, "account"],
      });
    }
    if (!sameAccountStateAsset(balance.asset, expected.asset)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${expected.field} balance asset does not match its execution context`,
        path: ["balances", expected.field, "asset"],
      });
    }
    if (
      observation.block.status !== "VERIFIED" &&
      balance.status === "AVAILABLE"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Balances cannot be available without a verified block context",
        path: ["balances", expected.field, "status"],
      });
    }
  }

  const allowance = observation.allowance;
  if (observation.context.tokenIn.kind === "native") {
    if (
      allowance.status !== "NOT_APPLICABLE" ||
      allowance.owner.toLowerCase() !== observation.context.sender.toLowerCase()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Native input must have a not-applicable allowance for the sender",
        path: ["allowance"],
      });
    }
    if (
      allowance.status === "NOT_APPLICABLE" &&
      allowance.blockNumber !== undefined &&
      observation.block.blockNumber !== undefined &&
      allowance.blockNumber !== observation.block.blockNumber
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Allowance provenance must match the snapshot block",
        path: ["allowance", "blockNumber"],
      });
    }
  } else {
    const expectedTokenAddress =
      observation.context.tokenIn.address.toLowerCase();
    if (
      allowance.status === "NOT_APPLICABLE" ||
      allowance.owner.toLowerCase() !==
        observation.context.sender.toLowerCase() ||
      allowance.tokenAddress.toLowerCase() !== expectedTokenAddress ||
      allowance.requiredAmountAtomic !== observation.context.amountInAtomic
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "ERC-20 allowance must match the sender, input token, and normalized amount",
        path: ["allowance"],
      });
    }
    if (
      allowance.status !== "NOT_APPLICABLE" &&
      observation.block.blockNumber !== undefined &&
      allowance.blockNumber !== observation.block.blockNumber
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ERC-20 allowance provenance must match the snapshot block",
        path: ["allowance", "blockNumber"],
      });
    }
    if (
      allowance.status !== "UNAVAILABLE" &&
      observation.block.status !== "VERIFIED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "ERC-20 allowance cannot be usable without a verified block context",
        path: ["allowance", "status"],
      });
    }
    if (
      allowance.status === "SUFFICIENT" &&
      BigInt(allowance.allowanceAtomic) < BigInt(allowance.requiredAmountAtomic)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sufficient allowance must cover the required amount",
        path: ["allowance", "status"],
      });
    }
    if (
      allowance.status === "INSUFFICIENT" &&
      BigInt(allowance.allowanceAtomic) >=
        BigInt(allowance.requiredAmountAtomic)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Insufficient allowance must be below the required amount",
        path: ["allowance", "status"],
      });
    }
    if (
      allowance.status === "UNAVAILABLE" &&
      allowance.spender.status !==
        (allowance.reason === "SPENDER_NOT_QUALIFIED"
          ? "UNAVAILABLE"
          : "QUALIFIED")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Allowance failure reason must match whether the spender was qualified",
        path: ["allowance", "spender"],
      });
    }
  }
}

export function sameAccountStateAsset(
  left: z.infer<typeof assetReferenceSchema>,
  right: z.infer<typeof assetReferenceSchema>,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "native" || right.kind === "native") return true;
  return left.address.toLowerCase() === right.address.toLowerCase();
}

function assetIdentity(
  chainId: number,
  asset: z.infer<typeof assetReferenceSchema>,
): string {
  return asset.kind === "native"
    ? `${chainId}:native`
    : `${chainId}:${asset.address.toLowerCase()}`;
}
