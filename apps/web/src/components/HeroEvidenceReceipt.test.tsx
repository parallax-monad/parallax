import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { HeroEvidenceReceipt } from "./HeroEvidenceReceipt";

describe("HeroEvidenceReceipt", () => {
  test("shows one disclosed demo receipt with six evidence rows", () => {
    const html = renderToStaticMarkup(<HeroEvidenceReceipt language="en" />);

    expect(html).toContain("EVIDENCE RECEIPT");
    expect(html).toContain("DEMO PRESET");
    expect(html).toContain("SAMPLE DATA");
    expect(html).toContain("READ ONLY");
    expect(html).toContain("DEMO PRESET / SAMPLE");
    expect(html).not.toContain("13,842,911");
    expect(html).not.toContain("v0.4");
    expect(html.match(/data-evidence-row/g)).toHaveLength(6);
    expect(html).toContain("Economic boundary");
    expect(html).toContain("91.77 USDC");
    expect(html).toContain("93.40 USDC");
    expect(html).toContain("ADJUST");
  });

  test("localizes the demo disclosure and outcome in the Chinese receipt", () => {
    const html = renderToStaticMarkup(<HeroEvidenceReceipt language="zh-CN" />);

    expect(html).toContain("证据回执");
    expect(html).toContain("经济边界");
    expect(html).toContain("演示预设");
    expect(html).toContain("演示结果");
    expect(html).toContain("调整");
  });
});
