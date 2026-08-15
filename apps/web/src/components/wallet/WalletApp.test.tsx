/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { WalletApp } from "./WalletApp";

vi.mock("./WalletBackground", () => ({
  WalletBackground: () => null,
}));

const RUN_ID = "recovered-run";
const CREATED_AT = "2026-08-15T08:00:00.000Z";

const intent = {
  chainId: 143,
  protocol: "kuru",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: {
    kind: "erc20",
    address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  },
  amountInAtomic: "10000000000000000",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

const recoveredRun = {
  runId: RUN_ID,
  createdAt: CREATED_AT,
  replayMode: false,
  intent,
  status: "completed",
  systemStatus: "OK",
  verdict: "UNKNOWN",
  summary: "Recovered backend result.",
  ruleResults: [],
  recommendedActions: [],
  irrelevantActions: [],
  evidence: [],
  scope: [],
};

describe("WalletApp persisted Run recovery", () => {
  let root: Root | undefined;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.sessionStorage.clear();
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(async () => {
    if (root !== undefined) {
      await act(async () => {
        root?.unmount();
      });
      root = undefined;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
    document.body.innerHTML = "";
  });

  test("restores the persisted result and editable form after mount", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          runId: RUN_ID,
          createdAt: CREATED_AT,
          intent,
          status: "completed",
          result: recoveredRun,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", request);
    window.sessionStorage.setItem("parallax:last-run-id", RUN_ID);

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<WalletApp language="en" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe(`/api/runs/${RUN_ID}`);
    expect(container.textContent).toContain("Before you sign");
    expect(container.textContent).toContain("Live check");

    const reviewInputs = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Review inputs"),
    );
    expect(reviewInputs).toBeDefined();

    await act(async () => {
      reviewInputs?.click();
    });

    const amountInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Amount to pay"]',
    );
    expect(amountInput?.value).toBe("0.01");
  });

  test("does not let late recovery overwrite a new Check", async () => {
    let resolveRecovery: (response: Response) => void = () => undefined;
    const recoveryResponse = new Promise<Response>((resolve) => {
      resolveRecovery = resolve;
    });
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(() => recoveryResponse);
    vi.stubGlobal("fetch", request);
    window.sessionStorage.setItem("parallax:last-run-id", RUN_ID);

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<WalletApp language="en" />);
      await Promise.resolve();
    });

    const swapButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Swap",
    );
    expect(swapButton).toBeDefined();

    await act(async () => {
      swapButton?.click();
    });

    const submitButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
    ).find((button) => button.textContent?.includes("Submit live check"));
    expect(submitButton).toBeDefined();

    await act(async () => {
      submitButton?.click();
    });
    expect(container.textContent).toContain(
      "Checking this swap before you sign.",
    );

    await act(async () => {
      resolveRecovery(
        new Response(
          JSON.stringify({
            runId: RUN_ID,
            createdAt: CREATED_AT,
            intent,
            status: "completed",
            result: recoveredRun,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "Checking this swap before you sign.",
    );
    expect(container.textContent).not.toContain("Before you sign");
  });
});
