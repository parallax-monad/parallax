import type { Copy } from "@/lib/i18n";
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
export const MIN_SLIPPAGE = 0;
export const MAX_SLIPPAGE = 100;

export type FormFieldErrors = Partial<
  Record<"amountIn" | "slippage" | "minimumReceived" | "form", Copy>
>;

export type FormValidation =
  | {
      valid: true;
      values: { amountIn: number; slippage: number; minimumReceived?: number };
    }
  | { valid: false; errors: FormFieldErrors };

function parseFinite(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Shared UI/service validation. No caller is allowed to invent fallback values. */
export function validateForm(form: FormState): FormValidation {
  const errors: FormFieldErrors = {};
  const amountIn = parseFinite(form.amountIn);
  const slippage = parseFinite(form.slippage);
  const minimumReceived = parseFinite(form.minimumReceived);

  if (amountIn === undefined || amountIn <= 0) {
    errors.amountIn = {
      en: "Amount must be a positive number.",
      zh: "输入数量必须是大于 0 的数字。",
    };
  }

  if (
    slippage === undefined ||
    slippage < MIN_SLIPPAGE ||
    slippage > MAX_SLIPPAGE
  ) {
    errors.slippage = {
      en: `Slippage must be a number from ${MIN_SLIPPAGE} to ${MAX_SLIPPAGE}%.`,
      zh: `滑点必须是 ${MIN_SLIPPAGE}% 到 ${MAX_SLIPPAGE}% 之间的数字。`,
    };
  }

  if (
    form.minimumReceived.trim() !== "" &&
    (minimumReceived === undefined || minimumReceived <= 0)
  ) {
    errors.minimumReceived = {
      en: "Minimum received must be a positive number when provided.",
      zh: "填写最低收到量时，必须输入大于 0 的数字。",
    };
  }

  if (
    Object.keys(errors).length > 0 ||
    amountIn === undefined ||
    slippage === undefined
  ) {
    return { valid: false, errors };
  }

  return { valid: true, values: { amountIn, slippage, minimumReceived } };
}

export type LogicalFormChange =
  | "amountIn"
  | "slippage"
  | "minimumReceived"
  | "tokenPair"
  | "protocol";

/** Counts user-editable conditions, not derived quote or verdict differences. */
export function changedLogicalFields(
  previous: FormState,
  current: FormState,
): LogicalFormChange[] {
  const changes: LogicalFormChange[] = [];
  if (previous.amountIn !== current.amountIn) changes.push("amountIn");
  if (previous.slippage !== current.slippage) changes.push("slippage");
  if (previous.minimumReceived !== current.minimumReceived) {
    changes.push("minimumReceived");
  }
  if (
    previous.tokenIn !== current.tokenIn ||
    previous.tokenOut !== current.tokenOut
  ) {
    changes.push("tokenPair");
  }
  if (previous.protocol !== current.protocol) changes.push("protocol");
  return changes;
}

export type SubmissionPlan =
  | { allowed: true; submitted: FormState }
  | { allowed: false; errors: FormFieldErrors };

/**
 * Decides whether the UI may enter the checking screen. Keeping this pure makes
 * the no-scheduler guarantee testable: callers invoke the scheduler only for an
 * allowed plan.
 */
export function planSubmission(
  form: FormState,
  previousSubmitted?: FormState,
  options: { allowUnchanged?: boolean } = {},
): SubmissionPlan {
  const validation = validateForm(form);
  if (!validation.valid) return { allowed: false, errors: validation.errors };

  if (previousSubmitted) {
    const changes = changedLogicalFields(previousSubmitted, form);
    if (
      (changes.length === 0 && !options.allowUnchanged) ||
      changes.length > 1 ||
      changes[0] === "protocol"
    ) {
      return {
        allowed: false,
        errors: {
          form: {
            en: "Change exactly one supported condition before rerunning. The token pair counts as one condition.",
            zh: "重新检查前必须只修改一个支持的条件。代币对视为一个条件。",
          },
        },
      };
    }
  }

  return { allowed: true, submitted: { ...form } };
}

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
