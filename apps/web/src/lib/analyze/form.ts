import type { CheckSwapInput, Protocol } from "./types";

/**
 * The swap intent as the UI holds it. Kept out of any screen component so the
 * wallet flow and the check service share one contract.
 */
export type FormState = {
  protocol: Protocol;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage: string;
  minimumReceived: string;
};

/** The demo picks route and slippage, so the swap sheet stays wallet-like. */
export const DEMO_PROTOCOL: Protocol = "kuru";
export const DEMO_SLIPPAGE = "0.5";

export const INITIAL_FORM: FormState = {
  protocol: DEMO_PROTOCOL,
  tokenIn: "MON",
  tokenOut: "USDC",
  amountIn: "1200",
  slippage: DEMO_SLIPPAGE,
  minimumReceived: "",
};

export function toInput(form: FormState, parentRunId?: string): CheckSwapInput {
  return {
    parentRunId,
    protocol: form.protocol,
    tokenIn: form.tokenIn,
    tokenOut: form.tokenOut,
    amountIn: form.amountIn,
    slippage: form.slippage,
    minimumReceived: form.minimumReceived || undefined,
    minimumReceivedSource: form.minimumReceived
      ? "user_declared"
      : "unavailable",
  };
}
