import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AppRouteSurface } from "./App";

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
  });
});
