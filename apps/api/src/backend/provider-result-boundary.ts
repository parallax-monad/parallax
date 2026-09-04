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
 * 4. pass only an entire, explicitly approved change set to a later
 *    contract-building layer. `getContractOwnerApprovedCandidates` is not
 *    that final layer.
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

/**
 * Input for a candidate field; review status is assigned by the boundary.
 * Candidate values are constrained to JSON-compatible values so arbitrary
 * Provider SDK instances cannot cross the boundary.
 */
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
  readonly value?: ProvisionalJsonValue;
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
  readonly changeSetId: string;
  readonly changeSequence: number;
  readonly changeSetSize: number;
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

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNonEmptyString(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertOptionalString(
  value: unknown,
  label: string,
): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`${label} must be a string when provided`);
  }
}

function isProvisionalJsonValue(
  value: unknown,
  ancestors = new Set<object>(),
): value is ProvisionalJsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return value.every((item) => isProvisionalJsonValue(item, nextAncestors));
  }
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) =>
    isProvisionalJsonValue(item, nextAncestors),
  );
}

function cloneProvisionalJsonValue(
  value: ProvisionalJsonValue,
): ProvisionalJsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => cloneProvisionalJsonValue(item));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      cloneProvisionalJsonValue(item),
    ]),
  );
}

function normalizeProviderContext(
  provider: ProviderObservationContext,
): ProviderObservationContext {
  if (!isRecord(provider)) {
    throw new TypeError("provider must be a plain object");
  }
  assertNonEmptyString(provider.providerId, "provider.providerId");
  assertOptionalString(provider.providerVersion, "provider.providerVersion");
  assertOptionalString(provider.model, "provider.model");
  assertNonEmptyString(provider.observedAt, "provider.observedAt");
  if (Number.isNaN(Date.parse(provider.observedAt))) {
    throw new TypeError("provider.observedAt must be a valid timestamp");
  }
  return {
    providerId: provider.providerId,
    providerVersion: provider.providerVersion,
    model: provider.model,
    observedAt: provider.observedAt,
  };
}

function normalizeResponseEvidence(
  evidence: ProviderResponseEvidence,
): ProviderResponseEvidence {
  if (!isRecord(evidence)) {
    throw new TypeError("response evidence must be a plain object");
  }
  if (evidence.kind === "redacted_snapshot") {
    assertNonEmptyString(
      evidence.redactionProfile,
      "responseEvidence.redactionProfile",
    );
    if (!isProvisionalJsonValue(evidence.snapshot)) {
      throw new TypeError(
        "responseEvidence.snapshot must be a JSON-compatible redacted value",
      );
    }
    assertOptionalString(evidence.contentHash, "responseEvidence.contentHash");
    return {
      kind: "redacted_snapshot",
      redactionProfile: evidence.redactionProfile,
      snapshot: cloneProvisionalJsonValue(evidence.snapshot),
      contentHash: evidence.contentHash,
    };
  }
  if (evidence.kind === "reference") {
    assertNonEmptyString(evidence.reference, "responseEvidence.reference");
    assertOptionalString(
      evidence.referenceType,
      "responseEvidence.referenceType",
    );
    return {
      kind: "reference",
      reference: evidence.reference,
      referenceType: evidence.referenceType,
    };
  }
  throw new TypeError(
    "responseEvidence.kind must be reference or redacted_snapshot",
  );
}

function isCandidateStatus(
  value: unknown,
): value is ProvisionalCandidateFieldStatus {
  return (
    value === "observed" ||
    value === "missing" ||
    value === "null" ||
    value === "invalid"
  );
}

function isCandidateConfidence(
  value: unknown,
): value is ProvisionalCandidateConfidence {
  return (
    value === "unassessed" ||
    value === "low" ||
    value === "medium" ||
    value === "high"
  );
}

function normalizeCandidateField(
  field: ProvisionalCandidateFieldInput,
): ProvisionalCandidateFieldInput {
  if (!isRecord(field)) {
    throw new TypeError("candidate field must be a plain object");
  }
  assertNonEmptyString(field.candidatePath, "candidateField.candidatePath");
  assertOptionalString(field.sourcePath, "candidateField.sourcePath");
  assertNonEmptyString(field.observedShape, "candidateField.observedShape");
  if (typeof field.nullable !== "boolean") {
    throw new TypeError("candidateField.nullable must be a boolean");
  }
  if (
    field.observedValues !== undefined &&
    (!Array.isArray(field.observedValues) ||
      !field.observedValues.every((value) => typeof value === "string"))
  ) {
    throw new TypeError(
      "candidateField.observedValues must be an array of strings",
    );
  }
  assertOptionalString(field.transformRule, "candidateField.transformRule");
  assertOptionalString(field.semanticNote, "candidateField.semanticNote");
  if (!isCandidateStatus(field.status)) {
    throw new TypeError("candidateField.status is invalid");
  }
  if (!isCandidateConfidence(field.confidence)) {
    throw new TypeError("candidateField.confidence is invalid");
  }
  if (field.value !== undefined && !isProvisionalJsonValue(field.value)) {
    throw new TypeError("candidateField.value must be a JSON-compatible value");
  }
  return {
    candidatePath: field.candidatePath,
    sourcePath: field.sourcePath,
    observedShape: field.observedShape,
    nullable: field.nullable,
    observedValues:
      field.observedValues === undefined
        ? undefined
        : [...field.observedValues],
    transformRule: field.transformRule,
    semanticNote: field.semanticNote,
    status: field.status,
    confidence: field.confidence,
    value:
      field.value === undefined
        ? undefined
        : cloneProvisionalJsonValue(field.value),
  };
}

function normalizeCandidateFields(
  fields: readonly ProvisionalCandidateFieldInput[],
): readonly ProvisionalCandidateFieldInput[] {
  if (!Array.isArray(fields)) {
    throw new TypeError("candidateFields must be an array");
  }
  const normalized = fields.map((field) => normalizeCandidateField(field));
  const paths = new Set<string>();
  for (const field of normalized) {
    if (paths.has(field.candidatePath)) {
      throw new TypeError(
        `candidateFields contains duplicate path: ${field.candidatePath}`,
      );
    }
    paths.add(field.candidatePath);
  }
  return normalized;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as UnknownRecord)) {
    if (typeof child === "object" && child !== null) {
      deepFreeze(child);
    }
  }
  return Object.freeze(value);
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isReviewStatus(value: unknown): value is ProvisionalFieldReviewStatus {
  return (
    value === "pending_review" ||
    value === "approved" ||
    value === "rejected" ||
    value === "needs_evidence"
  );
}

function describeCandidateField(
  field: ProvisionalCandidateFieldInput,
): ProvisionalFieldDescription {
  return {
    candidatePath: field.candidatePath,
    sourcePath: field.sourcePath,
    observedShape: field.observedShape,
    nullable: field.nullable,
    observedValues:
      field.observedValues === undefined
        ? undefined
        : [...field.observedValues],
    transformRule: field.transformRule,
    semanticNote: field.semanticNote,
    status: field.status,
    confidence: field.confidence,
  };
}

function normalizeFieldDescription(
  description: ProvisionalFieldDescription,
): ProvisionalFieldDescription {
  if (!isRecord(description)) {
    throw new TypeError("field description must be a plain object");
  }
  assertNonEmptyString(description.candidatePath, "field.candidatePath");
  assertOptionalString(description.sourcePath, "field.sourcePath");
  assertNonEmptyString(description.observedShape, "field.observedShape");
  if (typeof description.nullable !== "boolean") {
    throw new TypeError("field.nullable must be a boolean");
  }
  if (
    description.observedValues !== undefined &&
    (!Array.isArray(description.observedValues) ||
      !description.observedValues.every((value) => typeof value === "string"))
  ) {
    throw new TypeError("field.observedValues must be an array of strings");
  }
  assertOptionalString(description.transformRule, "field.transformRule");
  assertOptionalString(description.semanticNote, "field.semanticNote");
  if (!isCandidateStatus(description.status)) {
    throw new TypeError("field.status is invalid");
  }
  if (!isCandidateConfidence(description.confidence)) {
    throw new TypeError("field.confidence is invalid");
  }
  return {
    candidatePath: description.candidatePath,
    sourcePath: description.sourcePath,
    observedShape: description.observedShape,
    nullable: description.nullable,
    observedValues:
      description.observedValues === undefined
        ? undefined
        : [...description.observedValues],
    transformRule: description.transformRule,
    semanticNote: description.semanticNote,
    status: description.status,
    confidence: description.confidence,
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

function sameOptionalStringArray(
  previous: readonly string[] | undefined,
  current: readonly string[] | undefined,
): boolean {
  if (previous === undefined || current === undefined) {
    return previous === current;
  }
  const previousValues = [...previous].sort();
  const currentValues = [...current].sort();
  return (
    previousValues.length === currentValues.length &&
    previousValues.every((value, index) => value === currentValues[index])
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
    changeSetId: input.changeIdPrefix,
    changeSequence: sequence,
    changeSetSize: 0,
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

function isChangeType(value: unknown): value is ProvisionalFieldChangeType {
  return (
    value === "added" ||
    value === "removed" ||
    value === "renamed" ||
    value === "type_changed" ||
    value === "nullability_changed" ||
    value === "enum_changed" ||
    value === "semantic_changed" ||
    value === "mapping_changed" ||
    value === "observation_status_changed" ||
    value === "confidence_changed"
  );
}

function normalizeDecision(
  decision: ProvisionalFieldReviewDecision,
  expectedContractOwnerId?: string,
): ProvisionalContractOwnerDecision {
  if (!isRecord(decision)) {
    throw new TypeError("Contract Owner decision must be a plain object");
  }
  if (
    decision.status !== "approved" &&
    decision.status !== "rejected" &&
    decision.status !== "needs_evidence"
  ) {
    throw new TypeError("Contract Owner decision status is invalid");
  }
  assertNonEmptyString(decision.decidedBy, "decision.decidedBy");
  if (
    expectedContractOwnerId !== undefined &&
    decision.decidedBy !== expectedContractOwnerId
  ) {
    throw new TypeError("decision.decidedBy does not match Contract Owner");
  }
  if (!isValidTimestamp(decision.decidedAt)) {
    throw new TypeError("decision.decidedAt must be a valid timestamp");
  }
  assertOptionalString(decision.note, "decision.note");
  return {
    status: decision.status,
    decidedBy: decision.decidedBy,
    decidedAt: decision.decidedAt,
    note: decision.note,
  };
}

function hasValidChangeSemantics(
  changeType: ProvisionalFieldChangeType,
  previous: ProvisionalFieldDescription | undefined,
  next: ProvisionalFieldDescription | undefined,
): boolean {
  if (changeType === "added") {
    return previous === undefined && next !== undefined;
  }
  if (changeType === "removed") {
    return previous !== undefined && next === undefined;
  }
  if (previous === undefined || next === undefined) return false;
  switch (changeType) {
    case "renamed":
      return previous.candidatePath !== next.candidatePath;
    case "type_changed":
      return previous.observedShape !== next.observedShape;
    case "nullability_changed":
      return previous.nullable !== next.nullable;
    case "enum_changed":
      return !sameOptionalStringArray(
        previous.observedValues,
        next.observedValues,
      );
    case "semantic_changed":
      return previous.semanticNote !== next.semanticNote;
    case "mapping_changed":
      return (
        previous.sourcePath !== next.sourcePath ||
        previous.transformRule !== next.transformRule
      );
    case "observation_status_changed":
      return previous.status !== next.status;
    case "confidence_changed":
      return previous.confidence !== next.confidence;
    default:
      return false;
  }
}

function normalizeChangeRecord(
  change: ProvisionalFieldChangeRecord,
): ProvisionalFieldChangeRecord {
  if (!isRecord(change)) {
    throw new TypeError("change record must be a plain object");
  }
  assertNonEmptyString(change.changeId, "change.changeId");
  assertNonEmptyString(change.changeSetId, "change.changeSetId");
  if (
    !Number.isInteger(change.changeSequence) ||
    change.changeSequence < 1 ||
    !Number.isInteger(change.changeSetSize) ||
    change.changeSetSize < 1
  ) {
    throw new TypeError(
      "change sequence and set size must be positive integers",
    );
  }
  if (change.changeId !== `${change.changeSetId}:${change.changeSequence}`) {
    throw new TypeError("change.changeId is not bound to its sequence");
  }
  if (!isChangeType(change.changeType)) {
    throw new TypeError("change.changeType is invalid");
  }
  const previous =
    change.previous === undefined
      ? undefined
      : normalizeFieldDescription(change.previous);
  const next =
    change.next === undefined
      ? undefined
      : normalizeFieldDescription(change.next);
  if (!hasValidChangeSemantics(change.changeType, previous, next)) {
    throw new TypeError("change record semantics do not match change type");
  }
  const provider = normalizeProviderContext(change.provider);
  const evidence = normalizeResponseEvidence(change.evidence);
  assertNonEmptyString(change.impact, "change.impact");
  assertNonEmptyString(change.proposedBy, "change.proposedBy");
  if (!isValidTimestamp(change.proposedAt)) {
    throw new TypeError("change.proposedAt must be a valid timestamp");
  }
  if (!isReviewStatus(change.reviewStatus)) {
    throw new TypeError("change.reviewStatus is invalid");
  }
  const contractOwnerDecision =
    change.contractOwnerDecision === undefined
      ? undefined
      : normalizeDecision(change.contractOwnerDecision);
  if (
    (change.reviewStatus === "pending_review" &&
      contractOwnerDecision !== undefined) ||
    (change.reviewStatus !== "pending_review" &&
      (contractOwnerDecision === undefined ||
        contractOwnerDecision.status !== change.reviewStatus))
  ) {
    throw new TypeError("change review status and decision do not match");
  }
  return {
    changeId: change.changeId,
    changeSetId: change.changeSetId,
    changeSequence: change.changeSequence,
    changeSetSize: change.changeSetSize,
    changeType: change.changeType,
    previous,
    next,
    provider,
    evidence,
    impact: change.impact,
    proposedBy: change.proposedBy,
    proposedAt: change.proposedAt,
    reviewStatus: change.reviewStatus,
    contractOwnerDecision,
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

export function createProvisionalProviderResult(
  input: ProvisionalProviderResultInput,
): ProvisionalProviderResult {
  if (!isRecord(input)) {
    throw new TypeError("provisional result input must be a plain object");
  }
  const provider = normalizeProviderContext(input.provider);
  const responseEvidence = normalizeResponseEvidence(input.responseEvidence);
  if (
    input.status !== "success" &&
    input.status !== "unknown" &&
    input.status !== "unsupported" &&
    input.status !== "failed" &&
    input.status !== "timeout" &&
    input.status !== "stale" &&
    input.status !== "invalid"
  ) {
    throw new TypeError("provisional result status is invalid");
  }
  const candidateFields = normalizeCandidateFields(input.candidateFields);
  return deepFreeze({
    provider,
    status: input.status,
    responseEvidence,
    candidateFields: candidateFields.map((candidate) => ({
      ...candidate,
      reviewStatus: "pending_review" as const,
    })),
  });
}

/**
 * Detects observational drift only. Every returned record starts at
 * `pending_review`, including fields seen for the first time without a
 * previous baseline.
 */
export function detectProvisionalFieldChanges(
  input: ProvisionalFieldChangeDetectionInput,
): readonly ProvisionalFieldChangeRecord[] {
  if (!isRecord(input)) {
    throw new TypeError("change detection input must be a plain object");
  }
  const provider = normalizeProviderContext(input.provider);
  const evidence = normalizeResponseEvidence(input.evidence);
  const previous =
    input.previous === undefined
      ? undefined
      : normalizeCandidateFields(input.previous);
  const current = normalizeCandidateFields(input.current);
  assertNonEmptyString(input.impact, "change.impact");
  assertNonEmptyString(input.proposedBy, "change.proposedBy");
  if (!isValidTimestamp(input.proposedAt)) {
    throw new TypeError("change.proposedAt must be a valid timestamp");
  }
  assertNonEmptyString(input.changeIdPrefix, "change.changeIdPrefix");

  const normalizedInput: ProvisionalFieldChangeDetectionInput = {
    previous,
    current,
    provider,
    evidence,
    impact: input.impact,
    proposedBy: input.proposedBy,
    proposedAt: input.proposedAt,
    changeIdPrefix: input.changeIdPrefix,
  };
  const previousByPath = new Map(
    (previous ?? []).map((field) => [field.candidatePath, field]),
  );
  const matchedPreviousPaths = new Set<string>();
  const matchedCurrentPaths = new Set<string>();
  const changes: ProvisionalFieldChangeRecord[] = [];
  const sequence = { value: 0 };

  for (const currentField of current) {
    const samePathPrevious = previousByPath.get(currentField.candidatePath);
    if (samePathPrevious) {
      matchedPreviousPaths.add(samePathPrevious.candidatePath);
      matchedCurrentPaths.add(currentField.candidatePath);
      addPairedChanges(
        normalizedInput,
        samePathPrevious,
        currentField,
        sequence,
        changes,
      );
      continue;
    }

    const sameSourcePrevious = (previous ?? []).filter(
      (previousField) =>
        previousField.sourcePath !== undefined &&
        previousField.sourcePath === currentField.sourcePath &&
        !matchedPreviousPaths.has(previousField.candidatePath),
    );
    const renamedPrevious = sameSourcePrevious[0];
    if (
      currentField.sourcePath !== undefined &&
      sameSourcePrevious.length === 1 &&
      renamedPrevious !== undefined
    ) {
      matchedPreviousPaths.add(renamedPrevious.candidatePath);
      matchedCurrentPaths.add(currentField.candidatePath);
      addPairedChanges(
        normalizedInput,
        renamedPrevious,
        currentField,
        sequence,
        changes,
      );
      continue;
    }

    matchedCurrentPaths.add(currentField.candidatePath);
    sequence.value += 1;
    changes.push(
      createChangeRecord(
        normalizedInput,
        sequence.value,
        "added",
        undefined,
        currentField,
      ),
    );
  }

  for (const previousField of previous ?? []) {
    if (matchedPreviousPaths.has(previousField.candidatePath)) {
      continue;
    }
    sequence.value += 1;
    changes.push(
      createChangeRecord(
        normalizedInput,
        sequence.value,
        "removed",
        previousField,
        undefined,
      ),
    );
  }

  if (matchedCurrentPaths.size !== current.length) {
    throw new Error("Every current provisional field must be classified");
  }

  return deepFreeze(
    changes.map((change) => ({
      ...change,
      changeSetSize: changes.length,
    })),
  );
}

export function reviewProvisionalFieldChange(
  change: ProvisionalFieldChangeRecord,
  decision: ProvisionalFieldReviewDecision,
  contractOwnerId: string,
): ProvisionalFieldChangeRecord {
  assertNonEmptyString(contractOwnerId, "contractOwnerId");
  const normalizedChange = normalizeChangeRecord(change);
  const normalizedDecision = normalizeDecision(decision, contractOwnerId);
  return deepFreeze({
    ...normalizedChange,
    reviewStatus: normalizedDecision.status,
    contractOwnerDecision: normalizedDecision,
  });
}

function sameProviderContext(
  left: ProviderObservationContext,
  right: ProviderObservationContext,
): boolean {
  return (
    left.providerId === right.providerId &&
    left.providerVersion === right.providerVersion &&
    left.model === right.model &&
    left.observedAt === right.observedAt
  );
}

function sameJsonValue(
  left: ProvisionalJsonValue,
  right: ProvisionalJsonValue,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    ) {
      return false;
    }
    return left.every((value, index) => {
      const rightValue = right[index];
      return rightValue !== undefined && sameJsonValue(value, rightValue);
    });
  }
  const leftObject = left as { readonly [key: string]: ProvisionalJsonValue };
  const rightObject = right as { readonly [key: string]: ProvisionalJsonValue };
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => {
      const rightKey = rightKeys[index];
      const leftValue = leftObject[key];
      const rightValue =
        rightKey === undefined ? undefined : rightObject[rightKey];
      return (
        key === rightKey &&
        leftValue !== undefined &&
        rightValue !== undefined &&
        sameJsonValue(leftValue, rightValue)
      );
    })
  );
}

function sameResponseEvidence(
  left: ProviderResponseEvidence,
  right: ProviderResponseEvidence,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "reference" && right.kind === "reference") {
    return (
      left.reference === right.reference &&
      left.referenceType === right.referenceType
    );
  }
  if (left.kind !== "redacted_snapshot" || right.kind !== "redacted_snapshot") {
    return false;
  }
  return (
    left.redactionProfile === right.redactionProfile &&
    left.contentHash === right.contentHash &&
    sameJsonValue(left.snapshot, right.snapshot)
  );
}

function sameFieldDescription(
  left: ProvisionalFieldDescription,
  right: ProvisionalFieldDescription,
): boolean {
  return (
    left.candidatePath === right.candidatePath &&
    left.sourcePath === right.sourcePath &&
    left.observedShape === right.observedShape &&
    left.nullable === right.nullable &&
    sameOptionalStringArray(left.observedValues, right.observedValues) &&
    left.transformRule === right.transformRule &&
    left.semanticNote === right.semanticNote &&
    left.status === right.status &&
    left.confidence === right.confidence
  );
}

function isApprovedChange(
  change: ProvisionalFieldChangeRecord,
  contractOwnerId: string,
): boolean {
  const decision = change.contractOwnerDecision;
  return (
    change.reviewStatus === "approved" &&
    decision !== undefined &&
    decision.status === "approved" &&
    decision.decidedBy === contractOwnerId &&
    isValidTimestamp(decision.decidedAt)
  );
}

function isCompleteApprovedChangeSet(
  result: ProvisionalProviderResult,
  changes: readonly ProvisionalFieldChangeRecord[],
  contractOwnerId: string,
): boolean {
  if (changes.length === 0) return false;
  const first = changes[0];
  if (first === undefined || first.changeSetSize !== changes.length) {
    return false;
  }
  const sequences = new Set<number>();
  for (const change of changes) {
    if (
      change.changeSetId !== first.changeSetId ||
      change.changeSetSize !== first.changeSetSize ||
      change.changeSequence < 1 ||
      change.changeSequence > first.changeSetSize ||
      sequences.has(change.changeSequence) ||
      !sameProviderContext(change.provider, result.provider) ||
      !sameResponseEvidence(change.evidence, result.responseEvidence) ||
      !isApprovedChange(change, contractOwnerId)
    ) {
      return false;
    }
    sequences.add(change.changeSequence);
  }
  if (
    sequences.size !== changes.length ||
    Array.from({ length: changes.length }, (_, index) => index + 1).some(
      (sequence) => !sequences.has(sequence),
    )
  ) {
    return false;
  }

  const currentDescriptions = new Map(
    result.candidateFields.map((candidate) => [
      candidate.candidatePath,
      describeCandidateField(candidate),
    ]),
  );
  const nextChanges = changes.filter((change) => change.next !== undefined);
  const nextPaths = new Set(
    nextChanges.flatMap((change) =>
      change.next === undefined ? [] : [change.next.candidatePath],
    ),
  );
  if (
    nextPaths.size !== currentDescriptions.size ||
    [...currentDescriptions.keys()].some((path) => !nextPaths.has(path))
  ) {
    return false;
  }
  return [...currentDescriptions.entries()].every(([path, description]) => {
    const relatedChanges = nextChanges.filter(
      (change) => change.next?.candidatePath === path,
    );
    return (
      relatedChanges.length > 0 &&
      relatedChanges.every(
        (change) =>
          change.next !== undefined &&
          sameFieldDescription(change.next, description),
      )
    );
  });
}

export function normalizeProvisionalProviderResult(
  input: unknown,
): ProvisionalProviderResult {
  if (!isRecord(input)) {
    throw new TypeError("provisional result must be a plain object");
  }
  return createProvisionalProviderResult({
    provider: input.provider as ProviderObservationContext,
    status: input.status as ProvisionalProviderResultInput["status"],
    responseEvidence: input.responseEvidence as ProviderResponseEvidence,
    candidateFields:
      input.candidateFields as readonly ProvisionalCandidateFieldInput[],
  });
}

function normalizeResultForApproval(
  result: ProvisionalProviderResult,
): ProvisionalProviderResult {
  return normalizeProvisionalProviderResult(result);
}

/**
 * Returns approved candidate observations for a downstream contract-building
 * layer. It never returns a final Evidence Contract and does not mutate the
 * provisional result. A candidate is visible only when the complete change
 * set for the current observation is present, bound to the same provider and
 * evidence, and explicitly approved by the Contract Owner.
 */
export function getContractOwnerApprovedCandidates(
  result: ProvisionalProviderResult,
  changes: readonly ProvisionalFieldChangeRecord[],
  contractOwnerId: string,
): readonly ProvisionalCandidateField[] {
  if (
    typeof contractOwnerId !== "string" ||
    contractOwnerId.trim().length === 0
  ) {
    return [];
  }
  try {
    const normalizedResult = normalizeResultForApproval(result);
    if (!Array.isArray(changes)) return [];
    const normalizedChanges = changes.map((change) =>
      normalizeChangeRecord(change),
    );
    if (
      !isCompleteApprovedChangeSet(
        normalizedResult,
        normalizedChanges,
        contractOwnerId,
      )
    ) {
      return [];
    }
    return deepFreeze(
      normalizedResult.candidateFields.map((candidate) => ({
        ...candidate,
        reviewStatus: "approved" as const,
      })),
    );
  } catch {
    return [];
  }
}
