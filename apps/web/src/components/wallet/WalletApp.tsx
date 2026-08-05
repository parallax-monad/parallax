import { type ReactNode, useEffect, useRef, useState } from "react";
import { EvidenceDrawer } from "@/components/analyze/EvidenceDrawer";
import { WalletBackground } from "@/components/wallet/WalletBackground";
import {
  WALLET_STAGE_COUNT,
  WalletChecking,
} from "@/components/wallet/WalletChecking";
import { WalletHome } from "@/components/wallet/WalletHome";
import { CloseIcon } from "@/components/wallet/WalletIcons";
import { WalletResult } from "@/components/wallet/WalletResult";
import { WalletSwap } from "@/components/wallet/WalletSwap";
import { flaggedFields } from "@/lib/analyze/fields";
import { type FormState, INITIAL_FORM, toInput } from "@/lib/analyze/form";
import { checkSwap } from "@/lib/analyze/service";
import type { CheckSwapResult } from "@/lib/analyze/types";
import type { Language } from "@/lib/i18n";

/** Milliseconds per simulated Moss stage, tuned for a sub-minute demo. */
const STAGE_MS = 380;

type Screen = "home" | "swap" | "checking" | "result";

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
  /** Bumped on every return home, so the background replays its entrance. */
  const [homeVisit, setHomeVisit] = useState(0);
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
    setHomeVisit((visit) => visit + 1);
  };

  // Flags come from the current result only, so they clear the moment a new run
  // starts rather than pointing at conditions the user already changed.
  const flags = result ? flaggedFields(result) : [];

  return (
    <div className="relative mx-auto -mt-[var(--header-h)] flex w-[92vw] flex-col pb-6 pt-4 md:w-[45vw]">
      <WalletBackground
        verdict={screen === "result" ? result?.verdict : undefined}
        visitKey={homeVisit}
      />
      {/* Translucent so the starfield reads behind the wallet, with a blur to
          keep body text legible over moving particles. */}
      <div className="relative z-10 flex h-[calc(100vh-2.5rem)] flex-col overflow-hidden border border-line bg-ink-elev/85 backdrop-blur-md">
        <header className="relative flex items-center justify-center px-5 py-3">
          <span className="text-[15px] font-extrabold tracking-[-0.05em] text-monad-dim">
            PARAL<span className="text-white">LAX</span>
          </span>
          {screen !== "home" && (
            <button
              type="button"
              aria-label="Return to wallet home"
              className="absolute right-5 text-dim transition-colors hover:text-monad-dim"
              onClick={discard}
            >
              <CloseIcon size={20} />
            </button>
          )}
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
