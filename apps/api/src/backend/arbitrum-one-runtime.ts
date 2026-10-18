import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_ONE_RUNTIME_PROFILE,
  arbitrumOneIntegrationConfigSchema,
  type BackendRuntime,
} from "../runtime-config.js";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import type { ChainOperationOptions } from "./chain-adapter.js";
import { createNativeRpcClient } from "./native-rpc-client.js";

export const ARBITRUM_ONE_READ_ONLY_RPC_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_call",
] as const;

export type ArbitrumOneReadOnlyRpcMethod =
  (typeof ARBITRUM_ONE_READ_ONLY_RPC_METHODS)[number];

export type ArbitrumOneReadOnlyRpcClient = {
  request(
    method: ArbitrumOneReadOnlyRpcMethod,
    params?: readonly unknown[],
    options?: ChainOperationOptions,
  ): Promise<unknown>;
};

export type ArbitrumOneQuoteRuntime = {
  readonly profile: typeof ARBITRUM_ONE_RUNTIME_PROFILE;
  readonly rpcClient: ArbitrumOneReadOnlyRpcClient;
};

export type ArbitrumOneQuoteRuntimeOptions = {
  /** Internal test seam; never populated from an API request. */
  readonly rpcClient?: ArbitrumRpcClient;
  readonly fetchImplementation?: typeof fetch;
};

const readOnlyRpcMethodSet = new Set<string>(
  ARBITRUM_ONE_READ_ONLY_RPC_METHODS,
);
const defaultRpcTimeoutMs = 30_000;

/**
 * Selects the immutable backend-owned One profile, validates its separately
 * configured endpoint against eth_chainId, and exposes only quote-path RPC
 * reads. No Sepolia endpoint or client-supplied profile/address is accepted.
 */
export async function createArbitrumOneQuoteRuntime(
  runtime: BackendRuntime,
  options: ArbitrumOneQuoteRuntimeOptions = {},
): Promise<ArbitrumOneQuoteRuntime> {
  const candidate = runtime.config.arbitrumOne;
  if (candidate === undefined) {
    throw new Error("Arbitrum One runtime profile is unavailable");
  }

  let profile: ReturnType<typeof arbitrumOneIntegrationConfigSchema.parse>;
  try {
    profile = arbitrumOneIntegrationConfigSchema.parse(candidate);
  } catch {
    throw new Error("Arbitrum One runtime profile is invalid");
  }
  if (profile.rpcUrl === undefined) {
    throw new Error("ARBITRUM_ONE_RPC_URL is required for Arbitrum One quotes");
  }

  const configuredClient =
    options.rpcClient ??
    createNativeRpcClient({
      rpcUrl: profile.rpcUrl,
      fetchImplementation: options.fetchImplementation,
    });
  const rpcClient: ArbitrumOneReadOnlyRpcClient = {
    async request(method, params = [], requestOptions) {
      if (!readOnlyRpcMethodSet.has(method)) {
        throw new Error(
          "Arbitrum One quote runtime permits read-only RPC methods only",
        );
      }
      try {
        return await configuredClient.request(method, params, {
          ...requestOptions,
          timeoutMs: requestOptions?.timeoutMs ?? defaultRpcTimeoutMs,
        });
      } catch {
        throw new Error(`Arbitrum One RPC ${method} request failed`);
      }
    },
  };

  let chainIdResponse: unknown;
  try {
    chainIdResponse = await rpcClient.request("eth_chainId", []);
  } catch {
    throw new Error("Arbitrum One RPC chain ID validation failed");
  }
  const observedChainId = parseRpcChainId(chainIdResponse);
  if (observedChainId === undefined) {
    throw new Error("Arbitrum One RPC returned an invalid chain ID");
  }
  if (observedChainId !== BigInt(ARBITRUM_ONE_CHAIN_ID)) {
    throw new Error(
      `Arbitrum One RPC chain mismatch: expected ${ARBITRUM_ONE_CHAIN_ID}, received ${observedChainId}`,
    );
  }

  return {
    profile: ARBITRUM_ONE_RUNTIME_PROFILE,
    rpcClient,
  };
}

function parseRpcChainId(value: unknown): bigint | undefined {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)
  ) {
    return undefined;
  }
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}
