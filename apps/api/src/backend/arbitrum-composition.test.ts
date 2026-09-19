import {
  convertAtomicAmountToHuman,
  type GenericEvidence,
  genericEvidenceSchema,
  type NormalizedSwapIntent,
  runResultSchema,
} from "@parallax/contracts";
import { economicFailStopResult } from "@parallax/orchestrator/application/action-gate-fixtures";
import type {
  CallerConstraint,
  ConstraintEvidence,
  QuoteContext,
} from "@parallax/risk";
import { describe, expect, it } from "vitest";
import { createBackendApp } from "../bootstrap/backend.js";
import { UnsupportedAgentFlowError } from "../ports.js";
import { bootstrapBackendRuntime } from "../runtime-config.js";
import { InMemoryRunStore } from "../store.js";

import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import {
  type ArbitrumProductionCompositionOptions,
  bootstrapArbitrumBackend,
  createArbitrumProductionComposition,
} from "./arbitrum-composition.js";
import {
  CAMELOT_SEPOLIA_QUOTER,
  CAMELOT_SEPOLIA_ROUTER,
  CAMELOT_SEPOLIA_USDC,
  CAMELOT_SEPOLIA_WETH,
  createCamelotV3ProtocolAdapter,
} from "./camelot-v3-protocol-adapter.js";
import type { BackendCompositionRuntime } from "./composition.js";
import {
  createFakeChainAdapter,
  createFakeProviderAdapter,
} from "./fake-harness.js";
import { NATIVE_RPC_ARBITRUM_PROVIDER_ID } from "./native-rpc-evidence.js";
import { BackendPipeline } from "./pipeline.js";

const normalizedIntent: NormalizedSwapIntent = {
  chainId: 421614,
  protocol: "camelot-v3",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: {
    kind: "erc20",
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  amountInAtomic: "1000",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

function options(): ArbitrumProductionCompositionOptions {
  const runtime = bootstrapBackendRuntime({
    environment: {
      MONAD_RPC_URL: "https://monad.example.test",
      ARBITRUM_RPC_URL: "https://arbitrum.example.test",
      MOSS_RUNTIME_VERSION: "fixture-runtime",
      MOSS_RUNTIME_REVISION: "fixture-revision",
    },
    tokenRegistry: {
      chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
      tokens: [],
    },
  });
  return {
    runtime,
    runStore: new InMemoryRunStore(),
    chainAdapter: createFakeChainAdapter({
      chainId: 421614,
      blockNumber: "42",
      gasUnits: "21000",
      finality: { status: "finalized" },
    }),
    providers: [
      createFakeProviderAdapter<NormalizedSwapIntent>({
        providerId: "controlled-arbitrum-provider",
        intent: normalizedIntent,
        chainId: 421614,
        protocol: "camelot-v3",
        capabilities: ["simulate"],
      }),
    ],
    core: { evaluate: async (input) => input },
    decision: { decide: async (input) => input },
  };
}

const arbitrumTokenAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const arbitrumTokenRegistry = {
  chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
  tokens: [
    {
      chainId: 421614,
      address: arbitrumTokenAddress,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "42",
    },
  ],
};
const arbitrumEnvironment = {
  MONAD_RPC_URL: "https://monad.example.test",
  ARBITRUM_RPC_URL: "https://arbitrum.example.test",
  MOSS_RUNTIME_VERSION: "fixture-runtime",
  MOSS_RUNTIME_REVISION: "fixture-revision",
};

function arbitrumRuntime() {
  return bootstrapBackendRuntime({
    environment: arbitrumEnvironment,
    tokenRegistry: arbitrumTokenRegistry,
  });
}

function arbitrumCompositionOptions(
  runtime: ReturnType<typeof arbitrumRuntime>,
  protocolAdapter?: ArbitrumProductionCompositionOptions["protocolAdapter"],
): ArbitrumProductionCompositionOptions {
  return {
    runtime,
    runStore: new InMemoryRunStore(),
    chainAdapter: createFakeChainAdapter({
      chainId: 421614,
      blockNumber: "42",
      gasUnits: "21000",
      finality: { status: "finalized" },
    }),
    ...(protocolAdapter === undefined ? {} : { protocolAdapter }),
    core: { evaluate: async (input) => input },
    decision: { decide: async (input) => input },
  };
}

describe("Arbitrum production composition skeleton", () => {
  it("bootstraps runtime and composition without starting a server", () => {
    const input = options();
    const { runtime: _runtime, ...compositionOptions } = input;
    const bootstrapped = bootstrapArbitrumBackend({
      ...compositionOptions,
      environment: {
        MONAD_RPC_URL: "https://monad.example.test",
        ARBITRUM_RPC_URL: "https://arbitrum.example.test",
        MOSS_RUNTIME_VERSION: "fixture-runtime",
        MOSS_RUNTIME_REVISION: "fixture-revision",
      },
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [],
      },
    });

    expect(bootstrapped.runtime.config.arbitrum?.protocolId).toBe("camelot-v3");
    expect(bootstrapped.composition.resolveChain(421614).chainId).toBe(421614);
  });

  it("selects the exact Arbitrum chain, Camelot protocol, and injected provider", () => {
    const composition = createArbitrumProductionComposition(options());

    expect(composition.resolveChain(421614).chainId).toBe(421614);
    expect(composition.resolveProtocol(421614, "camelot-v3").protocolId).toBe(
      "camelot-v3",
    );
    expect(
      composition.resolveProvider({
        intent: normalizedIntent,
        chainId: 421614,
        protocol: "camelot-v3",
        capability: "simulate",
      }).providerId,
    ).toBe("controlled-arbitrum-provider");
  });

  it("projects non-success Native RPC evidence through the public check response", async () => {
    const runtime = arbitrumRuntime();
    const provider = createFakeProviderAdapter<NormalizedSwapIntent>({
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      intent: normalizedIntent,
      chainId: 421614,
      protocol: "camelot-v3",
      capabilities: ["simulate", "eth_call", "estimateGas", "pinned-block"],
      supports: () => true,
      result: {
        provider: {
          providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
          observedAt: "2026-09-10T00:01:00.000Z",
        },
        status: "unknown",
        responseEvidence: {
          kind: "redacted_snapshot",
          redactionProfile: "native-rpc-method-results-v1",
          snapshot: { mode: "LIVE", status: "unknown" },
        },
        candidateFields: [
          {
            candidatePath: "nativeRpc.ethCall.returnData",
            observedShape: "hex_string",
            status: "observed",
            nullable: false,
            confidence: "high",
            value: "0xabcdef",
          },
          {
            candidatePath: "nativeRpc.estimateGas.gasUnits",
            observedShape: "decimal_string",
            status: "observed",
            nullable: false,
            confidence: "high",
            value: "21000",
          },
        ],
      },
    });
    const composition = createArbitrumProductionComposition({
      ...arbitrumCompositionOptions(runtime),
      providers: [provider],
      protocolAdapter: createCamelotV3ProtocolAdapter({
        quote: async () => ({
          estimatedAmountOut: "0.5",
          minimumAmountOut: "0.4",
          runtimeVersion: "arbitrum-camelot-v3",
          runtimeRevision: "native-rpc",
        }),
        buildTransaction: async () => ({
          to: "0x2222222222222222222222222222222222222222",
          data: "0x1234",
          value: "0x0",
        }),
      }),
      core: { evaluate: async (input) => input },
      decision: {
        decide: async (_input, context) => {
          const pipelineContext = context as {
            runId: string;
            intent: NormalizedSwapIntent;
          };
          const result = economicFailStopResult(
            {
              sender: pipelineContext.intent.sender,
              mon: { kind: "native" },
              usdc: pipelineContext.intent.tokenOut as {
                kind: "erc20";
                address: string;
              },
              simulatorPinnedBlock: "42",
              runtimeVersion: "arbitrum-camelot-v3",
              runtimeRevision: "native-rpc",
            },
            pipelineContext.runId,
            pipelineContext.intent,
          );
          return {
            ...result,
            route: {
              ...result.route,
              protocol: pipelineContext.intent.protocol,
            },
          };
        },
      },
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: { kind: "native" },
          tokenOut: {
            kind: "erc20",
            address: arbitrumTokenAddress,
          },
          amountIn: "1",
          economicBoundary: {
            availability: "available",
            minimumReceived: "0.02",
            source: "user_declared",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      providerEvidence: {
        provider: {
          providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
          status: "UNKNOWN",
        },
        provenance: {
          source: "rpc",
          mode: "LIVE",
          simulationBlock: "42",
          runtime: {
            runtimeVersion: "arbitrum-camelot-v3",
            runtimeRevision: "native-rpc",
          },
        },
        checkedScope: ["native-rpc.eth_call", "native-rpc.estimateGas"],
        providerData: {
          nativeRpc: {
            status: "unknown",
            freshness: { status: "not_checked" },
            notChecked: expect.arrayContaining([
              "receipt",
              "outcome",
              "assetChanges",
            ]),
          },
        },
      },
    });
  });

  it("accepts the LIVE Arbitrum composition runtime instead of the Moss runtime identity", async () => {
    // Regression for the P0 integration blocker: the authoritative runtime of a
    // provider-neutral composition Run is the LIVE provider Evidence's own
    // provenance runtime (arbitrum-camelot-v3 / native-rpc). The configured Moss
    // runtime identity is deliberately unrelated here and must not reject it.
    const blockHash = `0x${"ab".repeat(32)}`;
    const rpcClient: ArbitrumRpcClient = {
      async request(method, params = []) {
        if (method === "eth_chainId") return "0x66eee";
        if (method === "eth_getBlockByNumber") {
          return { number: "0x2a", hash: blockHash };
        }
        if (method === "eth_estimateGas") return "0x426b4";
        if (method === "eth_call") {
          const transaction = params[0] as { to?: string } | undefined;
          if (
            transaction?.to?.toLowerCase() ===
            CAMELOT_SEPOLIA_QUOTER.toLowerCase()
          ) {
            return `0x${15882896725531551n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
          }
          return "0x";
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
    };
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [
          {
            chainId: 421614,
            address: CAMELOT_SEPOLIA_USDC,
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: "42",
          },
        ],
      },
    });
    expect(runtime.config.moss.runtimeVersion).not.toBe("arbitrum-camelot-v3");
    expect(runtime.config.moss.runtimeRevision).not.toBe("native-rpc");
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: new InMemoryRunStore(),
      rpcClient,
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
          amountIn: "0.001",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );
    const body = (await response.json()) as {
      status?: string;
      verdict?: string;
      evidence?: Array<{ runtimeVersion?: string; runtimeRevision?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      providerEvidence: {
        provider: {
          providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
          status: "UNKNOWN",
        },
        provenance: {
          mode: "LIVE",
          source: "rpc",
          simulationBlock: "42",
          runtime: {
            runtimeVersion: "arbitrum-camelot-v3",
            runtimeRevision: "native-rpc",
          },
        },
      },
    });
    expect(body.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtimeVersion: "arbitrum-camelot-v3",
          runtimeRevision: "native-rpc",
        }),
      ]),
    );
  });

  it("does not label a Native RPC provider failure as Moss simulation", async () => {
    const runtime = arbitrumRuntime();
    const provider = createFakeProviderAdapter<NormalizedSwapIntent>({
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      intent: normalizedIntent,
      chainId: 421614,
      protocol: "camelot-v3",
      capabilities: ["simulate"],
      supports: () => false,
    });
    const composition = createArbitrumProductionComposition({
      ...arbitrumCompositionOptions(runtime),
      providers: [provider],
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: { kind: "native" },
          tokenOut: {
            kind: "erc20",
            address: arbitrumTokenAddress,
          },
          amountIn: "1",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: {
        code: "UNSUPPORTED",
        message: "Provider evaluation is not available in this runtime",
      },
      run: {
        status: "integration_error",
        scope: [
          {
            key: "P0-CHECK-SIMULATION-001",
            label: "Provider evaluation",
            status: "unknown",
            reason: "REQUIRED_CHECK_INTERRUPTED",
          },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain("Moss simulation");
  });

  it("requires an explicit Arbitrum endpoint when no controlled chain seam is supplied", () => {
    const input = options();
    const { chainAdapter: _chainAdapter, ...withoutChain } = input;
    const runtimeWithoutRpc = bootstrapBackendRuntime({
      environment: {
        MONAD_RPC_URL: "https://monad.example.test",
        MOSS_RUNTIME_VERSION: "fixture-runtime",
        MOSS_RUNTIME_REVISION: "fixture-revision",
      },
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [],
      },
    });
    expect(() =>
      createArbitrumProductionComposition({
        ...withoutChain,
        runtime: runtimeWithoutRpc,
      }),
    ).toThrow("Arbitrum RPC URL is required");
  });

  it("wires a configured Arbitrum RPC through Camelot and NativeRpcProvider", async () => {
    const blockHash = `0x${"ab".repeat(32)}`;
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    const rpcClient: ArbitrumRpcClient = {
      async request(method, params = []) {
        calls.push({ method, params });
        if (method === "eth_chainId") return "0x66eee";
        if (method === "eth_getBlockByNumber") {
          return { number: "0x2a", hash: blockHash };
        }
        if (method === "eth_estimateGas") return "0x426b4";
        if (method === "eth_call") {
          const transaction = params[0] as { to?: string } | undefined;
          if (
            transaction?.to?.toLowerCase() ===
            CAMELOT_SEPOLIA_QUOTER.toLowerCase()
          ) {
            return `0x${15882896725531551n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
          }
          return "0x";
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
    };
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [
          {
            chainId: 421614,
            address: CAMELOT_SEPOLIA_USDC,
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: "42",
          },
        ],
      },
    });
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: new InMemoryRunStore(),
      rpcClient,
    });
    const pipeline = new BackendPipeline({ runtime: composition });
    const execution = await pipeline.executeNormalized(
      {
        ...normalizedIntent,
        tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
        amountInAtomic: "1000000000000000",
      },
      {
        rawInput: normalizedIntent as never,
        runId: "arbitrum-golden-path",
        chainId: 421614,
        protocol: "camelot-v3",
        capability: "simulate",
      },
    );

    expect(execution.providerResult).toMatchObject({
      status: "success",
      provider: { providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID },
    });
    expect(execution.providerEvidence).toMatchObject({
      provider: {
        providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
        status: "UNKNOWN",
      },
      provenance: { mode: "LIVE", source: "rpc" },
      unknownScope: expect.arrayContaining(["receipt", "simulation"]),
    });
    expect(execution.decisionOutput).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      providerEvidence: {
        provider: { providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID },
      },
    });
    expect(execution.unsignedTransaction.payload).toMatchObject({
      to: CAMELOT_SEPOLIA_ROUTER,
      chainId: "0x66eee",
    });
    const quoteCall = calls.find(
      ({ method, params }) =>
        method === "eth_call" &&
        (params[0] as { to?: string } | undefined)?.to?.toLowerCase() ===
          CAMELOT_SEPOLIA_QUOTER.toLowerCase(),
    );
    expect(quoteCall).toMatchObject({
      params: [
        {
          to: CAMELOT_SEPOLIA_QUOTER,
          data: expect.stringContaining(
            `2d9ebd1d${CAMELOT_SEPOLIA_WETH.slice(2).toLowerCase().padStart(64, "0")}${CAMELOT_SEPOLIA_USDC.slice(2).toLowerCase().padStart(64, "0")}${1000000000000000n.toString(16).padStart(64, "0")}`,
          ),
        },
        "0x2a",
      ],
    });
    const estimateCall = calls.find(
      ({ method }) => method === "eth_estimateGas",
    );
    expect(estimateCall).toMatchObject({
      params: [
        expect.objectContaining({
          to: CAMELOT_SEPOLIA_ROUTER,
          data: expect.stringContaining("bc651188"),
          chainId: "0x66eee",
        }),
      ],
    });
    expect(calls[2]).toMatchObject({
      method: "eth_call",
      params: [expect.anything(), "0x2a"],
    });
    expect(calls.map(({ method }) => method)).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_call",
      "eth_estimateGas",
      "eth_getBlockByNumber",
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_call",
      "eth_estimateGas",
    ]);
  });

  it("normalizes Arbitrum quotes through the public app and reaches Camelot", async () => {
    const runtime = arbitrumRuntime();
    let receivedIntent: NormalizedSwapIntent | undefined;
    const protocolAdapter = createCamelotV3ProtocolAdapter({
      quote: async (intent) => {
        receivedIntent = intent;
        return {
          status: "available",
          quote: {
            estimatedAmountOut: "0.5",
            source: "quote",
            blockNumber: "42",
            runtimeVersion: "camelot-fixture-runtime",
            runtimeRevision: "camelot-fixture-revision",
          },
        };
      },
    });
    const composition = createArbitrumProductionComposition(
      arbitrumCompositionOptions(runtime, protocolAdapter),
    );
    const app = createBackendApp({
      runtime,
      // createBackendApp predates specialized composition input unions.
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: "0x1111111111111111111111111111111111111111",
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
          amountIn: "1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "available",
      quote: {
        estimatedAmountOut: "0.5",
        blockNumber: "42",
        runtimeVersion: "camelot-fixture-runtime",
        runtimeRevision: "camelot-fixture-revision",
      },
    });
    expect(receivedIntent).toMatchObject({
      chainId: 421614,
      protocol: "camelot-v3",
      amountInAtomic: "1000000000000000000",
      economicBoundary: { availability: "unavailable" },
    });
  });

  it("continues to normalize Arbitrum checks at the public app boundary", async () => {
    const runtime = arbitrumRuntime();
    let receivedIntent: NormalizedSwapIntent | undefined;
    const composition = createArbitrumProductionComposition(
      arbitrumCompositionOptions(runtime),
    );
    const app = createBackendApp({
      runtime,
      // createBackendApp predates specialized composition input unions.
      composition: composition as unknown as BackendCompositionRuntime,
      agentFlow: {
        async check(input) {
          receivedIntent = input.intent;
          throw new UnsupportedAgentFlowError();
        },
      },
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: "0x1111111111111111111111111111111111111111",
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
          amountIn: "1",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED" },
    });
    expect(receivedIntent).toMatchObject({
      chainId: 421614,
      protocol: "camelot-v3",
      amountInAtomic: "1000000000000000000",
      economicBoundary: { availability: "unavailable" },
    });
  });
});

const p0IntentAmountInAtomic = "1000";
const p0ObservedAt = "2026-09-01T00:00:00.000Z";

function p0Field<T>(value: T) {
  return {
    value,
    source: "rpc" as const,
    reproducibility: "REPRODUCIBLE" as const,
    blockNumber: "42",
    fetchedAt: p0ObservedAt,
  };
}

/**
 * A fully verified provider-neutral observation, used only to prove that the
 * default Arbitrum decision obeys the P0 Risk verdict. It is never a claim
 * about real Native RPC evidence.
 */
function p0VerifiedEvidence(
  intent: NormalizedSwapIntent = normalizedIntent,
  options: {
    estimatedAmountOut?: string;
    amountReceivedAtomic?: string;
  } = {},
): GenericEvidence {
  const estimatedAmountOut = options.estimatedAmountOut ?? "0.5";
  const amountReceivedAtomic = options.amountReceivedAtomic ?? "500000";
  const minimumReceived =
    intent.economicBoundary.availability === "available"
      ? convertAtomicAmountToHuman(
          intent.economicBoundary.minimumReceivedAtomic,
          6,
        )
      : undefined;
  return genericEvidenceSchema.parse({
    intent: {
      chainId: 421614,
      protocol: "camelot-v3",
      sender: intent.sender,
      tokenIn: "native",
      tokenOut: arbitrumTokenAddress,
      amountIn: convertAtomicAmountToHuman(intent.amountInAtomic, 18),
      ...(minimumReceived === undefined
        ? { minimumReceivedSource: "unavailable" }
        : {
            minimumReceived,
            minimumReceivedSource: intent.economicBoundary.source,
          }),
    },
    provider: {
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      status: "SUCCESS",
      integrationStatus: "OK",
      errors: p0Field([]),
    },
    execution: { status: "SUCCESS" },
    quote: {
      value: { estimatedAmountOut },
      source: "quote",
      reproducibility: "REPRODUCIBLE",
      blockNumber: "42",
      fetchedAt: p0ObservedAt,
    },
    action: p0Field([]),
    receipt: p0Field({ status: "success" }),
    outcome: p0Field({
      amountReceivedAtomic,
      recipient: intent.recipient,
      tokenOut: arbitrumTokenAddress,
    }),
    assetChanges: p0Field([]),
    assetChangeAssessment: "NOT_APPLICABLE",
    warnings: p0Field([]),
    simulation: {
      value: {
        expectedTransactions: 1,
        observedResults: 1,
        unmatchedResultIndexes: [],
        halted: false,
        complete: true,
        missingTransactionIndexes: [],
      },
      source: "derived",
      reproducibility: "REPRODUCIBLE",
      blockNumber: "42",
      fetchedAt: p0ObservedAt,
    },
    blockNumber: p0Field("42"),
    capabilities: ["quote"],
    provenance: {
      observedChainId: 421614,
      fetchedAt: p0ObservedAt,
      mode: "LIVE",
      source: "rpc",
      simulationBlock: "42",
      runtime: {
        runtimeVersion: "arbitrum-camelot-v3",
        runtimeRevision: "native-rpc",
      },
    },
    checkedScope: ["quote"],
    unknownScope: [],
    providerData: {},
  });
}

const p0SelectedQuote: QuoteContext = {
  chainId: 421614,
  protocol: "camelot-v3",
  tokenIn: "native",
  tokenOut: arbitrumTokenAddress,
  amountInAtomic: p0IntentAmountInAtomic,
  amountOutAtomic: "490000",
  quoteId: "selected-baseline",
  provenance: "quote-adapter:v1",
  blockNumber: "41",
  observedAt: "2026-08-31T00:00:00.000Z",
};

const p0Constraints: readonly CallerConstraint[] = [
  {
    name: "maxPriceImpact",
    source: "caller",
    declarationId: "impact",
    numerator: "10",
    denominator: "1",
    unit: "bps",
  },
];

const p0ConstraintEvidence: readonly ConstraintEvidence[] = [
  {
    name: "maxPriceImpact",
    state: "VERIFIED",
    numerator: "50",
    denominator: "1",
    unit: "bps",
    evidenceKey: "impact",
  },
];

function p0CompositionOptions(
  overrides: Partial<ArbitrumProductionCompositionOptions> = {},
): ArbitrumProductionCompositionOptions {
  return {
    runtime: arbitrumRuntime(),
    runStore: new InMemoryRunStore(),
    chainAdapter: createFakeChainAdapter({
      chainId: 421614,
      blockNumber: "42",
      gasUnits: "21000",
      finality: { status: "finalized" },
    }),
    providers: [
      createFakeProviderAdapter<NormalizedSwapIntent>({
        providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
        intent: normalizedIntent,
        chainId: 421614,
        protocol: "camelot-v3",
        capabilities: ["simulate", "eth_call", "estimateGas", "pinned-block"],
        supports: () => true,
      }),
    ],
    protocolAdapter: createCamelotV3ProtocolAdapter({
      quote: async () => ({
        estimatedAmountOut: "0.5",
        blockNumber: "42",
        runtimeVersion: "arbitrum-camelot-v3",
        runtimeRevision: "native-rpc",
      }),
      buildTransaction: async () => ({
        to: "0x2222222222222222222222222222222222222222",
        data: "0x1234",
        value: "0x0",
      }),
    }),
    ...overrides,
  };
}

async function runP0Check(
  composition: ReturnType<typeof createArbitrumProductionComposition>,
  runId: string,
  intent: NormalizedSwapIntent = normalizedIntent,
) {
  const pipeline = new BackendPipeline({ runtime: composition });
  return pipeline.executeNormalized(intent, {
    rawInput: normalizedIntent as never,
    runId,
    chainId: 421614,
    protocol: "camelot-v3",
    capability: "simulate",
  });
}

describe("Arbitrum composition P0 Risk wiring", () => {
  it("fails the default decision closed to UNKNOWN without a selected baseline", async () => {
    // The legacy projection of this verified Evidence is PROCEED; the P0 gate
    // has no Expectation Baseline, so the published verdict must be UNKNOWN and
    // the current quote must never be used as the baseline.
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        providerEvidenceMapper: ({ normalizedIntent }) =>
          p0VerifiedEvidence(normalizedIntent as NormalizedSwapIntent),
      }),
    );

    const execution = await runP0Check(composition, "p0-no-baseline");

    expect(execution.decisionOutput).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      summary: "Live check could not establish a trustworthy result",
    });
    expect(
      (execution.decisionOutput as { readonly verdict: string }).verdict,
    ).not.toBe("PROCEED");
    // The Backend-side verdict override must keep the shared Run contract valid.
    expect(runResultSchema.safeParse(execution.decisionOutput).success).toBe(
      true,
    );
  });

  it("makes the final verdict obey the P0 Risk verdict for an injected baseline", async () => {
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        providerEvidenceMapper: ({ normalizedIntent }) =>
          p0VerifiedEvidence(normalizedIntent as NormalizedSwapIntent),
        p0Risk: {
          selectedQuote: p0SelectedQuote,
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
        },
      }),
    );

    const execution = await runP0Check(composition, "p0-constraint-stop");

    // The legacy projection of this verified Evidence is PROCEED; the injected
    // caller constraint violation must still be published as STOP.
    expect(execution.decisionOutput).toMatchObject({
      status: "completed",
      verdict: "STOP",
      summary: "Live check completed with verdict STOP",
    });
    expect(runResultSchema.safeParse(execution.decisionOutput).success).toBe(
      true,
    );
  });

  it("runs bounded remediation through a terminal child Run before recording VERIFIED", async () => {
    const store = new InMemoryRunStore();
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        runStore: store,
        providerEvidenceMapper: ({ normalizedIntent }) =>
          p0VerifiedEvidence(normalizedIntent as NormalizedSwapIntent),
        p0Risk: {
          selectedQuote: p0SelectedQuote,
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
            constraintEvidenceForCandidate: () => [
              {
                name: "maxPriceImpact",
                state: "VERIFIED",
                numerator: "1",
                denominator: "1",
                unit: "bps",
                evidenceKey: "candidate-impact",
              },
            ],
          },
        },
      }),
    );

    const execution = await runP0Check(composition, "p0-remediation");
    const result = runResultSchema.parse(execution.decisionOutput);
    expect(result).toMatchObject({
      status: "completed",
      verdict: "STOP",
      recommendedActions: [],
    });
    expect(result.providerEvidence?.providerData).not.toHaveProperty(
      "backendP0",
    );
  });

  it("fails closed when candidate Evidence is bound to the baseline Intent", async () => {
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        providerEvidenceMapper: () => p0VerifiedEvidence(),
        p0Risk: {
          selectedQuote: p0SelectedQuote,
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
            constraintEvidenceForCandidate: () => [
              {
                name: "maxPriceImpact",
                state: "VERIFIED",
                numerator: "1",
                denominator: "1",
                unit: "bps",
                evidenceKey: "candidate-impact",
              },
            ],
          },
        },
      }),
    );

    const execution = await runP0Check(composition, "p0-mismatched-candidate");

    expect(runResultSchema.parse(execution.decisionOutput)).toMatchObject({
      status: "completed",
      verdict: "STOP",
      recommendedActions: [],
    });
  });

  it("does not reuse parent constraint Evidence for a changed candidate", async () => {
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        providerEvidenceMapper: ({ normalizedIntent }) =>
          p0VerifiedEvidence(normalizedIntent as NormalizedSwapIntent),
        p0Risk: {
          selectedQuote: p0SelectedQuote,
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
          },
        },
      }),
    );

    const execution = await runP0Check(composition, "p0-parent-constraints");

    expect(runResultSchema.parse(execution.decisionOutput)).toMatchObject({
      status: "completed",
      verdict: "STOP",
      recommendedActions: [],
    });
  });

  it("publishes a verified remediation through the existing RunResult Action Gate", async () => {
    const store = new InMemoryRunStore();
    const availableIntent: NormalizedSwapIntent = {
      ...normalizedIntent,
      economicBoundary: {
        availability: "available",
        minimumReceivedAtomic: "600000",
        source: "user_declared",
      },
    };
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        runStore: store,
        providerEvidenceMapper: ({ normalizedIntent }) => {
          const candidate = normalizedIntent as NormalizedSwapIntent;
          return p0VerifiedEvidence(candidate, {
            estimatedAmountOut:
              candidate.amountInAtomic === "1000" ? "0.5" : "0.7",
            amountReceivedAtomic:
              candidate.amountInAtomic === "1000" ? "500000" : "700000",
          });
        },
        p0Risk: {
          selectedQuote: p0SelectedQuote,
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
            constraintEvidenceForCandidate: () => [
              {
                name: "maxPriceImpact",
                state: "VERIFIED",
                numerator: "1",
                denominator: "1",
                unit: "bps",
                evidenceKey: "candidate-impact",
              },
            ],
          },
        },
      }),
    );

    const execution = await runP0Check(
      composition,
      "p0-public-remediation",
      availableIntent,
    );
    const result = runResultSchema.parse(execution.decisionOutput);

    expect(result).toMatchObject({
      status: "completed",
      verdict: "ADJUST",
      recommendedActions: [
        {
          action: { kind: "TRANSACTION_ADJUSTMENT", field: "amountIn" },
          recommendable: true,
          proposedChange: { before: "1000", after: "2000" },
        },
      ],
    });
    expect(result.providerEvidence?.providerData).not.toHaveProperty(
      "backendP0",
    );
    const verification = result.evidence.find(
      (item) => item.kind === "action_verification",
    );
    expect(verification).toMatchObject({
      kind: "action_verification",
      baselineRunId: "p0-public-remediation",
      beforeValue: "1000",
      afterValue: "2000",
    });
    if (verification?.kind === "action_verification") {
      await expect(
        store.get(verification.verificationRunId),
      ).resolves.toMatchObject({
        status: "completed",
        parentRunId: "p0-public-remediation",
      });
    }
  });

  it("leaves an injected custom core/decision override unchanged", async () => {
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        core: { evaluate: async () => ({ custom: "core" }) },
        decision: {
          decide: async (input) => ({ custom: "decision", input }),
        },
        p0Risk: {
          selectedQuote: p0SelectedQuote,
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
        },
      }),
    );

    const execution = await runP0Check(composition, "custom-override");

    expect(execution.decisionOutput).toEqual({
      custom: "decision",
      input: { custom: "core" },
    });
  });
});
