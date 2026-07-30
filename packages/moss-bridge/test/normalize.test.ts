import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawKuruEvidence } from "../src/index.js";
import {
  normalizeRecordedKuruEvidence,
  replayKuruEvidence,
} from "../src/index.js";

const raw = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/chain-evidence/kuru/mon-to-usdc/raw.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as RawKuruEvidence;

describe("recorded Kuru evidence", () => {
  it("re-normalizes the real MON to USDC fixture as an unsupported receipt gap", () => {
    const normalized = normalizeRecordedKuruEvidence({
      intent: {
        chainId: "143",
        sender: "0xcccccccccccccccccccccccccccccccccccccccc",
        tokenIn: "MON",
        tokenOut: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
        amountIn: "0.01",
      },
      raw,
      blockNumber: "91383505",
      mossVersion: "recorded baseline",
      mossCommit: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
    });
    expect(normalized.executionStatus).toBe("UNKNOWN");
    expect(normalized.approval.value).toBe("NOT_APPLICABLE");
    expect(normalized.limitations.join(" ")).toContain("FlipOrderUpdated");
  });

  it("marks replay without changing the original source", () => {
    const normalized = normalizeRecordedKuruEvidence({
      intent: {
        chainId: "143",
        sender: "0xcccccccccccccccccccccccccccccccccccccccc",
        tokenIn: "MON",
        tokenOut: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
        amountIn: "0.01",
      },
      raw,
      blockNumber: "91383505",
      mossVersion: "recorded baseline",
    });
    const replay = replayKuruEvidence(normalized);
    expect(replay.replayMode).toBe(true);
    expect(replay.quote).toMatchObject({ source: "quote", isReplay: true });
  });
});
