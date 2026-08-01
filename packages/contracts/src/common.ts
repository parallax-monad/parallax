import { z } from "zod";

const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const atomicAmountPattern = /^(?:0|[1-9]\d*)$/;

export const UINT256_MAX = (1n << 256n) - 1n;

export const chainIdSchema = z.number().int().positive();

export const protocolSchema = z.enum(["kuru", "pancake"]);

export const transactionAdjustmentFieldSchema = z.enum([
  "amountIn",
  "tokenPair",
  "protocol",
  "slippage",
]);

export const addressSchema = z
  .string()
  .regex(addressPattern, "Expected a 20-byte EVM address");

export const positiveDecimalSchema = z
  .string()
  .regex(decimalPattern, "Expected a plain decimal string")
  .refine(
    (value) => /[1-9]/.test(value),
    "Expected an amount greater than zero",
  );

export const uint256AmountSchema = z
  .string()
  .regex(atomicAmountPattern, "Expected an unsigned atomic-unit integer string")
  .refine(
    (value) => !atomicAmountPattern.test(value) || BigInt(value) <= UINT256_MAX,
    "Atomic amount exceeds uint256 maximum",
  );

export const atomicAmountSchema = uint256AmountSchema.refine(
  (value) => value !== "0",
  "Expected an amount greater than zero",
);

export const assetReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native") }).strict(),
  z
    .object({
      kind: z.literal("erc20"),
      address: addressSchema,
    })
    .strict(),
]);

export type AssetReference = z.infer<typeof assetReferenceSchema>;

export function assetIdentity(input: {
  chainId: number;
  asset: AssetReference;
}): string {
  const assetKey =
    input.asset.kind === "native"
      ? "native"
      : input.asset.address.toLowerCase();

  return `${input.chainId}:${assetKey}`;
}
