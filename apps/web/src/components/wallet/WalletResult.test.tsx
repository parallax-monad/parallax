import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { CheckSwapResult } from "@/lib/analyze/types";
import { WalletResult } from "./WalletResult";

function result(overrides: Partial<CheckSwapResult> = {}): CheckSwapResult {
  return {
    runId: "run-1",
    systemStatus: "OK",
    verdict: "UNKNOWN",
    summary: { en: "Backend summary", zh: "后端摘要" },
    recommendedActions: [],
    irrelevantActions: [],
    checked: [],
    notChecked: [],
    evidence: [],
    ruleResults: [],
    unknowns: [],
    intent: { tokenIn: "MON", tokenOut: "USDC", amountIn: "0.01" },
    quote: {
      expectedOutput: "unavailable",
      route: { en: "MON → USDC", zh: "MON → USDC" },
      blockNumber: "92820000",
    },
    simulatedOutput: "unavailable",
    minimumReceivedSource: "unavailable",
    createdAt: "2026-08-06T00:00:00.000Z",
    ruleVersion: "P0-EVIDENCE-001",
    mossVersion: "moss@1",
    productRunMode: "LIVE",
    replayMode: false,
    rawResponse: { runId: "run-1" },
    ...overrides,
  };
}

const render = (value: CheckSwapResult) =>
  renderToStaticMarkup(
    <WalletResult
      language="en"
      result={value}
      onDiscard={() => undefined}
      onKeep={() => undefined}
      onOpenEvidence={() => undefined}
      onRetry={() => undefined}
    />,
  );

describe("WalletResult", () => {
  test("labels normal backend results as live", () => {
    const html = render(result());
    expect(html).toContain("Live check");
    expect(html).not.toContain(">Demo<");
  });

  test("renders structured exception details and retry for retryable errors", () => {
    const html = render(
      result({
        systemStatus: "INTEGRATION_ERROR",
        apiFailure: {
          httpStatus: 502,
          code: "RPC_UNAVAILABLE",
          stage: "quote",
          retryable: true,
        },
      }),
    );
    expect(html).toContain("border-risk-moderate/50");
    expect(html).toContain("bg-risk-moderate/10");
    expect(html).toContain("text-risk-moderate");
    expect(html).not.toContain("risk-elevated");
    expect(html).toContain("Check could not be completed");
    expect(html).toContain("RPC_UNAVAILABLE");
    expect(html).toContain("retryable");
    expect(html).toContain(">true<");
    expect(html).toContain(">Retry<");
    expect(html).not.toContain("Not enough evidence");
  });

  test("does not offer retry when backend marks the error non-retryable", () => {
    const html = render(
      result({
        systemStatus: "INTEGRATION_ERROR",
        apiFailure: {
          httpStatus: 400,
          code: "INVALID_RERUN",
          reason: "PARENT_NOT_FOUND",
          retryable: false,
        },
      }),
    );
    expect(html).toContain("INVALID_RERUN");
    expect(html).toContain("PARENT_NOT_FOUND");
    expect(html).not.toContain(">Retry<");
    expect(html).toContain("cannot be retried as-is");
    expect(html).toContain("View details");
  });

  test("shows the backend field issue that caused a rejected request", () => {
    const html = render(
      result({
        systemStatus: "INTEGRATION_ERROR",
        apiFailure: {
          httpStatus: 400,
          code: "NORMALIZATION_FAILED",
          retryable: false,
          issues: [
            {
              code: "TOO_MANY_DECIMAL_PLACES",
              field: "economicBoundary.minimumReceived",
              message: "Amount supports at most 6 decimal places",
            },
          ],
        },
      }),
    );

    expect(html).toContain("NORMALIZATION_FAILED");
    expect(html).toContain("economicBoundary.minimumReceived");
    expect(html).toContain("Amount supports at most 6 decimal places");
  });

  test("names the shortfall using the simulated output, not the quote estimate", () => {
    const html = render(
      result({
        verdict: "STOP",
        quote: {
          expectedOutput: "0.000230",
          route: { en: "MON → USDC", zh: "MON → USDC" },
          blockNumber: "94209970",
        },
        simulatedOutput: "0.000223",
        ruleResults: [
          {
            id: "P0-ECONOMIC-001",
            group: "economicBoundary",
            label: { en: "P0-ECONOMIC-001", zh: "P0-ECONOMIC-001" },
            outcome: "FAIL",
            detail: {
              en: "OUTPUT_BELOW_BOUNDARY",
              zh: "OUTPUT_BELOW_BOUNDARY",
            },
          },
        ],
      }),
    );

    expect(html).toContain("Below your Minimum Received");
    expect(html).toContain("The simulation returned 0.000223");
    expect(html).toContain("does not meet the Minimum Received");
    expect(html).toContain("does not improve the transaction");
  });

  test("stays quiet about the boundary when the rule passed", () => {
    const html = render(
      result({
        verdict: "PROCEED",
        ruleResults: [
          {
            id: "P0-ECONOMIC-001",
            group: "economicBoundary",
            label: { en: "P0-ECONOMIC-001", zh: "P0-ECONOMIC-001" },
            outcome: "PASS",
            detail: { en: "No reason provided", zh: "No reason provided" },
          },
        ],
      }),
    );

    expect(html).not.toContain("Below your Minimum Received");
  });
});
