import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { CheckSwapResult } from "@/lib/analyze/types";
import { EvidenceDrawer } from "./EvidenceDrawer";

function result(
  capabilities: NonNullable<
    CheckSwapResult["providerEvidence"]
  >["capabilities"],
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
    capabilities: [],
    evidence: [],
    ruleResults: [],
    unknowns: [],
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
    providerEvidence: {
      status: "UNKNOWN",
      capabilities,
    },
  };
}

function render(
  capabilities: NonNullable<
    NonNullable<CheckSwapResult["providerEvidence"]>["capabilities"]
  >,
) {
  return renderToStaticMarkup(
    <EvidenceDrawer
      result={result(capabilities)}
      language="en"
      onClose={() => undefined}
    />,
  );
}

describe("EvidenceDrawer capability scope", () => {
  test("uses a neutral empty state for an empty not_checked group", () => {
    const html = render([
      {
        id: "trace-rpc.callTracer",
        summary: "Supplementary call trace",
        status: "checked",
        sourceCategory: "trace_rpc",
      },
    ]);

    expect(html).toContain("Not checked");
    expect(html).toContain("No items reported");
    expect(html).not.toContain('class="shrink-0 text-faint">Unavailable');
  });

  test("reserves Unavailable for an explicitly unavailable capability", () => {
    const html = render([
      {
        id: "trace-rpc.callTracer",
        summary: "Supplementary call trace",
        status: "unavailable",
        sourceCategory: "trace_rpc",
        reason: "rpc_unavailable",
      },
    ]);

    expect(html).toContain("Unavailable");
    expect(html).toContain("rpc_unavailable");
  });
});
