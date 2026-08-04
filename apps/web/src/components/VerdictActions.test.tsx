import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  createVerdictInteractionHandlers,
  VerdictActions,
  type VerdictZone,
} from "./VerdictActions";

describe("VerdictActions", () => {
  test("places all four verdict states in one shared field", () => {
    const html = renderToStaticMarkup(<VerdictActions language="en" />);

    expect(html).toContain('data-verdict-field=""');
    expect(html.match(/data-verdict-choice=/g)).toHaveLength(4);
    expect(html.match(/data-receipt-dot=/g)).toHaveLength(37);
    expect(html).toContain("READY TO SIGN");
    expect(html).toContain("REVISE &amp; RERUN");
    expect(html).toContain("DO NOT SIGN");
    expect(html).toContain("MORE EVIDENCE NEEDED");
  });

  test("exposes one selected quadrant as an interactive choice", () => {
    const html = renderToStaticMarkup(<VerdictActions language="en" />);

    expect(html).toContain('data-verdict-center=""');
    expect(html).toContain('data-activation="pointer"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
    expect(html).toContain("SELECTED FIELD");
    expect(html).toContain("REVISE &amp; RERUN");
  });

  test("follows mouse hover without requiring a click", () => {
    let selected: VerdictZone = "southeast";
    const handlers = createVerdictInteractionHandlers("northwest", (zone) => {
      selected = zone;
    });

    handlers.onPointerEnter({ pointerType: "mouse" });
    expect(selected).toBe("northwest");
  });

  test("uses touch press as a fallback but ignores touch enter", () => {
    let selected: VerdictZone = "southeast";
    const handlers = createVerdictInteractionHandlers("northwest", (zone) => {
      selected = zone;
    });

    handlers.onPointerEnter({ pointerType: "touch" });
    expect(selected).toBe("southeast");
    handlers.onPointerDown({ pointerType: "touch" });
    expect(selected).toBe("northwest");
  });

  test("supports keyboard focus selection", () => {
    let selected: VerdictZone = "southeast";
    const handlers = createVerdictInteractionHandlers("northeast", (zone) => {
      selected = zone;
    });

    handlers.onFocus();
    expect(selected).toBe("northeast");
  });

  test("uses concise, idiomatic Chinese verdict language", () => {
    const html = renderToStaticMarkup(<VerdictActions language="zh-CN" />);

    expect(html).toContain("证据尚不足");
    expect(html).toContain("可以签署");
    expect(html).toContain("请勿签署");
    expect(html).toContain("调整后重跑");
    expect(html).toContain("移动指针，查看结论");
    expect(html).not.toContain("需要更多证据");
  });
});
