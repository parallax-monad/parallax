import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { checkSwap } from "@/lib/analyze/service";
import type { CheckSwapInput } from "@/lib/analyze/types";
import { WalletResult } from "./WalletResult";

const input: CheckSwapInput = {
  protocol: "kuru",
  tokenIn: "MON",
  tokenOut: "USDC",
  amountIn: "1200",
  slippage: "0.5",
  minimumReceivedSource: "unavailable",
};

const render = (result: ReturnType<typeof checkSwap>) =>
  renderToStaticMarkup(
    <WalletResult
      language="en"
      result={result}
      onDiscard={() => undefined}
      onKeep={() => undefined}
      onOpenEvidence={() => undefined}
    />,
  );

describe("WalletResult", () => {
  test("renders integration failure before the internal UNKNOWN verdict", () => {
    const html = render(checkSwap({ ...input, amountIn: "invalid" }));

    expect(html).toContain("Check could not be completed");
    expect(html).toContain("No transaction conclusion was produced");
    expect(html).toContain("Retry check");
    expect(html).toContain("View details");
    expect(html).not.toContain("Not enough evidence");
    expect(html).not.toContain("PROCEED");
    expect(html).not.toContain("Next step in this result");
    expect(html).toContain("Demo preset");
  });

  test("renders demo mode and compact scope counts for a normal result", () => {
    const html = render(checkSwap(input));

    expect(html).toContain(">Demo preset<");
    expect(html).toContain("It is not current Live Evidence");
    expect(html).toContain("Checked: 2");
    expect(html).toContain("Unknown: 0");
    expect(html).toContain("Not checked: 4");
    expect(html).not.toContain("Recorded replay");
  });
});
