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
import {
  type FormFieldErrors,
  type FormState,
  INITIAL_FORM,
  planSubmission,
  toInput,
} from "@/lib/analyze/form";
import { checkSwap, loadReplay } from "@/lib/analyze/service";
import { createStageScheduler } from "@/lib/analyze/stageScheduler";
import type { CheckSwapResult } from "@/lib/analyze/types";
import { type Language, pick } from "@/lib/i18n";

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
  const [submittedForm, setSubmittedForm] = useState<FormState | undefined>();
  const [formErrors, setFormErrors] = useState<FormFieldErrors>({});
  const [stage, setStage] = useState(0);
  /** Which path the in-flight run came from, so the loading screen can say so. */
  const [checkingMode, setCheckingMode] = useState<"live" | "replay">("live");
  const [result, setResult] = useState<CheckSwapResult | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Bumped on every return home, so the background replays its entrance. */
  const [homeVisit, setHomeVisit] = useState(0);
  const schedulerRef = useRef(createStageScheduler());

  // Reads the ref inside the cleanup so the effect stays dependency-free and
  // still cancels an in-flight pipeline when the screen unmounts.
  useEffect(() => {
    const scheduler = schedulerRef.current;
    return () => scheduler.cancel();
  }, []);

  const runCheck = (allowUnchanged = false) => {
    const plan = planSubmission(form, result ? submittedForm : undefined, {
      allowUnchanged,
    });
    if (!plan.allowed) {
      setFormErrors(plan.errors);
      return;
    }

    const parent = result?.systemStatus === "OK" ? result : undefined;
    const submitted = plan.submitted;
    setFormErrors({});
    setResult(undefined);
    setDrawerOpen(false);
    setStage(0);
    setCheckingMode("live");
    setScreen("checking");

    schedulerRef.current.run({
      stageCount: WALLET_STAGE_COUNT,
      stageMs: STAGE_MS,
      onStage: setStage,
      onSettle: async () => {
        const nextResult = await checkSwap(toInput(submitted, parent?.runId));
        setResult(nextResult);
        setSubmittedForm(submitted);
        setScreen("result");
      },
    });
  };

  const runReplay = () => {
    setFormErrors({});
    setResult(undefined);
    setDrawerOpen(false);
    setStage(0);
    setCheckingMode("replay");
    setScreen("checking");

    schedulerRef.current.run({
      stageCount: WALLET_STAGE_COUNT,
      stageMs: STAGE_MS,
      onStage: setStage,
      onSettle: async () => {
        const nextResult = await loadReplay("mon-to-usdc");
        setResult(nextResult);
        setSubmittedForm(form);
        setScreen("result");
      },
    });
  };

  const discard = () => {
    schedulerRef.current.cancel();
    setResult(undefined);
    setSubmittedForm(undefined);
    setFormErrors({});
    setDrawerOpen(false);
    setForm(INITIAL_FORM);
    setScreen("home");
    setHomeVisit((visit) => visit + 1);
  };

  // Flags come from the current result only, so they clear the moment a new run
  // starts rather than pointing at conditions the user already changed.
  const flags = result ? flaggedFields(result) : [];

  return (
    // Desktop stays tucked beneath the nav; mobile uses a separate utility row.
    <div className="wallet-app-shell relative mx-auto flex w-[92vw] flex-col pb-6 pt-2 md:-mt-[var(--header-h)] md:w-[45vw] md:pt-4">
      <WalletBackground
        verdict={screen === "result" ? result?.verdict : undefined}
        visitKey={homeVisit}
      />
      {/* Translucent so the starfield reads behind the wallet, with a blur to
          keep body text legible over moving particles. */}
      {/* Desktop uses the original viewport calculation; the mobile utility row
          supplies a safe-area-aware height override. */}
      <div className="wallet-app-frame relative z-10 flex h-[calc(100vh-2.5rem)] flex-col overflow-hidden border border-line bg-ink-elev/85 backdrop-blur-md">
        <header className="relative flex items-center justify-center px-5 py-3">
          <span className="text-[15px] font-extrabold tracking-[-0.05em] text-monad-dim">
            PARAL<span className="text-white">LAX</span>
          </span>
          {screen !== "home" && (
            <button
              type="button"
              aria-label={pick(
                language,
                "Return to wallet home",
                "返回演示钱包首页",
              )}
              className="wallet-app-close absolute right-5 text-dim transition-colors hover:text-monad-dim"
              onClick={discard}
            >
              <CloseIcon size={20} />
            </button>
          )}
        </header>

        {/* x is clipped because the screen transition slides in from the right;
            leaving it visible would resolve to auto and flash a scrollbar. */}
        <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
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
                  errors={formErrors}
                  flags={flags}
                  form={form}
                  language={language}
                  onChange={(nextForm) => {
                    setForm(nextForm);
                    if (Object.keys(formErrors).length > 0) setFormErrors({});
                  }}
                  onSubmit={runCheck}
                  onReplay={runReplay}
                />
              )}
              {screen === "checking" && (
                <WalletChecking
                  language={language}
                  mode={checkingMode}
                  stage={stage}
                />
              )}
              {screen === "result" && result && (
                <WalletResult
                  language={language}
                  result={result}
                  onDiscard={discard}
                  onRetry={() => runCheck(true)}
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
