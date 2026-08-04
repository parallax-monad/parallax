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
  MOSS_RUNTIME_VERSION: z.string().trim().min(1),
  MOSS_RUNTIME_REVISION: z.string().trim().min(1),
});

const tokenRegistryEnvironmentSchema = z.object({
  PARALLAX_TOKEN_REGISTRY_JSON: z.preprocess(
    (value) => value ?? "",
    z.string().trim().min(1, "PARALLAX_TOKEN_REGISTRY_JSON is required"),
  ),
});

export const mossIntegrationConfigSchema = z
  .object({
    rpcUrl: rpcUrlSchema,
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

// TODO(moss-integration, owner: Jie + Backend): Inject the confirmed P0 chain,
// MON/USDC metadata, verification block, RPC, Moss runtime version, and
// immutable Moss runtime revision through this bootstrap path. Recorded
// fixtures must never become live defaults.
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
      runtimeVersion: environment.MOSS_RUNTIME_VERSION,
      runtimeRevision: environment.MOSS_RUNTIME_REVISION,
    },
  });

  return {
    config,
    tokenRegistry: createTrustedTokenRegistry(config.tokenRegistry),
  };
}
