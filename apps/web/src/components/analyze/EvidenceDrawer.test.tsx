import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { CheckSwapResult } from "@/lib/analyze/types";
import { EvidenceDrawer } from "./EvidenceDrawer";

function result(
  providerEvidence: CheckSwapResult["providerEvidence"],
): CheckSwapResult {
  return {
    runId: "run-1",
    systemStatus: "OK",
    verdict: "UNKNOWN",
    summary: { en: "summary", zh: "摘要" },
    recommendedActions: [],
    irrelevantActions: [],
    checked: [],
    notChecked: [],
    evidence: [],
    ruleResults: [],
    unknowns: [],
    unavailable: [],
    intent: { tokenIn: "MON", tokenOut: "USDC", amountIn: "0.01" },
    quote: {
      expectedOutput: "unavailable",
      route: { en: "MON -> USDC", zh: "MON -> USDC" },
      blockNumber: "unavailable",
    },
    simulatedOutput: "unavailable",
    minimumReceivedSource: "unavailable",
    createdAt: "2026-08-15T08:00:00.000Z",
    ruleVersion: "unavailable",
    mossVersion: "unavailable",
    productRunMode: "LIVE",
    replayMode: false,
    rawResponse: {},
    providerEvidence,
  };
}

describe("EvidenceDrawer scope presentation", () => {
  test("does not present an empty not-checked group as unavailable", () => {
    const html = renderToStaticMarkup(
      <EvidenceDrawer
        result={result({
          status: "UNKNOWN",
          checkedScope: [],
          unknownScope: [],
          unavailableScope: [],
        })}
        language="en"
        onClose={() => undefined}
      />,
    );

    expect(html).toContain("Not checked");
    expect(html).toContain("No items reported");
    expect(html).not.toContain('text-faint">Unavailable');
  });

  test("keeps unavailable for explicitly recorded unavailable scope", () => {
    const html = renderToStaticMarkup(
      <EvidenceDrawer
        result={result({
          status: "UNKNOWN",
          checkedScope: [],
          unknownScope: [],
          unavailableScope: ["Trace RPC"],
        })}
        language="en"
        onClose={() => undefined}
      />,
    );

    expect(html).toContain("Trace RPC");
  });
});
