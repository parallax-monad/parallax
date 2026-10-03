import { useState } from "react";
import type { AccountStateSnapshot } from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

function value(value: string | undefined): string {
  return value ?? "UNAVAILABLE";
}
function atomic(
  value: string | undefined,
  decimals: number | undefined,
): string {
  if (!value || !/^\d+$/.test(value) || decimals === undefined)
    return "UNAVAILABLE";
  if (decimals === 0) return value;
  const padded = value.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}

function balanceText(
  balance: AccountStateSnapshot["balances"]["inputToken"],
): string {
  if (balance.status !== "AVAILABLE") {
    return `UNAVAILABLE · ${value(balance.reason)}`;
  }
  return `${atomic(balance.amountAtomic, balance.metadata.decimals)} ${balance.metadata.symbol}`;
}

function Row({
  label,
  language,
  text,
}: {
  label: Copy;
  language: Language;
  text: string;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-line py-2 last:border-0">
      <dt className="min-w-0 flex-1 text-dim">{say(language, label)}</dt>
      <dd className="mono m-0 min-w-0 max-w-full break-all text-left text-white sm:max-w-[72%] sm:text-right">
        {text}
      </dd>
    </div>
  );
}

function Balance({
  snapshot,
  language,
}: {
  snapshot: AccountStateSnapshot;
  language: Language;
}) {
  const rows = [
    [{ en: "Input balance", zh: "输入余额" }, snapshot.balances.inputToken],
    [{ en: "Output balance", zh: "输出余额" }, snapshot.balances.outputToken],
    [{ en: "Native balance", zh: "原生余额" }, snapshot.balances.native],
  ] as const;
  return (
    <dl className="m-0">
      {rows.map(([label, balance]) => (
        <Row
          key={label.en}
          language={language}
          label={label}
          text={
            balance.status === "AVAILABLE"
              ? balanceText(balance)
              : `UNAVAILABLE · ${balance.reason ?? "UNKNOWN"}`
          }
        />
      ))}
    </dl>
  );
}

export function AccountStateCard({
  snapshot,
  language,
}: {
  snapshot: AccountStateSnapshot;
  language: Language;
}) {
  const [expanded, setExpanded] = useState(false);
  
  const allowance = snapshot.allowance;
  const inputMetadata = snapshot.balances.inputToken.metadata;
  const allowanceDecimals =
    allowance.status === "NOT_APPLICABLE" ? undefined : inputMetadata.decimals;
  const allowanceSymbol =
    allowance.status === "NOT_APPLICABLE" ? "" : inputMetadata.symbol;
  const allowanceText = (() => {
    switch (allowance.status) {
      case "NOT_APPLICABLE":
        return `NOT_APPLICABLE · ${allowance.reason}`;
      case "UNAVAILABLE":
        return `UNAVAILABLE · ${allowance.reason} · required ${atomic(allowance.requiredAmountAtomic, allowanceDecimals)} ${allowanceSymbol}`;
      case "SUFFICIENT":
      case "INSUFFICIENT":
        return `${allowance.status} · allowance ${atomic(allowance.allowanceAtomic, allowanceDecimals)} ${allowanceSymbol} · required ${atomic(allowance.requiredAmountAtomic, allowanceDecimals)} ${allowanceSymbol}`;
    }
  })();
  const spender =
    allowance.status === "NOT_APPLICABLE"
      ? "NOT_APPLICABLE"
      : allowance.spender.status === "QUALIFIED"
        ? allowance.spender.address
        : `UNAVAILABLE · ${allowance.spender.status}`;

  return (
    <section className="rounded-[12px] border border-line bg-ink-elev2/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
              {say(language, {
                en: "Account state snapshot",
                zh: "账户状态快照",
              })}
            </h3>
          </div>
          <p className="mt-2 text-[12px] leading-[1.5] text-dim">
            {say(language, {
              en: "Recorded for this account, asset pair, amount, and block. It is not a live balance after this observation.",
              zh: "此记录绑定账户、资产对、数量和区块，不代表观测后仍是实时余额。",
            })}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          className="shrink-0 text-[12px] font-bold uppercase tracking-[0.06em] text-monad-dim underline"
          onClick={() => setExpanded(!expanded)}
        >
          {say(
            language,
            expanded
              ? { en: "Hide", zh: "收起" }
              : { en: "View", zh: "查看" },
          )}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 border-t border-line pt-3">
          <Balance language={language} snapshot={snapshot} />
          <dl className="m-0 mt-2 border-t border-line pt-1">
            <Row
              language={language}
              label={{ en: "Allowance", zh: "授权额度" }}
              text={allowanceText}
            />
            <Row
              language={language}
              label={{ en: "Qualified spender", zh: "合格 spender" }}
              text={spender}
            />
            <Row
              language={language}
              label={{ en: "Block", zh: "区块" }}
              text={`${value(snapshot.block.blockNumber)} · ${snapshot.block.status}`}
            />
            <Row
              language={language}
              label={{ en: "Observed at", zh: "观测时间" }}
              text={snapshot.block.observedAt}
            />
            <Row
              language={language}
              label={{ en: "Snapshot ID", zh: "快照 ID" }}
              text={snapshot.snapshotId}
            />
          </dl>
        </div>
      )}
    </section>
  );
}
