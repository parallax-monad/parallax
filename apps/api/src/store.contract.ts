import type {
  FailedRunResult,
  NormalizedSwapIntent,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import type { RunStore } from "./store.js";

export type RunStoreFactory = () => RunStore | Promise<RunStore>;

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

function failureResult(runId: string, parentRunId?: string): FailedRunResult {
  return {
    runId,
    parentRunId,
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
}

/** Shared behavioral contract for every RunStore implementation. */
export function runStoreContract(
  implementationName: string,
  createStore: RunStoreFactory,
): void {
  describe(`${implementationName} RunStore contract`, () => {
    it("reads records asynchronously", async () => {
      const store = await createStore();
      await store.start("async-run", intent);

      const pending = store.get("async-run");

      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).resolves.toMatchObject({
        runId: "async-run",
        status: "started",
      });
    });

    it("moves a run from started to completed", async () => {
      const store = await createStore();
      const result = failureResult("complete-run");

      await store.start("complete-run", intent);
      await expect(store.get("complete-run")).resolves.toMatchObject({
        status: "started",
        intent,
      });
      await store.complete(result);

      await expect(store.get("complete-run")).resolves.toMatchObject({
        status: "completed",
        result,
      });
      await expect(store.get("missing-run")).resolves.toBeUndefined();
    });

    it("preserves a parent Run link across a child lifecycle", async () => {
      const store = await createStore();
      const result = failureResult("child-run", "parent-run");

      await store.start("child-run", intent, "parent-run");
      await store.complete(result);

      await expect(store.get("child-run")).resolves.toMatchObject({
        runId: "child-run",
        parentRunId: "parent-run",
        status: "completed",
        result,
      });
    });

    it("rejects a completed result with a different parent", async () => {
      const store = await createStore();
      await store.start("complete-parent-mismatch", intent, "parent-run");

      await expect(
        store.complete(
          failureResult("complete-parent-mismatch", "other-parent"),
        ),
      ).rejects.toThrow("parent does not match");
    });

    it("rejects duplicate starts and repeated terminal transitions", async () => {
      const store = await createStore();
      await store.start("failed-run", intent);

      await expect(store.start("failed-run", intent)).rejects.toThrow(
        "already exists",
      );
      const failed = failureResult("failed-run");
      await store.fail("failed-run", "AGENT_FLOW_ERROR", failed);

      await expect(store.get("failed-run")).resolves.toMatchObject({
        status: "failed",
        failure: "AGENT_FLOW_ERROR",
        result: { status: "integration_error", verdict: "UNKNOWN" },
      });
      await expect(
        store.fail("failed-run", "INVALID_AGENT_FLOW_RESPONSE", failed),
      ).rejects.toThrow("not in the started state");
    });

    it("allows exactly one concurrent terminal transition", async () => {
      const store = await createStore();
      const runId = "terminal-race";
      const terminalResult = failureResult(runId);
      await store.start(runId, intent);

      const outcomes = await Promise.allSettled([
        store.complete(terminalResult),
        store.fail(runId, "AGENT_FLOW_ERROR", terminalResult),
      ]);

      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);
      const finalRecord = await store.get(runId);
      if (outcomes[0]?.status === "fulfilled") {
        expect(finalRecord).toMatchObject({
          status: "completed",
          result: terminalResult,
        });
      } else {
        expect(finalRecord).toMatchObject({
          status: "failed",
          failure: "AGENT_FLOW_ERROR",
          result: terminalResult,
        });
      }
    });

    it("rejects a failure result with a different parent", async () => {
      const store = await createStore();
      await store.start("failure-parent-mismatch", intent, "parent-run");

      await expect(
        store.fail(
          "failure-parent-mismatch",
          "AGENT_FLOW_ERROR",
          failureResult("failure-parent-mismatch", "other-parent"),
        ),
      ).rejects.toThrow("failure result does not match");
    });

    it("does not expose mutable references to stored records", async () => {
      const store = await createStore();
      await store.start("immutable-run", intent);
      const first = await store.get("immutable-run");
      if (first === undefined) throw new Error("missing test record");

      first.intent.amountInAtomic = "999";

      expect((await store.get("immutable-run"))?.intent.amountInAtomic).toBe(
        "1",
      );
    });
  });
}
