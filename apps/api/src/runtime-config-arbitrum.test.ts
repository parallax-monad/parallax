import { describe, expect, it } from "vitest";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  bootstrapBackendRuntime,
} from "./runtime-config.js";

describe("Arbitrum runtime configuration", () => {
  it("normalizes an explicit Arbitrum RPC URL without inventing credentials", () => {
    const runtime = bootstrapBackendRuntime({
      environment: {
        MONAD_RPC_URL: "https://monad.example.test",
        ARBITRUM_RPC_URL: "https://arbitrum.example.test",
        MOSS_RUNTIME_VERSION: "fixture-runtime",
        MOSS_RUNTIME_REVISION: "fixture-revision",
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
      environment: {
        MONAD_RPC_URL: "https://monad.example.test",
        MOSS_RUNTIME_VERSION: "fixture-runtime",
        MOSS_RUNTIME_REVISION: "fixture-revision",
      },
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
});
