import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runResultSchema } from "./run.js";

function json(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

describe("Replay fixtures", () => {
  it.each(["mon-to-usdc", "usdc-to-mon"] as const)(
    "stores %s as a complete canonical RunResult",
    (id) => {
      const fixture = json(`../../../fixtures/replay-data/${id}.json`);
      const parsed = runResultSchema.safeParse(fixture);

      expect(parsed.success).toBe(true);
      if (!parsed.success) throw new Error("invalid fixture");
      expect(parsed.data.replayMode).toBe(true);
      expect(parsed.data.evidence.every((item) => item.fixtureId === id)).toBe(
        true,
      );
    },
  );
});
