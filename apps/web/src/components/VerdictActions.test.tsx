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
    expect(
      html.match(/aria-describedby="verdict-vote-instructions"/g),
    ).toHaveLength(4);
    expect(html).toContain(
      "Choose one verdict. You have one vote. Choosing another verdict moves your vote.",
    );
    expect(html.match(/data-vote-dot=/g)).toHaveLength(37);
    expect(html).toContain("37 DEMO VOTES / INTERACTIVE POLL");
    expect(html).toContain("ONE PERSON / ONE VOTE");
    expect(html).not.toContain("READY TO SIGN");
    expect(html).toContain("PROCEED / DEMO");
    expect(html).toContain("ADJUST BEFORE PROCEEDING");
    expect(html).toContain("DO NOT USE THIS TRANSACTION PATH");
    expect(html).toContain("MORE EVIDENCE IS REQUIRED");
  });

  test("starts as an uncast interactive vote", () => {
    const html = renderToStaticMarkup(<VerdictActions language="en" />);

    expect(html).toContain('data-verdict-center=""');
    expect(html).toContain('data-activation="vote"');
    expect(html.match(/aria-pressed="true"/g) ?? []).toHaveLength(0);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(4);
    expect(html).toContain("CAST YOUR VOTE");
  });

  test("assigns a distinct semantic tone to every verdict", () => {
    const html = renderToStaticMarkup(<VerdictActions language="en" />);

    expect(html).toContain('data-verdict-tone="evidence"');
    expect(html).toContain('data-verdict-tone="ready"');
    expect(html).toContain('data-verdict-tone="blocked"');
    expect(html).toContain('data-verdict-tone="rerun"');
    expect(html).not.toContain('data-tone="rerun"');
  });

  test("frames the landing demo as an evidence assessment", () => {
    const html = renderToStaticMarkup(<VerdictActions language="en" />);

    expect(html).toContain(
      "Parallax could not reach a transaction conclusion because required evidence is missing or incomplete.",
    );
    expect(html).toContain(
      "No blocking evidence was found within the checked demo scope. This is not a safety guarantee.",
    );
    expect(html).toContain(
      "Blocking evidence applies to this transaction Intent or path. Review the checked reason before continuing.",
    );
    expect(html).toContain(
      "When a verified transaction adjustment is available, review the evidence and rerun after making that one change.",
    );
  });

  test("uses hover for preview and click for voting", () => {
    let previewed: VerdictZone | null = null;
    let voted: VerdictZone | null = null;
    const handlers = createVerdictInteractionHandlers(
      "northwest",
      (zone) => {
        previewed = zone;
      },
      (zone) => {
        voted = zone;
      },
    );

    handlers.onPointerEnter({ pointerType: "mouse" });
    expect(previewed).toBe("northwest");
    expect(voted).toBeNull();
    expect("onClick" in handlers).toBe(true);
    if ("onClick" in handlers) handlers.onClick();
    expect(voted).toBe("northwest");
  });

  test("moves the same vote when another quadrant is chosen", () => {
    let voted: VerdictZone | null = null;
    const preview = () => {};
    const northwest = createVerdictInteractionHandlers(
      "northwest",
      preview,
      (zone) => {
        voted = zone;
      },
    );
    const northeast = createVerdictInteractionHandlers(
      "northeast",
      preview,
      (zone) => {
        voted = zone;
      },
    );

    northwest.onClick();
    expect(voted).toBe("northwest");
    northeast.onClick();
    expect(voted).toBe("northeast");
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

    expect(html).toContain("需要更多证据");
    expect(html).not.toContain("可以签署");
    expect(html).toContain("PROCEED／演示");
    expect(html).toContain("请勿使用当前交易路径");
    expect(html).toContain("继续之前请先调整");
    expect(html).toContain("一人一票 · 点击改投");
    expect(html).toContain("一人一票");
    expect(html).toContain("由于必要证据缺失或不完整");
    expect(html).toContain("阻断证据适用于当前交易意图或路径");
  });
});
