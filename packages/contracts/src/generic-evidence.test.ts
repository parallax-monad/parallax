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
    status: "SUCCESS",
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
      status: "OK",
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
      runtimeVersion: "0.1.0",
      runtimeRevision: "1111111111111111111111111111111111111111",
      commit: "1111111111111111111111111111111111111111",
      replayMode: false,
      isReplay: false,
      isMock: false,
      source: "moss",
      observedChainId: 143,
      simulatorPinnedBlock: "1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
    },
    checkedScope: ["quote", "action", "simulation", "simulation-coverage"],
    unknownScope: [],
    providerData: {
      mossVersion: "@themoss/protocol-kuru@0.1.0",
      packageVersions: { "@themoss/core": "0.1.0" },
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

  it("accepts every legal evidence status", () => {
    for (const status of [
      "SUCCESS",
      "UNKNOWN",
      "UNSUPPORTED",
      "FAILED",
      "STALE",
    ] as const) {
      const parsed = genericEvidenceSchema.safeParse(evidence({ status }));
      expect(parsed.success).toBe(true);
    }
  });

  it("accepts FAILED evidence with a classified provider failure", () => {
    const parsed = genericEvidenceSchema.safeParse(
      evidence({
        status: "FAILED",
        provider: {
          ...evidence().provider,
          status: "INTEGRATION_ERROR",
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

  it("rejects a classified failure on an OK provider status", () => {
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
    const { status: _status, ...withoutStatus } = evidence();
    expect(genericEvidenceSchema.safeParse(withoutStatus).success).toBe(false);

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

  it("enforces the Mock provenance truthfulness boundary", () => {
    const mockSource = evidence({
      provenance: { ...evidence().provenance, source: "mock", isMock: false },
    });
    expect(genericEvidenceSchema.safeParse(mockSource).success).toBe(false);

    const mockFlag = evidence({
      provenance: { ...evidence().provenance, source: "moss", isMock: true },
    });
    expect(genericEvidenceSchema.safeParse(mockFlag).success).toBe(false);

    const consistentMock = evidence({
      provenance: { ...evidence().provenance, source: "mock", isMock: true },
    });
    expect(genericEvidenceSchema.safeParse(consistentMock).success).toBe(true);
  });

  it("preserves provider-specific provenance and metadata verbatim", () => {
    const parsed = genericEvidenceSchema.safeParse(
      evidence({
        provenance: {
          ...evidence().provenance,
          checkoutRevision: "2222222222222222222222222222222222222222",
        },
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
      expect(parsed.data.provenance.checkoutRevision).toBe(
        "2222222222222222222222222222222222222222",
      );
      expect(parsed.data.providerData.approval).toBe("NOT_APPLICABLE");
      expect(parsed.data.providerData.arbitrary).toEqual({
        nested: ["value", 1, null],
      });
    }
  });

  it("accepts a missing simulatorPinnedBlock on a legal terminal NO_ROUTE", () => {
    const parsed = genericEvidenceSchema.safeParse(
      evidence({
        status: "SUCCESS",
        execution: { status: "NO_ROUTE" },
        provenance: {
          ...evidence().provenance,
          simulatorPinnedBlock: undefined,
        },
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
