import { useState } from "react";
import { TokenIcon } from "@/components/analyze/TokenIcon";
import { ChevronDownIcon, SwapIcon } from "@/components/wallet/WalletIcons";
import {
  DEMO_RECIPIENT,
  formatAmount,
  knownBalanceOf,
} from "@/components/wallet/walletData";
import type { FieldFlag } from "@/lib/analyze/fields";
import {
  payTokenFor,
  receiveTokenFor,
  SUPPORTED_TOKENS_OUT,
  swapDirectionFor,
} from "@/lib/analyze/fixtures";
import type { FormFieldErrors, FormState } from "@/lib/analyze/form";
import { atomicToDisplay } from "@/lib/analyze/service";
import type {
  AccountAllowance,
  AccountStateState,
  Protocol,
  QuoteState,
} from "@/lib/analyze/types";
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

/**
 * The route the demo actually submits. Derived from the form's protocol so a
 * camelot-v3 run is never labelled as Kuru.
 */
const ROUTE_LABEL: Record<Protocol, Copy> = {
  kuru: { en: "Kuru (live API)", zh: "Kuru（实时 API）" },
  pancake: {
    en: "PancakeSwap V3 (live API)",
    zh: "PancakeSwap V3（实时 API）",
  },
  "camelot-v3": { en: "Camelot V3 (live API)", zh: "Camelot V3（实时 API）" },
};

const ALLOWANCE_LINE: Record<AccountAllowance["status"], Copy> = {
  SUFFICIENT: { en: "Sufficient", zh: "充足" },
  INSUFFICIENT: { en: "Insufficient", zh: "不足" },
  UNAVAILABLE: { en: "Unavailable", zh: "不可用" },
  NOT_APPLICABLE: {
    en: "Not needed (native input)",
    zh: "不需要（原生币输入）",
  },
};

const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Pre-submit balance and allowance, read from the Backend account state. Fails
 * closed: an unknown read says so instead of showing a guessed number.
 */
function AccountStateLine({
  accountState,
  language,
}: {
  accountState?: AccountStateState;
  language: Language;
}) {
  if (!accountState || accountState.status === "idle") return null;

  if (accountState.status === "loading") {
    return (
      <p className="mt-2 text-[12px] leading-[1.5] text-dim">
        {say(language, {
          en: "Reading balance and allowance…",
          zh: "正在读取余额与授权额度…",
        })}
      </p>
    );
  }

  if (accountState.status === "unavailable") {
    return (
      <p className="mt-2 text-[12px] leading-[1.5] text-risk-elevated">
        {say(language, {
          en: "Checked balance and allowance are unknown. The check still runs.",
          zh: "已检查的余额与授权额度未知。检查仍会运行。",
        })}
      </p>
    );
  }

  const { view } = accountState;
  const side = view.inputToken;
  const balance =
    side.status === "AVAILABLE" && side.amountAtomic !== undefined
      ? `${atomicToDisplay(side.amountAtomic, side.decimals)}${
          side.symbol ? ` ${side.symbol}` : ""
        }`
      : say(language, { en: "unknown", zh: "未知" });
  const spender =
    view.allowance.status !== "NOT_APPLICABLE" &&
    view.allowance.spender?.status === "QUALIFIED"
      ? view.allowance.spender.address
      : undefined;

  return (
    <p className="mt-2 text-[12px] leading-[1.5] text-dim">
      {say(language, { en: "Checked balance", zh: "已检查余额" })}:{" "}
      <span className="mono text-white">{balance}</span>
      {" · "}
      {say(language, { en: "Allowance", zh: "授权额度" })}:{" "}
      <span className="text-white">
        {say(language, ALLOWANCE_LINE[view.allowance.status])}
      </span>
      {spender && (
        <>
          {" "}
          <span className="mono">{shortAddress(spender)}</span>
        </>
      )}
    </p>
  );
}

export function WalletSwap({
  form,
  language,
  errors = {},
  flags = [],
  quote = { status: "idle" },
  accountState,
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
  /** Trusted pre-submit account state. Unknown reads render as unknown. */
  accountState?: AccountStateState;
  onChange: (form: FormState) => void;
  onSubmit: () => void;
  onReplay: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    onChange({ ...form, [key]: value });

  const flagFor = (key: FieldFlag["field"]) =>
    flags.find((flag) => flag.field === key);

  // The real Arbitrum/Camelot path has exactly one balance source: the checked
  // account state. The demo wallet table is historical Monad fixture data (its
  // USDC entry is 500) and must never be shown or spent as a real balance.
  const realArbitrumPath = form.protocol === "camelot-v3";
  const accountInputToken =
    accountState?.status === "available"
      ? accountState.view.inputToken
      : undefined;
  const trustedBalanceAtomic =
    accountInputToken?.status === "AVAILABLE"
      ? accountInputToken.amountAtomic
      : undefined;
  const trustedBalanceDecimals = accountInputToken?.decimals;
  // Exact string conversion only: routing the atomic amount through a JS Number
  // would lose precision on 18-decimal balances.
  const trustedBalance =
    trustedBalanceAtomic !== undefined && trustedBalanceDecimals !== undefined
      ? atomicToDisplay(trustedBalanceAtomic, trustedBalanceDecimals)
      : undefined;
  const demoBalance = realArbitrumPath
    ? undefined
    : knownBalanceOf(form.tokenIn);
  const balanceLabel =
    trustedBalance ??
    (demoBalance === undefined ? undefined : formatAmount(demoBalance));
  const maxAmount =
    trustedBalance ??
    (demoBalance === undefined ? undefined : String(demoBalance));
  const canUseMax = realArbitrumPath
    ? trustedBalanceAtomic !== undefined && BigInt(trustedBalanceAtomic) > 0n
    : demoBalance !== undefined && demoBalance > 0;
  const receiveOptions = SUPPORTED_TOKENS_OUT.includes(form.tokenOut)
    ? SUPPORTED_TOKENS_OUT
    : [form.tokenOut, ...SUPPORTED_TOKENS_OUT];
  const nextDirection = swapDirectionFor(form.tokenIn, form.tokenOut);
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
      <section className="rounded-[16px] border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-xl">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
            {say(language, { en: "You pay", zh: "你支付" })}
          </span>
          <span className="text-[12px] text-dim">
            {say(language, { en: "Balance", zh: "余额" })}{" "}
            {balanceLabel === undefined
              ? say(language, { en: "unknown", zh: "未知" })
              : balanceLabel}
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
            options={["ETH"]}
            value={form.tokenIn}
            onSelect={(value) =>
              onChange({
                ...form,
                tokenIn: value,
                tokenOut: receiveTokenFor(value),
              })
            }
          />
        </div>
        <button
          type="button"
          className="mt-1 text-[12px] font-bold uppercase tracking-[0.08em] text-monad-dim disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canUseMax || maxAmount === undefined}
          onClick={() => {
            // Writes the exact trusted decimal string, never a rounded Number.
            if (maxAmount !== undefined) set("amountIn", maxAmount);
          }}
        >
          {say(language, { en: "Use max", zh: "使用全部" })}
        </button>
        <AccountStateLine accountState={accountState} language={language} />
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

      <div className="flex justify-center">
        <button
          type="button"
          aria-label={say(language, {
            en: "Swap the pay and receive direction",
            zh: "调换支付与接收方向",
          })}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line-strong bg-ink-elev2 text-monad-dim transition-all duration-200 ease-out hover:text-white active:scale-95"
          onClick={() =>
            onChange({
              ...form,
              tokenIn: nextDirection.tokenIn,
              tokenOut: nextDirection.tokenOut,
            })
          }
        >
          <SwapIcon size={18} />
        </button>
      </div>

      <section className="rounded-[16px] border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-xl">
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
            options={receiveOptions}
            value={form.tokenOut}
            onSelect={(value) => {
              const pay = payTokenFor(value);
              onChange({
                ...form,
                tokenOut: value,
                tokenIn: pay ?? form.tokenIn,
              });
            }}
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

      <section className="rounded-[16px] border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl overflow-hidden">
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
                {say(language, ROUTE_LABEL[form.protocol])}
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
          className="rounded-[12px] border border-risk-high/30 bg-risk-high/[0.06] px-4 py-3 text-[13px] leading-[1.5] text-risk-high backdrop-blur-xl"
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
