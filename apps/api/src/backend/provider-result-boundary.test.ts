import { describe, expect, it } from "vitest";
import {
  createProvisionalProviderResult,
  detectProvisionalFieldChanges,
  getContractOwnerApprovedCandidates,
  type ProvisionalCandidateFieldInput,
  reviewProvisionalFieldChange,
} from "./provider-result-boundary.js";

const providerContext = {
  providerId: "fixture-provider",
  providerVersion: "fixture-v1",
  model: "fixture-model",
  observedAt: "2026-09-04T13:00:00.000Z",
} as const;

const responseEvidence = {
  kind: "redacted_snapshot" as const,
  redactionProfile: "test-fixture-v1",
  snapshot: {
    execution: { success: true, gas: "redacted" },
  },
};

function field(
  overrides: Partial<ProvisionalCandidateFieldInput> = {},
): ProvisionalCandidateFieldInput {
  return {
    candidatePath: "execution.success",
    sourcePath: "$.execution.success",
    observedShape: "boolean",
    nullable: false,
    transformRule: "identity",
    semanticNote:
      "Observed provider execution flag; meaning is pending review.",
    status: "observed",
    confidence: "unassessed",
    value: true,
    ...overrides,
  };
}

describe("provisional provider result boundary", () => {
  it("keeps provider observations internal and pending until explicitly reviewed", () => {
    const result = createProvisionalProviderResult({
      provider: providerContext,
      status: "success",
      responseEvidence,
      candidateFields: [field()],
    });

    expect(result.candidateFields[0]).toMatchObject({
      candidatePath: "execution.success",
      sourcePath: "$.execution.success",
      reviewStatus: "pending_review",
    });
    expect(result.responseEvidence).toEqual(responseEvidence);
    expect(getContractOwnerApprovedCandidates(result, [])).toEqual([]);
    expect((result as Record<string, unknown>).evidence).toBeUndefined();
    expect((result as Record<string, unknown>).verdict).toBeUndefined();
  });

  it("preserves a controlled redacted snapshot without exposing raw provider output", () => {
    const result = createProvisionalProviderResult({
      provider: providerContext,
      status: "success",
      responseEvidence,
      candidateFields: [
        field({
          candidatePath: "execution.gas",
          sourcePath: "$.execution.gas",
          observedShape: "string",
          value: "redacted",
        }),
      ],
    });

    expect(result.responseEvidence).toEqual({
      kind: "redacted_snapshot",
      redactionProfile: "test-fixture-v1",
      snapshot: { execution: { success: true, gas: "redacted" } },
    });
    expect(result.candidateFields[0]?.value).toBe("redacted");
  });

  it("records added and unknown provider fields without promoting them to the boundary", () => {
    const previous = [field()];
    const current = [
      field(),
      field({
        candidatePath: "execution.newSignal",
        sourcePath: "$.execution.newSignal",
        observedShape: "string",
        nullable: true,
        status: "observed",
        value: "unreviewed",
      }),
    ];

    const changes = detectProvisionalFieldChanges({
      previous,
      current,
      provider: providerContext,
      evidence: responseEvidence,
      proposedBy: "backend-owner",
      proposedAt: "2026-09-04T13:01:00.000Z",
      changeIdPrefix: "fixture-change",
      impact: "Candidate field may require Contract Owner review.",
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      changeId: "fixture-change:1",
      changeType: "added",
      next: { candidatePath: "execution.newSignal" },
      reviewStatus: "pending_review",
    });
    expect(changes[0]?.contractOwnerDecision).toBeUndefined();
  });

  it("creates reviewable records for missing, nullability, type, enum, semantic, and mapping changes", () => {
    const previous = [
      field({
        candidatePath: "execution.outcome",
        sourcePath: "$.execution.result",
        observedShape: "string",
        nullable: false,
        transformRule: "map-result",
        semanticNote: "Original outcome note",
        observedValues: ["success", "failed"],
      }),
      field({
        candidatePath: "execution.removed",
        sourcePath: "$.execution.removed",
        observedShape: "number",
        nullable: false,
      }),
    ];
    const current = [
      field({
        candidatePath: "execution.outcome",
        sourcePath: "$.execution.outcome",
        observedShape: "object",
        nullable: true,
        transformRule: "map-outcome",
        semanticNote: "Updated outcome note",
        observedValues: ["success", "unknown"],
      }),
    ];

    const changes = detectProvisionalFieldChanges({
      previous,
      current,
      provider: providerContext,
      evidence: responseEvidence,
      proposedBy: "backend-owner",
      proposedAt: "2026-09-04T13:02:00.000Z",
      changeIdPrefix: "shape-change",
      impact: "Candidate mapping changed and needs evidence.",
    });

    expect(changes.map((change) => change.changeType)).toEqual([
      "type_changed",
      "nullability_changed",
      "enum_changed",
      "semantic_changed",
      "mapping_changed",
      "removed",
    ]);
    for (const change of changes) {
      expect(change.reviewStatus).toBe("pending_review");
      expect(change.previous ?? change.next).toBeDefined();
      expect(change.provider).toEqual(providerContext);
      expect(change.evidence).toEqual(responseEvidence);
      expect(change.impact).toBe(
        "Candidate mapping changed and needs evidence.",
      );
      expect(change.proposedBy).toBe("backend-owner");
      expect(change.proposedAt).toBe("2026-09-04T13:02:00.000Z");
    }
  });

  it("only exposes candidates after a Contract Owner approval decision", () => {
    const result = createProvisionalProviderResult({
      provider: providerContext,
      status: "success",
      responseEvidence,
      candidateFields: [
        field(),
        field({
          candidatePath: "execution.unknown",
          sourcePath: "$.execution.unknown",
          observedShape: "string",
          value: "pending",
        }),
      ],
    });
    const changes = detectProvisionalFieldChanges({
      previous: undefined,
      current: result.candidateFields,
      provider: providerContext,
      evidence: responseEvidence,
      proposedBy: "backend-owner",
      proposedAt: "2026-09-04T13:03:00.000Z",
      changeIdPrefix: "approval-change",
      impact: "New candidate observed from a provider response.",
    });

    const firstChange = changes[0];
    const secondChange = changes[1];
    expect(firstChange).toBeDefined();
    expect(secondChange).toBeDefined();
    if (firstChange === undefined || secondChange === undefined) {
      throw new Error("Expected two candidate change records");
    }

    const approved = reviewProvisionalFieldChange(firstChange, {
      status: "approved",
      decidedBy: "contract-owner",
      decidedAt: "2026-09-04T13:04:00.000Z",
      note: "Approved for future contract review only.",
    });
    const rejected = reviewProvisionalFieldChange(secondChange, {
      status: "rejected",
      decidedBy: "contract-owner",
      decidedAt: "2026-09-04T13:04:30.000Z",
      note: "Insufficient evidence.",
    });

    expect(
      getContractOwnerApprovedCandidates(result, [approved, rejected]),
    ).toEqual([
      expect.objectContaining({
        candidatePath: "execution.success",
        reviewStatus: "approved",
      }),
    ]);
    expect(getContractOwnerApprovedCandidates(result, [rejected])).toEqual([]);
    expect(approved.contractOwnerDecision).toMatchObject({
      status: "approved",
      decidedBy: "contract-owner",
      decidedAt: "2026-09-04T13:04:00.000Z",
    });
  });
});
