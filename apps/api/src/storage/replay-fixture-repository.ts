import { readFile } from "node:fs/promises";
import type { ReplayFixtureId } from "@parallax/contracts";
import type { ReplayFixtureRepository } from "@parallax/orchestrator/application";

const fixtureUrls: Record<ReplayFixtureId, URL> = {
  "mon-to-usdc": new URL(
    "../../../../fixtures/replay-data/mon-to-usdc.json",
    import.meta.url,
  ),
  "usdc-to-mon": new URL(
    "../../../../fixtures/replay-data/usdc-to-mon.json",
    import.meta.url,
  ),
};

/** Reads API-owned frozen RunResult snapshots without calling live services. */
export class FileReplayFixtureRepository implements ReplayFixtureRepository {
  public async load(id: ReplayFixtureId): Promise<unknown> {
    return JSON.parse(await readFile(fixtureUrls[id], "utf8"));
  }
}
