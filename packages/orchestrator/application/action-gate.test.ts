import type { NormalizedSwapIntent, RunResult } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import {
  buildVerifiedAdjustBaseline,
  childRunPassesActionGate,
  isActionGateCandidate,
  proposeAmountInAdjustment,
} from "./action-gate.js";
import {
  type ActionGateFixtureAssets,
  economicFailStopResult,
  economicPassChildResult,
} from "./action-gate-fixtures.js";

const sender = "0x1111111111111111111111111111111111111111";
const usdc = {
  kind: "erc20" as const,
  address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
};
const mon = { kind: "native" as const };

const assets: ActionGateFixtureAssets = {
  sender,
  mon,
  usdc,
  simulatorPinnedBlock: "92820000",
  runtimeVersion: "moss-0.1.0",
  runtimeRevision: "revision-1",
};

const availableIntent: NormalizedSwapIntent = {
  chainId: 143,
  protocol: "kuru",
  sender,
  recipient: sender,
  recipientSource: "defaulted_from_sender",
  tokenIn: mon,
  tokenOut: usdc,
  amountInAtomic: "1500000000000000000",
  economicBoundary: {
    availability: "available",
    minimumReceivedAtomic: "20000",
    source: "user_declared",
  },
};

type Completed = Extract<RunResult, { status: "completed" }>;

describe("Action Gate fixture helpers", () => {
  it("recognizes an economic FAIL STOP baseline as a Gate candidate", () => {
    expect(
      isActionGateCandidate(economicFailStopResult(assets, "run-1", availableIntent)),
    ).toBe(true);
  });

  it("rejects baselines without an available Economic Boundary", () => {
    const baseline = economicFailStopResult(assets, "run-1", availableIntent);
    expect(
      isActionGateCandidate({
        ...baseline,
        intent: {
          ...baseline.intent,
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        },
      }),
    ).toBe(false);
  });

  it("rejects baselines with blocking UNKNOWN Scope", () => {
    const baseline = economicFailStopResult(assets, "run-1", availableIntent);
    expect(
      isActionGateCandidate({
        ...baseline,
        scope: [
          ...baseline.scope,
          {
            key: "P0-CHECK-SIMULATION-001",
            label: "Moss simulation",
            status: "unknown",
            reason: "REQUIRED_CHECK_INTERRUPTED",
          },
        ],
      }),
    ).toBe(false);
  });

  it("rejects baselines with blocking UNKNOWN Rule Results", () => {
    const baseline = economicFailStopResult(assets, "run-1", availableIntent);
    expect(
      isActionGateCandidate({
        ...baseline,
        ruleResults: [
          baseline.ruleResults[0]!,
          {
            ruleId: "P0-EXECUTION-001",
            status: "UNKNOWN",
            reasonCode: "RULE_CLASSIFICATION_NOT_VERIFIED",
            evidenceRefs: baseline.ruleResults[1]!.evidenceRefs,
            actionEvaluations: [],
          },
          baseline.ruleResults[2]!,
        ],
      }),
    ).toBe(false);
  });

  it("proposes a deterministic amountInAtomic reduction", () => {
    const adjustment = proposeAmountInAdjustment(availableIntent);
    expect(adjustment).toEqual({
      before: "1500000000000000000",
      after: "1000000000000000000",
      nextIntent: {
        ...availableIntent,
        amountInAtomic: "1000000000000000000",
      },
    });
  });

  it("builds a verified ADJUST baseline from a passing child Run", () => {
    const baseline = economicFailStopResult(assets, "run-1", availableIntent);
    const adjustment = proposeAmountInAdjustment(baseline.intent);
    const childBase = economicPassChildResult(
      assets,
      "run-2",
      adjustment.nextIntent,
    );
    const child: Completed = {
      ...childBase,
      parentRunId: "run-1",
      diff: {
        previousRunId: "run-1",
        previousVerdict: "STOP",
        changedFields: [
          {
            field: "amountInAtomic",
            before: adjustment.before,
            after: adjustment.after,
          },
        ],
      },
    };

    expect(childRunPassesActionGate(child, "run-1")).toBe(true);

    const verified = buildVerifiedAdjustBaseline(baseline, child, adjustment);
    expect(verified).toMatchObject({
      runId: "run-1",
      verdict: "ADJUST",
      recommendedActions: [
        {
          action: { kind: "TRANSACTION_ADJUSTMENT", field: "amountIn" },
          recommendable: true,
          actionReasonCode: "OUTPUT_IMPROVEMENT_VERIFIED",
          proposedChange: {
            field: "amountIn",
            before: adjustment.before,
            after: adjustment.after,
          },
        },
      ],
    });
    expect(
      verified.evidence.some(
        (item) =>
          item.kind === "action_verification" &&
          item.verificationRunId === "run-2",
      ),
    ).toBe(true);
  });

  it("rejects a child that fails a required Gate rule", () => {
    const adjustment = proposeAmountInAdjustment(availableIntent);
    const childBase = economicPassChildResult(
      assets,
      "run-2",
      adjustment.nextIntent,
    );
    const failingChild: Completed = {
      ...childBase,
      parentRunId: "run-1",
      verdict: "STOP",
      summary: "Adjusted Intent still misses the Economic Boundary",
      ruleResults: [
        childBase.ruleResults[0]!,
        childBase.ruleResults[1]!,
        {
          ruleId: "P0-ECONOMIC-001",
          status: "FAIL",
          reasonCode: "OUTPUT_BELOW_BOUNDARY",
          evidenceRefs: childBase.ruleResults[2]!.evidenceRefs,
          actionEvaluations: [],
        },
      ],
      diff: {
        previousRunId: "run-1",
        previousVerdict: "STOP",
        changedFields: [
          {
            field: "amountInAtomic",
            before: adjustment.before,
            after: adjustment.after,
          },
        ],
      },
    };

    expect(childRunPassesActionGate(failingChild, "run-1")).toBe(false);
  });

  it("rejects a child whose simulated tokenOut recipient does not match Intent", () => {
    const adjustment = proposeAmountInAdjustment(availableIntent);
    const childBase = economicPassChildResult(
      assets,
      "run-2",
      adjustment.nextIntent,
    );
    const mismatched: Completed = {
      ...childBase,
      parentRunId: "run-1",
      evidence: childBase.evidence.map((item) =>
        item.kind === "simulated_token_out"
          ? {
              ...item,
              recipient: "0x2222222222222222222222222222222222222222",
            }
          : item,
      ),
      diff: {
        previousRunId: "run-1",
        previousVerdict: "STOP",
        changedFields: [
          {
            field: "amountInAtomic",
            before: adjustment.before,
            after: adjustment.after,
          },
        ],
      },
    };

    expect(childRunPassesActionGate(mismatched, "run-1")).toBe(false);
  });

  it("rejects a child whose simulated tokenOut asset does not match Intent", () => {
    const adjustment = proposeAmountInAdjustment(availableIntent);
    const childBase = economicPassChildResult(
      assets,
      "run-2",
      adjustment.nextIntent,
    );
    const mismatched: Completed = {
      ...childBase,
      parentRunId: "run-1",
      evidence: childBase.evidence.map((item) =>
        item.kind === "simulated_token_out"
          ? {
              ...item,
              tokenOut: {
                kind: "erc20" as const,
                address: "0x9999999999999999999999999999999999999999",
              },
            }
          : item,
      ),
      diff: {
        previousRunId: "run-1",
        previousVerdict: "STOP",
        changedFields: [
          {
            field: "amountInAtomic",
            before: adjustment.before,
            after: adjustment.after,
          },
        ],
      },
    };

    expect(childRunPassesActionGate(mismatched, "run-1")).toBe(false);
  });
});
