import {
  type EvidenceField,
  EvidenceProviderError,
  type GenericProviderError,
  type GenericSwapIntent,
  type JsonValue,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import {
  type KuruLiveRunner,
  type LiveKuruResult,
  MossProvider,
  type NormalizedKuruEvidence,
  type NormalizedMossError,
  replayKuruEvidence,
  type SimulationCoverage,
  type Sourced,
  toGenericEvidence,
} from "../src/index.js";

const sender = "0x1111111111111111111111111111111111111111";
const usdc = "0x2222222222222222222222222222222222222222";

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
      amountIn: "0.01",
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
    simulationCoverage: sourced<SimulationCoverage>(
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
    mossVersion: "@themoss/protocol-kuru@0.1.0",
    mossCommit: runtime.runtimeRevision,
    runtimeVersion: runtime.runtimeVersion,
    runtimeRevision: runtime.runtimeRevision,
    source: "moss",
    replayMode: false,
    isReplay: false,
    isMock: false,
    approval: sourced("NOT_APPLICABLE", "derived"),
    walletAffordabilityChecked: false,
    limitations: [
      "Moss trace simulation synthetic-prefunds native MON only.",
      "No signing, broadcast, custody, or wallet mutation occurred.",
    ],
    ...overrides,
  };
}

function liveResult(overrides: Partial<LiveKuruResult> = {}): LiveKuruResult {
  return {
    runId: "run-1",
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
    ...overrides,
  };
}

describe("toGenericEvidence adapter", () => {
  it("maps a live success into complete generic evidence", () => {
    const generic = toGenericEvidence(evidence({ simulatorPinnedBlock: "1" }), {
      stages: liveResult().stages,
      runtime: liveResult().runtime,
      observedChainId: 143,
    });

    expect(generic.provider).toMatchObject({
      providerId: "moss-kuru",
      status: "SUCCESS",
      integrationStatus: "OK",
    });
    expect(generic.provider.errors.value).toEqual([]);
    expect(generic.quote.value).toEqual({ estimatedAmountOut: "10" });
    expect(generic.action.value).toEqual([
      { protocol: "kuru", method: "swap" },
    ]);
    expect(generic.receipt.value).toEqual({ status: "ok" });
    expect(generic.outcome.value).toEqual({ status: "ok" });
    expect(generic.assetChanges.value).toEqual([]);
    expect(generic.warnings.value).toEqual([]);
    expect(generic.simulation.value?.complete).toBe(true);
    expect(generic.blockNumber.value).toBe("1");
    expect(generic.assetChangeAssessment).toBe("NOT_APPLICABLE");
    expect(generic.capabilities).toEqual(["quote", "action", "simulate"]);
    expect(generic.checkedScope).toEqual([
      "quote",
      "action",
      "simulation",
      "simulation-coverage",
    ]);
    expect(generic.unknownScope).toEqual([]);
    expect(generic.provenance).toMatchObject({
      mode: "LIVE",
      source: "moss",
      observedChainId: 143,
      simulationBlock: "1",
      runtime: {
        runtimeVersion: runtime.runtimeVersion,
        runtimeRevision: runtime.runtimeRevision,
        checkoutRevision: runtime.runtimeRevision,
        commit: runtime.runtimeRevision,
        packageVersions,
      },
    });
    expect(generic.providerData.mossVersion).toBe(
      "@themoss/protocol-kuru@0.1.0",
    );
    expect(generic.providerData.packageVersions).toBeUndefined();
    expect(generic.providerData.limitations).toHaveLength(2);
    expect(generic.providerData.walletAffordabilityChecked).toBe(false);
  });

  it("maps NO_ROUTE as a legal terminal without a pinned block", () => {
    const noRoute: NormalizedMossError = {
      stage: "QUOTE",
      code: "NO_ROUTE",
      message: "no verified Kuru market path",
      integrationStatus: "OK",
      source: "quote",
      normalization: "DERIVED",
      retryable: false,
    };
    const generic = toGenericEvidence(
      evidence({
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
    );

    expect(generic.provider).toMatchObject({
      providerId: "moss-kuru",
      status: "SUCCESS",
      integrationStatus: "OK",
    });
    expect(generic.execution.status).toBe("NO_ROUTE");
    expect(generic.provider.failure).toBeUndefined();
    expect(generic.provider.errors.value).toEqual([noRoute]);
    expect(generic.provenance.simulationBlock).toBeUndefined();
    expect(generic.checkedScope).toEqual(["no-route"]);
    expect(generic.unknownScope).toEqual([
      "quote",
      "action",
      "simulation",
      "simulation-coverage",
    ]);
  });

  it("preserves a classified integration failure and partial evidence", () => {
    const integrationError: NormalizedMossError = {
      stage: "SIMULATE",
      code: "INTEGRATION_ERROR",
      message: "simulator unavailable",
      integrationStatus: "INTEGRATION_ERROR",
      source: "rpc",
      normalization: "PRESERVED",
      retryable: true,
    };
    const generic = toGenericEvidence(
      evidence({
        integrationStatus: "INTEGRATION_ERROR",
        receipt: sourced(null, "unknown", "UNKNOWN"),
        outcome: sourced(null, "unknown", "UNKNOWN"),
        assetChanges: sourced<JsonValue[]>(null, "unknown", "UNKNOWN"),
        simulationCoverage: sourced<SimulationCoverage>(
          null,
          "unknown",
          "UNKNOWN",
        ),
        errors: sourced([integrationError], "rpc"),
      }),
      { stages: [], runtime: runtimeIdentity(), observedChainId: 143 },
    );

    expect(generic.provider).toMatchObject({
      providerId: "moss-kuru",
      status: "FAILED",
      integrationStatus: "INTEGRATION_ERROR",
    });
    expect(generic.provider.failure).toEqual(integrationError);
    expect(generic.quote.value).toEqual({ estimatedAmountOut: "10" });
    expect(generic.action.value).not.toBeNull();
    expect(generic.receipt.value).toBeNull();
  });

  it("synthesizes a classified failure when no error detail exists", () => {
    const generic = toGenericEvidence(
      evidence({
        integrationStatus: "UNAVAILABLE",
        errors: sourced([], "moss"),
      }),
      { stages: [], runtime: runtimeIdentity(), observedChainId: 143 },
    );

    expect(generic.provider).toMatchObject({
      providerId: "moss-kuru",
      status: "FAILED",
      integrationStatus: "UNAVAILABLE",
    });
    expect(generic.provider.failure).toMatchObject({
      code: "UNAVAILABLE",
      message: "Live Evidence reported an integration failure without details",
      integrationStatus: "UNAVAILABLE",
      source: "moss",
    });
  });

  it("separates provider status from execution outcome", () => {
    // Verified simulation revert: provider SUCCESS, execution REVERTED.
    // (Risk still returns UNKNOWN for REVERTED — asserted by the
    // orchestrator Risk-compatibility matrix.)
    const reverted = toGenericEvidence(
      evidence({ executionStatus: "REVERTED" }),
    );
    expect(reverted.provider.status).toBe("SUCCESS");
    expect(reverted.provider.integrationStatus).toBe("OK");
    expect(reverted.execution.status).toBe("REVERTED");

    // Undetermined outcome (e.g. unsupported receipt / incomplete coverage):
    // provider UNKNOWN, execution UNKNOWN.
    const undetermined = toGenericEvidence(
      evidence({ executionStatus: "UNKNOWN" }),
    );
    expect(undetermined.provider.status).toBe("UNKNOWN");
    expect(undetermined.provider.integrationStatus).toBe("OK");
    expect(undetermined.execution.status).toBe("UNKNOWN");

    // Integration failure dominates both axes.
    const failed = toGenericEvidence(
      evidence({ integrationStatus: "TIMEOUT" }),
    );
    expect(failed.provider.status).toBe("FAILED");
    expect(failed.provider.integrationStatus).toBe("TIMEOUT");
  });

  it("keeps non-decimal quote output fail-closed instead of rejecting evidence", () => {
    const generic = toGenericEvidence(
      evidence({
        quote: sourced({ estimatedAmountOut: "not-a-decimal" }, "quote"),
      }),
    );
    expect(generic.quote.value).toBeNull();

    const emptyMinimum = toGenericEvidence(
      evidence({
        quote: sourced(
          { estimatedAmountOut: "10", minimumAmountOut: "" },
          "quote",
        ),
      }),
    );
    expect(emptyMinimum.quote.value).toEqual({ estimatedAmountOut: "10" });
  });

  it("preserves Replay truthfulness as RECORDED_REPLAY mode", () => {
    const generic = toGenericEvidence(replayKuruEvidence(evidence()));
    expect(generic.provenance.mode).toBe("RECORDED_REPLAY");
    expect(generic.provenance.source).toBe("moss");
  });

  it("preserves Mock truthfulness as MOCK mode", () => {
    const generic = toGenericEvidence(
      evidence({ source: "mock", isMock: true }),
    );
    expect(generic.provenance.source).toBe("mock");
    expect(generic.provenance.mode).toBe("MOCK");
    expect(generic.provider.status).toBe("SUCCESS");
  });

  it("preserves provider-specific provenance without flattening it", () => {
    const generic = toGenericEvidence(evidence(), {
      stages: [
        {
          stage: "QUOTE",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          success: true,
          raw: { data: { estimatedAmountOut: "10" } },
          runtime: runtimeIdentity(),
          blockNumber: "1",
        },
      ],
      runtime: runtimeIdentity(),
      observedChainId: 143,
    });
    expect(generic.provenance.runtime?.checkoutRevision).toBe(
      runtime.runtimeRevision,
    );
    expect(generic.provenance.runtime?.packageVersions).toEqual(
      packageVersions,
    );
    expect(generic.providerData.stages).toEqual([
      {
        stage: "QUOTE",
        success: true,
        blockNumber: "1",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
      },
    ]);
  });
});

describe("MossProvider", () => {
  const genericIntent = (): GenericSwapIntent => ({
    chainId: 143,
    protocol: "kuru",
    sender,
    tokenIn: "native",
    tokenOut: usdc,
    amountIn: "0.01",
    minimumReceivedSource: "unavailable",
  });

  function provider(runner?: KuruLiveRunner) {
    return new MossProvider({ runtime, runner });
  }

  it("evaluates a live swap into generic evidence", async () => {
    const generic = await provider(async (value) =>
      liveResult({ runId: value.runId }),
    ).evaluate({
      runId: "run-1",
      intent: genericIntent(),
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
    });

    expect(generic.provider).toMatchObject({
      providerId: "moss-kuru",
      status: "SUCCESS",
      integrationStatus: "OK",
    });
    expect(generic.provenance.observedChainId).toBe(143);
    expect(generic.provenance.simulationBlock).toBe("1");
    expect(generic.provenance.runtime?.runtimeRevision).toBe(
      runtime.runtimeRevision,
    );
  });

  it("accepts a terminal NO_ROUTE without a simulator pinned block", async () => {
    const noRoute: NormalizedMossError = {
      stage: "QUOTE",
      code: "NO_ROUTE",
      message: "no verified Kuru market path",
      integrationStatus: "OK",
      source: "quote",
      normalization: "DERIVED",
      retryable: false,
    };
    const generic = await provider(async (value) =>
      liveResult({
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
        simulatorPinnedBlock: undefined,
      }),
    ).evaluate({
      runId: "run-1",
      intent: genericIntent(),
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
    });

    expect(generic.execution.status).toBe("NO_ROUTE");
    expect(generic.provenance.simulationBlock).toBeUndefined();
  });

  it("fails closed on mismatched runtime provenance", async () => {
    await expect(
      provider(async (value) =>
        liveResult({
          runId: value.runId,
          evidence: evidence({
            runtimeRevision: "2222222222222222222222222222222222222222",
          }),
        }),
      ).evaluate({
        runId: "run-1",
        intent: genericIntent(),
        tokenInDecimals: 18,
        tokenOutDecimals: 6,
      }),
    ).rejects.toMatchObject({
      name: "EvidenceProviderError",
      code: "INTERNAL_ERROR",
      integrationStatus: "INTEGRATION_ERROR",
    });
  });

  it("fails closed on a non-Monad observed chain", async () => {
    await expect(
      provider(async (value) =>
        liveResult({ runId: value.runId, observedChainId: 1 }),
      ).evaluate({
        runId: "run-1",
        intent: genericIntent(),
        tokenInDecimals: 18,
        tokenOutDecimals: 6,
      }),
    ).rejects.toMatchObject({
      name: "EvidenceProviderError",
      code: "INTERNAL_ERROR",
      integrationStatus: "INTEGRATION_ERROR",
    });
  });

  it("fails closed when simulator pinned-block provenance is absent", async () => {
    await expect(
      provider(async (value) =>
        liveResult({ runId: value.runId, simulatorPinnedBlock: undefined }),
      ).evaluate({
        runId: "run-1",
        intent: genericIntent(),
        tokenInDecimals: 18,
        tokenOutDecimals: 6,
      }),
    ).rejects.toMatchObject({
      name: "EvidenceProviderError",
      code: "INTERNAL_ERROR",
      integrationStatus: "INTEGRATION_ERROR",
    });
  });

  it("fails closed when the RPC chain ID is unavailable", async () => {
    await expect(
      provider(async (value) =>
        liveResult({ runId: value.runId, observedChainId: undefined }),
      ).evaluate({
        runId: "run-1",
        intent: genericIntent(),
        tokenInDecimals: 18,
        tokenOutDecimals: 6,
      }),
    ).rejects.toMatchObject({
      name: "EvidenceProviderError",
      code: "UNAVAILABLE",
      integrationStatus: "UNAVAILABLE",
      source: "rpc",
      stage: "DISCOVER",
    });
  });

  it("classifies an unavailable RPC runner error", async () => {
    await expect(
      provider(async () => {
        throw {
          code: "UNAVAILABLE",
          integrationStatus: "UNAVAILABLE",
          source: "rpc",
          message: "RPC unavailable",
        };
      }).evaluate({
        runId: "run-1",
        intent: genericIntent(),
        tokenInDecimals: 18,
        tokenOutDecimals: 6,
      }),
    ).rejects.toMatchObject({
      name: "EvidenceProviderError",
      code: "UNAVAILABLE",
      integrationStatus: "UNAVAILABLE",
      source: "rpc",
    });
  });

  it("classifies an invalid Moss checkout as unavailable", async () => {
    await expect(
      provider(async () => {
        throw new Error(
          "MOSS_RUNTIME_PATH does not contain a Moss checkout: /tmp/missing",
        );
      }).evaluate({
        runId: "run-1",
        intent: genericIntent(),
        tokenInDecimals: 18,
        tokenOutDecimals: 6,
      }),
    ).rejects.toMatchObject({
      name: "EvidenceProviderError",
      code: "UNAVAILABLE",
      integrationStatus: "UNAVAILABLE",
      source: "moss",
    });
  });

  it("classifies a missing runtime path as unavailable", async () => {
    await expect(
      new MossProvider({
        runtime: { ...runtime, runtimePath: undefined },
      }).evaluate({
        runId: "run-1",
        intent: genericIntent(),
        tokenInDecimals: 18,
        tokenOutDecimals: 6,
      }),
    ).rejects.toMatchObject({
      name: "EvidenceProviderError",
      code: "UNAVAILABLE",
      integrationStatus: "UNAVAILABLE",
      source: "moss",
    });
  });

  it("rejects unsupported intents without invoking the runner", async () => {
    let invoked = false;
    const mossProvider = provider(async () => {
      invoked = true;
      return liveResult();
    });
    expect(mossProvider.supports(genericIntent())).toBe(true);
    expect(
      mossProvider.supports({ ...genericIntent(), protocol: "pancake" }),
    ).toBe(false);
    expect(mossProvider.supports({ ...genericIntent(), chainId: 1 })).toBe(
      false,
    );

    await expect(
      mossProvider.evaluate({
        runId: "run-1",
        intent: { ...genericIntent(), protocol: "pancake" },
        tokenInDecimals: 18,
        tokenOutDecimals: 6,
      }),
    ).rejects.toBeInstanceOf(EvidenceProviderError);
    expect(invoked).toBe(false);
  });
});

describe("provider failure vocabulary", () => {
  it("EvidenceField preserves field-level provenance for consumers", () => {
    const generic = toGenericEvidence(evidence());
    const quote: EvidenceField<unknown> = generic.quote;
    expect(quote.source).toBe("quote");
    expect(quote.reproducibility).toBe("REPRODUCIBLE");
    expect(quote.blockNumber).toBe("1");

    const errors: EvidenceField<GenericProviderError[]> =
      generic.provider.errors;
    expect(errors.value).toEqual([]);
  });
});
