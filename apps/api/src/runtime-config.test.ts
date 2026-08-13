import { describe, expect, it } from "vitest";
import {
  backendRuntimeConfigSchema,
  bootstrapBackendRuntime,
  parseRunStoreEnvironment,
  parseTokenRegistryEnvironment,
} from "./runtime-config.js";

const tokenRegistryConfig = {
  chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
  tokens: [
    {
      chainId: 143,
      address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "90000000",
    },
  ],
};

const environment = {
  MONAD_RPC_URL: "https://rpc.example.test",
  MOSS_RUNTIME_VERSION: "confirmed-portable-baseline",
  MOSS_RUNTIME_REVISION: "moss-commit-123",
};

describe("backend runtime config", () => {
  it("defaults the RunStore backend to process-local memory", () => {
    expect(parseRunStoreEnvironment({})).toEqual({
      RUN_STORE_BACKEND: "memory",
      DATABASE_URL: undefined,
    });
  });

  it("requires a PostgreSQL URL when the persistent backend is selected", () => {
    expect(() =>
      parseRunStoreEnvironment({ RUN_STORE_BACKEND: "postgres" }),
    ).toThrow("DATABASE_URL is required when RUN_STORE_BACKEND=postgres");
    expect(() =>
      parseRunStoreEnvironment({
        RUN_STORE_BACKEND: "postgres",
        DATABASE_URL: "https://database.example.test",
      }),
    ).toThrow(/DATABASE_URL must use the postgres/);
  });

  it("accepts both standard PostgreSQL URL schemes", () => {
    expect(
      parseRunStoreEnvironment({
        RUN_STORE_BACKEND: "postgres",
        DATABASE_URL: "postgres://user:pass@localhost:5432/parallax",
      }),
    ).toMatchObject({ RUN_STORE_BACKEND: "postgres" });
    expect(
      parseRunStoreEnvironment({
        RUN_STORE_BACKEND: "postgres",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/parallax",
      }),
    ).toMatchObject({ RUN_STORE_BACKEND: "postgres" });
  });

  it("parses verified token metadata from the launcher environment", () => {
    expect(
      parseTokenRegistryEnvironment({
        PARALLAX_TOKEN_REGISTRY_JSON: JSON.stringify(tokenRegistryConfig),
      }),
    ).toEqual(tokenRegistryConfig);
  });

  it("reports a missing or malformed token registry environment value", () => {
    expect(() => parseTokenRegistryEnvironment({})).toThrow(
      "PARALLAX_TOKEN_REGISTRY_JSON is required",
    );
    expect(() =>
      parseTokenRegistryEnvironment({ PARALLAX_TOKEN_REGISTRY_JSON: "{" }),
    ).toThrow(/PARALLAX_TOKEN_REGISTRY_JSON must be valid JSON/);
  });

  it("bootstraps from environment and backend-owned token metadata", () => {
    const runtime = bootstrapBackendRuntime({
      environment,
      tokenRegistry: tokenRegistryConfig,
    });

    expect(runtime.config.moss.rpcUrl).toBe("https://rpc.example.test");
    expect(
      runtime.tokenRegistry.resolve(143, { kind: "native" }),
    ).toMatchObject({
      symbol: "MON",
      decimals: 18,
    });
  });

  it("fails closed when required production settings are absent", () => {
    expect(() =>
      bootstrapBackendRuntime({
        environment: {},
        tokenRegistry: tokenRegistryConfig,
      }),
    ).toThrow();
  });

  it("requires an immutable Moss runtime revision", () => {
    expect(
      backendRuntimeConfigSchema.safeParse({
        tokenRegistry: tokenRegistryConfig,
        moss: {
          rpcUrl: environment.MONAD_RPC_URL,
          runtimeVersion: environment.MOSS_RUNTIME_VERSION,
        },
      }).success,
    ).toBe(false);
    expect(() =>
      bootstrapBackendRuntime({
        environment: {
          ...environment,
          MOSS_RUNTIME_REVISION: undefined,
        },
        tokenRegistry: tokenRegistryConfig,
      }),
    ).toThrow();
  });

  it("rejects integration settings inside the token registry", () => {
    expect(() =>
      bootstrapBackendRuntime({
        environment,
        tokenRegistry: {
          ...tokenRegistryConfig,
          rpcUrl: environment.MONAD_RPC_URL,
        },
      }),
    ).toThrow();
  });

  it("rejects non-HTTP RPC URLs", () => {
    expect(() =>
      bootstrapBackendRuntime({
        environment: {
          ...environment,
          MONAD_RPC_URL: "file:///tmp/recorded-fixture.json",
        },
        tokenRegistry: tokenRegistryConfig,
      }),
    ).toThrow();
  });

  it("keeps Moss settings outside the token registry contract", () => {
    expect(
      backendRuntimeConfigSchema.safeParse({
        tokenRegistry: tokenRegistryConfig,
        moss: {
          rpcUrl: environment.MONAD_RPC_URL,
          runtimeVersion: environment.MOSS_RUNTIME_VERSION,
          runtimeRevision: environment.MOSS_RUNTIME_REVISION,
        },
      }).success,
    ).toBe(true);
  });
});
