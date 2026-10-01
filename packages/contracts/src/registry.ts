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
export const publicTokenMetadataSchema = trustedTokenMetadataSchema;

export type TrustedTokenMetadata = z.infer<typeof trustedTokenMetadataSchema>;
export type PublicTokenMetadata = z.infer<typeof publicTokenMetadataSchema>;

/** Backend-owned display metadata for the exact input and output assets. */
export const tokenMetadataPairSchema = z
  .object({
    tokenIn: trustedTokenMetadataSchema,
    tokenOut: trustedTokenMetadataSchema,
  })
  .strict()
  .refine((pair) => pair.tokenIn.chainId === pair.tokenOut.chainId, {
    message: "Token metadata must belong to the same chain",
    path: ["tokenOut", "chainId"],
  });

export type TokenMetadataPair = z.infer<typeof tokenMetadataPairSchema>;

/** Configured P0 identity; availability does not imply live execution success. */
export const p0ConfigSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("AVAILABLE"),
        chainId: z.literal(421614),
        protocol: z.literal("camelot-v3"),
        tokenMetadata: tokenMetadataPairSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("UNAVAILABLE"),
        reason: z.enum(["ROUTE_NOT_CONFIGURED", "TOKEN_METADATA_UNAVAILABLE"]),
      })
      .strict(),
  ])
  .superRefine((config, context) => {
    if (
      config.status === "AVAILABLE" &&
      (config.tokenMetadata.tokenIn.chainId !== config.chainId ||
        config.tokenMetadata.tokenIn.asset.kind !== "native" ||
        config.tokenMetadata.tokenOut.asset.kind !== "erc20")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "P0 metadata must describe the configured native-to-ERC20 route",
        path: ["tokenMetadata"],
      });
    }
  });

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
