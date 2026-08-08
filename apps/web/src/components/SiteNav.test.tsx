import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SiteNav } from "./SiteNav";

const noop = () => undefined;

describe("SiteNav", () => {
  test("links the landing demo label to the existing analyze route", () => {
    const html = renderToStaticMarkup(
      <SiteNav language="en" onLanguageChange={noop} />,
    );

    expect(html).toContain('href="#/analyze"');
    expect(html).toContain("Try demo");
    expect(html).not.toContain(">Analyze<");
  });

  test("provides a bilingual return path from the MVP route", () => {
    const english = renderToStaticMarkup(
      <SiteNav
        active="analyze"
        language="en"
        minimal
        onLanguageChange={noop}
      />,
    );
    const chinese = renderToStaticMarkup(
      <SiteNav
        active="analyze"
        language="zh-CN"
        minimal
        onLanguageChange={noop}
      />,
    );

    expect(english).toContain('href="#/"');
    expect(english).toContain("← Landing");
    expect(chinese).toContain("← 首页");
    expect(english).toContain("← Back to Parallax");
    expect(chinese).toContain("← 返回 Parallax");
    expect(english.match(/Switch to Simplified Chinese/g)).toHaveLength(1);
    expect(english.match(/Switch to English/g)).toHaveLength(1);
    expect(english).not.toContain('href="#/analyze"');
  });
});
