import { z } from "zod";

/** HTTP presentation only: never an input to Risk, EvidenceState or Action Gate. */
export const evidencePresentationStatusSchema = z.enum([
  "checked",
  "unknown",
  "unavailable",
]);

export const evidencePresentationReasonSchema = z.enum([
  "not_recorded",
  "evidence_unknown",
  "not_applicable",
  "outside_baseline",
  "check_not_run",
  "rpc_unavailable",
  "method_unsupported",
  "invalid_parameters",
  "timeout",
  "cancelled",
  "malformed_response",
  "binding_mismatch",
  "context_unverified",
]);

const sourceCategorySchema = z.enum([
  "native_rpc",
  "trace_rpc",
  "quote",
  "simulation",
  "unknown",
]);

const presentationShape = {
  status: evidencePresentationStatusSchema,
  sourceCategory: sourceCategorySchema,
  observedAt: z.string().datetime().optional(),
  reason: evidencePresentationReasonSchema.optional(),
  mode: z.enum(["LIVE", "RECORDED_REPLAY", "MOCK"]).optional(),
};

/** References existing Evidence items instead of copying their provenance/summary. */
export const evidenceItemPresentationSchema = z
  .object({ evidenceKey: z.string().trim().min(1), ...presentationShape })
  .strict();

const evidenceCapabilityPresentationObjectSchema = z
  .object({
    key: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    stage: z.literal("SIMULATE"),
    ...presentationShape,
    status: z.enum(["checked", "not_checked", "unknown", "unavailable"]),
    blockContext: z
      .object({
        blockNumber: z.string().regex(/^\d+$/),
        blockHash: z
          .string()
          .regex(/^0x[0-9a-f]{64}$/i)
          .optional(),
        status: z.enum(["observed", "requested"]),
      })
      .strict()
      .optional(),
  })
  .strict();

export const evidenceCapabilityPresentationSchema =
  evidenceCapabilityPresentationObjectSchema.superRefine((item, context) => {
    if ((item.status === "checked") !== (item.reason === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message:
          "Checked capabilities have no failure reason; other states require one",
      });
    }
  });

export const evidencePresentationSchema = z
  .object({
    version: z.literal(1),
    items: z.array(evidenceItemPresentationSchema),
    capabilities: z.array(evidenceCapabilityPresentationSchema),
  })
  .strict();

export type EvidencePresentation = z.infer<typeof evidencePresentationSchema>;
export type EvidenceCapabilityPresentation = z.infer<
  typeof evidenceCapabilityPresentationSchema
>;
