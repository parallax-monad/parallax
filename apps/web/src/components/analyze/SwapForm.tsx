import type { ReactNode } from "react";
import { TokenIcon } from "@/components/analyze/TokenIcon";
import type { FieldFlag, FormFieldKey } from "@/lib/analyze/fields";
import {
  SUPPORTED_PROTOCOLS,
  SUPPORTED_TOKENS_IN,
  SUPPORTED_TOKENS_OUT,
} from "@/lib/analyze/fixtures";
import type { CheckSwapInput, Protocol } from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

export type FormState = {
  protocol: Protocol;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage: string;
  minimumReceived: string;
};

export const INITIAL_FORM: FormState = {
  protocol: "kuru",
  tokenIn: "MON",
  tokenOut: "USDC",
  amountIn: "1200",
  slippage: "0.5",
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

const LABELS: Record<FormFieldKey, Copy> = {
  protocol: { en: "Protocol", zh: "协议" },
  tokenIn: { en: "Token in", zh: "输入代币" },
  tokenOut: { en: "Token out", zh: "输出代币" },
  amountIn: { en: "Amount in", zh: "输入数量" },
  slippage: { en: "Slippage %", zh: "滑点 %" },
  minimumReceived: {
    en: "Minimum received (optional)",
    zh: "最低收到量（选填）",
  },
};

const toOptions = (values: readonly string[]) =>
  values.map((value) => ({ value, label: value }));

const FLAG_HINT: Copy = { en: "Change this", zh: "改这里" };

/** A locked input can still be the cause, so it says so without inviting a fix. */
const LOCKED_CAUSE_HINT: Copy = {
  en: "This is the cause, but it cannot be changed here",
  zh: "这是原因，但这里改不了",
};

/**
 * Why a specific input is flagged. Rendered under the control and wired to it
 * through aria-describedby, so the reason is not conveyed by the red border
 * alone.
 */
function FlagNote({
  id,
  language,
  reason,
  editable,
}: {
  id: string;
  language: Language;
  reason: Copy;
  editable: boolean;
}) {
  return (
    <span
      className={`mt-2 flex items-start gap-1.5 text-[13px] font-normal normal-case leading-[1.5] tracking-normal ${
        editable ? "text-risk-high" : "text-risk-elevated"
      }`}
      id={id}
    >
      <strong className="shrink-0 font-bold uppercase tracking-[0.06em]">
        {say(language, editable ? FLAG_HINT : LOCKED_CAUSE_HINT)}
      </strong>
      <span className="text-dim">{say(language, reason)}</span>
    </span>
  );
}

/**
 * Shared border treatment. An actionable input goes red; a locked cause goes
 * amber, matching the UNKNOWN/elevated tone used elsewhere, so red always means
 * "you can fix this here".
 */
const flagBorder = (flag?: FieldFlag) => {
  if (!flag) return "border-line-strong";
  return flag.editable ? "border-risk-high" : "border-risk-elevated";
};

/**
 * Renders a select only when there is a real choice to make. With a single
 * supported value a dropdown implies options that do not exist, so the value is
 * shown as a locked field instead.
 */
function ChoiceField({
  name,
  label,
  language,
  options,
  value,
  onSelect,
  icon,
  flag,
}: {
  name: FormFieldKey;
  label: Copy;
  language: Language;
  options: readonly { value: string; label: string }[];
  value: string;
  onSelect: (value: string) => void;
  icon?: ReactNode;
  flag?: FieldFlag;
}) {
  const current = options.find((option) => option.value === value);
  const noteId = `${name}-flag`;

  if (options.length <= 1) {
    return (
      <div>
        <span className="field-caption">{say(language, label)}</span>
        <div className={`field-control gap-2 ${flagBorder(flag)}`}>
          {icon}
          <span className="text-[15px] font-bold text-white">
            {current?.label ?? value}
          </span>
        </div>
        {flag && (
          <FlagNote
            editable={flag.editable}
            id={noteId}
            language={language}
            reason={flag.reason}
          />
        )}
      </div>
    );
  }

  return (
    <label>
      <span>{say(language, label)}</span>
      <select
        aria-describedby={flag ? noteId : undefined}
        aria-invalid={flag ? true : undefined}
        className={flagBorder(flag)}
        value={value}
        onChange={(event) => onSelect(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {flag && (
        <FlagNote
          editable={flag.editable}
          id={noteId}
          language={language}
          reason={flag.reason}
        />
      )}
    </label>
  );
}

/** A free-text numeric input, flagged the same way as a select. */
function NumberField({
  name,
  label,
  language,
  value,
  onInput,
  placeholder,
  flag,
}: {
  name: FormFieldKey;
  label: Copy;
  language: Language;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  flag?: FieldFlag;
}) {
  const noteId = `${name}-flag`;

  return (
    <label>
      <span>{say(language, label)}</span>
      <input
        aria-describedby={flag ? noteId : undefined}
        aria-invalid={flag ? true : undefined}
        className={flagBorder(flag)}
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onInput(event.target.value)}
      />
      {flag && (
        <FlagNote
          editable={flag.editable}
          id={noteId}
          language={language}
          reason={flag.reason}
        />
      )}
    </label>
  );
}

export function SwapForm({
  form,
  language,
  pending,
  flags = [],
  onChange,
  onSubmit,
}: {
  form: FormState;
  language: Language;
  pending: boolean;
  /** Inputs the last run said are worth changing. Empty before the first run. */
  flags?: FieldFlag[];
  onChange: (form: FormState) => void;
  onSubmit: () => void;
}) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    onChange({ ...form, [key]: value });

  const flagFor = (key: FormFieldKey) =>
    flags.find((flag) => flag.field === key);

  const names = (list: FieldFlag[]) =>
    list.map((flag) => say(language, LABELS[flag.field])).join(" · ");

  const editableFlags = flags.filter((flag) => flag.editable);
  const lockedFlags = flags.filter((flag) => !flag.editable);

  return (
    <form
      className="card field"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <span className="eyebrow">
        {say(language, { en: "Swap intent", zh: "交易意图" })}
      </span>
      <h2 className="m-0 mb-1.5 text-[20px] font-extrabold tracking-[-0.03em]">
        {say(language, {
          en: "Describe the swap you are about to sign.",
          zh: "描述你即将签名的交易。",
        })}
      </h2>
      <p className="mb-6 text-[14px] leading-[1.6] text-dim">
        {say(language, {
          en: "Nothing is signed or broadcast. This runs a pre-sign check only.",
          zh: "不会签名，也不会广播。这里只做签名前检查。",
        })}
      </p>

      {editableFlags.length > 0 && (
        <div
          className="mb-5 border border-risk-high/60 bg-risk-high/5 px-3 py-2.5"
          role="status"
        >
          <strong className="block text-[13px] font-bold uppercase tracking-[0.08em] text-risk-high">
            {say(language, {
              en: "Inputs to change",
              zh: "需要修改的输入",
            })}
          </strong>
          <p className="m-0 mt-1.5 text-[15px] font-bold normal-case tracking-normal text-white">
            {names(editableFlags)}
          </p>
        </div>
      )}

      {lockedFlags.length > 0 && (
        <div
          className="mb-5 border border-risk-elevated/60 bg-risk-elevated/5 px-3 py-2.5"
          role="status"
        >
          <strong className="block text-[13px] font-bold uppercase tracking-[0.08em] text-risk-elevated">
            {say(language, {
              en: "Cause is outside what you can change",
              zh: "原因不在你能修改的范围内",
            })}
          </strong>
          <p className="m-0 mt-1.5 text-[15px] font-bold normal-case tracking-normal text-white">
            {names(lockedFlags)}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ChoiceField
          flag={flagFor("protocol")}
          label={LABELS.protocol}
          language={language}
          name="protocol"
          options={SUPPORTED_PROTOCOLS}
          value={form.protocol}
          onSelect={(value) => set("protocol", value as Protocol)}
        />

        <NumberField
          flag={flagFor("amountIn")}
          label={LABELS.amountIn}
          language={language}
          name="amountIn"
          value={form.amountIn}
          onInput={(value) => set("amountIn", value)}
        />

        <ChoiceField
          flag={flagFor("tokenIn")}
          icon={<TokenIcon symbol={form.tokenIn} />}
          label={LABELS.tokenIn}
          language={language}
          name="tokenIn"
          options={toOptions(SUPPORTED_TOKENS_IN)}
          value={form.tokenIn}
          onSelect={(value) => set("tokenIn", value)}
        />

        <ChoiceField
          flag={flagFor("tokenOut")}
          icon={<TokenIcon symbol={form.tokenOut} />}
          label={LABELS.tokenOut}
          language={language}
          name="tokenOut"
          options={toOptions(SUPPORTED_TOKENS_OUT)}
          value={form.tokenOut}
          onSelect={(value) => set("tokenOut", value)}
        />

        <NumberField
          flag={flagFor("slippage")}
          label={LABELS.slippage}
          language={language}
          name="slippage"
          value={form.slippage}
          onInput={(value) => set("slippage", value)}
        />

        <NumberField
          flag={flagFor("minimumReceived")}
          label={LABELS.minimumReceived}
          language={language}
          name="minimumReceived"
          placeholder={say(language, {
            en: "Your accepted boundary",
            zh: "你接受的边界",
          })}
          value={form.minimumReceived}
          onInput={(value) => set("minimumReceived", value)}
        />
      </div>

      <button
        type="submit"
        className="btn btn-primary mt-6"
        disabled={pending}
        aria-busy={pending}
      >
        {pending
          ? say(language, { en: "Checking…", zh: "检查中…" })
          : say(language, { en: "Check before signing", zh: "签名前检查" })}
      </button>
    </form>
  );
}
