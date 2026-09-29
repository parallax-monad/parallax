import type { ReactNode } from "react";
import { atomicToDisplay } from "@/lib/analyze/service";
import type {
  AccountAllowance,
  AccountStateState,
  AccountStateUnavailableReason,
  AccountTokenBalance,
} from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

/**
 * Plain-language copy for the normalized Backend reason codes. These are public
 * enums, never provider payloads, and an unknown code is shown verbatim rather
 * than replaced with an invented explanation.
 */
const REASON: Record<string, Copy> = {
  RPC_UNAVAILABLE: {
    en: "The chain read was unavailable.",
    zh: "链上读取不可用。",
  },
  RPC_TIMEOUT: { en: "The chain read timed out.", zh: "链上读取超时。" },
  INVALID_RPC_RESPONSE: {
    en: "The chain returned an unusable response.",
    zh: "链上返回了不可用的响应。",
  },
  BLOCK_HASH_MISMATCH: {
    en: "The pinned block changed between reads.",
    zh: "两次读取之间锁定的区块发生了变化。",
  },
  BLOCK_RECHECK_FAILED: {
    en: "The pinned block could not be re-checked.",
    zh: "无法重新校验锁定的区块。",
  },
  BLOCK_CONTEXT_UNAVAILABLE: {
    en: "No verified block context was available.",
    zh: "没有可用的已验证区块上下文。",
  },
  SPENDER_NOT_QUALIFIED: {
    en: "No qualified spender is registered for this route.",
    zh: "此路径没有已登记的合格 spender。",
  },
  UNAVAILABLE: {
    en: "The Backend did not publish this observation.",
    zh: "后端未发布此观察结果。",
  },
};

const ALLOWANCE_STATUS: Record<AccountAllowance["status"], Copy> = {
  SUFFICIENT: { en: "Sufficient", zh: "充足" },
  INSUFFICIENT: { en: "Insufficient", zh: "不足" },
  UNAVAILABLE: { en: "Unavailable", zh: "不可用" },
  NOT_APPLICABLE: { en: "Not applicable", zh: "不适用" },
};

const SNAPSHOT_STATUS: Record<"AVAILABLE" | "PARTIAL" | "UNAVAILABLE", Copy> = {
  AVAILABLE: { en: "Available", zh: "可用" },
  PARTIAL: { en: "Partial", zh: "部分可用" },
  UNAVAILABLE: { en: "Unavailable", zh: "不可用" },
};

const UNAVAILABLE_REASON: Record<AccountStateUnavailableReason, Copy> = {
  REQUEST_FAILED: {
    en: "The account-state request did not complete, so balance and allowance are unknown.",
    zh: "账户状态请求未完成，因此余额与授权额度未知。",
  },
  INVALID_RESPONSE: {
    en: "The account-state response could not be read, so balance and allowance are unknown.",
    zh: "无法解析账户状态响应，因此余额与授权额度未知。",
  },
  SNAPSHOT_UNAVAILABLE: {
    en: "The Backend marked this account-state snapshot unavailable.",
    zh: "后端将此账户状态快照标记为不可用。",
  },
};

/** Renders one balance side; an unknown scale stays explicit as an atomic value. */
function balanceValue(
  balance: AccountTokenBalance,
  language: Language,
): string {
  if (balance.status === "AVAILABLE" && balance.amountAtomic !== undefined) {
    const amount = atomicToDisplay(balance.amountAtomic, balance.decimals);
    return balance.symbol ? `${amount} ${balance.symbol}` : amount;
  }
  const reason = balance.reason ? REASON[balance.reason] : undefined;
  return say(language, reason ?? { en: "Not published", zh: "未发布" });
}

function Row({
  label,
  language,
  children,
}: {
  label: Copy;
  language: Language;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1">
      <dt className="text-[12px] font-bold uppercase tracking-[0.06em] text-dim">
        {say(language, label)}
      </dt>
      <dd className="m-0 max-w-full text-right text-[13px] text-white">
        {children}
      </dd>
    </div>
  );
}

/**
 * Trusted input-token balance, allowance, and block binding for the checked
 * intent. Renders only normalized Backend fields: no Provider or RPC payload is
 * ever copied here, and an unknown observation is shown as unknown.
 */
export function AccountStateCard({
  accountState,
  language,
}: {
  accountState?: AccountStateState;
  language: Language;
}) {
  if (!accountState || accountState.status === "idle") return null;

  if (accountState.status === "loading") {
    return (
      <section className="rounded-[12px] border border-line bg-ink-elev2/30 p-3">
        <h3 className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
          {say(language, { en: "Balance and allowance", zh: "余额与授权额度" })}
        </h3>
        <p className="m-0 mt-1 text-[13px] text-dim">
          {say(language, {
            en: "Reading balance and allowance…",
            zh: "正在读取余额与授权额度…",
          })}
        </p>
      </section>
    );
  }

  if (accountState.status === "unavailable") {
    return (
      <section className="rounded-[12px] border border-line bg-ink-elev2/30 p-3">
        <h3 className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
          {say(language, { en: "Balance and allowance", zh: "余额与授权额度" })}
        </h3>
        <p className="m-0 mt-1 text-[13px] leading-[1.5] text-risk-elevated">
          {say(language, UNAVAILABLE_REASON[accountState.reason])}
        </p>
        <p className="m-0 mt-1 text-[12px] text-dim">
          {say(language, {
            en: "Snapshot status",
            zh: "快照状态",
          })}
          :{" "}
          <span className="mono">
            {say(language, SNAPSHOT_STATUS.UNAVAILABLE)}
          </span>
        </p>
      </section>
    );
  }

  const { view } = accountState;
  const { allowance, block, inputToken } = view;

  return (
    <section className="rounded-[12px] border border-line bg-ink-elev2/30 p-3">
      <h3 className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
        {say(language, { en: "Balance and allowance", zh: "余额与授权额度" })}
      </h3>
      <p className="m-0 mt-1 text-[12px] leading-[1.5] text-dim">
        {say(language, {
          en: "Read from the Backend account state for this intent. It is evidence about the checked state, not a guarantee.",
          zh: "取自此交易意图的后端账户状态。它是关于已检查状态的证据，不是保证。",
        })}
      </p>

      <dl className="m-0 mt-2 border-t border-line pt-1 text-[13px]">
        <Row label={{ en: "Snapshot", zh: "快照" }} language={language}>
          {say(language, SNAPSHOT_STATUS[view.status])}{" "}
          <span className="mono text-[12px] text-dim">{view.status}</span>
        </Row>

        <Row
          label={{ en: "Input balance", zh: "输入余额" }}
          language={language}
        >
          {balanceValue(inputToken, language)}
        </Row>

        <Row label={{ en: "Allowance", zh: "授权额度" }} language={language}>
          {say(language, ALLOWANCE_STATUS[allowance.status])}{" "}
          <span className="mono text-[12px] text-dim">{allowance.status}</span>
        </Row>

        {allowance.status === "SUFFICIENT" ||
        allowance.status === "INSUFFICIENT" ? (
          <>
            <Row label={{ en: "Approved", zh: "已授权" }} language={language}>
              <span className="mono">
                {atomicToDisplay(
                  allowance.allowanceAtomic,
                  view.decimalsBySymbol[inputToken.symbol ?? ""],
                )}
              </span>
            </Row>
            <Row label={{ en: "Required", zh: "所需" }} language={language}>
              <span className="mono">
                {atomicToDisplay(
                  allowance.requiredAmountAtomic,
                  view.decimalsBySymbol[inputToken.symbol ?? ""],
                )}
              </span>
            </Row>
          </>
        ) : null}

        {allowance.status === "UNAVAILABLE" && (
          <Row label={{ en: "Reason", zh: "原因" }} language={language}>
            {say(language, REASON[allowance.reason] ?? REASON.UNAVAILABLE)}
          </Row>
        )}

        {allowance.status !== "NOT_APPLICABLE" &&
          allowance.spender?.status === "QUALIFIED" && (
            <Row label={{ en: "Spender", zh: "Spender" }} language={language}>
              <span className="mono break-all">
                {allowance.spender.address}
              </span>
            </Row>
          )}

        <Row
          label={{ en: "Block binding", zh: "区块绑定" }}
          language={language}
        >
          {block.status === "VERIFIED" || block.status === "STALE" ? (
            <span className="mono break-all">
              {block.blockNumber} · {block.blockHash} · {block.observedAt}
            </span>
          ) : (
            <span className="text-dim">
              {say(language, {
                en: "Not verified",
                zh: "未验证",
              })}
              {block.reason ? (
                <span className="mono"> · {block.reason}</span>
              ) : null}
            </span>
          )}
        </Row>
      </dl>
    </section>
  );
}
