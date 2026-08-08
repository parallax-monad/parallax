import type {
  JsonValue,
  NormalizedKuruEvidence,
  NormalizedMossError,
  SimulationCoverage,
  Sourced,
} from "@parallax/moss-bridge";
import { describe, expect, it } from "vitest";
import {
  KuruLiveAgentFlow,
  KuruLiveQuoteAgentFlow,
  type LiveAgentFlowInput,
} from "./index.js";

const sender = "0x1111111111111111111111111111111111111111";
const usdc = "0x2222222222222222222222222222222222222222";
const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const liveUsdcTransferEvent: JsonValue = {
  kind: "event",
  address: usdc,
  topics: [
    transferTopic,
    `0x${"3".repeat(64)}`,
    `0x${sender.slice(2).padStart(64, "0")}`,
  ],
  data: `0x${"df".padStart(64, "0")}`,
};

const intent: LiveAgentFlowInput["intent"] = {
  chainId: 143,
  protocol: "kuru",
  sender,
  recipient: sender,
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: { kind: "erc20", address: usdc },
  amountInAtomic: "10000000000000000",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

const runtime = {
  rpcUrl: "https://rpc.example.test",
  runtimePath: "/tmp/moss-runtime",
  runtimeVersion: "0.1.0",
  runtimeRevision: "1111111111111111111111111111111111111111",
};

const packageVersions = {
  "@themoss/core": runtime.runtimeVersion,
  "@themoss/erc": runtime.runtimeVersion,
  "@themoss/protocol-kuru": runtime.runtimeVersion,
  "@themoss/simulator": runtime.runtimeVersion,
  "@themoss/system": runtime.runtimeVersion,
};

function runtimeIdentity() {
  return {
    runtimeVersion: runtime.runtimeVersion,
    runtimeRevision: runtime.runtimeRevision,
    checkoutRevision: runtime.runtimeRevision,
    packageVersions,
  };
}

function sourced<T>(
  value: T | null,
  source: Sourced<unknown>["source"],
  reproducibility: Sourced<unknown>["reproducibility"] = "REPRODUCIBLE",
): Sourced<T> {
  return {
    value,
    source,
    reproducibility,
    blockNumber: "1",
  };
}

function evidence(
  overrides: Partial<NormalizedKuruEvidence> = {},
): NormalizedKuruEvidence {
  return {
    protocol: "kuru",
    intent: {
      chainId: "143",
      sender,
      tokenIn: "MON",
      tokenOut: usdc,
      amountIn: intent.amountInAtomic,
      minimumReceivedSource: "unavailable",
    },
    integrationStatus: "OK",
    executionStatus: "SUCCESS",
    quote: sourced({ estimatedAmountOut: "10" }, "quote"),
    action: sourced([{ protocol: "kuru", method: "swap" }], "moss"),
    receipt: sourced({ status: "ok" }, "moss"),
    outcome: sourced({ status: "ok" }, "moss"),
    assetChanges: sourced([], "moss"),
    assetChangeAssessment: "NOT_APPLICABLE",
    warnings: sourced([], "moss"),
    revertReason: sourced<string>(null, "unknown", "UNKNOWN"),
    gas: sourced([], "moss"),
    simulationCoverage: sourced(
      {
        expectedTransactions: 1,
        observedResults: 1,
        unmatchedResultIndexes: [],
        missingTransactionIndexes: [],
        halted: false,
        complete: true,
      },
      "derived",
    ),
    errors: sourced([], "moss"),
    blockNumber: sourced("1", "rpc"),
    mossVersion: "0.1.0",
    mossCommit: runtime.runtimeRevision,
    runtimeVersion: runtime.runtimeVersion,
    runtimeRevision: runtime.runtimeRevision,
    source: "moss",
    replayMode: false,
    isReplay: false,
    isMock: false,
    approval: sourced("NOT_APPLICABLE", "derived"),
    walletAffordabilityChecked: false,
    limitations: [],
    ...overrides,
  };
}

function input(runId = "run-1"): LiveAgentFlowInput {
  return {
    runId,
    intent,
    tokenInDecimals: 18,
    tokenOutDecimals: 6,
    moss: runtime,
  };
}

function liveAmountOutFlow() {
  return new KuruLiveAgentFlow(async (value) => ({
    runId: value.runId,
    evidence: evidence({
      assetChanges: sourced([liveUsdcTransferEvent], "moss"),
      assetChangeAssessment: "EXPLAINED",
      outcome: sourced(
        {
          operation: "swap",
          protocol: "kuru",
          sender,
          tokenIn: "native",
          tokenOut: usdc,
          amountIn: intent.amountInAtomic,
          amountOut: "223",
        },
        "moss",
      ),
    }),
    raw: {
      discover: null,
      load: null,
      quote: null,
      action: null,
      simulation: null,
    },
    stages: [],
    runtime: runtimeIdentity(),
    observedChainId: 143,
    simulatorPinnedBlock: "1",
  }));
}

describe("KuruLiveAgentFlow", () => {
  it("returns a quote without requiring simulation provenance", async () => {
    const flow = new KuruLiveQuoteAgentFlow(async (value) => ({
      runId: value.runId,
      evidence: evidence({
        quote: sourced(
          {
            estimatedAmountOut: "0.000223",
            minimumAmountOut: "0.000221",
          },
          "quote",
        ),
      }),
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      stages: [],
      runtime: runtimeIdentity(),
      observedChainId: 143,
    }));

    await expect(flow.quote(input("quote-1"))).resolves.toMatchObject({
      status: "available",
      quote: {
        estimatedAmountOut: "0.000223",
        minimumAmountOut: "0.000221",
      },
    });
  });

  it("fails closed when the Quote RPC chain ID is unavailable", async () => {
    const flow = new KuruLiveQuoteAgentFlow(async (value) => ({
      runId: value.runId,
      evidence: evidence({
        quote: sourced({ estimatedAmountOut: "0.000223" }, "quote"),
      }),
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      stages: [],
      runtime: runtimeIdentity(),
    }));

    await expect(
      flow.quote(input("quote-chain-unavailable")),
    ).rejects.toMatchObject({
      code: "RPC_UNAVAILABLE",
      integrationStatus: "UNAVAILABLE",
      source: "rpc",
      stage: "DISCOVER",
    });
  });

  it("maps live Evidence and Risk output into a completed Run", async () => {
    let received:
      | Parameters<
          NonNullable<ConstructorParameters<typeof KuruLiveAgentFlow>[0]>
        >[0]
      | undefined;
    const flow = new KuruLiveAgentFlow(async (value) => {
      received = value;
      return {
        runId: value.runId,
        evidence: evidence(),
        raw: {
          discover: null,
          load: null,
          quote: null,
          action: null,
          simulation: null,
        },
        stages: [],
        runtime: runtimeIdentity(),
        observedChainId: 143,
        simulatorPinnedBlock: "1",
      };
    });

    const result = await flow.check(input());

    expect(received).toMatchObject({
      runId: "run-1",
      rpcUrl: runtime.rpcUrl,
      runtimePath: runtime.runtimePath,
      runtimeVersion: runtime.runtimeVersion,
      runtimeRevision: runtime.runtimeRevision,
      intent: {
        chainId: "143",
        tokenIn: "native",
        tokenOut: usdc,
        amountIn: "0.01",
        minimumReceivedSource: "unavailable",
      },
    });
    expect(result).toMatchObject({
      runId: "run-1",
      status: "completed",
      systemStatus: "OK",
      verdict: "PROCEED",
      simulatorPinnedBlock: "1",
      quote: {
        estimatedAmountOut: "10",
        source: "quote",
        blockNumber: "1",
        runtimeVersion: runtime.runtimeVersion,
        runtimeRevision: runtime.runtimeRevision,
      },
      route: { availability: "available", protocol: "kuru" },
      ruleResults: [
        { ruleId: "P0-EVIDENCE-001", status: "PASS" },
        { ruleId: "P0-EXECUTION-001", status: "PASS" },
        { ruleId: "P0-ECONOMIC-001", status: "NOT_APPLICABLE" },
      ],
    });
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ simulatorPinnedBlock: "1" }),
      ]),
    );
  });

  it("preserves a no-route classification as STOP without fabricating simulation evidence", async () => {
    const noRoute: NormalizedMossError = {
      stage: "QUOTE",
      code: "NO_ROUTE",
      message: "no verified Kuru market path",
      integrationStatus: "OK",
      source: "quote",
      normalization: "DERIVED",
      retryable: false,
    };
    const flow = new KuruLiveAgentFlow(async (value) => ({
      runId: value.runId,
      evidence: evidence({
        executionStatus: "NO_ROUTE",
        quote: sourced(null, "unknown", "UNKNOWN"),
        action: sourced(null, "unknown", "UNKNOWN"),
        receipt: sourced(null, "unknown", "UNKNOWN"),
        outcome: sourced(null, "unknown", "UNKNOWN"),
        simulationCoverage: sourced<SimulationCoverage>(
          null,
          "unknown",
          "UNKNOWN",
        ),
        errors: sourced([noRoute], "quote"),
      }),
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      stages: [],
      runtime: runtimeIdentity(),
      observedChainId: 143,
    }));

    const result = await flow.check(input());

    expect(result).toMatchObject({
      status: "completed",
      verdict: "STOP",
      route: { availability: "unavailable" },
    });
    expect(
      result.ruleResults.find((rule) => rule.ruleId === "P0-EXECUTION-001"),
    ).toMatchObject({
      status: "FAIL",
      reasonCode: "NO_ROUTE_FOUND",
    });
    expect(
      result.ruleResults.find((rule) => rule.ruleId === "P0-ECONOMIC-001"),
    ).toMatchObject({
      status: "NOT_APPLICABLE",
      applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
    });
    expect(
      result.evidence.some((item) => item.kind === "no_route_raw_output"),
    ).toBe(true);
    expect(
      result.evidence.some((item) => item.kind === "no_route_classification"),
    ).toBe(true);
    expect(result.scope).toEqual(
      expect.arrayContaining([
        {
          key: "P0-CHECK-ACTION-001",
          label: "Action construction",
          status: "not_checked",
          reason: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
        },
        {
          key: "P0-CHECK-SIMULATION-001",
          label: "Moss simulation",
          status: "not_checked",
          reason: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
        },
        {
          key: "P0-CHECK-SIMULATION-COVERAGE-001",
          label: "Simulation coverage",
          status: "not_checked",
          reason: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
        },
      ]),
    );
  });

  it("treats an ACTION no-route as checked action and stops before simulation", async () => {
    const noRoute: NormalizedMossError = {
      stage: "ACTION",
      code: "NO_ROUTE",
      message: "no verified Kuru market path during action construction",
      integrationStatus: "OK",
      source: "moss",
      normalization: "DERIVED",
      retryable: false,
    };
    const flow = new KuruLiveAgentFlow(async (value) => ({
      runId: value.runId,
      evidence: evidence({
        executionStatus: "NO_ROUTE",
        quote: sourced(null, "unknown", "UNKNOWN"),
        action: sourced(null, "unknown", "UNKNOWN"),
        receipt: sourced(null, "unknown", "UNKNOWN"),
        outcome: sourced(null, "unknown", "UNKNOWN"),
        simulationCoverage: sourced<SimulationCoverage>(
          null,
          "unknown",
          "UNKNOWN",
        ),
        errors: sourced([noRoute], "moss"),
      }),
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      stages: [],
      runtime: runtimeIdentity(),
      observedChainId: 143,
      simulatorPinnedBlock: "1",
    }));

    const result = await flow.check(input());

    expect(result.verdict).toBe("STOP");
    expect(result.scope).toEqual(
      expect.arrayContaining([
        {
          key: "P0-CHECK-ACTION-001",
          label: "Action construction",
          status: "checked",
        },
        {
          key: "P0-CHECK-SIMULATION-001",
          label: "Moss simulation",
          status: "not_checked",
          reason: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
        },
        {
          key: "P0-CHECK-SIMULATION-COVERAGE-001",
          label: "Simulation coverage",
          status: "not_checked",
          reason: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
        },
      ]),
    );
  });

  it("uses verified simulated output for an available Economic Boundary", async () => {
    const flow = new KuruLiveAgentFlow(async (value) => ({
      runId: value.runId,
      evidence: evidence({
        quote: sourced({ estimatedAmountOut: "20000" }, "quote"),
        intent: {
          chainId: "143",
          sender,
          tokenIn: "MON",
          tokenOut: usdc,
          amountIn: intent.amountInAtomic,
          minimumReceived: "10000",
          minimumReceivedSource: "user_declared",
        },
        outcome: sourced(
          {
            amountReceivedAtomic: "20000",
            recipient: sender,
            tokenOut: usdc,
          },
          "moss",
        ),
      }),
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      stages: [],
      runtime: runtimeIdentity(),
      observedChainId: 143,
      simulatorPinnedBlock: "1",
    }));

    const result = await flow.check({
      ...input(),
      intent: {
        ...intent,
        economicBoundary: {
          availability: "available",
          minimumReceivedAtomic: "10000",
          source: "user_declared",
        },
      },
    });

    expect(result.verdict).toBe("PROCEED");
    expect(
      result.ruleResults.find((rule) => rule.ruleId === "P0-ECONOMIC-001"),
    ).toMatchObject({ status: "PASS" });
    expect(
      result.evidence.find((item) => item.kind === "simulated_token_out"),
    ).toMatchObject({ amountReceivedAtomic: "20000" });
  });

  it("derives simulated tokenOut from the live Kuru amountOut shape", async () => {
    const flow = liveAmountOutFlow();

    const result = await flow.check({
      ...input(),
      intent: {
        ...intent,
        economicBoundary: {
          availability: "available",
          minimumReceivedAtomic: "1",
          source: "user_declared",
        },
      },
    });

    expect(result.verdict).toBe("PROCEED");
    expect(
      result.ruleResults.find((rule) => rule.ruleId === "P0-ECONOMIC-001"),
    ).toMatchObject({ status: "PASS" });
    expect(
      result.evidence.find((item) => item.kind === "simulated_token_out"),
    ).toMatchObject({
      amountReceivedAtomic: "223",
      recipient: sender,
      derivation: "asset_change",
      inputEvidenceRefs: expect.arrayContaining([
        expect.objectContaining({
          key: `${runtime.runtimeRevision}:asset-changes`,
        }),
      ]),
    });

    const belowBoundary = await flow.check({
      ...input("run-live-below-boundary"),
      intent: {
        ...intent,
        economicBoundary: {
          availability: "available",
          minimumReceivedAtomic: "1000",
          source: "user_declared",
        },
      },
    });

    expect(belowBoundary.verdict).toBe("STOP");
    expect(
      belowBoundary.ruleResults.find(
        (rule) => rule.ruleId === "P0-ECONOMIC-001",
      ),
    ).toMatchObject({
      status: "FAIL",
      reasonCode: "OUTPUT_BELOW_BOUNDARY",
    });
  });

  it("does not infer an explicit recipient from the sender", async () => {
    const flow = liveAmountOutFlow();
    const recipient = "0x4444444444444444444444444444444444444444";

    const result = await flow.check({
      ...input("run-explicit-recipient"),
      intent: {
        ...intent,
        recipient,
        recipientSource: "explicit",
        economicBoundary: {
          availability: "available",
          minimumReceivedAtomic: "1",
          source: "user_declared",
        },
      },
    });

    expect(result.verdict).toBe("UNKNOWN");
    expect(
      result.ruleResults.find((rule) => rule.ruleId === "P0-ECONOMIC-001"),
    ).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "SIMULATED_OUTPUT_UNAVAILABLE",
    });
    expect(
      result.evidence.some((item) => item.kind === "simulated_token_out"),
    ).toBe(false);
  });

  it("returns STOP for a below-boundary result until an Action Gate exists", async () => {
    const flow = new KuruLiveAgentFlow(async (value) => ({
      runId: value.runId,
      evidence: evidence({
        quote: sourced({ estimatedAmountOut: "9000" }, "quote"),
        intent: {
          chainId: "143",
          sender,
          tokenIn: "MON",
          tokenOut: usdc,
          amountIn: intent.amountInAtomic,
          minimumReceived: "10000",
          minimumReceivedSource: "user_declared",
        },
        outcome: sourced(
          {
            amountReceivedAtomic: "9000",
            recipient: sender,
            tokenOut: usdc,
          },
          "moss",
        ),
      }),
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      stages: [],
      runtime: runtimeIdentity(),
      observedChainId: 143,
      simulatorPinnedBlock: "1",
    }));

    const result = await flow.check({
      ...input(),
      intent: {
        ...intent,
        economicBoundary: {
          availability: "available",
          minimumReceivedAtomic: "10000",
          source: "user_declared",
        },
      },
    });

    expect(result).toMatchObject({
      verdict: "STOP",
      summary: "Simulated output was below the declared Economic Boundary",
      recommendedActions: [],
    });
    expect(
      result.ruleResults.find((rule) => rule.ruleId === "P0-ECONOMIC-001"),
    ).toMatchObject({
      status: "FAIL",
      reasonCode: "OUTPUT_BELOW_BOUNDARY",
    });
  });

  it("retains trusted quote and execution Evidence on a simulation Integration Error", async () => {
    const flow = new KuruLiveAgentFlow(async (value) => ({
      runId: value.runId,
      evidence: evidence({
        integrationStatus: "INTEGRATION_ERROR",
        receipt: sourced(null, "unknown", "UNKNOWN"),
        outcome: sourced(null, "unknown", "UNKNOWN"),
        assetChanges: sourced<JsonValue[]>(null, "unknown", "UNKNOWN"),
        simulationCoverage: sourced<SimulationCoverage>(
          null,
          "unknown",
          "UNKNOWN",
        ),
        errors: sourced(
          [
            {
              stage: "SIMULATE",
              code: "INTEGRATION_ERROR",
              message: "simulator unavailable",
              integrationStatus: "INTEGRATION_ERROR",
              source: "rpc",
              normalization: "PRESERVED",
              retryable: true,
            },
          ],
          "rpc",
        ),
      }),
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      stages: [],
      runtime: runtimeIdentity(),
      observedChainId: 143,
      simulatorPinnedBlock: "1",
    }));

    await expect(flow.check(input())).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      stage: "SIMULATE",
      partialRunResult: {
        status: "integration_error",
        error: { stage: "simulation" },
        route: { availability: "available" },
        ruleResults: [{ ruleId: "P0-EXECUTION-001", status: "PASS" }],
        evidence: expect.arrayContaining([
          expect.objectContaining({ key: `${runtime.runtimeRevision}:quote` }),
          expect.objectContaining({ key: `${runtime.runtimeRevision}:action` }),
        ]),
      },
    });
  });

  it("retains partial Evidence when integration status has no detailed error", async () => {
    const flow = new KuruLiveAgentFlow(async (value) => ({
      runId: value.runId,
      evidence: evidence({
        integrationStatus: "UNAVAILABLE",
        errors: sourced([], "moss"),
      }),
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      stages: [],
      runtime: runtimeIdentity(),
      observedChainId: 143,
      simulatorPinnedBlock: "1",
    }));

    await expect(flow.check(input())).rejects.toMatchObject({
      code: "MOSS_UNAVAILABLE",
      partialRunResult: {
        status: "integration_error",
        evidence: expect.arrayContaining([
          expect.objectContaining({ key: `${runtime.runtimeRevision}:quote` }),
          expect.objectContaining({ key: `${runtime.runtimeRevision}:action` }),
        ]),
      },
    });
  });

  it("fails closed when live runtime provenance does not match the configured identity", async () => {
    const flow = new KuruLiveAgentFlow(async (value) => ({
      runId: value.runId,
      evidence: evidence({
        runtimeRevision: "2222222222222222222222222222222222222222",
      }),
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      stages: [],
      runtime: runtimeIdentity(),
      observedChainId: 143,
      simulatorPinnedBlock: "1",
    }));

    await expect(flow.check(input())).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      integrationStatus: "INTEGRATION_ERROR",
    });
  });

  it("fails closed when the adapter observes a non-Monad Chain ID", async () => {
    const flow = new KuruLiveAgentFlow(async (value) => ({
      runId: value.runId,
      evidence: evidence(),
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      stages: [],
      runtime: runtimeIdentity(),
      observedChainId: 1,
      simulatorPinnedBlock: "1",
    }));

    await expect(flow.check(input())).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      integrationStatus: "INTEGRATION_ERROR",
    });
  });

  it("fails closed when simulator pinned-block provenance is absent", async () => {
    const flow = new KuruLiveAgentFlow(async (value) => ({
      runId: value.runId,
      evidence: evidence(),
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      stages: [],
      runtime: runtimeIdentity(),
      observedChainId: 143,
    }));

    await expect(flow.check(input())).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      integrationStatus: "INTEGRATION_ERROR",
    });
  });

  it("maps an unavailable RPC to a retryable Integration Error", async () => {
    const flow = new KuruLiveAgentFlow(async () => {
      throw {
        code: "UNAVAILABLE",
        integrationStatus: "UNAVAILABLE",
        source: "rpc",
        message: "RPC unavailable",
      };
    });

    await expect(flow.check(input())).rejects.toMatchObject({
      code: "RPC_UNAVAILABLE",
      integrationStatus: "UNAVAILABLE",
      source: "rpc",
    });
  });

  it("classifies an invalid Moss checkout as Moss unavailable", async () => {
    const flow = new KuruLiveAgentFlow(async () => {
      throw new Error(
        "MOSS_RUNTIME_PATH does not contain a Moss checkout: /tmp/missing",
      );
    });

    await expect(flow.check(input())).rejects.toMatchObject({
      code: "MOSS_UNAVAILABLE",
      integrationStatus: "UNAVAILABLE",
      source: "moss",
    });
  });
});
