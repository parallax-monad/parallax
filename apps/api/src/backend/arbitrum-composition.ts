import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
  type CheckSwapRequest,
  type NormalizedSwapIntent,
} from "@parallax/contracts";
import { normalizeArbitrumCheckSwapRequest } from "../normalization.js";
import {
  type BackendBootstrapInput,
  type BackendRuntime,
  bootstrapBackendRuntime,
} from "../runtime-config.js";
import type { RunStore } from "../store.js";
import {
  ArbitrumChainAdapter,
  type ArbitrumTransaction,
} from "./arbitrum-chain-adapter.js";
import { CamelotV3ProtocolAdapter } from "./camelot-v3-protocol-adapter.js";
import type { ChainAdapter } from "./chain-adapter.js";
import { ChainRegistry } from "./chain-registry.js";
import {
  type BackendCompositionRuntime,
  type CorePort,
  createBackendComposition,
  type DecisionPort,
  type NormalizationBoundary,
} from "./composition.js";
import { ProtocolRegistry } from "./protocol-registry.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import {
  type ProviderEnvironment,
  ProviderRegistry,
} from "./provider-registry.js";
import type { ReceiptAnchorer, ReceiptSigner } from "./receipt-ports.js";

export type ArbitrumProductionCompositionOptions = {
  readonly runtime: BackendRuntime;
  readonly runStore: RunStore;
  readonly chainAdapter?: ChainAdapter<ArbitrumTransaction>;
  readonly protocolAdapter?: CamelotV3ProtocolAdapter;
  readonly providers?: readonly ProviderAdapter<
    NormalizedSwapIntent,
    unknown
  >[];
  readonly providerEnvironment?: ProviderEnvironment;
  readonly normalization?: NormalizationBoundary<
    CheckSwapRequest,
    NormalizedSwapIntent
  >;
  readonly core: CorePort<NormalizedSwapIntent, unknown, unknown>;
  readonly decision: DecisionPort<unknown, unknown, unknown>;
  readonly receiptSigner?: ReceiptSigner;
  readonly receiptAnchorer?: ReceiptAnchorer;
};

export type ArbitrumProductionComposition = BackendCompositionRuntime<
  CheckSwapRequest,
  NormalizedSwapIntent,
  unknown,
  unknown,
  unknown,
  ChainAdapter<ArbitrumTransaction>,
  CamelotV3ProtocolAdapter,
  NormalizedSwapIntent,
  unknown,
  unknown
>;

export type ArbitrumBackendBootstrapOptions = Omit<
  ArbitrumProductionCompositionOptions,
  "runtime"
> &
  BackendBootstrapInput;

export type ArbitrumBackendBootstrap = {
  readonly runtime: BackendRuntime;
  readonly composition: ArbitrumProductionComposition;
};

/**
 * Builds the production composition skeleton for Arbitrum Sepolia × Camelot V3.
 *
 * The chain endpoint and provider implementations remain explicit dependencies.
 * In particular, an empty provider list is valid and fails closed at selection;
 * this function never invents Tenderly credentials or real pool values.
 */
export function createArbitrumProductionComposition(
  options: ArbitrumProductionCompositionOptions,
): ArbitrumProductionComposition {
  const arbitrumConfig =
    options.runtime.config.arbitrum ??
    ({
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      protocolId: CAMELOT_V3_PROTOCOL_ID,
      rpcUrl: undefined,
    } as const);
  const chainAdapter =
    options.chainAdapter ??
    (arbitrumConfig.rpcUrl === undefined
      ? (() => {
          throw new Error(
            "Arbitrum RPC URL is required unless a controlled chain adapter is injected",
          );
        })()
      : new ArbitrumChainAdapter({
          rpcUrl: arbitrumConfig.rpcUrl,
        }));
  const protocolAdapter =
    options.protocolAdapter ?? new CamelotV3ProtocolAdapter();
  const normalization = options.normalization ?? {
    normalize: (input: CheckSwapRequest): NormalizedSwapIntent => {
      const result = normalizeArbitrumCheckSwapRequest(
        input,
        options.runtime.tokenRegistry,
      );
      if (!result.success) throw new Error(result.error.message);
      return result.intent;
    },
  };

  return createBackendComposition({
    chainRegistry: new ChainRegistry([chainAdapter]),
    protocolRegistry: new ProtocolRegistry([
      {
        chainId: arbitrumConfig.chainId,
        protocol: arbitrumConfig.protocolId,
        adapter: protocolAdapter,
      },
    ]),
    providerRegistry: new ProviderRegistry(options.providers ?? [], {
      environment: options.providerEnvironment ?? "production",
    }),
    normalization,
    core: options.core,
    decision: options.decision,
    runStore: options.runStore,
    receiptSigner: options.receiptSigner,
    receiptAnchorer: options.receiptAnchorer,
  }) as ArbitrumProductionComposition;
}

/** Naming alias for callers that use the shorter Backend composition term. */
export const createArbitrumBackendComposition =
  createArbitrumProductionComposition;

/**
 * Bootstraps only the runtime descriptor and composition wiring. It deliberately
 * does not start an HTTP server, create a provider credential, or claim live
 * Camelot/Evidence/Receipt acceptance.
 */
export function bootstrapArbitrumBackend(
  options: ArbitrumBackendBootstrapOptions,
): ArbitrumBackendBootstrap {
  const runtime = bootstrapBackendRuntime({
    environment: options.environment,
    tokenRegistry: options.tokenRegistry,
  });
  const {
    environment: _environment,
    tokenRegistry: _tokenRegistry,
    ...compositionOptions
  } = options;
  return {
    runtime,
    composition: createArbitrumProductionComposition({
      ...compositionOptions,
      runtime,
    }),
  };
}
