import { isDeepStrictEqual } from "node:util";
import {
  assetIdentity,
  type NormalizedSwapIntent,
  type RerunRejectionReason,
  type RunDiff,
  type RunResult,
  runDiffSchema,
} from "@parallax/contracts";

export type RerunRunRecord =
  | { status: "started" }
  | { status: "failed" }
  | { status: "completed"; result: RunResult };

export interface RerunRunStore {
  get(runId: string): RerunRunRecord | undefined;
}

export type RerunContext =
  | { kind: "baseline" }
  | { kind: "child"; parentRunId: string; diff: RunDiff };

export type RerunResolution =
  | { success: true; context: RerunContext }
  | {
      success: false;
      reason: RerunRejectionReason;
      message: string;
    };

/** Resolves the immutable baseline and exact single-condition child diff. */
export function resolveRerun(
  parentRunId: string | undefined,
  intent: NormalizedSwapIntent,
  store: RerunRunStore,
): RerunResolution {
  if (parentRunId === undefined) {
    return { success: true, context: { kind: "baseline" } };
  }

  const parent = store.get(parentRunId);
  if (parent === undefined) {
    return {
      success: false,
      reason: "PARENT_NOT_FOUND",
      message: "The parent Run was not found",
    };
  }

  if (parent.status !== "completed" || parent.result.status !== "completed") {
    return {
      success: false,
      reason: "PARENT_NOT_COMPLETED",
      message: "The parent Run is not completed",
    };
  }

  if (parent.result.replayMode) {
    return {
      success: false,
      reason: "PARENT_IS_REPLAY",
      message: "Recorded Replay Runs cannot be re-run",
    };
  }

  if (parent.result.parentRunId !== undefined) {
    return {
      success: false,
      reason: "RERUN_CHAINING_UNSUPPORTED",
      message: "A Re-run must target a baseline Run",
    };
  }

  if (
    parent.result.intent.chainId !== intent.chainId ||
    parent.result.intent.sender.toLowerCase() !== intent.sender.toLowerCase()
  ) {
    return {
      success: false,
      reason: "CHAIN_OR_SENDER_CHANGED",
      message: "A Re-run must preserve the baseline chain and sender",
    };
  }

  if (
    !isDeepStrictEqual(
      parent.result.intent.economicBoundary,
      intent.economicBoundary,
    )
  ) {
    return {
      success: false,
      reason: "BOUNDARY_CHANGED",
      message:
        "A verification Re-run must preserve the baseline Economic Boundary",
    };
  }

  if (
    parent.result.intent.economicBoundary.availability === "available" &&
    assetIdentity({
      chainId: parent.result.intent.chainId,
      asset: parent.result.intent.tokenOut,
    }) !== assetIdentity({ chainId: intent.chainId, asset: intent.tokenOut })
  ) {
    return {
      success: false,
      reason: "BOUNDARY_ASSET_CHANGED",
      message:
        "A Re-run cannot change the Boundary asset while preserving the original Economic Boundary",
    };
  }

  const diff = buildRunDiff(parent.result, intent);
  if (!diff.success) {
    return {
      success: false,
      reason: "NOT_EXACTLY_ONE_CHANGE",
      message: diff.message,
    };
  }

  return {
    success: true,
    context: { kind: "child", parentRunId, diff: diff.value },
  };
}

type DiffResult =
  | { success: true; value: RunDiff }
  | { success: false; message: string };

/** Exact single-field Intent Diff used by Re-run and Action Gate children. */
export function buildRunDiff(
  previous: RunResult,
  nextIntent: NormalizedSwapIntent,
): DiffResult {
  const changedFields: RunDiff["changedFields"] = [];
  const addChange = (
    field: RunDiff["changedFields"][number]["field"],
    before: string,
    after: string,
  ) => {
    if (before !== after) {
      changedFields.push({ field, before, after });
    }
  };

  addChange(
    "amountInAtomic",
    previous.intent.amountInAtomic,
    nextIntent.amountInAtomic,
  );
  addChange("protocol", previous.intent.protocol, nextIntent.protocol);
  addChange(
    "recipient",
    previous.intent.recipient.toLowerCase(),
    nextIntent.recipient.toLowerCase(),
  );
  addChange(
    "tokenPair",
    tokenPairDiffValue(previous.intent),
    tokenPairDiffValue(nextIntent),
  );

  if (changedFields.length !== 1) {
    return {
      success: false,
      message: "A Re-run must change exactly one supported Intent field",
    };
  }

  return {
    success: true,
    value: runDiffSchema.parse({
      previousRunId: previous.runId,
      previousVerdict: previous.verdict,
      changedFields,
    }),
  };
}

function tokenPairDiffValue(intent: NormalizedSwapIntent): string {
  return `${assetDiffValue(intent.tokenIn)}->${assetDiffValue(intent.tokenOut)}`;
}

function assetDiffValue(asset: NormalizedSwapIntent["tokenIn"]): string {
  return asset.kind === "native"
    ? "native"
    : `erc20:${asset.address.toLowerCase()}`;
}
