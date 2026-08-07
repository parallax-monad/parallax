import { useState } from "react";
import { TokenIcon } from "@/components/analyze/TokenIcon";
import { ChevronDownIcon, SwapIcon } from "@/components/wallet/WalletIcons";
import {
  balanceOf,
  DEMO_RECIPIENT,
  formatAmount,
} from "@/components/wallet/walletData";
import type { FieldFlag } from "@/lib/analyze/fields";
import {
  SUPPORTED_TOKENS_IN,
  SUPPORTED_TOKENS_OUT,
} from "@/lib/analyze/fixtures";
import type { FormFieldErrors, FormState } from "@/lib/analyze/form";
import { type Language, say } from "@/lib/i18n";

/** A token side of the swap. Locked when the fixture set offers one option. */
function TokenSelect({
  language,
  options,
  value,
  onSelect,
}: {
  language: Language;
  options: readonly string[];
  value: string;
  onSelect: (value: string) => void;
}) {
  if (options.length <= 1) {
    return (
      <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line-strong bg-ink-elev2 px-3 py-2">
        <TokenIcon size={22} symbol={value} />
        <span className="text-[15px] font-bold">{value}</span>
      </span>
    );
  }

  return (
    <span className="relative inline-flex shrink-0 items-center gap-2 rounded-full border border-line-strong bg-ink-elev2 px-3 py-2">
      <TokenIcon size={22} symbol={value} />
      <span className="text-[15px] font-bold">{value}</span>
      <ChevronDownIcon className="text-dim" size={16} />
      <select
        aria-label={say(language, { en: "Token", zh: "代币" })}
        className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 text-transparent opacity-0"
        value={value}
        onChange={(event) => onSelect(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * The reason the last run gave for this input, shown inline in the swap sheet so
 * the user does not have to remember the result screen to act on it.
 */
function FlagNote({ flag, language }: { flag: FieldFlag; language: Language }) {
  return (
    <p
      className={`mt-2 text-[13px] leading-[1.5] ${flag.editable ? "text-risk-high" : "text-risk-elevated"}`}
    >
      {say(language, flag.reason)}
    </p>
  );
}

export function WalletSwap({
  form,
  language,
  errors = {},
  flags = [],
  onChange,
  onSubmit,
  onReplay,
}: {
  form: FormState;
  language: Language;
  errors?: FormFieldErrors;
  /** Inputs the last run said are worth changing. Empty before the first run. */
  flags?: FieldFlag[];
  onChange: (form: FormState) => void;
  onSubmit: () => void;
  onReplay: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    onChange({ ...form, [key]: value });

  const flagFor = (key: FieldFlag["field"]) =>
    flags.find((flag) => flag.field === key);

  const balance = balanceOf(form.tokenIn);
  const estimate = undefined;
  const amountFlag = flagFor("amountIn");
  const amountError = errors.amountIn;
  const slippageError = errors.slippage;
  const minimumReceivedError = errors.minimumReceived;

  return (
    <form
      className="field flex flex-col gap-3 px-5 pb-6 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <section className="border border-line bg-ink-rail p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
            {say(language, { en: "You pay", zh: "你支付" })}
          </span>
          <span className="text-[12px] text-dim">
            {say(language, { en: "Balance", zh: "余额" })}{" "}
            {formatAmount(balance)}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input
            aria-describedby={
              amountError
                ? "swap-amount-error"
                : amountFlag
                  ? "swap-amount-flag"
                  : undefined
            }
            aria-invalid={amountError || amountFlag ? true : undefined}
            aria-label={say(language, { en: "Amount to pay", zh: "支付数量" })}
            className={`min-w-0 flex-1 border-0 bg-transparent px-0 text-[30px] font-extrabold tracking-[-0.04em] hover:border-0 ${
              amountError || amountFlag ? "text-risk-high" : "text-white"
            }`}
            inputMode="decimal"
            placeholder="0"
            value={form.amountIn}
            onChange={(event) => set("amountIn", event.target.value)}
          />
          <TokenSelect
            language={language}
            options={SUPPORTED_TOKENS_IN}
            value={form.tokenIn}
            onSelect={(value) => set("tokenIn", value)}
          />
        </div>
        <button
          type="button"
          className="mt-1 text-[12px] font-bold uppercase tracking-[0.08em] text-monad-dim"
          onClick={() => set("amountIn", String(balance))}
        >
          {say(language, { en: "Use max", zh: "使用全部" })}
        </button>
        {amountError && (
          <p
            id="swap-amount-error"
            className="mt-2 text-[13px] leading-[1.5] text-risk-high"
          >
            {say(language, amountError)}
          </p>
        )}
        {!amountError && amountFlag && (
          <span id="swap-amount-flag">
            <FlagNote flag={amountFlag} language={language} />
          </span>
        )}
      </section>

      <div aria-hidden="true" className="flex justify-center">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line-strong bg-ink-elev2 text-monad-dim">
          <SwapIcon size={18} />
        </span>
      </div>

      <section className="border border-line bg-ink-rail p-4">
        <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
          {say(language, { en: "You receive (est.)", zh: "你收到（预估）" })}
        </span>
        <div className="mt-3 flex items-center gap-3">
          <strong
            className={`min-w-0 flex-1 truncate text-[30px] font-extrabold tracking-[-0.04em] ${
              estimate === undefined ? "text-faint" : "text-white"
            }`}
          >
            {estimate === undefined
              ? say(language, { en: "No quote", zh: "无报价" })
              : formatAmount(estimate)}
          </strong>
          <TokenSelect
            language={language}
            options={SUPPORTED_TOKENS_OUT}
            value={form.tokenOut}
            onSelect={(value) => set("tokenOut", value)}
          />
        </div>
        <p className="mt-2 text-[12px] leading-[1.5] text-dim">
          {say(language, {
            en: "The live backend response supplies the quote after submission. No local quote is invented.",
            zh: "提交后由实时后端响应提供报价。前端不会编造本地报价。",
          })}
        </p>
      </section>

      <section className="border border-line bg-ink-rail">
        <button
          type="button"
          aria-expanded={advancedOpen}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-dim">
            {say(language, { en: "Advanced", zh: "高级设置" })}
          </span>
          <ChevronDownIcon
            className={`text-dim transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            size={18}
          />
        </button>

        {advancedOpen && (
          <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
            <label>
              <span>{say(language, { en: "Slippage %", zh: "滑点 %" })}</span>
              <input
                aria-describedby={
                  slippageError ? "swap-slippage-error" : undefined
                }
                aria-invalid={
                  slippageError || flagFor("slippage") ? true : undefined
                }
                className={
                  slippageError || flagFor("slippage")
                    ? "border-risk-high"
                    : "border-line-strong"
                }
                inputMode="decimal"
                value={form.slippage}
                onChange={(event) => set("slippage", event.target.value)}
              />
              {slippageError ? (
                <p
                  id="swap-slippage-error"
                  className="mt-2 text-[13px] leading-[1.5] text-risk-high"
                >
                  {say(language, slippageError)}
                </p>
              ) : (
                flagFor("slippage") && (
                  <FlagNote
                    flag={flagFor("slippage") as FieldFlag}
                    language={language}
                  />
                )
              )}
            </label>

            <label>
              <span>
                {say(language, {
                  en: "Minimum received (optional)",
                  zh: "最低收到量（选填）",
                })}
              </span>
              <input
                aria-describedby={
                  minimumReceivedError
                    ? "swap-minimum-received-error"
                    : undefined
                }
                aria-invalid={
                  minimumReceivedError || flagFor("minimumReceived")
                    ? true
                    : undefined
                }
                className={
                  minimumReceivedError || flagFor("minimumReceived")
                    ? "border-risk-high"
                    : "border-line-strong"
                }
                inputMode="decimal"
                placeholder={say(language, {
                  en: "Your accepted boundary",
                  zh: "你接受的边界",
                })}
                value={form.minimumReceived}
                onChange={(event) => set("minimumReceived", event.target.value)}
              />
              {minimumReceivedError ? (
                <p
                  id="swap-minimum-received-error"
                  className="mt-2 text-[13px] leading-[1.5] text-risk-high"
                >
                  {say(language, minimumReceivedError)}
                </p>
              ) : (
                flagFor("minimumReceived") && (
                  <FlagNote
                    flag={flagFor("minimumReceived") as FieldFlag}
                    language={language}
                  />
                )
              )}
            </label>

            <div className="field-row">
              <span className="field-caption">
                {say(language, { en: "Recipient", zh: "接收地址" })}
              </span>
              <span className="field-control mono text-dim">
                {DEMO_RECIPIENT}
              </span>
            </div>

            <div className="field-row">
              <span className="field-caption">
                {say(language, { en: "Route", zh: "路径" })}
              </span>
              <span className="field-control text-white">
                {say(language, {
                  en: "Kuru (live API)",
                  zh: "Kuru（实时 API）",
                })}
              </span>
              {flagFor("protocol") && (
                <FlagNote
                  flag={flagFor("protocol") as FieldFlag}
                  language={language}
                />
              )}
            </div>
          </div>
        )}
      </section>

      {errors.form && (
        <p
          role="alert"
          className="border border-risk-high/50 bg-risk-high/10 px-3 py-2.5 text-[13px] leading-[1.5] text-risk-high"
        >
          {say(language, errors.form)}
        </p>
      )}

      <button type="submit" className="btn btn-monad mt-1 w-full">
        {say(language, {
          en: "Submit live check",
          zh: "提交实时检查",
        })}
      </button>
      <button
        type="button"
        className="btn btn-monad-outline mt-2 w-full"
        onClick={onReplay}
      >
        {say(language, {
          en: "Load recorded replay",
          zh: "载入录制回放",
        })}
      </button>
      <p className="text-center text-[12px] leading-[1.5] text-dim">
        {say(language, {
          en: "Parallax runs a pre-sign check. No signing, no broadcasting.",
          zh: "Parallax 只做签名前检查。不签名，不广播。",
        })}
      </p>
    </form>
  );
}
