import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { WalletChecking } from "./WalletChecking";

const render = (mode?: "live" | "replay") =>
  renderToStaticMarkup(<WalletChecking language="en" mode={mode} stage={2} />);

describe("WalletChecking", () => {
  test("labels a live check as live", () => {
    const html = render("live");

    expect(html).toContain("Live backend check");
    expect(html).toContain("Checking this swap before you sign.");
    expect(html).not.toContain("Recorded replay");
  });

  test("never labels a recorded replay as a live check", () => {
    const html = render("replay");

    expect(html).toContain("Recorded replay");
    expect(html).toContain("Loading a recorded check.");
    expect(html).not.toContain("Live backend check");
  });

  test("defaults to live so an unset mode cannot silently claim replay", () => {
    expect(render()).toContain("Live backend check");
  });
});
