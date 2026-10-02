import type {
  FailedRunResult,
  NormalizedSwapIntent,
} from "@parallax/contracts";
import { economicFailStopResult } from "@parallax/orchestrator/application/action-gate-fixtures";
import { describe, expect, it } from "vitest";
import { projectEvidencePresentation } from "./backend/evidence-presentation.js";
import type { RunStore } from "./store.js";

export type RunStoreFactory = () => RunStore | Promise<RunStore>;
export type RunStoreContractOptions = { skip?: boolean };

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
    ...(parentRunId === undefined
      ? {}
      : {
          parentRunId,
          diff: {
            previousRunId: parentRunId,
            previousVerdict: "UNKNOWN" as const,
            changedFields: [
              {
                field: "amountInAtomic" as const,
                before: "1",
                after: "2",
              },
            ],
          },
        }),
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

function completedResultWithBasicSimulation(runId: string) {
  const completedIntent: NormalizedSwapIntent = {
    ...intent,
    economicBoundary: {
      availability: "available",
      minimumReceivedAtomic: "20000",
      source: "user_declared",
    },
  };
  const result = economicFailStopResult(
    {
      sender: intent.sender,
      mon: intent.tokenIn as Extract<
        NormalizedSwapIntent["tokenIn"],
        { kind: "native" }
      >,
      usdc: intent.tokenOut as Extract<
        NormalizedSwapIntent["tokenOut"],
        { kind: "erc20" }
      >,
      simulatorPinnedBlock: "42",
      runtimeVersion: "native-rpc-runtime",
      runtimeRevision: "native-rpc-revision",
    },
    runId,
    completedIntent,
  );

  result.p0 = {
    expectationBaseline: { status: "MISSING" },
    quoteFidelity: { status: "UNKNOWN", reason: "MISSING_BASELINE" },
    cause: { status: "NOT_VERIFIED" },
    constraints: [],
    evidenceState: "UNAVAILABLE",
    transactionProtection: {
      status: "NOT_APPLICABLE",
      source: "unavailable",
    },
    basicSimulation: {
      call: {
        status: "SUCCEEDED",
        returnDataFingerprint: `sha256:${"a".repeat(64)}`,
      },
      gasEstimate: { status: "AVAILABLE", gasUnits: "21000" },
      blockNumber: "42",
      blockHash: `0x${"b".repeat(64)}`,
      observedAt: "2026-09-10T00:01:00.000Z",
      validityAtExecution: "UNKNOWN",
      preparedTransactionFingerprint: `sha256:${"c".repeat(64)}`,
      uncheckedCapabilities: ["receipt", "outcome", "traces"],
    },
    remediation: { status: "NOT_RUN" },
  };
  return result;
}

/** Shared behavioral contract for every RunStore implementation. */
export function runStoreContract(
  implementationName: string,
  createStore: RunStoreFactory,
  options: RunStoreContractOptions = {},
): void {
  const contractIt = options.skip === true ? it.skip : it;
  describe(`${implementationName} RunStore contract`, () => {
    contractIt(
      "round-trips the display projection for completed/failed Runs and preserves legacy absence",
      async () => {
        const store = await createStore();
        for (const mode of ["completed", "failed"] as const) {
          const result =
            mode === "completed"
              ? completedResultWithBasicSimulation(`presentation-${mode}`)
              : failureResult(`presentation-${mode}`);
          result.evidencePresentation = projectEvidencePresentation(result);
          await store.start(result.runId, result.intent);
          if (result.status === "integration_error")
            await store.fail(result.runId, "AGENT_FLOW_ERROR", result);
          else await store.complete(result);
          const record = await store.get(result.runId);
          expect(
            record?.status === "started"
              ? undefined
              : record?.result.evidencePresentation,
          ).toEqual(result.evidencePresentation);
        }
        const legacy = failureResult("presentation-legacy");
        await store.start(legacy.runId, legacy.intent);
        await store.fail(legacy.runId, "AGENT_FLOW_ERROR", legacy);
        const record = await store.get(legacy.runId);
        expect(
          record?.status === "started"
            ? undefined
            : record?.result.evidencePresentation,
        ).toBeUndefined();
      },
    );
    contractIt(
      "round-trips trusted metadata for completed and failed Runs, preserving legacy absence",
      async () => {
        const store = await createStore();
        const metadata = {
          tokenIn: {
            chainId: 143,
            asset: { kind: "native" as const },
            symbol: "MON",
            decimals: 18,
            decimalsSource: "chain_config" as const,
          },
          tokenOut: {
            chainId: 143,
            asset: intent.tokenOut as { kind: "erc20"; address: string },
            symbol: "USDC",
            decimals: 6,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: "42",
          },
        };
        for (const mode of ["completed", "failed"] as const) {
          const result =
            mode === "completed"
              ? completedResultWithBasicSimulation(`metadata-${mode}`)
              : failureResult(`metadata-${mode}`);
          result.tokenMetadata = metadata;
          await store.start(result.runId, result.intent);
          if (mode === "failed" && result.status === "integration_error")
            await store.fail(result.runId, "AGENT_FLOW_ERROR", result);
          else await store.complete(result);
          const record = await store.get(result.runId);
          expect(
            record?.status === "started"
              ? undefined
              : record?.result.tokenMetadata,
          ).toEqual(metadata);
        }
        const legacy = failureResult("legacy-no-metadata");
        await store.start(legacy.runId, legacy.intent);
        await store.fail(legacy.runId, "AGENT_FLOW_ERROR", legacy);
        const record = await store.get(legacy.runId);
        expect(
          record?.status === "started"
            ? undefined
            : record?.result.tokenMetadata,
        ).toBeUndefined();
      },
    );
    contractIt("reads records asynchronously", async () => {
      const store = await createStore();
      await store.start("async-run", intent);

      const pending = store.get("async-run");

      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).resolves.toMatchObject({
        runId: "async-run",
        status: "started",
      });
    });

    contractIt("moves a run from started to completed", async () => {
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

    contractIt(
      "round-trips basicSimulation facts without making them provider-specific",
      async () => {
        const store = await createStore();
        const result = completedResultWithBasicSimulation("basic-simulation");

        await store.start("basic-simulation", result.intent);
        await store.complete(result);

        const record = await store.get("basic-simulation");
        expect(record).toMatchObject({
          status: "completed",
          result: {
            p0: {
              basicSimulation: {
                call: { status: "SUCCEEDED" },
                gasEstimate: { status: "AVAILABLE", gasUnits: "21000" },
                blockNumber: "42",
                validityAtExecution: "UNKNOWN",
              },
            },
          },
        });
      },
    );

    contractIt(
      "keeps pre-basicSimulation Runs as not recorded instead of inventing execution facts",
      async () => {
        const store = await createStore();
        const result = completedResultWithBasicSimulation("legacy-run");
        if (result.p0 === undefined) {
          throw new Error("expected a P0 result before removing the new field");
        }
        delete result.p0.basicSimulation;

        await store.start("legacy-run", result.intent);
        await store.complete(result);

        const record = await store.get("legacy-run");
        if (record?.status !== "completed") {
          throw new Error("expected a completed legacy Run");
        }
        expect(record.result.runId).toBe("legacy-run");
        expect(record.result.p0).toMatchObject({
          expectationBaseline: { status: "MISSING" },
          quoteFidelity: { status: "UNKNOWN", reason: "MISSING_BASELINE" },
          cause: { status: "NOT_VERIFIED" },
          evidenceState: "UNAVAILABLE",
          transactionProtection: {
            status: "NOT_APPLICABLE",
            source: "unavailable",
          },
          remediation: { status: "NOT_RUN" },
        });
        expect(record.result.p0?.basicSimulation).toBeUndefined();
      },
    );

    contractIt(
      "preserves a parent Run link across a child lifecycle",
      async () => {
        const store = await createStore();
        const result = failureResult("child-run", "parent-run");

        await store.start("parent-run", intent);
        await store.start("child-run", intent, "parent-run");
        await store.complete(result);

        await expect(store.get("child-run")).resolves.toMatchObject({
          runId: "child-run",
          parentRunId: "parent-run",
          status: "completed",
          result,
        });
      },
    );

    contractIt(
      "rejects a completed result with a different parent",
      async () => {
        const store = await createStore();
        await store.start("parent-run", intent);
        await store.start("complete-parent-mismatch", intent, "parent-run");

        await expect(
          store.complete(
            failureResult("complete-parent-mismatch", "other-parent"),
          ),
        ).rejects.toThrow("parent does not match");
      },
    );

    contractIt(
      "rejects a completed result with a different Intent",
      async () => {
        const store = await createStore();
        await store.start("complete-intent-mismatch", intent);
        const result = failureResult("complete-intent-mismatch");
        result.intent = { ...intent, amountInAtomic: "2" };

        await expect(store.complete(result)).rejects.toThrow(
          "result does not match",
        );
      },
    );

    contractIt("rejects a child Run with an unknown parent", async () => {
      const store = await createStore();

      await expect(
        store.start("orphan-child", intent, "missing-parent"),
      ).rejects.toThrow("parent does not exist");
    });

    contractIt(
      "rejects duplicate starts and repeated terminal transitions",
      async () => {
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
      },
    );

    contractIt(
      "allows exactly one concurrent terminal transition",
      async () => {
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
      },
    );

    contractIt("rejects a failure result with a different parent", async () => {
      const store = await createStore();
      await store.start("parent-run", intent);
      await store.start("failure-parent-mismatch", intent, "parent-run");

      await expect(
        store.fail(
          "failure-parent-mismatch",
          "AGENT_FLOW_ERROR",
          failureResult("failure-parent-mismatch", "other-parent"),
        ),
      ).rejects.toThrow("failure result does not match");
    });

    contractIt(
      "does not expose mutable references to stored records",
      async () => {
        const store = await createStore();
        await store.start("immutable-run", intent);
        const first = await store.get("immutable-run");
        if (first === undefined) throw new Error("missing test record");

        first.intent.amountInAtomic = "999";

        expect((await store.get("immutable-run"))?.intent.amountInAtomic).toBe(
          "1",
        );
      },
    );
  });
}
