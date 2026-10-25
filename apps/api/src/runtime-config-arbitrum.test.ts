import { quoteRequestSchema } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_ONE_PROFILE_ID,
  ARBITRUM_ONE_RUNTIME_PROFILE,
  ARBITRUM_SEPOLIA_CHAIN_ID,
  arbitrumOneIntegrationConfigSchema,
  backendEnvironmentSchema,
  bootstrapBackendRuntime,
  resolveArbitrumRuntimeProfile,
} from "./runtime-config.js";

const baseEnvironment = {
  MONAD_RPC_URL: "https://monad.example.test",
  MOSS_RUNTIME_VERSION: "fixture-runtime",
  MOSS_RUNTIME_REVISION: "fixture-revision",
};

describe("Arbitrum runtime configuration", () => {
  it("normalizes an explicit Arbitrum RPC URL without inventing credentials", () => {
    const runtime = bootstrapBackendRuntime({
      environment: {
        ...baseEnvironment,
        ARBITRUM_RPC_URL: "https://arbitrum.example.test",
      },
      tokenRegistry: {
        chains: [
          { chainId: ARBITRUM_SEPOLIA_CHAIN_ID, symbol: "ETH", decimals: 18 },
        ],
        tokens: [],
      },
    });

    expect(runtime.config.arbitrum).toEqual({
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      protocolId: "camelot-v3",
      rpcUrl: "https://arbitrum.example.test",
    });
  });

  it("keeps Arbitrum disabled-but-described when no endpoint is configured", () => {
    const runtime = bootstrapBackendRuntime({
      environment: baseEnvironment,
      tokenRegistry: {
        chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
        tokens: [],
      },
    });

    expect(runtime.config.arbitrum).toEqual({
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      protocolId: "camelot-v3",
    });
  });

  it("treats a blank endpoint as disabled and rejects non-HTTP endpoints", () => {
    expect(
      backendEnvironmentSchema.parse({
        ...baseEnvironment,
        ARBITRUM_RPC_URL: "  ",
      }).ARBITRUM_RPC_URL,
    ).toBeUndefined();
    expect(() =>
      backendEnvironmentSchema.parse({
        ...baseEnvironment,
        ARBITRUM_RPC_URL: "file:///tmp/arbitrum-fixture.json",
      }),
    ).toThrow(/HTTP or HTTPS/);
  });

  it("keeps the Arbitrum One profile and endpoint separate from Sepolia", () => {
    const runtime = bootstrapBackendRuntime({
      environment: {
        ...baseEnvironment,
        ARBITRUM_RPC_URL: "https://sepolia.example.test",
        ARBITRUM_ONE_RPC_URL: "https://one.example.test",
      },
      tokenRegistry: {
        chains: [
          { chainId: ARBITRUM_SEPOLIA_CHAIN_ID, symbol: "ETH", decimals: 18 },
          { chainId: ARBITRUM_ONE_CHAIN_ID, symbol: "ETH", decimals: 18 },
        ],
        tokens: [],
      },
    });

    expect(runtime.config.arbitrum).toEqual({
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      protocolId: "camelot-v3",
      rpcUrl: "https://sepolia.example.test",
    });
    expect(runtime.config.arbitrumOne).toMatchObject({
      profileId: ARBITRUM_ONE_PROFILE_ID,
      chainId: ARBITRUM_ONE_CHAIN_ID,
      protocolId: "camelot-v3",
      rpcUrl: "https://one.example.test",
      deployments: ARBITRUM_ONE_RUNTIME_PROFILE.deployments,
      route: ARBITRUM_ONE_RUNTIME_PROFILE.route,
      capabilities: { quote: true, check: false, simulation: false },
    });
    expect(
      resolveArbitrumRuntimeProfile(runtime, ARBITRUM_SEPOLIA_CHAIN_ID),
    ).toEqual(runtime.config.arbitrum);
    expect(
      resolveArbitrumRuntimeProfile(runtime, ARBITRUM_ONE_CHAIN_ID),
    ).toEqual(runtime.config.arbitrumOne);
    expect(resolveArbitrumRuntimeProfile(runtime, 1)).toBeUndefined();
  });

  it("does not fall back from a missing One endpoint to the Sepolia endpoint", () => {
    const runtime = bootstrapBackendRuntime({
      environment: {
        ...baseEnvironment,
        ARBITRUM_RPC_URL: "https://sepolia.example.test",
      },
      tokenRegistry: {
        chains: [
          { chainId: ARBITRUM_ONE_CHAIN_ID, symbol: "ETH", decimals: 18 },
        ],
        tokens: [],
      },
    });

    expect(runtime.config.arbitrum?.rpcUrl).toBe(
      "https://sepolia.example.test",
    );
    expect(runtime.config.arbitrumOne?.rpcUrl).toBeUndefined();
    expect(
      resolveArbitrumRuntimeProfile(runtime, ARBITRUM_ONE_CHAIN_ID)?.rpcUrl,
    ).toBeUndefined();
  });

  it("locks Arbitrum One deployment and profile identity to the backend profile", () => {
    const runtime = bootstrapBackendRuntime({
      environment: {
        ...baseEnvironment,
        ARBITRUM_ONE_RPC_URL: "https://one.example.test",
      },
      tokenRegistry: {
        chains: [
          { chainId: ARBITRUM_ONE_CHAIN_ID, symbol: "ETH", decimals: 18 },
        ],
        tokens: [],
      },
    });
    const profile = runtime.config.arbitrumOne;
    expect(profile).toBeDefined();
    if (profile === undefined) throw new Error("Arbitrum One profile missing");

    expect(
      arbitrumOneIntegrationConfigSchema.safeParse({
        ...profile,
        profileId: "client-selected-profile",
      }).success,
    ).toBe(false);
    expect(
      arbitrumOneIntegrationConfigSchema.safeParse({
        ...profile,
        deployments: {
          ...profile.deployments,
          quoterAddress: "0x1111111111111111111111111111111111111111",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects client-supplied trusted profile and address overrides", () => {
    const quoteRequest = {
      chainId: ARBITRUM_ONE_CHAIN_ID,
      protocol: "camelot-v3",
      sender: "0x1111111111111111111111111111111111111111",
      tokenIn: { kind: "native" as const },
      tokenOut: {
        kind: "erc20" as const,
        address: ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenOut.address,
      },
      amountIn: "0.001",
    };

    expect(quoteRequestSchema.safeParse(quoteRequest).success).toBe(true);
    expect(
      quoteRequestSchema.safeParse({
        ...quoteRequest,
        profileId: ARBITRUM_ONE_PROFILE_ID,
      }).success,
    ).toBe(false);
    expect(
      quoteRequestSchema.safeParse({
        ...quoteRequest,
        quoterAddress: ARBITRUM_ONE_RUNTIME_PROFILE.deployments.quoterAddress,
      }).success,
    ).toBe(false);
  });

  it("enables local-fork Check only in development and keeps the public profile quote-only", () => {
    const environment = {
      ...baseEnvironment,
      NODE_ENV: "development",
      ARBITRUM_ONE_RPC_URL: "https://one.example.test",
      ARBITRUM_ONE_LOCAL_FORK_CHECK_ENABLED: "true",
      ARBITRUM_ONE_FORK_LOCAL_RPC_URL: "http://127.0.0.1:8545",
      ARBITRUM_ONE_FORK_INSTANCE_ID: "00000000-0000-4000-8000-000000000001",
    };
    const runtime = bootstrapBackendRuntime({
      environment,
      tokenRegistry: {
        chains: [
          { chainId: ARBITRUM_ONE_CHAIN_ID, symbol: "ETH", decimals: 18 },
        ],
        tokens: [],
      },
    });

    expect(runtime.config.arbitrumOneLocalForkCheck).toEqual({
      rpcUrl: "http://127.0.0.1:8545",
      forkInstanceId: "00000000-0000-4000-8000-000000000001",
      anvilVersion: "1.8.5",
    });
    expect(runtime.config.arbitrumOne?.capabilities).toEqual({
      quote: true,
      check: false,
      simulation: false,
    });
    expect(() =>
      bootstrapBackendRuntime({
        environment: { ...environment, NODE_ENV: "production" },
        tokenRegistry: {
          chains: [
            { chainId: ARBITRUM_ONE_CHAIN_ID, symbol: "ETH", decimals: 18 },
          ],
          tokens: [],
        },
      }),
    ).toThrow();
  });

  it("fails closed for non-development opt-in and incomplete local fork configuration", () => {
    const enabledEnvironment = {
      ...baseEnvironment,
      NODE_ENV: "development",
      ARBITRUM_ONE_RPC_URL: "https://one.example.test",
      ARBITRUM_ONE_LOCAL_FORK_CHECK_ENABLED: "true",
      ARBITRUM_ONE_FORK_LOCAL_RPC_URL: "http://127.0.0.1:8545",
      ARBITRUM_ONE_FORK_INSTANCE_ID: "00000000-0000-4000-8000-000000000001",
    };
    for (const environment of [
      { ...enabledEnvironment, NODE_ENV: "production" },
      { ...enabledEnvironment, ARBITRUM_ONE_RPC_URL: undefined },
      { ...enabledEnvironment, ARBITRUM_ONE_FORK_LOCAL_RPC_URL: undefined },
      { ...enabledEnvironment, ARBITRUM_ONE_FORK_INSTANCE_ID: undefined },
      { ...enabledEnvironment, NODE_ENV: undefined },
    ]) {
      expect(backendEnvironmentSchema.safeParse(environment).success).toBe(
        false,
      );
    }
    expect(
      backendEnvironmentSchema.safeParse({
        ...baseEnvironment,
        ARBITRUM_ONE_LOCAL_FORK_CHECK_ENABLED: "true",
      }).success,
    ).toBe(false);
  });

  it("accepts only unauthenticated local HTTP fork RPC endpoints", () => {
    const base = {
      ...baseEnvironment,
      NODE_ENV: "development",
      ARBITRUM_ONE_RPC_URL: "https://one.example.test",
      ARBITRUM_ONE_LOCAL_FORK_CHECK_ENABLED: "true",
      ARBITRUM_ONE_FORK_INSTANCE_ID: "00000000-0000-4000-8000-000000000001",
    };
    for (const rpcUrl of [
      "https://127.0.0.1:8545",
      "http://192.0.2.1:8545",
      "http://user:pass@localhost:8545",
      "http://host.docker.internal:8545?token=secret",
    ]) {
      expect(
        backendEnvironmentSchema.safeParse({
          ...base,
          ARBITRUM_ONE_FORK_LOCAL_RPC_URL: rpcUrl,
        }).success,
      ).toBe(false);
    }
  });
});
