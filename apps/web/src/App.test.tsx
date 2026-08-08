import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AppRouteSurface, prepareAnalyzeNavigation } from "./App";

describe("AppRouteSurface", () => {
  test("keeps a dark viewport surface mounted around route content", () => {
    const html = renderToStaticMarkup(
      <AppRouteSurface>
        <span>route content</span>
      </AppRouteSurface>,
    );

    expect(html).toContain('data-app-route-surface=""');
    expect(html).toContain("min-h-[100dvh]");
    expect(html).toContain("bg-[#05050a]");
    expect(html).toContain("route content");
    expect(html).toContain("route-transition-shield");
  });

  test("prepares only same-tab primary-button demo navigation", () => {
    const dataset: Record<string, string> = {};
    vi.stubGlobal("document", { documentElement: { dataset } });
    const click = {
      altKey: false,
      button: 0,
      ctrlKey: false,
      defaultPrevented: false,
      metaKey: false,
      shiftKey: false,
    };

    try {
      prepareAnalyzeNavigation(click);
      expect(dataset.routeTransition).toBe("analyze");

      delete dataset.routeTransition;
      prepareAnalyzeNavigation({ ...click, metaKey: true });
      expect(dataset.routeTransition).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
