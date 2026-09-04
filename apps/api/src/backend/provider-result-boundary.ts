/**
 * Internal provisional boundary between Provider responses and the canonical
 * Evidence Contract.
 *
 * This module deliberately models observations and candidate fields only. It
 * does not export a final Evidence schema, a verdict, or a public response
 * DTO. Provider-specific response values may be retained only as explicitly
 * controlled response evidence (a redacted snapshot or a traceable reference).
 *
 * Review workflow:
 * 1. create a provisional result from a Provider observation;
 * 2. compare it with the previous observation and register field changes;
 * 3. keep every change pending until the Contract Owner records a decision;
 * 4. pass only explicitly approved candidates to a later contract-building
 *    layer. `getContractOwnerApprovedCandidates` is not that final layer.
 */

export type ProvisionalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ProvisionalJsonValue[]
  | { readonly [key: string]: ProvisionalJsonValue };

export type ProvisionalProviderResultStatus =
  | "success"
  | "unknown"
  | "unsupported"
  | "failed"
  | "timeout"
  | "stale"
  | "invalid";

export type ProvisionalCandidateFieldStatus =
  | "observed"
  | "missing"
  | "null"
  | "invalid";

export type ProvisionalCandidateConfidence =
  | "unassessed"
  | "low"
  | "medium"
  | "high";

export type ProvisionalFieldReviewStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "needs_evidence";

export type ProviderObservationContext = {
  readonly providerId: string;
  readonly providerVersion?: string;
  readonly model?: string;
  readonly observedAt: string;
};

export type ProviderResponseEvidence =
  | {
      readonly kind: "redacted_snapshot";
      readonly redactionProfile: string;
      readonly snapshot: ProvisionalJsonValue;
      readonly contentHash?: string;
    }
  | {
      readonly kind: "reference";
      readonly reference: string;
      readonly referenceType?: string;
    };

/** Input for a candidate field; review status is assigned by the boundary. */
export type ProvisionalCandidateFieldInput = {
  readonly candidatePath: string;
  readonly sourcePath?: string;
  readonly observedShape: string;
  readonly nullable: boolean;
  readonly observedValues?: readonly string[];
  readonly transformRule?: string;
  readonly semanticNote?: string;
  readonly status: ProvisionalCandidateFieldStatus;
  readonly confidence: ProvisionalCandidateConfidence;
  readonly value?: unknown;
};

export type ProvisionalCandidateField = ProvisionalCandidateFieldInput & {
  readonly reviewStatus: ProvisionalFieldReviewStatus;
};

export type ProvisionalProviderResultInput = {
  readonly provider: ProviderObservationContext;
  readonly status: ProvisionalProviderResultStatus;
  readonly responseEvidence: ProviderResponseEvidence;
  readonly candidateFields: readonly ProvisionalCandidateFieldInput[];
};

export type ProvisionalProviderResult = {
  readonly provider: ProviderObservationContext;
  readonly status: ProvisionalProviderResultStatus;
  readonly responseEvidence: ProviderResponseEvidence;
  readonly candidateFields: readonly ProvisionalCandidateField[];
};

/**
 * A description used in the change registry. It intentionally omits the
 * observed value so change records do not become an uncontrolled raw-response
 * log or an accidental public contract.
 */
export type ProvisionalFieldDescription = {
  readonly candidatePath: string;
  readonly sourcePath?: string;
  readonly observedShape: string;
  readonly nullable: boolean;
  readonly observedValues?: readonly string[];
  readonly transformRule?: string;
  readonly semanticNote?: string;
  readonly status: ProvisionalCandidateFieldStatus;
  readonly confidence: ProvisionalCandidateConfidence;
};

export type ProvisionalFieldChangeType =
  | "added"
  | "removed"
  | "renamed"
  | "type_changed"
  | "nullability_changed"
  | "enum_changed"
  | "semantic_changed"
  | "mapping_changed"
  | "observation_status_changed"
  | "confidence_changed";

export type ProvisionalContractOwnerDecision = {
  readonly status: Exclude<ProvisionalFieldReviewStatus, "pending_review">;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly note?: string;
};

export type ProvisionalFieldChangeRecord = {
  readonly changeId: string;
  readonly changeType: ProvisionalFieldChangeType;
  readonly previous?: ProvisionalFieldDescription;
  readonly next?: ProvisionalFieldDescription;
  readonly provider: ProviderObservationContext;
  readonly evidence: ProviderResponseEvidence;
  readonly impact: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly reviewStatus: ProvisionalFieldReviewStatus;
  readonly contractOwnerDecision?: ProvisionalContractOwnerDecision;
};

export type ProvisionalFieldChangeDetectionInput = {
  readonly previous?: readonly ProvisionalCandidateFieldInput[];
  readonly current: readonly ProvisionalCandidateFieldInput[];
  readonly provider: ProviderObservationContext;
  readonly evidence: ProviderResponseEvidence;
  readonly impact: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly changeIdPrefix: string;
};

export type ProvisionalFieldReviewDecision =
  Readonly<ProvisionalContractOwnerDecision>;

export function createProvisionalProviderResult(
  input: ProvisionalProviderResultInput,
): ProvisionalProviderResult {
  return {
    provider: input.provider,
    status: input.status,
    responseEvidence: input.responseEvidence,
    candidateFields: input.candidateFields.map((candidate) => ({
      ...candidate,
      reviewStatus: "pending_review",
    })),
  };
}

function describeCandidateField(
  field: ProvisionalCandidateFieldInput,
): ProvisionalFieldDescription {
  return {
    candidatePath: field.candidatePath,
    sourcePath: field.sourcePath,
    observedShape: field.observedShape,
    nullable: field.nullable,
    observedValues: field.observedValues,
    transformRule: field.transformRule,
    semanticNote: field.semanticNote,
    status: field.status,
    confidence: field.confidence,
  };
}

function valuesChanged(
  previous: readonly string[] | undefined,
  current: readonly string[] | undefined,
): boolean {
  const previousValues = [...new Set(previous ?? [])].sort();
  const currentValues = [...new Set(current ?? [])].sort();
  return (
    previousValues.length !== currentValues.length ||
    previousValues.some((value, index) => value !== currentValues[index])
  );
}

function createChangeRecord(
  input: ProvisionalFieldChangeDetectionInput,
  sequence: number,
  changeType: ProvisionalFieldChangeType,
  previous: ProvisionalCandidateFieldInput | undefined,
  next: ProvisionalCandidateFieldInput | undefined,
): ProvisionalFieldChangeRecord {
  return {
    changeId: `${input.changeIdPrefix}:${sequence}`,
    changeType,
    previous: previous ? describeCandidateField(previous) : undefined,
    next: next ? describeCandidateField(next) : undefined,
    provider: input.provider,
    evidence: input.evidence,
    impact: input.impact,
    proposedBy: input.proposedBy,
    proposedAt: input.proposedAt,
    reviewStatus: "pending_review",
  };
}

function addPairedChanges(
  input: ProvisionalFieldChangeDetectionInput,
  previous: ProvisionalCandidateFieldInput,
  current: ProvisionalCandidateFieldInput,
  sequence: { value: number },
  changes: ProvisionalFieldChangeRecord[],
): void {
  const add = (changeType: ProvisionalFieldChangeType): void => {
    sequence.value += 1;
    changes.push(
      createChangeRecord(input, sequence.value, changeType, previous, current),
    );
  };

  if (previous.candidatePath !== current.candidatePath) {
    add("renamed");
  }
  if (previous.observedShape !== current.observedShape) {
    add("type_changed");
  }
  if (previous.nullable !== current.nullable) {
    add("nullability_changed");
  }
  if (valuesChanged(previous.observedValues, current.observedValues)) {
    add("enum_changed");
  }
  if (previous.semanticNote !== current.semanticNote) {
    add("semantic_changed");
  }
  if (
    previous.sourcePath !== current.sourcePath ||
    previous.transformRule !== current.transformRule
  ) {
    add("mapping_changed");
  }
  if (previous.status !== current.status) {
    add("observation_status_changed");
  }
  if (previous.confidence !== current.confidence) {
    add("confidence_changed");
  }
}

/**
 * Detects observational drift only. Every returned record starts at
 * `pending_review`, including fields seen for the first time without a
 * previous baseline.
 */
export function detectProvisionalFieldChanges(
  input: ProvisionalFieldChangeDetectionInput,
): readonly ProvisionalFieldChangeRecord[] {
  const previousByPath = new Map(
    (input.previous ?? []).map((field) => [field.candidatePath, field]),
  );
  const matchedPreviousPaths = new Set<string>();
  const matchedCurrentPaths = new Set<string>();
  const changes: ProvisionalFieldChangeRecord[] = [];
  const sequence = { value: 0 };

  for (const current of input.current) {
    const samePathPrevious = previousByPath.get(current.candidatePath);
    if (samePathPrevious) {
      matchedPreviousPaths.add(samePathPrevious.candidatePath);
      matchedCurrentPaths.add(current.candidatePath);
      addPairedChanges(input, samePathPrevious, current, sequence, changes);
      continue;
    }

    const sameSourcePrevious = (input.previous ?? []).filter(
      (previous) =>
        previous.sourcePath !== undefined &&
        previous.sourcePath === current.sourcePath &&
        !matchedPreviousPaths.has(previous.candidatePath),
    );
    const renamedPrevious = sameSourcePrevious[0];
    if (
      current.sourcePath !== undefined &&
      sameSourcePrevious.length === 1 &&
      renamedPrevious !== undefined
    ) {
      matchedPreviousPaths.add(renamedPrevious.candidatePath);
      matchedCurrentPaths.add(current.candidatePath);
      addPairedChanges(input, renamedPrevious, current, sequence, changes);
      continue;
    }

    matchedCurrentPaths.add(current.candidatePath);
    sequence.value += 1;
    changes.push(
      createChangeRecord(input, sequence.value, "added", undefined, current),
    );
  }

  for (const previous of input.previous ?? []) {
    if (matchedPreviousPaths.has(previous.candidatePath)) {
      continue;
    }
    sequence.value += 1;
    changes.push(
      createChangeRecord(input, sequence.value, "removed", previous, undefined),
    );
  }

  // Keep this set as an explicit invariant: every current field is either
  // paired with a baseline or registered as an addition.
  if (matchedCurrentPaths.size !== input.current.length) {
    throw new Error("Every current provisional field must be classified");
  }

  return changes;
}

export function reviewProvisionalFieldChange(
  change: ProvisionalFieldChangeRecord,
  decision: ProvisionalFieldReviewDecision,
): ProvisionalFieldChangeRecord {
  return {
    ...change,
    reviewStatus: decision.status,
    contractOwnerDecision: decision,
  };
}

/**
 * Returns approved candidate observations for a downstream contract-building
 * layer. It never returns a final Evidence Contract and does not mutate the
 * provisional result. A candidate is visible only when all records associated
 * with its path contain an explicit Contract Owner approval decision.
 */
export function getContractOwnerApprovedCandidates(
  result: ProvisionalProviderResult,
  changes: readonly ProvisionalFieldChangeRecord[],
): readonly ProvisionalCandidateField[] {
  return result.candidateFields.flatMap((candidate) => {
    const relatedChanges = changes.filter(
      (change) =>
        change.next?.candidatePath === candidate.candidatePath ||
        change.previous?.candidatePath === candidate.candidatePath,
    );
    const approved =
      relatedChanges.length > 0 &&
      relatedChanges.every(
        (change) =>
          change.reviewStatus === "approved" &&
          change.contractOwnerDecision?.status === "approved" &&
          change.contractOwnerDecision.decidedBy.length > 0 &&
          change.contractOwnerDecision.decidedAt.length > 0,
      );

    return approved
      ? [{ ...candidate, reviewStatus: "approved" as const }]
      : [];
  });
}
