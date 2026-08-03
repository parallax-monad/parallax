import { runResultSchema } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { FileReplayFixtureRepository } from "./replay-fixture-repository.js";

describe("FileReplayFixtureRepository", () => {
  it.each(["mon-to-usdc", "usdc-to-mon"] as const)(
    "loads the API-owned frozen %s RunResult",
    async (id) => {
      const fixture = await new FileReplayFixtureRepository().load(id);
      const parsed = runResultSchema.safeParse(fixture);

      expect(parsed.success).toBe(true);
      if (!parsed.success) throw new Error("invalid fixture");
      expect(parsed.data).toMatchObject({
        runId: expect.stringContaining(id),
        replayMode: true,
      });
    },
  );
});
