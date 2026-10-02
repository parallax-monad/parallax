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
  if (balance.status !== "AVAILABLE" || !balance.metadata) {
    return `UNAVAILABLE · ${value(balance.reason)}`;
  }
  return `${atomic(balance.amountAtomic, balance.metadata.decimals)} ${balance.metadata.symbol}`;
}

function Row({ label, text }: { label: Copy; text: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-3 border-b border-line py-2 last:border-0">
      <dt className="text-dim">{label.en}</dt>
      <dd className="mono m-0 min-w-0 break-all text-right text-white">
        {text}
      </dd>
    </div>
  );
}

function Balance({ snapshot }: { snapshot: AccountStateSnapshot }) {
  const rows = [
    ["Input balance", snapshot.balances.inputToken],
    ["Output balance", snapshot.balances.outputToken],
    ["Native balance", snapshot.balances.native],
  ] as const;
  return (
    <dl className="m-0">
      {rows.map(([label, balance]) => (
        <Row
          key={label}
          label={{ en: label, zh: label }}
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
  const allowance = snapshot.allowance;
  const allowanceText =
    allowance.status === "NOT_APPLICABLE"
      ? `NOT_APPLICABLE · ${allowance.reason}`
      : `${allowance.status} · allowance ${atomic(allowance.allowanceAtomic, allowance.metadata?.decimals)} ${allowance.metadata?.symbol ?? ""} · required ${atomic(allowance.requiredAmountAtomic, allowance.metadata?.decimals)} ${allowance.metadata?.symbol ?? ""}`;
  const spender =
    allowance.status === "NOT_APPLICABLE"
      ? "NOT_APPLICABLE"
      : (allowance.spender?.address ??
        `UNAVAILABLE · ${allowance.reason ?? "SPENDER_NOT_QUALIFIED"}`);

  return (
    <section className="rounded-[12px] border border-line bg-ink-elev2/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
          {say(language, { en: "Account state snapshot", zh: "账户状态快照" })}
        </h3>
        <span className="mono text-[11px] text-white">{snapshot.status}</span>
      </div>
      <p className="mt-2 text-[12px] leading-[1.5] text-dim">
        {say(language, {
          en: "Recorded for this account, asset pair, amount, and block. It is not a live balance after this observation.",
          zh: "此记录绑定账户、资产对、数量和区块，不代表观测后仍是实时余额。",
        })}
      </p>
      <Balance snapshot={snapshot} />
      <dl className="m-0 mt-2 border-t border-line pt-1">
        <Row label={{ en: "Allowance", zh: "授权额度" }} text={allowanceText} />
        <Row
          label={{ en: "Qualified spender", zh: "合格 spender" }}
          text={spender}
        />
        <Row
          label={{ en: "Block", zh: "区块" }}
          text={`${value(snapshot.block.blockNumber)} · ${snapshot.block.status}`}
        />
        <Row
          label={{ en: "Observed at", zh: "观测时间" }}
          text={snapshot.block.observedAt}
        />
        <Row
          label={{ en: "Snapshot ID", zh: "快照 ID" }}
          text={snapshot.snapshotId}
        />
      </dl>
    </section>
  );
}
