import { keccak_256 } from "@noble/hashes/sha3.js";
import type { RunResult } from "@parallax/contracts";
import { runIdSchema, runResultSchema } from "@parallax/contracts";
import { z } from "zod";

const addressPattern = /^0x[a-fA-F0-9]{40}$/u;
const bytes32Pattern = /^0x[a-fA-F0-9]{64}$/u;
const runKeyDomain = new TextEncoder().encode(
  "ParallaxDecisionRegistry.RunKey.v1\u0000",
);
const commitmentDomain = new TextEncoder().encode(
  "ParallaxDecisionRegistry.Commitment.v1\u0000",
);

type CompletedRun = Extract<RunResult, { status: "completed" }>;
export type DecisionRecordJsonValue =
  | null
  | boolean
  | number
  | string
  | DecisionRecordJsonValue[]
  | { [key: string]: DecisionRecordJsonValue };

export type DecisionRegistryContext = {
  chainId: number;
  registryAddress: string;
};

export type DecisionRecordV1 = {
  schema: "parallax.decision-record";
  version: 1;
  registry: { chainId: number; address: string };
  run: {
    runId: string;
    createdAt: string;
    parentRunId?: string;
    replayMode: false;
    intent: DecisionRecordJsonValue;
    tokenMetadata?: DecisionRecordJsonValue;
  };
  decision: {
    status: "completed";
    systemStatus: "OK";
    verdict: "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";
    summary: string;
    simulatorPinnedBlock?: string;
    ruleResults: DecisionRecordJsonValue;
    recommendedActions: DecisionRecordJsonValue;
    irrelevantActions: DecisionRecordJsonValue;
    evidence: DecisionRecordJsonValue;
    scope: DecisionRecordJsonValue;
    route: DecisionRecordJsonValue;
    quote?: DecisionRecordJsonValue;
    p0?: DecisionRecordJsonValue;
    providerEvidence?: DecisionRecordJsonValue;
    diff?: DecisionRecordJsonValue;
  };
};

export type DecisionAnchorBundleV1 = {
  schema: "parallax.decision-anchor-bundle";
  version: 1;
  runId: string;
  chainId: number;
  registryAddress: string;
  runKey: string;
  recordHash: string;
  commitment: string;
  record: DecisionRecordV1;
};

const registryContextSchema = z
  .object({
    chainId: z.number().int().positive().safe(),
    registryAddress: z.string().regex(addressPattern),
  })
  .strict();

const runEnvelopeSchema = z
  .object({
    runId: runIdSchema,
    createdAt: z.string().datetime(),
    parentRunId: runIdSchema.optional(),
    intent: z.unknown(),
    status: z.literal("completed"),
    result: z.unknown(),
  })
  .passthrough();

const bundleEnvelopeSchema = z
  .object({
    schema: z.literal("parallax.decision-anchor-bundle"),
    version: z.literal(1),
    runId: z.string().uuid(),
    chainId: z.number().int().positive().safe(),
    registryAddress: z.string().regex(addressPattern),
    runKey: z.string().regex(bytes32Pattern),
    recordHash: z.string().regex(bytes32Pattern),
    commitment: z.string().regex(bytes32Pattern),
    record: z.unknown(),
  })
  .strict();

const canonicalJsonValueSchema = z.custom<DecisionRecordJsonValue>((value) => {
  try {
    canonicalizeJsonV1(value);
    return true;
  } catch {
    return false;
  }
});

const decisionRecordV1Schema = z
  .object({
    schema: z.literal("parallax.decision-record"),
    version: z.literal(1),
    registry: z
      .object({
        chainId: z.number().int().positive().safe(),
        address: z.string().regex(addressPattern),
      })
      .strict(),
    run: z
      .object({
        runId: z.string().uuid(),
        createdAt: z.string().datetime(),
        parentRunId: z.string().uuid().optional(),
        replayMode: z.literal(false),
        intent: canonicalJsonValueSchema,
        tokenMetadata: canonicalJsonValueSchema.optional(),
      })
      .strict(),
    decision: z
      .object({
        status: z.literal("completed"),
        systemStatus: z.literal("OK"),
        verdict: z.enum(["PROCEED", "ADJUST", "STOP", "UNKNOWN"]),
        summary: z.string(),
        simulatorPinnedBlock: z.string().optional(),
        ruleResults: canonicalJsonValueSchema,
        recommendedActions: canonicalJsonValueSchema,
        irrelevantActions: canonicalJsonValueSchema,
        evidence: canonicalJsonValueSchema,
        scope: canonicalJsonValueSchema,
        route: canonicalJsonValueSchema,
        quote: canonicalJsonValueSchema.optional(),
        p0: canonicalJsonValueSchema.optional(),
        providerEvidence: canonicalJsonValueSchema.optional(),
        diff: canonicalJsonValueSchema.optional(),
      })
      .strict()
      .superRefine((decision, context) => {
        const providerEvidence = decision.providerEvidence;
        if (providerEvidence === undefined) return;
        if (
          typeof providerEvidence !== "object" ||
          providerEvidence === null ||
          Array.isArray(providerEvidence) ||
          !Object.hasOwn(providerEvidence, "providerData")
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Provider Evidence must include an empty providerData field",
            path: ["providerEvidence", "providerData"],
          });
          return;
        }
        const providerData = (providerEvidence as Record<string, unknown>)
          .providerData;
        if (
          typeof providerData !== "object" ||
          providerData === null ||
          Array.isArray(providerData) ||
          Object.keys(providerData).length !== 0
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provider Evidence payloads are excluded from V1 records",
            path: ["providerEvidence", "providerData"],
          });
        }
      }),
  })
  .strict();

/**
 * RFC 8785-style canonical JSON for JSON values. ECMAScript number/string
 * serialization is used, keys are sorted by UTF-16 code units, and values
 * outside the JSON/I-JSON domain are rejected instead of silently omitted.
 */
export function canonicalizeJsonV1(value: unknown): string {
  return canonicalize(value, new Set());
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertWellFormedUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    ) {
      throw new Error("Canonical JSON does not allow imprecise numbers");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error("Value is outside the canonical JSON data model");
  }
  if (ancestors.has(value)) {
    throw new Error("Canonical JSON does not allow circular values");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value, (item) => canonicalize(item, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Canonical JSON accepts plain objects only");
    }
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys
      .map((key) => {
        assertWellFormedUnicode(key);
        return `${JSON.stringify(key)}:${canonicalize(object[key], ancestors)}`;
      })
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error("Canonical JSON requires well-formed Unicode strings");
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error("Canonical JSON requires well-formed Unicode strings");
    }
  }
}

export function keccak256Hex(value: Uint8Array): string {
  return bytesToHex(keccak_256(value));
}

export function buildDecisionRecordV1(
  input: unknown,
  context: DecisionRegistryContext,
): DecisionRecordV1 {
  const normalizedContext = parseRegistryContext(context);
  const envelope = runEnvelopeSchema.parse(input);
  let result: RunResult;
  try {
    result = runResultSchema.parse(envelope.result);
  } catch {
    throw new Error("Run response does not match the public Run contract");
  }

  if (
    result.status !== "completed" ||
    result.replayMode ||
    result.runId !== envelope.runId ||
    (result.createdAt !== undefined &&
      result.createdAt !== envelope.createdAt) ||
    result.parentRunId !== envelope.parentRunId ||
    canonicalizeJsonV1(result.intent) !== canonicalizeJsonV1(envelope.intent)
  ) {
    throw new Error(
      "Only a matching, completed, non-replay persisted Run can be anchored",
    );
  }

  return projectDecisionRecord(result, normalizedContext, envelope.createdAt);
}

export function prepareDecisionAnchor(
  input: unknown,
  context: DecisionRegistryContext,
): DecisionAnchorBundleV1 {
  const record = buildDecisionRecordV1(input, context);
  const normalizedContext = parseRegistryContext(context);
  const recordHash = keccak256Hex(
    new TextEncoder().encode(canonicalizeJsonV1(record)),
  );
  const runKey = deriveRunKey(
    record.run.runId,
    normalizedContext.chainId,
    normalizedContext.registryAddress,
  );
  const commitment = deriveCommitment(
    normalizedContext.chainId,
    normalizedContext.registryAddress,
    runKey,
    recordHash,
  );

  return {
    schema: "parallax.decision-anchor-bundle",
    version: 1,
    runId: record.run.runId,
    chainId: normalizedContext.chainId,
    registryAddress: normalizedContext.registryAddress,
    runKey,
    recordHash,
    commitment,
    record,
  };
}

export function verifyDecisionAnchorBundle(input: unknown): {
  runKey: string;
  recordHash: string;
  commitment: string;
} {
  const bundle = bundleEnvelopeSchema.parse(input);
  const context = parseRegistryContext({
    chainId: bundle.chainId,
    registryAddress: bundle.registryAddress,
  });
  const record = validateDecisionRecord(bundle.record, context);
  if (bundle.runId !== record.run.runId) {
    throw new Error("Decision anchor bundle Run ID does not match its record");
  }

  const recordHash = keccak256Hex(
    new TextEncoder().encode(canonicalizeJsonV1(record)),
  );
  const runKey = deriveRunKey(
    record.run.runId,
    context.chainId,
    context.registryAddress,
  );
  const commitment = deriveCommitment(
    context.chainId,
    context.registryAddress,
    runKey,
    recordHash,
  );

  if (
    bundle.runKey.toLowerCase() !== runKey ||
    bundle.recordHash.toLowerCase() !== recordHash ||
    bundle.commitment.toLowerCase() !== commitment
  ) {
    throw new Error(
      "Decision anchor bundle failed local commitment verification",
    );
  }

  return { runKey, recordHash, commitment };
}

export function assertDecisionAnchorMatchesPersistedRun(
  bundleInput: unknown,
  persistedRun: unknown,
): void {
  const bundle = bundleEnvelopeSchema.parse(bundleInput);
  const original = verifyDecisionAnchorBundle(bundle);
  const current = prepareDecisionAnchor(persistedRun, {
    chainId: bundle.chainId,
    registryAddress: bundle.registryAddress,
  });
  if (
    current.runKey !== original.runKey ||
    current.recordHash !== original.recordHash ||
    current.commitment !== original.commitment
  ) {
    throw new Error(
      "Anchor bundle does not match the persisted Run returned by the API",
    );
  }
}

export function deriveRunKey(
  runId: string,
  chainId: number,
  registryAddress: string,
): string {
  const context = parseRegistryContext({ chainId, registryAddress });
  const normalizedRunId = z.string().uuid().parse(runId);
  return keccak256Hex(
    concatBytes(
      runKeyDomain,
      uint256Word(context.chainId),
      addressWord(context.registryAddress),
      new TextEncoder().encode(normalizedRunId),
    ),
  );
}

export function deriveCommitment(
  chainId: number,
  registryAddress: string,
  runKey: string,
  recordHash: string,
): string {
  const context = parseRegistryContext({ chainId, registryAddress });
  if (!bytes32Pattern.test(runKey) || !bytes32Pattern.test(recordHash)) {
    throw new Error("Run key and record hash must be bytes32 values");
  }
  return keccak256Hex(
    concatBytes(
      commitmentDomain,
      uint256Word(context.chainId),
      addressWord(context.registryAddress),
      hexToBytes(runKey),
      hexToBytes(recordHash),
    ),
  );
}

function projectDecisionRecord(
  result: CompletedRun,
  context: DecisionRegistryContext,
  createdAt = result.createdAt,
): DecisionRecordV1 {
  const run = {
    runId: result.runId,
    createdAt: createdAt ?? "",
    ...(result.parentRunId === undefined
      ? {}
      : { parentRunId: result.parentRunId }),
    replayMode: false as const,
    intent: asCanonicalJsonValue(result.intent),
    ...(result.tokenMetadata === undefined
      ? {}
      : { tokenMetadata: asCanonicalJsonValue(result.tokenMetadata) }),
  };
  const decision = {
    status: result.status,
    systemStatus: result.systemStatus,
    verdict: result.verdict,
    summary: result.summary,
    ...(result.simulatorPinnedBlock === undefined
      ? {}
      : { simulatorPinnedBlock: result.simulatorPinnedBlock }),
    ruleResults: asCanonicalJsonValue(result.ruleResults),
    recommendedActions: asCanonicalJsonValue(result.recommendedActions),
    irrelevantActions: asCanonicalJsonValue(result.irrelevantActions),
    evidence: asCanonicalJsonValue(result.evidence),
    scope: asCanonicalJsonValue(result.scope),
    route: asCanonicalJsonValue(result.route),
    ...(result.quote === undefined
      ? {}
      : { quote: asCanonicalJsonValue(result.quote) }),
    ...(result.p0 === undefined ? {} : { p0: asCanonicalJsonValue(result.p0) }),
    ...(result.providerEvidence === undefined
      ? {}
      : {
          providerEvidence: asCanonicalJsonValue({
            ...result.providerEvidence,
            providerData: {},
          }),
        }),
    ...(result.diff === undefined
      ? {}
      : { diff: asCanonicalJsonValue(result.diff) }),
  };

  return {
    schema: "parallax.decision-record",
    version: 1,
    registry: {
      chainId: context.chainId,
      address: context.registryAddress,
    },
    run,
    decision,
  };
}

function validateDecisionRecord(
  input: unknown,
  context: DecisionRegistryContext,
): DecisionRecordV1 {
  const envelope = decisionRecordV1Schema.parse(input);
  if (
    envelope.registry.chainId !== context.chainId ||
    envelope.registry.address.toLowerCase() !== context.registryAddress
  ) {
    throw new Error("Decision record Registry does not match the bundle");
  }
  return envelope as DecisionRecordV1;
}

function parseRegistryContext(
  context: DecisionRegistryContext,
): DecisionRegistryContext {
  const parsed = registryContextSchema.parse(context);
  return {
    chainId: parsed.chainId,
    registryAddress: parsed.registryAddress.toLowerCase(),
  };
}

function asCanonicalJsonValue(value: unknown): DecisionRecordJsonValue {
  canonicalizeJsonV1(value);
  return value as DecisionRecordJsonValue;
}

function uint256Word(value: number): Uint8Array {
  let remaining = BigInt(value);
  const word = new Uint8Array(32);
  for (let index = word.length - 1; index >= 0; index -= 1) {
    word[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return word;
}

function addressWord(address: string): Uint8Array {
  return concatBytes(new Uint8Array(12), hexToBytes(address));
}

function hexToBytes(value: string): Uint8Array {
  const hex = value.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(value: Uint8Array): string {
  return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const totalLength = values.reduce((total, value) => total + value.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}
