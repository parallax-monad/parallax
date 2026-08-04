import { z } from "zod";

/** Stable API-facing reasons for rejecting a Re-run request. */
export const rerunRejectionReasonSchema = z.enum([
  "PARENT_NOT_FOUND",
  "PARENT_NOT_COMPLETED",
  "PARENT_IS_REPLAY",
  "RERUN_CHAINING_UNSUPPORTED",
  "CHAIN_OR_SENDER_CHANGED",
  "BOUNDARY_CHANGED",
  "BOUNDARY_ASSET_CHANGED",
  "NOT_EXACTLY_ONE_CHANGE",
]);

export type RerunRejectionReason = z.infer<typeof rerunRejectionReasonSchema>;
