import { readFileSync } from "node:fs";
import { type RunResult, runResultSchema } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { checkRunEnvelopeSchema } from "./run-envelope.js";

const recordedRun = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/replay-data/mon-to-usdc.json", import.meta.url),
    "utf8",
  ),
) as RunResult;

const completedEnvelope = {
  runId: recordedRun.runId,
  createdAt: "2026-09-29T20:00:00.000Z",
  intent: recordedRun.intent,
  status: "completed",
  result: recordedRun,
};

describe("checkRunEnvelopeSchema", () => {
  it("parses the Backend's started Run envelope", () => {
    const started = {
      runId: "run-started-1",
      createdAt: "2026-09-29T20:00:00.000Z",
      intent: recordedRun.intent,
      status: "started",
    };

    expect(checkRunEnvelopeSchema.parse(started)).toEqual(started);
  });

  it("parses a completed Run envelope and its canonical result", () => {
    const parsed = checkRunEnvelopeSchema.parse(completedEnvelope);

    expect(parsed.status).toBe("completed");
    expect(parsed.runId).toBe(recordedRun.runId);
  });

  it("is not the bare Run contract, because GET /api/runs returns an envelope", () => {
    // `GET /api/runs/:runId` returns the Backend's `CheckRunRecord`, not a bare
    // `RunResult`. The canonical Run schema is strict, so it rejects the
    // envelope: the envelope is API-local transport plumbing, which is exactly
    // why this module exists and why nothing was promoted to @parallax/contracts.
    expect(runResultSchema.safeParse(completedEnvelope).success).toBe(false);
    expect(runResultSchema.safeParse(recordedRun).success).toBe(true);
  });

  it("delegates the failed branch to the canonical FailedRunResult schema", () => {
    const failed = {
      runId: "run-failed-1",
      createdAt: "2026-09-29T20:00:00.000Z",
      intent: recordedRun.intent,
      status: "failed",
      failure: "AGENT_FLOW_ERROR",
      // A completed Run is not a FailedRunResult, so this must fail closed.
      result: recordedRun,
    };

    expect(checkRunEnvelopeSchema.safeParse(failed).success).toBe(false);
  });

  it("fails closed on unknown envelope keys", () => {
    expect(
      checkRunEnvelopeSchema.safeParse({
        ...completedEnvelope,
        rawProviderPayload: { secret: true },
      }).success,
    ).toBe(false);
  });
});
