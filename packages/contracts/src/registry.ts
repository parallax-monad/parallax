import { z } from "zod";
import {
  type AssetReference,
  addressSchema,
  assetIdentity,
  chainIdSchema,
} from "./common.js";

const tokenDisplayMetadataSchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  decimals: z.number().int().min(0).max(255),
});

export const chainConfigSchema = tokenDisplayMetadataSchema
  .extend({
    chainId: chainIdSchema,
  })
  .strict();

export const erc20TokenRegistryEntrySchema = tokenDisplayMetadataSchema
  .extend({
    chainId: chainIdSchema,
    address: addressSchema,
    decimalsSource: z.literal("onchain_verified"),
    verifiedAtBlock: z.string().regex(/^\d+$/),
  })
  .strict();

export const tokenRegistryConfigSchema = z
  .object({
    chains: z.array(chainConfigSchema).min(1),
    tokens: z.array(erc20TokenRegistryEntrySchema),
  })
  .strict()
  .superRefine((config, context) => {
    const chainIds = new Set<number>();
    config.chains.forEach((chain, index) => {
      if (chainIds.has(chain.chainId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Chain IDs must be unique",
          path: ["chains", index, "chainId"],
        });
      }
      chainIds.add(chain.chainId);
    });

    const tokenIds = new Set<string>();
    config.tokens.forEach((token, index) => {
      if (!chainIds.has(token.chainId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Token chainId must reference a configured chain",
          path: ["tokens", index, "chainId"],
        });
      }

      const tokenId = `${token.chainId}:${token.address.toLowerCase()}`;
      if (tokenIds.has(tokenId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Token registry entries must be unique",
          path: ["tokens", index, "address"],
        });
      }
      tokenIds.add(tokenId);
    });
  });

export const trustedTokenMetadataSchema = z.discriminatedUnion(
  "decimalsSource",
  [
    tokenDisplayMetadataSchema
      .extend({
        chainId: chainIdSchema,
        asset: z.object({ kind: z.literal("native") }).strict(),
        decimalsSource: z.literal("chain_config"),
      })
      .strict(),
    tokenDisplayMetadataSchema
      .extend({
        chainId: chainIdSchema,
        asset: z
          .object({
            kind: z.literal("erc20"),
            address: addressSchema,
          })
          .strict(),
        decimalsSource: z.literal("onchain_verified"),
        verifiedAtBlock: z.string().regex(/^\d+$/),
      })
      .strict(),
  ],
);

export type ChainConfig = z.infer<typeof chainConfigSchema>;
export type Erc20TokenRegistryEntry = z.infer<
  typeof erc20TokenRegistryEntrySchema
>;
export type TokenRegistryConfig = z.infer<typeof tokenRegistryConfigSchema>;
export type TrustedTokenMetadata = z.infer<typeof trustedTokenMetadataSchema>;

export type TrustedTokenRegistry = {
  hasChain(chainId: number): boolean;
  resolve(
    chainId: number,
    asset: AssetReference,
  ): TrustedTokenMetadata | undefined;
};

export function tokenRegistryKey(
  chainId: number,
  asset: AssetReference,
): string {
  return assetIdentity({ chainId, asset });
}
