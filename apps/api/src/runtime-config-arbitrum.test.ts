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
});
