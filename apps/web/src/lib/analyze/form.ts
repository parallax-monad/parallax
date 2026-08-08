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

const PLAIN_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function parseFinite(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePlainDecimal(value: string): number | undefined {
  return PLAIN_DECIMAL.test(value) ? parseFinite(value) : undefined;
}

/** Shared UI/service validation. No caller is allowed to invent fallback values. */
export function validateForm(form: FormState): FormValidation {
  const errors: FormFieldErrors = {};
  const amountIn = parsePlainDecimal(form.amountIn);
  const slippage = parseFinite(form.slippage);
  const minimumReceived = parsePlainDecimal(form.minimumReceived);

  if (form.amountIn === "") {
    errors.amountIn = {
      en: "Amount must be greater than 0.",
      zh: "输入数量必须大于 0。",
    };
  } else if (!PLAIN_DECIMAL.test(form.amountIn)) {
    errors.amountIn = {
      en: "Use a plain decimal such as 0.01 (no spaces, commas, or scientific notation).",
      zh: "请输入 0.01 这类普通小数（不要使用空格、逗号或科学记数法）。",
    };
  } else if (amountIn === undefined || amountIn <= 0) {
    errors.amountIn = {
      en: "Amount must be greater than 0.",
      zh: "输入数量必须大于 0。",
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

  if (form.minimumReceived !== "") {
    if (!PLAIN_DECIMAL.test(form.minimumReceived)) {
      errors.minimumReceived = {
        en: "Use a plain decimal such as 0.0003 (include the leading 0; no spaces, commas, or scientific notation).",
        zh: "请输入 0.0003 这类普通小数（必须包含前导 0；不要使用空格、逗号或科学记数法）。",
      };
    } else if (minimumReceived === undefined || minimumReceived <= 0) {
      errors.minimumReceived = {
        en: "Minimum received must be greater than 0 when provided.",
        zh: "填写最低收到量时，必须大于 0。",
      };
    }
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
    if (
      previousSubmitted.amountIn === form.amountIn &&
      previousSubmitted.minimumReceived === form.minimumReceived &&
      previousSubmitted.tokenIn === form.tokenIn &&
      previousSubmitted.tokenOut === form.tokenOut &&
      previousSubmitted.protocol === form.protocol &&
      previousSubmitted.slippage !== form.slippage
    ) {
      return {
        allowed: false,
        errors: {
          form: {
            en: "Slippage is not part of the /api/check contract. Change one supported intent condition instead.",
            zh: "滑点不属于 /api/check 契约。请改动一个受支持的意图条件。",
          },
        },
      };
    }

    const changes = changedLogicalFields(previousSubmitted, form);

    if (changes.includes("minimumReceived")) {
      return {
        allowed: false,
        errors: {
          minimumReceived: {
            en: "A Re-run must keep the original Minimum Received. Change another supported condition, or discard this result and start a new swap to set a different boundary.",
            zh: "重新检查必须保留原本的最低收到量。请修改其他受支持的条件；如要更改此边界，请放弃本次结果并开始新的兑换。",
          },
        },
      };
    }

    if (
      (changes.length === 0 && !options.allowUnchanged) ||
      changes.length > 1 ||
      changes[0] === "protocol"
    ) {
      return {
        allowed: false,
        errors: {
          form: {
            en: "Change exactly one backend-supported condition before rerunning. Slippage is not part of the /api/check contract.",
            zh: "请至少修改一个条件。",
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
  amountIn: "0.01",
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
