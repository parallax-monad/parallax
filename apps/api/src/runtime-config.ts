import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
  type TokenRegistryConfig,
  type TrustedTokenRegistry,
  tokenRegistryConfigSchema,
} from "@parallax/contracts";
import { z } from "zod";
import { createTrustedTokenRegistry } from "./trusted-token-registry.js";

const arbitrumSepoliaRuntimeConfig = {
  chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
  protocolId: CAMELOT_V3_PROTOCOL_ID,
} as const;

export const ARBITRUM_ONE_CHAIN_ID = 42161 as const;
export const ARBITRUM_ONE_PROFILE_ID = "arbitrum-one-camelot-v3" as const;
export const ARBITRUM_ONE_FORK_ANVIL_VERSION = "1.8.5" as const;

const arbitrumOneDeployments = Object.freeze({
  factoryAddress: "0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B",
  quoterAddress: "0x0Fc73040b26E9bC8514fA028D998E73A254Fa76E",
  routerAddress: "0x1F721E2E82F6676FCE4eA07A5958cF098D339e18",
  wrappedNativeAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
});

export const ARBITRUM_ONE_RUNTIME_PROFILE = Object.freeze({
  profileId: ARBITRUM_ONE_PROFILE_ID,
  chainId: ARBITRUM_ONE_CHAIN_ID,
  protocolId: CAMELOT_V3_PROTOCOL_ID,
  deployments: arbitrumOneDeployments,
  route: Object.freeze({
    poolAddress: "0xb1026b8e7276e7ac75410f1fcbbe21796e8f7526",
    tokenIn: Object.freeze({
      kind: "native" as const,
      symbol: "ETH",
      decimals: 18,
      wrappedAddress: arbitrumOneDeployments.wrappedNativeAddress,
    }),
    tokenOut: Object.freeze({
      kind: "erc20" as const,
      chainId: ARBITRUM_ONE_CHAIN_ID,
      address: arbitrumOneDeployments.usdcAddress,
      symbol: "USDC",
      decimals: 6,
    }),
  }),
  capabilities: Object.freeze({
    quote: true,
    check: false,
    simulation: false,
  }),
});

export {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
} from "@parallax/contracts";

const rpcUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => url.startsWith("http://") || url.startsWith("https://"),
    "Moss RPC URL must use HTTP or HTTPS",
  );

function isLocalForkRpcUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const isLoopbackV4 =
      /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(hostname);
    return (
      url.protocol === "http:" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      (hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "host.docker.internal" ||
        hostname === "anvil" ||
        hostname === "::1" ||
        isLoopbackV4)
    );
  } catch {
    return false;
  }
}

const localForkRpcUrlSchema = z
  .string()
  .url()
  .refine(
    isLocalForkRpcUrl,
    "Local fork RPC URL must use an unauthenticated local HTTP endpoint",
  );

const optionalEnvironmentString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const optionalEnvironmentPositiveInteger = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.coerce.number().int().positive().max(60_000).optional(),
);

export const backendEnvironmentSchema = z
  .object({
    MONAD_RPC_URL: rpcUrlSchema,
    ARBITRUM_RPC_URL: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      rpcUrlSchema.optional(),
    ),
    ARBITRUM_ONE_RPC_URL: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      rpcUrlSchema.optional(),
    ),
    NODE_ENV: optionalEnvironmentString,
    ARBITRUM_ONE_LOCAL_FORK_CHECK_ENABLED: z.preprocess(
      (value) => value ?? "false",
      z.enum(["true", "false"]),
    ),
    ARBITRUM_ONE_FORK_LOCAL_RPC_URL: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      localForkRpcUrlSchema.optional(),
    ),
    ARBITRUM_ONE_FORK_INSTANCE_ID: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z
        .string()
        .uuid()
        .refine((value) => value[14]?.toLowerCase() === "4")
        .optional(),
    ),
    MOSS_RUNTIME_PATH: optionalEnvironmentString,
    MOSS_RUNTIME_VERSION: z.string().trim().min(1),
    MOSS_RUNTIME_REVISION: z.string().trim().min(1),
    TENDERLY_ACCOUNT_SLUG: optionalEnvironmentString,
    TENDERLY_PROJECT_SLUG: optionalEnvironmentString,
    TENDERLY_ACCESS_KEY: optionalEnvironmentString,
    TENDERLY_TIMEOUT_MS: optionalEnvironmentPositiveInteger,
  })
  .superRefine((environment, context) => {
    const tenderlyValues = [
      environment.TENDERLY_ACCOUNT_SLUG,
      environment.TENDERLY_PROJECT_SLUG,
      environment.TENDERLY_ACCESS_KEY,
    ];
    const tenderlyConfigured = tenderlyValues.some(
      (value) => value !== undefined,
    );
    if (tenderlyConfigured) {
      const tenderlyFields = [
        ["TENDERLY_ACCOUNT_SLUG", environment.TENDERLY_ACCOUNT_SLUG],
        ["TENDERLY_PROJECT_SLUG", environment.TENDERLY_PROJECT_SLUG],
        ["TENDERLY_ACCESS_KEY", environment.TENDERLY_ACCESS_KEY],
      ] as const;
      for (const [field, value] of tenderlyFields) {
        if (value === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when Tenderly integration is configured`,
          });
        }
      }
      if (environment.ARBITRUM_RPC_URL === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ARBITRUM_RPC_URL"],
          message:
            "ARBITRUM_RPC_URL is required when Tenderly integration is configured",
        });
      }
    }

    if (environment.ARBITRUM_ONE_LOCAL_FORK_CHECK_ENABLED === "true") {
      if (environment.NODE_ENV !== "development") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ARBITRUM_ONE_LOCAL_FORK_CHECK_ENABLED"],
          message: "Local fork Check is only available in development mode",
        });
      }
      if (environment.ARBITRUM_ONE_RPC_URL === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ARBITRUM_ONE_RPC_URL"],
          message: "A source RPC is required for local fork Check",
        });
      }
      if (environment.ARBITRUM_ONE_FORK_LOCAL_RPC_URL === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ARBITRUM_ONE_FORK_LOCAL_RPC_URL"],
          message: "A local Anvil RPC URL is required for local fork Check",
        });
      }
      if (environment.ARBITRUM_ONE_FORK_INSTANCE_ID === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ARBITRUM_ONE_FORK_INSTANCE_ID"],
          message: "A fork instance identity is required for local fork Check",
        });
      }
    }
  });

const tokenRegistryEnvironmentSchema = z.object({
  PARALLAX_TOKEN_REGISTRY_JSON: z.preprocess(
    (value) => value ?? "",
    z.string().trim().min(1, "PARALLAX_TOKEN_REGISTRY_JSON is required"),
  ),
});

const databaseUrlSchema = z
  .string()
  .trim()
  .min(1, "DATABASE_URL is required")
  .refine(
    (value) =>
      value.startsWith("postgres://") || value.startsWith("postgresql://"),
    "DATABASE_URL must use the postgres:// or postgresql:// scheme",
  );

export const runStoreBackendSchema = z.enum(["memory", "postgres"]);

export const runStoreEnvironmentSchema = z
  .object({
    RUN_STORE_BACKEND: z.preprocess(
      (value) => value ?? "memory",
      runStoreBackendSchema,
    ),
    DATABASE_URL: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      databaseUrlSchema.optional(),
    ),
  })
  .superRefine((environment, context) => {
    if (
      environment.RUN_STORE_BACKEND === "postgres" &&
      environment.DATABASE_URL === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required when RUN_STORE_BACKEND=postgres",
      });
    }
    if (
      environment.RUN_STORE_BACKEND === "postgres" &&
      environment.DATABASE_URL !== undefined &&
      isPooledDatabaseUrl(environment.DATABASE_URL)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message:
          "DATABASE_URL must use a direct connection; pooled -pooler URLs do not support migration advisory locks",
      });
    }
  });

export type RunStoreEnvironment = z.infer<typeof runStoreEnvironmentSchema>;

export function parseRunStoreEnvironment(
  environment: unknown,
): RunStoreEnvironment {
  return runStoreEnvironmentSchema.parse(environment);
}

function isPooledDatabaseUrl(databaseUrl: string): boolean {
  try {
    return new URL(databaseUrl).hostname.includes("-pooler.");
  } catch {
    return false;
  }
}

export const mossIntegrationConfigSchema = z
  .object({
    rpcUrl: rpcUrlSchema,
    runtimePath: z.string().trim().min(1).optional(),
    runtimeVersion: z.string().trim().min(1),
    runtimeRevision: z.string().trim().min(1),
  })
  .strict();

export const arbitrumIntegrationConfigSchema = z
  .object({
    chainId: z.literal(arbitrumSepoliaRuntimeConfig.chainId),
    protocolId: z.literal(arbitrumSepoliaRuntimeConfig.protocolId),
    rpcUrl: rpcUrlSchema.optional(),
  })
  .strict();

const arbitrumOneRuntimeProfileSchema = z
  .object({
    profileId: z.literal(ARBITRUM_ONE_RUNTIME_PROFILE.profileId),
    chainId: z.literal(ARBITRUM_ONE_RUNTIME_PROFILE.chainId),
    protocolId: z.literal(ARBITRUM_ONE_RUNTIME_PROFILE.protocolId),
    deployments: z
      .object({
        factoryAddress: z.literal(
          ARBITRUM_ONE_RUNTIME_PROFILE.deployments.factoryAddress,
        ),
        quoterAddress: z.literal(
          ARBITRUM_ONE_RUNTIME_PROFILE.deployments.quoterAddress,
        ),
        routerAddress: z.literal(
          ARBITRUM_ONE_RUNTIME_PROFILE.deployments.routerAddress,
        ),
        wrappedNativeAddress: z.literal(
          ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress,
        ),
        usdcAddress: z.literal(
          ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress,
        ),
      })
      .strict(),
    route: z
      .object({
        poolAddress: z.literal(ARBITRUM_ONE_RUNTIME_PROFILE.route.poolAddress),
        tokenIn: z
          .object({
            kind: z.literal("native"),
            symbol: z.literal("ETH"),
            decimals: z.literal(18),
            wrappedAddress: z.literal(
              ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenIn.wrappedAddress,
            ),
          })
          .strict(),
        tokenOut: z
          .object({
            kind: z.literal("erc20"),
            chainId: z.literal(ARBITRUM_ONE_CHAIN_ID),
            address: z.literal(
              ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenOut.address,
            ),
            symbol: z.literal("USDC"),
            decimals: z.literal(6),
          })
          .strict(),
      })
      .strict(),
    capabilities: z
      .object({
        quote: z.literal(true),
        check: z.literal(false),
        simulation: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const arbitrumOneIntegrationConfigSchema =
  arbitrumOneRuntimeProfileSchema
    .extend({ rpcUrl: rpcUrlSchema.optional() })
    .strict();

export const arbitrumOneLocalForkCheckConfigSchema = z
  .object({
    rpcUrl: localForkRpcUrlSchema,
    forkInstanceId: z
      .string()
      .uuid()
      .refine((value) => value[14]?.toLowerCase() === "4"),
    anvilVersion: z.literal(ARBITRUM_ONE_FORK_ANVIL_VERSION),
  })
  .strict();

export const tenderlyIntegrationConfigSchema = z
  .object({
    accountSlug: z.string().trim().min(1),
    projectSlug: z.string().trim().min(1),
    accessKey: z.string().trim().min(1),
    timeoutMs: z.number().int().positive().max(60_000).optional(),
  })
  .strict();

export const backendRuntimeConfigSchema = z
  .object({
    tokenRegistry: tokenRegistryConfigSchema,
    moss: mossIntegrationConfigSchema,
    // Optional for backward-compatible Monad-only schema consumers. The
    // bootstrap function always includes the explicit Arbitrum descriptor.
    arbitrum: arbitrumIntegrationConfigSchema.optional(),
    // The profile is server-owned; only its isolated RPC endpoint is injected.
    arbitrumOne: arbitrumOneIntegrationConfigSchema.optional(),
    // This distinct development-only descriptor never changes profile capabilities.
    arbitrumOneLocalForkCheck: arbitrumOneLocalForkCheckConfigSchema.optional(),
    tenderly: tenderlyIntegrationConfigSchema.optional(),
  })
  .strict();

export type MossIntegrationConfig = z.infer<typeof mossIntegrationConfigSchema>;
export type ArbitrumIntegrationConfig = z.infer<
  typeof arbitrumIntegrationConfigSchema
>;
export type ArbitrumOneIntegrationConfig = z.infer<
  typeof arbitrumOneIntegrationConfigSchema
>;
export type ArbitrumOneLocalForkCheckConfig = z.infer<
  typeof arbitrumOneLocalForkCheckConfigSchema
>;
export type TenderlyIntegrationConfig = z.infer<
  typeof tenderlyIntegrationConfigSchema
>;
export type BackendRuntimeConfig = z.infer<typeof backendRuntimeConfigSchema>;

export type BackendBootstrapInput = {
  environment: unknown;
  tokenRegistry: unknown;
};

export type BackendRuntime = {
  config: BackendRuntimeConfig;
  tokenRegistry: TrustedTokenRegistry;
};

export type ArbitrumRuntimeProfile =
  | ArbitrumIntegrationConfig
  | ArbitrumOneIntegrationConfig;

/** Selects a backend-owned profile using only the requested source chain ID. */
export function resolveArbitrumRuntimeProfile(
  runtime: BackendRuntime,
  chainId: number,
): ArbitrumRuntimeProfile | undefined {
  if (chainId === ARBITRUM_SEPOLIA_CHAIN_ID) return runtime.config.arbitrum;
  if (chainId === ARBITRUM_ONE_CHAIN_ID) return runtime.config.arbitrumOne;
  return undefined;
}

/** Reads the verified token metadata required by the executable Node launcher. */
export function parseTokenRegistryEnvironment(
  environment: unknown,
): TokenRegistryConfig {
  const { PARALLAX_TOKEN_REGISTRY_JSON } =
    tokenRegistryEnvironmentSchema.parse(environment);

  let candidate: unknown;
  try {
    candidate = JSON.parse(PARALLAX_TOKEN_REGISTRY_JSON);
  } catch (cause) {
    throw new Error("PARALLAX_TOKEN_REGISTRY_JSON must be valid JSON", {
      cause,
    });
  }

  return tokenRegistryConfigSchema.parse(candidate);
}

// The live Agent Flow is enabled only when the caller supplies an exact Moss
// checkout path. Recorded fixtures must never become live defaults.
/**
 * Loads backend configuration from the deployment environment and validates it
 * before constructing runtime dependencies. The API server must bootstrap
 * through this function; there are intentionally no fixture or demo defaults.
 */
export function bootstrapBackendRuntime(
  input: BackendBootstrapInput,
): BackendRuntime {
  const environment = backendEnvironmentSchema.parse(input.environment);
  const tenderlyConfigured =
    environment.TENDERLY_ACCOUNT_SLUG !== undefined &&
    environment.TENDERLY_PROJECT_SLUG !== undefined &&
    environment.TENDERLY_ACCESS_KEY !== undefined;
  const config = backendRuntimeConfigSchema.parse({
    tokenRegistry: input.tokenRegistry,
    moss: {
      rpcUrl: environment.MONAD_RPC_URL,
      ...(environment.MOSS_RUNTIME_PATH
        ? { runtimePath: environment.MOSS_RUNTIME_PATH }
        : {}),
      runtimeVersion: environment.MOSS_RUNTIME_VERSION,
      runtimeRevision: environment.MOSS_RUNTIME_REVISION,
    },
    arbitrum: {
      ...arbitrumSepoliaRuntimeConfig,
      ...(environment.ARBITRUM_RPC_URL === undefined
        ? {}
        : { rpcUrl: environment.ARBITRUM_RPC_URL }),
    },
    arbitrumOne: {
      ...ARBITRUM_ONE_RUNTIME_PROFILE,
      ...(environment.ARBITRUM_ONE_RPC_URL === undefined
        ? {}
        : { rpcUrl: environment.ARBITRUM_ONE_RPC_URL }),
    },
    ...(environment.ARBITRUM_ONE_LOCAL_FORK_CHECK_ENABLED === "true"
      ? {
          arbitrumOneLocalForkCheck:
            arbitrumOneLocalForkCheckConfigSchema.parse({
              rpcUrl: environment.ARBITRUM_ONE_FORK_LOCAL_RPC_URL,
              forkInstanceId: environment.ARBITRUM_ONE_FORK_INSTANCE_ID,
              anvilVersion: ARBITRUM_ONE_FORK_ANVIL_VERSION,
            }),
        }
      : {}),
    ...(tenderlyConfigured
      ? {
          tenderly: {
            accountSlug: environment.TENDERLY_ACCOUNT_SLUG,
            projectSlug: environment.TENDERLY_PROJECT_SLUG,
            accessKey: environment.TENDERLY_ACCESS_KEY,
            ...(environment.TENDERLY_TIMEOUT_MS === undefined
              ? {}
              : { timeoutMs: environment.TENDERLY_TIMEOUT_MS }),
          },
        }
      : {}),
  }) as BackendRuntimeConfig;

  return {
    config,
    tokenRegistry: createTrustedTokenRegistry(config.tokenRegistry),
  };
}
