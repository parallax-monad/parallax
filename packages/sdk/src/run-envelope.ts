import {
  failedRunResultSchema,
  normalizedSwapIntentSchema,
  runIdSchema,
  runResultSchema,
} from "@parallax/contracts";
import { z } from "zod";

/**
 * Transport envelope returned by `GET /api/runs/:runId`.
 *
 * The envelope shape is owned by the Backend (`CheckRunRecord` in
 * `apps/api/src/store.ts`) and is deliberately not part of `@parallax/contracts`.
 * The SDK re-declares only the envelope keys that are pure transport plumbing,
 * and delegates every semantic field to the canonical Contract schemas:
 * `intent` uses `normalizedSwapIntentSchema`, terminal `result` uses
 * `runResultSchema` / `failedRunResultSchema`, and identifiers use
 * `runIdSchema`.
 *
 * `failure` is the Backend Store-level classification. The SDK keeps it as an
 * opaque non-empty string instead of restating a Backend-local enum, so the
 * Backend stays the source of truth for that vocabulary.
 */
const checkRunEnvelopeIdentity = {
  runId: runIdSchema,
  createdAt: z.string().datetime(),
  intent: normalizedSwapIntentSchema,
  parentRunId: runIdSchema.optional(),
};

export const checkRunEnvelopeSchema = z.discriminatedUnion("status", [
  z
    .object({
      ...checkRunEnvelopeIdentity,
      status: z.literal("started"),
    })
    .strict(),
  z
    .object({
      ...checkRunEnvelopeIdentity,
      status: z.literal("failed"),
      failure: z.string().trim().min(1),
      result: failedRunResultSchema,
    })
    .strict(),
  z
    .object({
      ...checkRunEnvelopeIdentity,
      status: z.literal("completed"),
      result: runResultSchema,
    })
    .strict(),
]);

export type CheckRunEnvelope = z.infer<typeof checkRunEnvelopeSchema>;
