import { z } from "zod";

export const replayFixtureIdSchema = z.enum(["mon-to-usdc", "usdc-to-mon"]);
export type ReplayFixtureId = z.infer<typeof replayFixtureIdSchema>;

export const replayApiErrorCodeSchema = z.enum([
  "REPLAY_NOT_FOUND",
  "INVALID_REPLAY_FIXTURE",
  "REPLAY_STORE_ERROR",
]);

export const replayApiErrorBodySchema = z
  .object({
    error: z
      .object({
        code: replayApiErrorCodeSchema,
        message: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export type ReplayApiErrorBody = z.infer<typeof replayApiErrorBodySchema>;
