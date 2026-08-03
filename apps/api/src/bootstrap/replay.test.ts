import { describe, expect, it } from "vitest";
import { createRecordedReplayApp } from "./replay.js";

describe("Recorded Replay API composition", () => {
  it("serves a validated real recording through the complete slice", async () => {
    const response = await createRecordedReplayApp().fetch(
      new Request("https://api.example.test/api/replay/mon-to-usdc"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      runId: "recorded-kuru-mon-to-usdc-91383505",
      replayMode: true,
      status: "completed",
      systemStatus: "OK",
      verdict: "UNKNOWN",
    });
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(
      body.evidence.every(
        (item: { fixtureId: string; isReplay: boolean; isMock: boolean }) =>
          item.fixtureId === "mon-to-usdc" &&
          item.isReplay === true &&
          item.isMock === false,
      ),
    ).toBe(true);

    const repeated = await createRecordedReplayApp().fetch(
      new Request("https://api.example.test/api/replay/mon-to-usdc"),
    );
    await expect(repeated.json()).resolves.toEqual(body);
  });
});
