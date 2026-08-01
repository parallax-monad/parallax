import { z } from "zod";
import { assetReferenceSchema, protocolSchema } from "./common.js";
import { evidenceSourceSchema } from "./evidence.js";

// Route is execution evidence produced by Moss, not a user-supplied Intent field.
export const routeSchema = z.discriminatedUnion("availability", [
  z
    .object({
      availability: z.literal("available"),
      protocol: protocolSchema,
      path: z.array(assetReferenceSchema).min(2),
      source: evidenceSourceSchema,
      blockNumber: z.string().regex(/^\d+$/).optional(),
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
]);

export type Route = z.infer<typeof routeSchema>;
