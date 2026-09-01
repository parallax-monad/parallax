import { describe, expect, it } from "vitest";
import {
  type EvidenceField,
  EvidenceProviderError,
  type GenericEvidence,
  type GenericProviderError,
  genericEvidenceSchema,
  type JsonValue,
} from "./index.js";

function field<T>(
  value: T | null,
  source: EvidenceField<unknown>["source"] = "moss",
  reproducibility: EvidenceField<unknown>["reproducibility"] = "REPRODUCIBLE",
): EvidenceField<T> {
  return { value, source, reproducibility, blockNumber: "1" };
}

function evidence(overrides: Partial<GenericEvidence> = {}): GenericEvidence {
  return {
    intent: {
      chainId: 143,
      protocol: "kuru",
      sender: "0xcccccccccccccccccccccccccccccccccccccccc",
      tokenIn: "MON",
      tokenOut: "0x2222222222222222222222222222222222222222",
      amountIn: "1",
      minimumReceivedSource: "unavailable",
    },
    provider: {
      providerId: "moss-kuru",
      status: "SUCCESS",
      integrationStatus: "OK",
      errors: field<GenericProviderError[]>([], "moss"),
    },
    execution: { status: "SUCCESS" },
    quote: field({ estimatedAmountOut: "10" }, "quote"),
    action: field<JsonValue[]>([], "moss"),
    receipt: field({ status: "ok" }, "moss"),
    outcome: field({ status: "ok" }, "moss"),
    assetChanges: field<JsonValue[]>([], "moss"),
    assetChangeAssessment: "NOT_APPLICABLE",
    warnings: field<JsonValue[]>([], "moss"),
    simulation: field(
      {
        expectedTransactions: 1,
        observedResults: 1,
        unmatchedResultIndexes: [],
        halted: false,
        complete: true,
        missingTransactionIndexes: [],
      },
      "derived",
    ),
    blockNumber: field("1", "rpc"),
    capabilities: ["quote", "action", "simulate"],
    provenance: {
      mode: "LIVE",
      source: "moss",
      observedChainId: 143,
      simulationBlock: "1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      runtime: {
        runtimeVersion: "0.1.0",
        runtimeRevision: "1111111111111111111111111111111111111111",
        checkoutRevision: "1111111111111111111111111111111111111111",
        commit: "1111111111111111111111111111111111111111",
        packageVersions: { "@themoss/core": "0.1.0" },
      },
    },
    checkedScope: ["quote", "action", "simulation", "simulation-coverage"],
    unknownScope: [],
    providerData: {
      mossVersion: "@themoss/protocol-kuru@0.1.0",
      stages: [{ stage: "QUOTE", success: true, blockNumber: "1" }],
    },
    ...overrides,
  };
}

describe("genericEvidenceSchema", () => {
  it("accepts valid complete evidence", () => {
    const parsed = genericEvidenceSchema.safeParse(evidence());
    expect(parsed.success).toBe(true);
  });

  it("accepts every legal provider evaluation status", () => {
    for (const status of [
      "SUCCESS",
      "UNKNOWN",
      "UNSUPPORTED",
      "FAILED",
      "STALE",
    ] as const) {
      const parsed = genericEvidenceSchema.safeParse(
        evidence({ provider: { ...evidence().provider, status } }),
      );
      expect(parsed.success).toBe(true);
    }
  });

  it("keeps provider evaluation status separate from execution outcome", () => {
    const reverted = genericEvidenceSchema.safeParse(
      evidence({ execution: { status: "REVERTED" } }),
    );
    expect(reverted.success).toBe(true);
    if (reverted.success) {
      expect(reverted.data.provider.status).toBe("SUCCESS");
      expect(reverted.data.execution.status).toBe("REVERTED");
    }

    const noRoute = genericEvidenceSchema.safeParse(
      evidence({ execution: { status: "NO_ROUTE" } }),
    );
    expect(noRoute.success).toBe(true);
    if (noRoute.success) {
      expect(noRoute.data.provider.status).toBe("SUCCESS");
      expect(noRoute.data.execution.status).toBe("NO_ROUTE");
    }
  });

  it("accepts FAILED evidence with a classified provider failure", () => {
    const parsed = genericEvidenceSchema.safeParse(
      evidence({
        provider: {
          ...evidence().provider,
          status: "FAILED",
          integrationStatus: "INTEGRATION_ERROR",
          failure: {
            stage: "SIMULATE",
            code: "INTEGRATION_ERROR",
            message: "simulator unavailable",
            integrationStatus: "INTEGRATION_ERROR",
            source: "rpc",
            normalization: "PRESERVED",
            retryable: true,
          },
        },
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects a classified failure on a non-FAILED provider status", () => {
    const parsed = genericEvidenceSchema.safeParse(
      evidence({
        provider: {
          ...evidence().provider,
          failure: {
            code: "INTEGRATION_ERROR",
            message: "unexpected failure",
            integrationStatus: "INTEGRATION_ERROR",
            source: "moss",
            normalization: "PRESERVED",
          },
        },
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects evidence without required core fields", () => {
    const { provider: _provider, ...withoutProvider } = evidence();
    expect(genericEvidenceSchema.safeParse(withoutProvider).success).toBe(
      false,
    );

    const { execution: _execution, ...withoutExecution } = evidence();
    expect(genericEvidenceSchema.safeParse(withoutExecution).success).toBe(
      false,
    );

    const { intent: _intent, ...withoutIntent } = evidence();
    expect(genericEvidenceSchema.safeParse(withoutIntent).success).toBe(false);

    const { provenance: _provenance, ...withoutProvenance } = evidence();
    expect(genericEvidenceSchema.safeParse(withoutProvenance).success).toBe(
      false,
    );

    const {
      integrationStatus: _integrationStatus,
      ...providerWithoutIntegrationStatus
    } = evidence().provider;
    const withoutIntegrationStatus = {
      ...evidence(),
      provider: providerWithoutIntegrationStatus,
    };
    expect(
      genericEvidenceSchema.safeParse(withoutIntegrationStatus).success,
    ).toBe(false);
  });

  it("rejects evidence with a missing required evidence field", () => {
    const { quote: _quote, ...withoutQuote } = evidence();
    expect(genericEvidenceSchema.safeParse(withoutQuote).success).toBe(false);

    const { simulation: _simulation, ...withoutSimulation } = evidence();
    expect(genericEvidenceSchema.safeParse(withoutSimulation).success).toBe(
      false,
    );
  });

  it("rejects extra fields outside the contract", () => {
    const extra = { ...evidence(), unexpected: "value" };
    expect(genericEvidenceSchema.safeParse(extra).success).toBe(false);
  });

  it("enforces the Mock truthfulness boundary via mode and source", () => {
    const mockSource = evidence({
      provenance: { ...evidence().provenance, source: "mock", mode: "LIVE" },
    });
    expect(genericEvidenceSchema.safeParse(mockSource).success).toBe(false);

    const mockMode = evidence({
      provenance: { ...evidence().provenance, source: "moss", mode: "MOCK" },
    });
    expect(genericEvidenceSchema.safeParse(mockMode).success).toBe(false);

    const consistentMock = evidence({
      provenance: { ...evidence().provenance, source: "mock", mode: "MOCK" },
    });
    expect(genericEvidenceSchema.safeParse(consistentMock).success).toBe(true);
  });

  it("preserves provider-specific runtime provenance without requiring it", () => {
    const withRuntime = genericEvidenceSchema.safeParse(evidence());
    expect(withRuntime.success).toBe(true);
    if (withRuntime.success) {
      expect(withRuntime.data.provenance.runtime).toMatchObject({
        runtimeVersion: "0.1.0",
        runtimeRevision: "1111111111111111111111111111111111111111",
        commit: "1111111111111111111111111111111111111111",
      });
    }

    // A future provider may omit the provider-specific runtime block entirely.
    const { runtime: _runtime, ...withoutRuntime } = evidence().provenance;
    const parsed = genericEvidenceSchema.safeParse(
      evidence({ provenance: withoutRuntime }),
    );
    expect(parsed.success).toBe(true);
  });

  it("preserves provider-specific metadata verbatim", () => {
    const parsed = genericEvidenceSchema.safeParse(
      evidence({
        providerData: {
          ...evidence().providerData,
          approval: "NOT_APPLICABLE",
          limitations: ["no signing", "no broadcast"],
          arbitrary: { nested: ["value", 1, null] },
        },
      }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.providerData.approval).toBe("NOT_APPLICABLE");
      expect(parsed.data.providerData.arbitrary).toEqual({
        nested: ["value", 1, null],
      });
    }
  });

  it("accepts a missing simulation block on a legal terminal NO_ROUTE", () => {
    const parsed = genericEvidenceSchema.safeParse(
      evidence({
        execution: { status: "NO_ROUTE" },
        provenance: { ...evidence().provenance, simulationBlock: undefined },
        checkedScope: ["no-route"],
        unknownScope: ["quote", "action", "simulation", "simulation-coverage"],
      }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("EvidenceProviderError", () => {
  it("carries the classified failure vocabulary", () => {
    const error = new EvidenceProviderError({
      providerId: "moss-kuru",
      code: "TIMEOUT",
      message: "stage QUOTE timed out after 30000ms",
      integrationStatus: "TIMEOUT",
      source: "rpc",
      stage: "QUOTE",
      retryable: true,
      cause: new Error("underlying"),
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("EvidenceProviderError");
    expect(error.providerId).toBe("moss-kuru");
    expect(error.code).toBe("TIMEOUT");
    expect(error.integrationStatus).toBe("TIMEOUT");
    expect(error.stage).toBe("QUOTE");
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("stage QUOTE timed out after 30000ms");
  });
});
