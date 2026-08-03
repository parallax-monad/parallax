import type { Copy } from "@/lib/i18n";
import {
  SUPPORTED_PROTOCOLS,
  SUPPORTED_TOKENS_IN,
  SUPPORTED_TOKENS_OUT,
} from "./fixtures";
import type { AdjustableField, CheckSwapResult } from "./types";

/** Keys the swap form actually renders. */
export type FormFieldKey =
  | "protocol"
  | "tokenIn"
  | "tokenOut"
  | "amountIn"
  | "slippage"
  | "minimumReceived";

/**
 * Rules speak in adjustable fields; the form speaks in inputs. `tokenPair` is
 * the only one that spans two inputs, so the mapping is not one-to-one.
 */
const FIELD_TARGETS: Record<AdjustableField, FormFieldKey[]> = {
  amountIn: ["amountIn"],
  tokenPair: ["tokenIn", "tokenOut"],
  protocol: ["protocol"],
  slippage: ["slippage"],
  minimumReceived: ["minimumReceived"],
};

/** A field the user can still change is worth flagging; a locked one is not. */
export function isFieldEditable(key: FormFieldKey): boolean {
  if (key === "protocol") return SUPPORTED_PROTOCOLS.length > 1;
  if (key === "tokenIn") return SUPPORTED_TOKENS_IN.length > 1;
  if (key === "tokenOut") return SUPPORTED_TOKENS_OUT.length > 1;
  return true;
}

export type FieldFlag = {
  field: FormFieldKey;
  reason: Copy;
  /** False when P0 locks the input, so the form explains instead of inviting a fix. */
  editable: boolean;
};

/**
 * Turns the run's recommended actions into per-input flags. Locked inputs are
 * still returned but marked non-editable, so a STOP caused by protocol or pair
 * is explained rather than silently dropped. Irrelevant actions are excluded:
 * marking them would contradict "changing this will not help" (PRD 12).
 */
export function flaggedFields(result: CheckSwapResult): FieldFlag[] {
  const seen = new Map<FormFieldKey, Copy>();

  for (const suggestion of result.recommendedActions) {
    for (const key of FIELD_TARGETS[suggestion.field]) {
      if (seen.has(key)) continue;
      seen.set(key, suggestion.reason);
    }
  }

  return [...seen].map(([field, reason]) => ({
    field,
    reason,
    editable: isFieldEditable(field),
  }));
}
