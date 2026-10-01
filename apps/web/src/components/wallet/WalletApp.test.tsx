/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { WalletApp } from "./WalletApp";

vi.mock("./WalletBackground", () => ({
  WalletBackground: () => null,
}));

vi.mock("./WalletIntro", () => ({
  WalletIntro: ({ onComplete }: { onComplete: () => void }) => {
    onComplete();
    return null;
  },
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
  tokenMetadata: [
    {
      chainId: 143,
      asset: { kind: "native" },
      symbol: "MON",
      decimals: 18,
      decimalsSource: "chain_config",
    },
    {
      chainId: 143,
      asset: {
        kind: "erc20",
        address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
      },
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified",
      verifiedAtBlock: "92820000",
    },
  ],
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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

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
      (button) => button.textContent?.includes("Review swap inputs"),
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

  test("opens the real Arbitrum P0 swap path from wallet home", async () => {
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

    expect(container.textContent).toContain(
      "Arbitrum Sepolia · Camelot V3 · ETH → USDC",
    );
    expect(container.textContent).not.toContain("ADJUST");
    expect(container.textContent).not.toContain("Load recorded replay");
  });

  test("rejects quote after user edits the input during debounce window", async () => {
    let quoteRequestCount = 0;
    const request = vi.fn<typeof fetch>().mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/quote")) {
        quoteRequestCount += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "available",
              quote: {
                source: "quote",
                estimatedAmountOut: "1500000",
                minimumAmountOut: "1485000",
                blockNumber: "12345",
                fetchedAt: "2026-01-01T00:00:00.000Z",
                runtimeVersion: "arbitrum-camelot-v3",
                runtimeRevision: "native-rpc",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    });
    vi.stubGlobal("fetch", request);

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

    const amountInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Amount to pay"]',
    );
    expect(amountInput).toBeDefined();
    const inputElement = amountInput as HTMLInputElement;

    await act(async () => {
      setInputValue(inputElement, "0.02");
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 550));
    });

    expect(quoteRequestCount).toBe(1);

    await act(async () => {
      setInputValue(inputElement, "0.03");
      await Promise.resolve();
    });

    const submitButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
    ).find((button) => button.textContent?.includes("Submit live check"));
    expect(submitButton).toBeDefined();

    const checkRequest = vi.fn<typeof fetch>().mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/check")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              runId: "test-run",
              createdAt: "2026-01-01T00:00:00.000Z",
              intent: {
                chainId: 421614,
                protocol: "camelot-v3",
                sender: "0x1111111111111111111111111111111111111111",
                recipient: "0x1111111111111111111111111111111111111111",
                recipientSource: "defaulted_from_sender",
                tokenIn: { kind: "native" },
                tokenOut: {
                  kind: "erc20",
                  address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
                },
                amountInAtomic: "30000000000000000",
                economicBoundary: {
                  availability: "unavailable",
                  source: "unavailable",
                },
              },
              status: "completed",
              result: recoveredRun,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (typeof url === "string" && url.includes("/api/quote")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "available",
              quote: {
                source: "quote",
                estimatedAmountOut: "1500000",
                minimumAmountOut: "1485000",
                blockNumber: "12345",
                fetchedAt: "2026-01-01T00:00:00.000Z",
                runtimeVersion: "arbitrum-camelot-v3",
                runtimeRevision: "native-rpc",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    });
    vi.stubGlobal("fetch", checkRequest);

    await act(async () => {
      submitButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2300));
    });

    const checkCalls = checkRequest.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("/api/check"),
    );
    const checkPayload = checkCalls[0]?.[1];
    const checkBody = checkPayload
      ? JSON.parse(checkPayload.body as string)
      : undefined;

    expect(checkCalls).toHaveLength(1);
    expect(checkBody?.amountIn).toBe("0.03");
    expect(checkBody?.expectationBaseline).toBeUndefined();
  });

  test("does not expose fixture-only remediation controls in the active P0 path", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<WalletApp language="en" />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "This demo checks a supported swap intent before signing",
    );
    expect(container.textContent).not.toContain("Your quote has changed");
    expect(container.textContent).not.toContain("View verified options");
    expect(container.textContent).not.toContain("Load recorded replay");
  });
});
