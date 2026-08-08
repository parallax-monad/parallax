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
import type { QuoteState } from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

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

/**
 * Why the backend has no publishable Quote. These are product states from the
 * closed `reason` set, not errors, so they never block submitting a Check.
 */
const QUOTE_UNAVAILABLE_REASON: Record<"NO_ROUTE" | "QUOTE_UNAVAILABLE", Copy> =
  {
    NO_ROUTE: {
      en: "The backend found no route for this pair and amount, so it published no quote.",
      zh: "后端未找到此代币对与数量的路径，因此没有报价。",
    },
    QUOTE_UNAVAILABLE: {
      en: "The backend could not produce a quote for this amount right now.",
      zh: "后端目前无法为该数量生成报价。",
    },
  };

export function WalletSwap({
  form,
  language,
  errors = {},
  flags = [],
  quote = { status: "idle" },
  onChange,
  onSubmit,
  onReplay,
}: {
  form: FormState;
  language: Language;
  errors?: FormFieldErrors;
  /** Inputs the last run said are worth changing. Empty before the first run. */
  flags?: FieldFlag[];
  /** Pre-submit `/api/quote` state. Never a locally computed estimate. */
  quote?: QuoteState;
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
            aria-live="polite"
            className={`min-w-0 flex-1 truncate text-[30px] font-extrabold tracking-[-0.04em] ${
              quote.status === "available" ? "text-white" : "text-faint"
            }`}
          >
            {quote.status === "available"
              ? // Printed verbatim: the backend already returns human units, and
                // re-parsing to a number would drop precision.
                quote.quote.estimatedAmountOut
              : say(
                  language,
                  quote.status === "loading"
                    ? { en: "Loading quote…", zh: "正在获取报价…" }
                    : { en: "No quote", zh: "无报价" },
                )}
          </strong>
          <TokenSelect
            language={language}
            options={SUPPORTED_TOKENS_OUT}
            value={form.tokenOut}
            onSelect={(value) => set("tokenOut", value)}
          />
        </div>

        {quote.status === "available" && (
          <dl className="m-0 mt-3 border-t border-line pt-2 text-[12px]">
            {quote.quote.minimumAmountOut !== undefined && (
              <div className="flex justify-between gap-3 py-1">
                <dt className="font-bold uppercase tracking-[0.06em] text-dim">
                  {say(language, {
                    en: "Minimum at this quote",
                    zh: "此报价的最低量",
                  })}
                </dt>
                <dd className="mono m-0 text-right text-white">
                  {quote.quote.minimumAmountOut} {form.tokenOut}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-3 py-1">
              <dt className="font-bold uppercase tracking-[0.06em] text-dim">
                {say(language, { en: "Quote block", zh: "报价区块" })}
              </dt>
              <dd className="mono m-0 text-right text-white">
                {quote.quote.blockNumber}
              </dd>
            </div>
          </dl>
        )}

        {quote.status === "unavailable" && (
          <p className="mt-2 text-[13px] leading-[1.5] text-risk-elevated">
            {say(language, QUOTE_UNAVAILABLE_REASON[quote.reason])}
          </p>
        )}

        {quote.status === "error" && (
          <p className="mt-2 text-[13px] leading-[1.5] text-risk-elevated">
            {say(language, {
              en: `The quote request failed (${quote.apiFailure.code}). You can still submit the check.`,
              zh: `报价请求失败（${quote.apiFailure.code}）。你仍然可以提交检查。`,
            })}
          </p>
        )}

        <p className="mt-2 text-[12px] leading-[1.5] text-dim">
          {say(language, {
            en: "This estimate comes from the backend quote stage before signing. It is not a simulated result and not a guaranteed output.",
            zh: "此预估来自签名前的后端报价阶段。它不是模拟结果，也不构成输出保证。",
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
                aria-describedby={[
                  "swap-minimum-received-help",
                  minimumReceivedError
                    ? "swap-minimum-received-error"
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" ")}
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
              <p
                id="swap-minimum-received-help"
                className="mt-2 text-[12px] leading-[1.6] text-dim"
              >
                {say(language, {
                  en: "Minimum Received is the lowest output amount accepted for this Intent. It is an acceptance boundary, not an estimate and not a way to improve the transaction.",
                  zh: "最低收到量是此交易意图可接受的最低输出数量。它是接受边界，不是预估值，也不是改善交易结果的方法。",
                })}
              </p>
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
