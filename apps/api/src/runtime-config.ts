import {
  type TokenRegistryConfig,
  type TrustedTokenRegistry,
  tokenRegistryConfigSchema,
} from "@parallax/contracts";
import { z } from "zod";
import { createTrustedTokenRegistry } from "./trusted-token-registry.js";

const rpcUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => url.startsWith("http://") || url.startsWith("https://"),
    "Moss RPC URL must use HTTP or HTTPS",
  );

export const backendEnvironmentSchema = z.object({
  MONAD_RPC_URL: rpcUrlSchema,
  MOSS_RUNTIME_PATH: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().min(1).optional(),
  ),
  MOSS_RUNTIME_VERSION: z.string().trim().min(1),
  MOSS_RUNTIME_REVISION: z.string().trim().min(1),
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
  });

export type RunStoreEnvironment = z.infer<typeof runStoreEnvironmentSchema>;

export function parseRunStoreEnvironment(
  environment: unknown,
): RunStoreEnvironment {
  return runStoreEnvironmentSchema.parse(environment);
}

export const mossIntegrationConfigSchema = z
  .object({
    rpcUrl: rpcUrlSchema,
    runtimePath: z.string().trim().min(1).optional(),
    runtimeVersion: z.string().trim().min(1),
    runtimeRevision: z.string().trim().min(1),
  })
  .strict();

export const backendRuntimeConfigSchema = z
  .object({
    tokenRegistry: tokenRegistryConfigSchema,
    moss: mossIntegrationConfigSchema,
  })
  .strict();

export type MossIntegrationConfig = z.infer<typeof mossIntegrationConfigSchema>;
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
  });

  return {
    config,
    tokenRegistry: createTrustedTokenRegistry(config.tokenRegistry),
  };
}
