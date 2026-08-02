import { z } from "zod";
import { assetReferenceSchema, protocolSchema } from "./common.js";
import { evidenceRefSchema, evidenceSourceSchema } from "./evidence.js";

// Route is execution evidence produced by Moss, not a user-supplied Intent field.
export const routeSchema = z
  .discriminatedUnion("availability", [
    z
      .object({
        availability: z.literal("available"),
        protocol: protocolSchema,
        path: z.array(assetReferenceSchema).min(2),
        source: evidenceSourceSchema,
        blockNumber: z.string().regex(/^\d+$/).optional(),
        evidenceRef: evidenceRefSchema,
        inputEvidenceRefs: z.array(evidenceRefSchema).min(1).optional(),
      })
      .strict(),
    z
      .object({
        availability: z.literal("unavailable"),
        reason: z.string().trim().min(1),
      })
      .strict(),
    z
      .object({
        availability: z.literal("unknown"),
        reason: z.string().trim().min(1),
      })
      .strict(),
  ])
  .superRefine((route, context) => {
    if (
      route.availability === "available" &&
      route.source === "derived" &&
      route.inputEvidenceRefs === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Derived Routes require resolving input Evidence references",
        path: ["inputEvidenceRefs"],
      });
    }
  });

export type Route = z.infer<typeof routeSchema>;
