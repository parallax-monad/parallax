import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
  type TokenRegistryConfig,
  type TrustedTokenRegistry,
  tokenRegistryConfigSchema,
} from "@parallax/contracts";
import { z } from "zod";
import { createTrustedTokenRegistry } from "./trusted-token-registry.js";

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
    if (!tenderlyConfigured) return;

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
    chainId: z.literal(ARBITRUM_SEPOLIA_CHAIN_ID),
    protocolId: z.literal(CAMELOT_V3_PROTOCOL_ID),
    rpcUrl: rpcUrlSchema.optional(),
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
    tenderly: tenderlyIntegrationConfigSchema.optional(),
  })
  .strict();

export type MossIntegrationConfig = z.infer<typeof mossIntegrationConfigSchema>;
export type ArbitrumIntegrationConfig = z.infer<
  typeof arbitrumIntegrationConfigSchema
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
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      protocolId: CAMELOT_V3_PROTOCOL_ID,
      ...(environment.ARBITRUM_RPC_URL === undefined
        ? {}
        : { rpcUrl: environment.ARBITRUM_RPC_URL }),
    },
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
