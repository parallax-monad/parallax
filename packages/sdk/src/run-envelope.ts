import {
  failedRunResultSchema,
  normalizedSwapIntentSchema,
  runIdSchema,
  runResultSchema,
} from "@parallax/contracts";
import { z } from "zod";

/**
 * The transport envelope returned by GET /api/runs/:runId.
 *
 * The Backend owns this envelope. The SDK describes only its lifecycle fields
 * and delegates the Intent and terminal Run payloads to canonical Contracts.
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
