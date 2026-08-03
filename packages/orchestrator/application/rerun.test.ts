import type { NormalizedSwapIntent, RunResult } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { type RerunRunStore, resolveRerun } from "./rerun.js";

const intent: NormalizedSwapIntent = {
  chainId: 143,
  protocol: "kuru",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: {
    kind: "erc20",
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  amountInAtomic: "1500000000000000000",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

const baseline: RunResult = {
  runId: "run-1",
  replayMode: false,
  intent,
  status: "completed",
  systemStatus: "OK",
  verdict: "UNKNOWN",
  summary: "Baseline",
  ruleResults: [],
  recommendedActions: [],
  irrelevantActions: [],
  evidence: [],
  scope: [],
  route: { availability: "unavailable", reason: "test" },
} as RunResult;

const store: RerunRunStore = {
  get() {
    return { status: "completed", result: baseline };
  },
};

describe("Re-run application use case", () => {
  it("returns a discriminated child context with one normalized change", () => {
    const result = resolveRerun(
      "run-1",
      { ...intent, amountInAtomic: "2000000000000000000" },
      store,
    );

    expect(result).toEqual({
      success: true,
      context: {
        kind: "child",
        parentRunId: "run-1",
        diff: {
          previousRunId: "run-1",
          previousVerdict: "UNKNOWN",
          changedFields: [
            {
              field: "amountInAtomic",
              before: "1500000000000000000",
              after: "2000000000000000000",
            },
          ],
        },
      },
    });
  });

  it("rejects a child Intent with multiple changed conditions", () => {
    const result = resolveRerun(
      "run-1",
      {
        ...intent,
        amountInAtomic: "2000000000000000000",
        protocol: "pancake",
      },
      store,
    );

    expect(result).toEqual({
      success: false,
      message: "A Re-run must change exactly one supported Intent field",
    });
  });

  it("rejects a recipient provenance-only change", () => {
    const result = resolveRerun(
      "run-1",
      { ...intent, recipientSource: "explicit" },
      store,
    );

    expect(result).toEqual({
      success: false,
      message: "A Re-run must change exactly one supported Intent field",
    });
  });

  it("represents a recipient change as one Diff field", () => {
    const result = resolveRerun(
      "run-1",
      {
        ...intent,
        recipient: "0x2222222222222222222222222222222222222222",
        recipientSource: "explicit",
      },
      store,
    );

    expect(result).toMatchObject({
      success: true,
      context: {
        kind: "child",
        diff: {
          changedFields: [
            {
              field: "recipient",
              before: intent.recipient,
              after: "0x2222222222222222222222222222222222222222",
            },
          ],
        },
      },
    });
  });

  it("rejects a tokenOut change when the baseline has an available Boundary", () => {
    const result = resolveRerun(
      "run-1",
      {
        ...intent,
        tokenOut: {
          kind: "erc20",
          address: "0x3333333333333333333333333333333333333333",
        },
        economicBoundary: {
          availability: "available",
          minimumReceivedAtomic: "1000000",
          source: "user_declared",
        },
      },
      {
        get() {
          return {
            status: "completed",
            result: {
              ...baseline,
              intent: {
                ...intent,
                economicBoundary: {
                  availability: "available",
                  minimumReceivedAtomic: "1000000",
                  source: "user_declared",
                },
              },
            },
          };
        },
      },
    );

    expect(result).toEqual({
      success: false,
      message:
        "A Re-run cannot change the Boundary asset while preserving the original Economic Boundary",
    });
  });
});
