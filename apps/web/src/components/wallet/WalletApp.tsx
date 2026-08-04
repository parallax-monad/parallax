import { type ReactNode, useEffect, useRef, useState } from "react";
import { EvidenceDrawer } from "@/components/analyze/EvidenceDrawer";
import {
  WALLET_STAGE_COUNT,
  WalletChecking,
} from "@/components/wallet/WalletChecking";
import { WalletHome } from "@/components/wallet/WalletHome";
import {
  ActivityIcon,
  BackIcon,
  CloseIcon,
  HomeIcon,
  ShieldIcon,
} from "@/components/wallet/WalletIcons";
import { WalletResult } from "@/components/wallet/WalletResult";
import { WalletSwap } from "@/components/wallet/WalletSwap";
import { DEMO_ADDRESS } from "@/components/wallet/walletData";
import { flaggedFields } from "@/lib/analyze/fields";
import { type FormState, INITIAL_FORM, toInput } from "@/lib/analyze/form";
import { checkSwap } from "@/lib/analyze/service";
import type { CheckSwapResult } from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

/** Milliseconds per simulated Moss stage, tuned for a sub-minute demo. */
const STAGE_MS = 380;

type Screen = "home" | "swap" | "checking" | "result";

const TITLE: Record<Screen, Copy> = {
  home: { en: "Parallax Wallet", zh: "Parallax 钱包" },
  swap: { en: "Swap", zh: "兑换" },
  checking: { en: "Pre-sign check", zh: "签名前检查" },
  result: { en: "Pre-sign result", zh: "检查结果" },
};

/**
 * Bottom chrome, so the frame reads as an app rather than a page with empty
 * space below the fold. Only Wallet is a real destination in this MVP; the rest
 * are rendered as inert labels rather than buttons that would do nothing.
 */
const TABS = [
  { key: "home", label: { en: "Wallet", zh: "钱包" }, icon: HomeIcon },
  { key: "checks", label: { en: "Checks", zh: "检查" }, icon: ShieldIcon },
  {
    key: "activity",
    label: { en: "Activity", zh: "活动" },
    icon: ActivityIcon,
  },
] satisfies { key: string; label: Copy; icon: typeof HomeIcon }[];

/**
 * Slides a whole screen in. The caller passes the screen name as `key`, so a
 * screen change remounts this and replays the entrance without the effect
 * needing to watch anything. Reduced motion skips straight to the shown state.
 */
function ScreenTransition({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={`flex flex-1 flex-col transition-all duration-300 ease-out ${
        shown ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

export function WalletApp({ language }: { language: Language }) {
  const [screen, setScreen] = useState<Screen>("home");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<CheckSwapResult | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const timersRef = useRef<number[]>([]);

  const clearTimers = () => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  };

  // Reads the ref inside the cleanup rather than closing over clearTimers, so
  // the effect stays dependency-free and still cancels on unmount.
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
    };
  }, []);

  const runCheck = () => {
    clearTimers();
    const parent = result;
    setResult(undefined);
    setDrawerOpen(false);
    setStage(0);
    setScreen("checking");

    for (let index = 1; index <= WALLET_STAGE_COUNT; index++) {
      timersRef.current.push(
        window.setTimeout(() => setStage(index), STAGE_MS * index),
      );
    }

    timersRef.current.push(
      window.setTimeout(
        () => {
          setResult(
            checkSwap(toInput(form, parent?.runId), { previous: parent }),
          );
          setScreen("result");
        },
        STAGE_MS * (WALLET_STAGE_COUNT + 1),
      ),
    );
  };

  const discard = () => {
    clearTimers();
    setResult(undefined);
    setDrawerOpen(false);
    setForm(INITIAL_FORM);
    setScreen("home");
  };

  // Flags come from the current result only, so they clear the moment a new run
  // starts rather than pointing at conditions the user already changed.
  const flags = result ? flaggedFields(result) : [];

  const canGoBack = screen === "swap" || screen === "result";

  return (
    <div className="mx-auto flex w-[92vw] flex-col pb-6 pt-4 md:w-[50vw]">
      <div className="flex h-[calc(100vh-var(--header-h)-2.5rem)] flex-col overflow-hidden border border-line bg-ink-elev">
        <header className="border-b border-line px-5 py-3">
          <div className="flex items-center gap-3">
            {canGoBack ? (
              <button
                type="button"
                aria-label={say(language, { en: "Back", zh: "返回" })}
                className="text-dim transition-colors hover:text-monad-dim"
                onClick={() => setScreen(screen === "result" ? "swap" : "home")}
              >
                <BackIcon size={20} />
              </button>
            ) : (
              <span className="text-[15px] font-extrabold tracking-[-0.05em] text-monad-dim">
                PARAL<span className="text-white">LAX</span>
              </span>
            )}

            <div className="min-w-0 flex-1 text-center">
              <strong className="block truncate text-[14px] font-bold">
                {say(language, TITLE[screen])}
              </strong>
              <span className="mono block truncate text-[11px] text-dim">
                Monad · {DEMO_ADDRESS}
              </span>
            </div>

            {screen === "home" ? (
              <span className="pill shrink-0">
                {say(language, { en: "Demo", zh: "演示" })}
              </span>
            ) : (
              <button
                type="button"
                aria-label={say(language, {
                  en: "Close and return to wallet",
                  zh: "关闭并返回钱包",
                })}
                className="text-dim transition-colors hover:text-monad-dim"
                onClick={discard}
              >
                <CloseIcon size={20} />
              </button>
            )}
          </div>
        </header>

        {/* x is clipped because the screen transition slides in from the right;
            leaving it visible would resolve to auto and flash a scrollbar. */}
        <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
          <ScreenTransition key={screen}>
            <div className="flex w-full flex-1 flex-col">
              {screen === "home" && (
                <WalletHome
                  language={language}
                  onSwap={() => setScreen("swap")}
                />
              )}
              {screen === "swap" && (
                <WalletSwap
                  flags={flags}
                  form={form}
                  language={language}
                  onChange={setForm}
                  onSubmit={runCheck}
                />
              )}
              {screen === "checking" && (
                <WalletChecking language={language} stage={stage} />
              )}
              {screen === "result" && result && (
                <WalletResult
                  language={language}
                  result={result}
                  onDiscard={discard}
                  onKeep={() => setScreen("swap")}
                  onOpenEvidence={() => setDrawerOpen(true)}
                />
              )}
            </div>
          </ScreenTransition>
        </div>

        <nav
          aria-label={say(language, { en: "Wallet sections", zh: "钱包分区" })}
          className="border-t border-line px-5 py-2.5"
        >
          <ul className="m-0 flex list-none justify-around p-0">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const current = tab.key === "home" && screen === "home";
              return (
                <li key={tab.key}>
                  <span
                    aria-current={current ? "page" : undefined}
                    className={`flex flex-col items-center gap-1 px-3 ${
                      current ? "text-monad-dim" : "text-faint"
                    }`}
                  >
                    <Icon size={19} />
                    <span className="text-[11px] font-bold uppercase tracking-[0.06em]">
                      {say(language, tab.label)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {result && drawerOpen && (
        <EvidenceDrawer
          language={language}
          result={result}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
