import { describe, expect, it } from "vitest";
import {
  getContractOwnerApprovedCandidates as approvalGate,
  createProvisionalProviderResult,
  detectProvisionalFieldChanges,
  type ProvisionalCandidateFieldInput,
  type ProvisionalFieldChangeRecord,
  type ProvisionalProviderResult,
  reviewProvisionalFieldChange as reviewChange,
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

const contractOwnerId = "contract-owner";

function approvedCandidates(
  result: Parameters<typeof approvalGate>[0],
  changes: Parameters<typeof approvalGate>[1],
) {
  return approvalGate(result, changes, contractOwnerId);
}

function reviewProvisionalFieldChange(
  change: Parameters<typeof reviewChange>[0],
  decision: Parameters<typeof reviewChange>[1],
) {
  return reviewChange(change, decision, contractOwnerId);
}

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
    expect(approvedCandidates(result, [])).toEqual([]);
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

  it("rejects arbitrary non-serializable candidate values at runtime", () => {
    const invalidCandidate = field({
      value: new Date() as unknown as ProvisionalCandidateFieldInput["value"],
    });

    expect(() =>
      createProvisionalProviderResult({
        provider: providerContext,
        status: "success",
        responseEvidence,
        candidateFields: [invalidCandidate],
      }),
    ).toThrow("candidateField.value must be a JSON-compatible value");
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
    const approvedSecond = reviewProvisionalFieldChange(secondChange, {
      status: "approved",
      decidedBy: "contract-owner",
      decidedAt: "2026-09-04T13:04:45.000Z",
      note: "Approved after review.",
    });

    expect(approvedCandidates(result, [approved, rejected])).toEqual([]);
    expect(approvedCandidates(result, [approved, approvedSecond])).toEqual([
      expect.objectContaining({
        candidatePath: "execution.success",
        reviewStatus: "approved",
      }),
      expect.objectContaining({
        candidatePath: "execution.unknown",
        reviewStatus: "approved",
      }),
    ]);
    expect(approvedCandidates(result, [rejected])).toEqual([]);
    expect(approved.contractOwnerDecision).toMatchObject({
      status: "approved",
      decidedBy: "contract-owner",
      decidedAt: "2026-09-04T13:04:00.000Z",
    });
  });

  it("fails closed for partial, stale, foreign, and unrelated approvals", () => {
    const previous = [field()];
    const current = [
      field({
        observedShape: "object",
        transformRule: "changed-mapping",
      }),
    ];
    const result = createProvisionalProviderResult({
      provider: providerContext,
      status: "success",
      responseEvidence,
      candidateFields: current,
    });
    const changes = detectProvisionalFieldChanges({
      previous,
      current: result.candidateFields,
      provider: providerContext,
      evidence: responseEvidence,
      proposedBy: "backend-owner",
      proposedAt: "2026-09-04T13:05:00.000Z",
      changeIdPrefix: "fail-closed-change",
      impact: "Candidate drift requires complete review.",
    });
    expect(changes.map((change) => change.changeType)).toEqual([
      "type_changed",
      "mapping_changed",
    ]);

    const firstChange = changes[0];
    const secondChange = changes[1];
    expect(firstChange).toBeDefined();
    expect(secondChange).toBeDefined();
    if (firstChange === undefined || secondChange === undefined) {
      throw new Error("Expected two candidate change records");
    }
    const approval = {
      status: "approved" as const,
      decidedBy: "contract-owner",
      decidedAt: "2026-09-04T13:06:00.000Z",
    };
    const approvedFirst = reviewProvisionalFieldChange(firstChange, approval);
    const approvedSecond = reviewProvisionalFieldChange(secondChange, approval);

    expect(approvedCandidates(result, [approvedFirst])).toEqual([]);
    expect(
      approvedCandidates(result, [approvedFirst, approvedSecond]),
    ).toHaveLength(1);

    const staleResult = createProvisionalProviderResult({
      provider: providerContext,
      status: "success",
      responseEvidence,
      candidateFields: [field({ observedShape: "number" })],
    });
    expect(
      approvedCandidates(staleResult, [approvedFirst, approvedSecond]),
    ).toEqual([]);

    const foreignResult = createProvisionalProviderResult({
      provider: { ...providerContext, providerId: "other-provider" },
      status: "success",
      responseEvidence,
      candidateFields: current,
    });
    expect(
      approvedCandidates(foreignResult, [approvedFirst, approvedSecond]),
    ).toEqual([]);

    const unrelatedResult = createProvisionalProviderResult({
      provider: providerContext,
      status: "success",
      responseEvidence,
      candidateFields: [field({ candidatePath: "unrelated.path" })],
    });
    expect(
      approvedCandidates(unrelatedResult, [approvedFirst, approvedSecond]),
    ).toEqual([]);
  });

  it("freezes normalized results and rejects forged records or identity mismatches", () => {
    const result = createProvisionalProviderResult({
      provider: providerContext,
      status: "success",
      responseEvidence,
      candidateFields: [field()],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidateFields)).toBe(true);
    expect(Object.isFrozen(result.candidateFields[0])).toBe(true);

    const changes = detectProvisionalFieldChanges({
      previous: undefined,
      current: result.candidateFields,
      provider: providerContext,
      evidence: responseEvidence,
      proposedBy: "backend-owner",
      proposedAt: "2026-09-04T13:07:00.000Z",
      changeIdPrefix: "containment-change",
      impact: "Candidate requires explicit Contract Owner review.",
    });
    const change = changes[0];
    expect(change).toBeDefined();
    if (change === undefined) {
      throw new Error("Expected a candidate change record");
    }
    const approval = {
      status: "approved" as const,
      decidedBy: contractOwnerId,
      decidedAt: "2026-09-04T13:08:00.000Z",
    };
    const approved = reviewProvisionalFieldChange(change, approval);

    expect(
      approvalGate(result, [approved], "different-contract-owner"),
    ).toEqual([]);

    const malformedResult = {
      ...result,
      candidateFields: [
        {
          ...result.candidateFields[0],
          value: new Date(),
        },
      ],
    } as unknown as ProvisionalProviderResult;
    expect(approvalGate(malformedResult, [approved], contractOwnerId)).toEqual(
      [],
    );

    const forgedChange = {
      ...approved,
      provider: {
        ...providerContext,
        providerVersion: { forged: true },
      },
    } as unknown as ProvisionalFieldChangeRecord;
    expect(() => reviewChange(forgedChange, approval, contractOwnerId)).toThrow(
      "provider.providerVersion",
    );
  });

  it("rejects duplicate or non-contiguous change sequences and stale descriptions", () => {
    const result = createProvisionalProviderResult({
      provider: providerContext,
      status: "success",
      responseEvidence,
      candidateFields: [field({ observedValues: [] })],
    });
    const changes = detectProvisionalFieldChanges({
      previous: undefined,
      current: result.candidateFields,
      provider: providerContext,
      evidence: responseEvidence,
      proposedBy: "backend-owner",
      proposedAt: "2026-09-04T13:09:00.000Z",
      changeIdPrefix: "sequence-change",
      impact: "Candidate requires complete review.",
    });
    const change = changes[0];
    expect(change).toBeDefined();
    if (change === undefined) {
      throw new Error("Expected a candidate change record");
    }
    const approved = reviewProvisionalFieldChange(change, {
      status: "approved",
      decidedBy: contractOwnerId,
      decidedAt: "2026-09-04T13:10:00.000Z",
    });

    const duplicateSequence = {
      ...approved,
      changeSequence: 1,
      changeId: `${approved.changeSetId}:1`,
    };
    expect(
      approvalGate(result, [approved, duplicateSequence], contractOwnerId),
    ).toEqual([]);

    const nonContiguousSequence = {
      ...approved,
      changeSequence: 2,
      changeId: `${approved.changeSetId}:2`,
    };
    expect(
      approvalGate(result, [nonContiguousSequence], contractOwnerId),
    ).toEqual([]);

    if (approved.next === undefined) {
      throw new Error("Expected an added candidate description");
    }
    const staleDescription = {
      ...approved,
      next: { ...approved.next, observedValues: undefined },
    };
    expect(approvalGate(result, [staleDescription], contractOwnerId)).toEqual(
      [],
    );
  });
});
