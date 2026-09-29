/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { INITIAL_FORM } from "@/lib/analyze/form";
import type { AccountStateState, AccountStateView } from "@/lib/analyze/types";
import { WalletSwap } from "./WalletSwap";

const blockHash = `0x${"a".repeat(64)}`;
const observedAt = "2026-10-01T00:00:03.000Z";

/** The real qualified sender balance recorded by the #103 USDC -> WETH capture. */
const TRUSTED_USDC_ATOMIC = "87898181500507860645523021";
/** The same amount as an exact 18-decimal string, never routed through a Number. */
const TRUSTED_USDC_EXACT = "87898181.500507860645523021";
/** The historical demo-wallet USDC balance that must never appear here. */
const DEMO_USDC_BALANCE = 500;

function accountView(
  inputToken: AccountStateView["inputToken"],
): AccountStateView {
  return {
    status: "AVAILABLE",
    decimalsBySymbol: { USDC: 18, WETH: 18 },
    inputToken,
    outputToken: {
      status: "AVAILABLE",
      symbol: "WETH",
      decimals: 18,
      decimalsSource: "onchain_verified",
      amountAtomic: "0",
    },
    allowance: {
      status: "SUFFICIENT",
      allowanceAtomic:
        "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      requiredAmountAtomic: "1000000000000000",
      spender: {
        status: "QUALIFIED",
        address: "0x171b925c51565f5d2a7d8c494ba3188d304efd93",
        qualificationRef:
          "be-103:usdc-weth-camelot-2026-09-29T10-09-52-993Z#evaluation.callTrace.actualSpender",
      },
      blockNumber: "313622358",
    },
    block: {
      status: "VERIFIED",
      chainId: 421614,
      blockNumber: "313622358",
      blockHash,
      observedAt,
    },
  };
}

const availableAccountState = (): AccountStateState => ({
  status: "available",
  view: accountView({
    status: "AVAILABLE",
    symbol: "USDC",
    decimals: 18,
    decimalsSource: "onchain_verified",
    amountAtomic: TRUSTED_USDC_ATOMIC,
  }),
});

/** The real Arbitrum/Camelot reverse path. */
const reverseForm = {
  ...INITIAL_FORM,
  protocol: "camelot-v3" as const,
  tokenIn: "USDC",
  tokenOut: "WETH",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
});

function renderSwap(
  accountState: AccountStateState | undefined,
  onChange: (form: typeof reverseForm) => void = () => undefined,
) {
  act(() => {
    root.render(
      <WalletSwap
        form={reverseForm}
        language="en"
        accountState={accountState}
        onChange={onChange as never}
        onSubmit={() => undefined}
        onReplay={() => undefined}
      />,
    );
  });
}

function balanceLine(): string {
  const span = [...container.querySelectorAll("span")].find((node) =>
    node.textContent?.startsWith("Balance"),
  );
  return span?.textContent ?? "";
}

function useMaxButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Use max"),
  );
}

describe("WalletSwap real Arbitrum/Camelot balance source", () => {
  test("shows only the trusted account-state balance, never the demo wallet table", () => {
    renderSwap(availableAccountState());

    // The exact 18-decimal balance, not a rounded Number and not the 500 mock.
    expect(balanceLine()).toBe(`Balance ${TRUSTED_USDC_EXACT}`);
    expect(balanceLine()).not.toBe(`Balance ${DEMO_USDC_BALANCE}`);
    // The demo table's formatted balance must not appear anywhere on the pay side.
    expect(container.textContent).not.toContain(`Balance ${DEMO_USDC_BALANCE}`);
  });

  test("Use max writes the exact trusted decimal balance", () => {
    const onChange = vi.fn();
    renderSwap(availableAccountState(), onChange);

    const button = useMaxButton();
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(false);
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      tokenIn: "USDC",
      tokenOut: "WETH",
      amountIn: TRUSTED_USDC_EXACT,
    });
    // Never the demo balance.
    expect(onChange.mock.calls[0]?.[0]?.amountIn).not.toBe(
      String(DEMO_USDC_BALANCE),
    );
  });

  test("an unavailable account state shows unknown and disables Use max", () => {
    renderSwap({ status: "unavailable", reason: "REQUEST_FAILED" });

    expect(balanceLine()).toContain("unknown");
    expect(balanceLine()).not.toContain(String(DEMO_USDC_BALANCE));
    expect(useMaxButton()?.disabled).toBe(true);
  });

  test("a loading account state shows unknown and disables Use max", () => {
    renderSwap({ status: "loading" });

    expect(balanceLine()).toContain("unknown");
    expect(useMaxButton()?.disabled).toBe(true);
  });

  test("a zero trusted balance leaves Use max disabled", () => {
    renderSwap({
      status: "available",
      view: accountView({
        status: "AVAILABLE",
        symbol: "USDC",
        decimals: 18,
        decimalsSource: "onchain_verified",
        amountAtomic: "0",
      }),
    });

    expect(balanceLine()).toContain("0");
    expect(useMaxButton()?.disabled).toBe(true);
  });

  test("missing trusted decimals show unknown and disable Use max", () => {
    renderSwap({
      status: "available",
      view: accountView({
        status: "AVAILABLE",
        symbol: "USDC",
        decimalsSource: "onchain_verified",
        amountAtomic: TRUSTED_USDC_ATOMIC,
      }),
    });

    // Without a trusted scale the human balance is unknown here; the raw atomic
    // value is still surfaced by the checked-balance line below.
    expect(balanceLine()).toContain("unknown");
    expect(useMaxButton()?.disabled).toBe(true);
  });
});
