import { readFileSync } from "node:fs";
import { runResultSchema } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import {
  ReplayApplicationService,
  type ReplayFixtureRepository,
} from "./replay.js";

function fixture(id: "mon-to-usdc" | "usdc-to-mon"): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/replay-data/${id}.json`, import.meta.url),
      "utf8",
    ),
  );
}

class StubRepository implements ReplayFixtureRepository {
  public constructor(private readonly candidate: unknown) {}

  public async load(): Promise<unknown> {
    return structuredClone(this.candidate);
  }
}

describe("ReplayApplicationService", () => {
  it.each(["mon-to-usdc", "usdc-to-mon"] as const)(
    "returns the frozen %s RunResult without changing its identity",
    async (fixtureId) => {
      const recorded = fixture(fixtureId);
      const service = new ReplayApplicationService({
        repository: new StubRepository(recorded),
      });

      const first = await service.replay(fixtureId);
      const second = await service.replay(fixtureId);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      if (first.status !== 200 || second.status !== 200) {
        throw new Error("unexpected response");
      }
      expect(runResultSchema.safeParse(first.body).success).toBe(true);
      expect(first.body).toEqual(recorded);
      expect(second.body).toEqual(first.body);
      expect(first.body.runId).toBe(
        fixtureId === "mon-to-usdc"
          ? "recorded-kuru-mon-to-usdc-91383505"
          : "recorded-kuru-usdc-to-mon-91383528",
      );
    },
  );

  it("rejects unknown IDs before loading storage", async () => {
    let loaded = false;
    const repository: ReplayFixtureRepository = {
      async load() {
        loaded = true;
        throw new Error("must not load");
      },
    };

    const response = await new ReplayApplicationService({ repository }).replay(
      "no-route",
    );

    expect(response).toMatchObject({
      status: 404,
      body: { error: { code: "REPLAY_NOT_FOUND" } },
    });
    expect(loaded).toBe(false);
  });

  it("fails closed for invalid Runs or mismatched Fixture identity", async () => {
    const invalidRun = new ReplayApplicationService({
      repository: new StubRepository({ replayMode: true }),
    });
    const wrongIdentity = structuredClone(fixture("mon-to-usdc")) as {
      evidence: Array<{ fixtureId: string }>;
    };
    wrongIdentity.evidence[0].fixtureId = "usdc-to-mon";

    await expect(invalidRun.replay("mon-to-usdc")).resolves.toMatchObject({
      status: 500,
      body: { error: { code: "INVALID_REPLAY_FIXTURE" } },
    });
    await expect(
      new ReplayApplicationService({
        repository: new StubRepository(wrongIdentity),
      }).replay("mon-to-usdc"),
    ).resolves.toMatchObject({
      status: 500,
      body: { error: { code: "INVALID_REPLAY_FIXTURE" } },
    });
  });

  it("rejects a Fixture that validation would normalize", async () => {
    const normalized = structuredClone(fixture("mon-to-usdc")) as {
      summary: string;
    };
    normalized.summary = ` ${normalized.summary} `;

    await expect(
      new ReplayApplicationService({
        repository: new StubRepository(normalized),
      }).replay("mon-to-usdc"),
    ).resolves.toMatchObject({
      status: 500,
      body: { error: { code: "INVALID_REPLAY_FIXTURE" } },
    });
  });

  it("rejects a valid Live Run as a Replay Fixture", async () => {
    const live = structuredClone(fixture("mon-to-usdc")) as {
      replayMode: boolean;
      evidence: Array<{ isReplay: boolean }>;
    };
    live.replayMode = false;
    for (const item of live.evidence) item.isReplay = false;

    await expect(
      new ReplayApplicationService({
        repository: new StubRepository(live),
      }).replay("mon-to-usdc"),
    ).resolves.toMatchObject({
      status: 500,
      body: { error: { code: "INVALID_REPLAY_FIXTURE" } },
    });
  });

  it("isolates storage failures", async () => {
    const repository: ReplayFixtureRepository = {
      async load() {
        throw new Error("storage details");
      },
    };

    await expect(
      new ReplayApplicationService({ repository }).replay("mon-to-usdc"),
    ).resolves.toEqual({
      status: 500,
      body: {
        error: {
          code: "REPLAY_STORE_ERROR",
          message: "The recorded replay could not be loaded",
        },
      },
    });
  });
});
