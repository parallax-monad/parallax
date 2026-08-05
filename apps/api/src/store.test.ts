import type {
  FailedRunResult,
  NormalizedSwapIntent,
  RunResult,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryRunStore } from "./store.js";

describe("InMemoryRunStore", () => {
  const intent = {
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
    amountInAtomic: "1",
    economicBoundary: {
      availability: "unavailable",
      source: "unavailable",
    },
  } as NormalizedSwapIntent;

  it("moves a run from started to completed", async () => {
    const store = new InMemoryRunStore();
    const result = { runId: "run-1", intent } as RunResult;

    await store.start("run-1", intent);
    expect(store.get("run-1")).toMatchObject({ status: "started", intent });
    await store.complete(result);

    expect(store.get("run-1")).toMatchObject({
      status: "completed",
      result,
    });
    expect(store.get("missing")).toBeUndefined();
  });

  it("preserves a parent Run link across a child lifecycle", async () => {
    const store = new InMemoryRunStore();
    const result = {
      runId: "run-2",
      parentRunId: "run-1",
      intent,
    } as RunResult;

    await store.start("run-2", intent, "run-1");
    await store.complete(result);

    expect(store.get("run-2")).toMatchObject({
      runId: "run-2",
      parentRunId: "run-1",
      status: "completed",
      result,
    });
  });

  it("rejects a completed result whose parent differs from the started Run", async () => {
    const store = new InMemoryRunStore();
    await store.start("run-2", intent, "run-1");

    await expect(
      store.complete({
        runId: "run-2",
        parentRunId: "other-parent",
        intent,
      } as RunResult),
    ).rejects.toThrow("parent does not match");
  });

  it("records failures and rejects duplicate or terminal transitions", async () => {
    const store = new InMemoryRunStore();
    await store.start("run-1", intent);

    await expect(store.start("run-1", intent)).rejects.toThrow(
      "already exists",
    );
    const failureResult: FailedRunResult = {
      runId: "run-1",
      replayMode: false,
      intent,
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "Agent Flow failed",
      error: {
        code: "MOSS_UNAVAILABLE",
        stage: "unknown",
        message: "Agent Flow failed",
        retryable: true,
      },
      ruleResults: [],
      recommendedActions: [],
      irrelevantActions: [],
      evidence: [],
      scope: [
        {
          key: "P0-CHECK-SIMULATION-001",
          label: "Moss simulation",
          status: "unknown",
          reason: "REQUIRED_CHECK_INTERRUPTED",
        },
      ],
    };
    await store.fail("run-1", "AGENT_FLOW_ERROR", failureResult);

    expect(store.get("run-1")).toMatchObject({
      status: "failed",
      failure: "AGENT_FLOW_ERROR",
      result: { status: "integration_error", verdict: "UNKNOWN" },
    });
    await expect(
      store.fail("run-1", "INVALID_AGENT_FLOW_RESPONSE", failureResult),
    ).rejects.toThrow("not in the started state");
  });

  it("rejects a failure result whose parent or intent differs from the started Run", async () => {
    const store = new InMemoryRunStore();
    await store.start("run-2", intent, "run-1");

    const failureResult: FailedRunResult = {
      runId: "run-2",
      parentRunId: "other-parent",
      replayMode: false,
      intent,
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "Agent Flow failed",
      error: {
        code: "MOSS_UNAVAILABLE",
        stage: "unknown",
        message: "Agent Flow failed",
        retryable: true,
      },
      ruleResults: [],
      recommendedActions: [],
      irrelevantActions: [],
      evidence: [],
      scope: [
        {
          key: "P0-CHECK-SIMULATION-001",
          label: "Moss simulation",
          status: "unknown",
          reason: "REQUIRED_CHECK_INTERRUPTED",
        },
      ],
    };

    await expect(
      store.fail("run-2", "AGENT_FLOW_ERROR", failureResult),
    ).rejects.toThrow("failure result does not match");
  });

  it("does not expose mutable references to stored records", async () => {
    const store = new InMemoryRunStore();
    await store.start("run-1", intent);
    const first = store.get("run-1");
    if (first === undefined) throw new Error("missing test record");

    first.intent.amountInAtomic = "999";

    expect(store.get("run-1")?.intent.amountInAtomic).toBe("1");
  });
});
