import { describe, expect, it } from "vitest";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  backendEnvironmentSchema,
  bootstrapBackendRuntime,
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
});
