import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { HeroEvidenceReceipt } from "./HeroEvidenceReceipt";

describe("HeroEvidenceReceipt", () => {
  test("shows one disclosed replay receipt with six evidence rows", () => {
    const html = renderToStaticMarkup(<HeroEvidenceReceipt language="en" />);

    expect(html).toContain("EVIDENCE RECEIPT");
    expect(html).toContain("REPLAY FIXTURE");
    expect(html).toContain("DEMO NETWORK");
    expect(html).toContain("SAMPLE BLOCK");
    expect(html).toContain("MOSS REPLAY / FIXTURE");
    expect(html).not.toContain("13,842,911");
    expect(html).not.toContain("v0.4");
    expect(html.match(/data-evidence-row/g)).toHaveLength(6);
    expect(html).toContain("Economic boundary");
    expect(html).toContain("91.77 USDC");
    expect(html).toContain("93.40 USDC");
    expect(html).toContain("REVISE &amp; RERUN");
  });

  test("keeps the instrument verdict in English in the Chinese receipt", () => {
    const html = renderToStaticMarkup(<HeroEvidenceReceipt language="zh-CN" />);

    expect(html).toContain("证据回执");
    expect(html).toContain("经济边界");
    expect(html).toContain("REVISE &amp; RERUN");
    expect(html).not.toContain("调整后重跑");
  });
});
