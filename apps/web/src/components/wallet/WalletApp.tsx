import { type ReactNode, useEffect, useRef, useState } from "react";
import { EvidenceDrawer } from "@/components/analyze/EvidenceDrawer";
import { WalletBackground } from "@/components/wallet/WalletBackground";
import {
  WALLET_STAGE_COUNT,
  WalletChecking,
} from "@/components/wallet/WalletChecking";
import { WalletHome } from "@/components/wallet/WalletHome";
import { CloseIcon } from "@/components/wallet/WalletIcons";
import { WalletIntro } from "@/components/wallet/WalletIntro";
import { WalletResult } from "@/components/wallet/WalletResult";
import { WalletSwap } from "@/components/wallet/WalletSwap";
import { flaggedFields } from "@/lib/analyze/fields";
import {
  applyRemediationOption,
  DEMO_SLIPPAGE,
  type FormFieldErrors,
  type FormState,
  INITIAL_FORM,
  planSubmission,
  toInput,
  validateForm,
} from "@/lib/analyze/form";
import {
  applyTokenMetadata,
  checkSwap,
  DEFAULT_SENDER,
  expectationBaseline,
  fetchAccountState,
  fetchP0Config,
  fetchQuote,
  formFromRunResult,
  loadAccountStateSnapshot,
  loadRun,
} from "@/lib/analyze/service";
import { createStageScheduler } from "@/lib/analyze/stageScheduler";
import type {
  AccountStateResult,
  CheckSwapResult,
  P0ConfigState,
  QuoteState,
  RemediationOption,
} from "@/lib/analyze/types";
import { type Language, pick } from "@/lib/i18n";

/** Milliseconds per simulated Moss stage, tuned for a sub-minute demo. */
const STAGE_MS = 380;

/**
 * Debounce before asking the backend for a Quote. Typing an amount digit by
 * digit should not fire a live Moss Discover â?? Load â?? Quote per keystroke.
 */
const QUOTE_DEBOUNCE_MS = 450;
const LAST_RUN_ID_KEY = "parallax:last-run-id";
const LAST_ACCOUNT_SNAPSHOT_ID_KEY = "parallax:last-account-snapshot-id";

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

function storedRunId(): string | undefined {
  try {
    return window.sessionStorage.getItem(LAST_RUN_ID_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function setStoredRunId(runId: string | undefined): void {
  try {
    if (runId === undefined) {
      window.sessionStorage.removeItem(LAST_RUN_ID_KEY);
    } else {
      window.sessionStorage.setItem(LAST_RUN_ID_KEY, runId);
    }
  } catch {
    // Session storage can be unavailable in privacy-restricted browsers.
  }
}

function storedAccountSnapshotId(): string | undefined {
  try {
    return (
      window.sessionStorage.getItem(LAST_ACCOUNT_SNAPSHOT_ID_KEY) ?? undefined
    );
  } catch {
    return undefined;
  }
}

function setStoredAccountSnapshotId(snapshotId: string | undefined): void {
  try {
    if (snapshotId === undefined)
      window.sessionStorage.removeItem(LAST_ACCOUNT_SNAPSHOT_ID_KEY);
    else
      window.sessionStorage.setItem(LAST_ACCOUNT_SNAPSHOT_ID_KEY, snapshotId);
  } catch {
    // Session storage can be unavailable in privacy-restricted browsers.
  }
}
function backendRunId(result: CheckSwapResult): string | undefined {
  if (result.replayMode) return undefined;
  const raw =
    typeof result.rawResponse === "object" && result.rawResponse !== null
      ? (result.rawResponse as Record<string, unknown>)
      : undefined;
  const nested =
    typeof raw?.run === "object" && raw.run !== null
      ? (raw.run as Record<string, unknown>)
      : undefined;
  const runId =
    typeof raw?.runId === "string"
      ? raw.runId
      : typeof nested?.runId === "string"
        ? nested.runId
        : undefined;
  return runId === result.runId ? runId : undefined;
}

function accountStateMatchesResult(
  result: CheckSwapResult,
  snapshot: NonNullable<CheckSwapResult["accountState"]>,
): boolean {
  const raw =
    typeof result.rawResponse === "object" && result.rawResponse !== null
      ? (result.rawResponse as Record<string, unknown>)
      : undefined;
  const rawRun =
    typeof raw?.result === "object" && raw.result !== null
      ? (raw.result as Record<string, unknown>)
      : raw;
  const intent =
    typeof rawRun?.intent === "object" && rawRun.intent !== null
      ? (rawRun.intent as Record<string, unknown>)
      : undefined;
  const rawTokenIn = intent?.tokenIn as
    | { kind?: string; address?: string }
    | undefined;
  const rawTokenOut = intent?.tokenOut as
    | { kind?: string; address?: string }
    | undefined;
  const equalAsset = (left: unknown, right: unknown) => {
    const a = left as { kind?: string; address?: string } | undefined;
    const b = right as { kind?: string; address?: string } | undefined;
    return (
      a?.kind === b?.kind &&
      (a?.kind !== "erc20" ||
        a.address?.toLowerCase() === b?.address?.toLowerCase())
    );
  };
  const rawSender =
    typeof intent?.sender === "string" ? intent.sender : undefined;
  const rawRecipient =
    typeof intent?.recipient === "string" ? intent.recipient : undefined;
  return (
    rawSender !== undefined &&
    rawRecipient !== undefined &&
    snapshot.context.chainId === result.chainId &&
    snapshot.context.protocol === result.protocol &&
    snapshot.context.sender.toLowerCase() === rawSender.toLowerCase() &&
    snapshot.context.recipient.toLowerCase() === rawRecipient.toLowerCase() &&
    snapshot.context.amountInAtomic === intent?.amountInAtomic &&
    equalAsset(snapshot.context.tokenIn, rawTokenIn) &&
    equalAsset(snapshot.context.tokenOut, rawTokenOut)
  );
}
export function WalletApp({ language }: { language: Language }) {
  const [showIntro, setShowIntro] = useState(true);
  const [screen, setScreen] = useState<Screen>("home");
  const screenRef = useRef<Screen>("home");
  // A user-started flow invalidates the mount-time recovery result.
  const recoveryCancelledRef = useRef(false);
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
  const [quote, setQuote] = useState<QuoteState>({ status: "idle" });
  const [accountState, setAccountState] = useState<AccountStateResult>({
    status: "idle",
  });
  const accountStateRef = useRef<AccountStateResult>({ status: "idle" });
  const snapshotRecoveryControllerRef = useRef<AbortController | undefined>();
  const [p0Config, setP0Config] = useState<P0ConfigState | undefined>();
  const schedulerRef = useRef(createStageScheduler());
  // The mount-only recovery effect reads this from its eventual promise callback.
  screenRef.current = screen;

  // Reads the ref inside the cleanup so the effect stays dependency-free and
  // still cancels an in-flight pipeline when the screen unmounts.
  useEffect(() => {
    const scheduler = schedulerRef.current;
    return () => scheduler.cancel();
  }, []);

  useEffect(() => {
    let active = true;
    void fetchP0Config().then((next) => {
      if (active) setP0Config(next);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const snapshotId = storedAccountSnapshotId();
    if (!snapshotId) return;
    const controller = new AbortController();
    snapshotRecoveryControllerRef.current = controller;
    let active = true;
    void loadAccountStateSnapshot(snapshotId, {
      signal: controller.signal,
    }).then((next) => {
      if (active && !controller.signal.aborted) {
        accountStateRef.current = next;
        setAccountState(next);
      }
    });
    return () => {
      active = false;
      controller.abort();
      if (snapshotRecoveryControllerRef.current === controller) {
        snapshotRecoveryControllerRef.current = undefined;
      }
    };
  }, []);

  useEffect(() => {
    const runId = storedRunId();
    if (runId === undefined) return;
    let active = true;
    void loadRun(runId).then((recovery) => {
      if (
        !active ||
        recoveryCancelledRef.current ||
        screenRef.current !== "home"
      ) {
        return;
      }
      if (recovery.kind === "terminal") {
        const restoredForm = formFromRunResult(recovery.result);
        setForm(restoredForm);
        setSubmittedForm(restoredForm);
        setResult(recovery.result);
        setCheckingMode("live");
        setScreen("result");
        return;
      }

      if (
        recovery.kind === "error" &&
        recovery.failure.code === "RUN_NOT_FOUND"
      ) {
        setStoredRunId(undefined);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  // Quote is only meaningful while the user is editing the swap. Invalid input
  // clears it rather than leaving a stale amount on screen, and each request
  // aborts the previous one so a slow response cannot overwrite a newer one.
  const { protocol, tokenIn, tokenOut, amountIn } = form;
  useEffect(() => {
    if (
      accountState.status !== "available" ||
      !result ||
      result.accountState ||
      !accountStateMatchesResult(result, accountState.snapshot)
    )
      return;
    setResult({ ...result, accountState: accountState.snapshot });
  }, [accountState, result]);

  useEffect(() => {
    if (
      screen !== "swap" ||
      !validateForm({
        protocol,
        tokenIn,
        tokenOut,
        amountIn,
        slippage: DEMO_SLIPPAGE,
        minimumReceived: "",
      }).valid
    ) {
      setQuote({ status: "idle" });
      setAccountState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setQuote({ status: "loading" });
      setAccountState({ status: "loading" });
      void Promise.all([
        fetchQuote(
          { protocol, tokenIn, tokenOut, amountIn },
          { signal: controller.signal },
        ),
        fetchAccountState(
          { protocol, tokenIn, tokenOut, amountIn, sender: DEFAULT_SENDER },
          { signal: controller.signal },
        ),
      ]).then(([nextQuote, nextAccountState]) => {
        if (controller.signal.aborted) return;
        setQuote(nextQuote);
        setAccountState(nextAccountState);
      });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [screen, protocol, tokenIn, tokenOut, amountIn]);

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
    const currentAccountState = accountStateRef.current;
    recoveryCancelledRef.current = true;
    snapshotRecoveryControllerRef.current?.abort();
    accountStateRef.current = { status: "idle" };
    setFormErrors({});
    setStoredRunId(undefined);
    setStoredAccountSnapshotId(undefined);
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
        const matchesQuoteRequest =
          quote.status === "available" &&
          quote.requestIdentity.protocol === submitted.protocol &&
          quote.requestIdentity.tokenIn === submitted.tokenIn &&
          quote.requestIdentity.tokenOut === submitted.tokenOut &&
          quote.requestIdentity.amountIn === submitted.amountIn;

        const nextResult = await checkSwap({
          ...toInput(submitted, parent?.runId),
          ...(matchesQuoteRequest
            ? {
                expectationBaseline: expectationBaseline(
                  {
                    protocol: submitted.protocol,
                    tokenIn: submitted.tokenIn,
                    tokenOut: submitted.tokenOut,
                    amountIn: submitted.amountIn,
                  },
                  quote.quote,
                ),
              }
            : {}),
        });
        const displayResult = applyTokenMetadata(
          nextResult,
          p0Config?.status === "AVAILABLE" ? p0Config.tokenMetadata : undefined,
        );
        const withAccountState =
          currentAccountState.status === "available" &&
          accountStateMatchesResult(displayResult, currentAccountState.snapshot)
            ? { ...displayResult, accountState: currentAccountState.snapshot }
            : displayResult;
        setStoredRunId(backendRunId(withAccountState));
        setStoredAccountSnapshotId(withAccountState.accountState?.snapshotId);
        setResult(withAccountState);
        setSubmittedForm(submitted);
        setScreen("result");
      },
    });
  };

  const applyOption = (option: RemediationOption) => {
    const nextForm = applyRemediationOption(form, option);
    if (nextForm === undefined) return;
    setForm(nextForm);
    setFormErrors({});
    setQuote({ status: "idle" });
    setScreen("swap");
  };

  const discard = () => {
    recoveryCancelledRef.current = true;
    schedulerRef.current.cancel();
    setStoredRunId(undefined);
    setStoredAccountSnapshotId(undefined);
    setResult(undefined);
    setSubmittedForm(undefined);
    setFormErrors({});
    setDrawerOpen(false);
    setForm(INITIAL_FORM);
    accountStateRef.current = { status: "idle" };
    setAccountState({ status: "idle" });
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
      {showIntro ? (
        <WalletIntro onComplete={() => setShowIntro(false)} />
      ) : (
        <div className="wallet-app-frame relative z-10 flex h-[calc(100vh-2.5rem)] flex-col overflow-hidden rounded-[24px] border-none bg-ink-elev/90 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.12),_0_1px_3px_rgba(0,0,0,0.08)] animate-wallet-enter">
          <header className="relative flex items-center justify-center px-6 py-5">
            <span className="text-[22px] font-semibold tracking-[-0.02em] text-monad-dim">
              PARAL<span className="text-white">LAX</span>
            </span>
            {screen !== "home" && (
              <button
                type="button"
                aria-label={pick(
                  language,
                  "Return to wallet home",
                  "è¿?å??æ¼?ç¤ºé?±å??é¦?é¡µ",
                )}
                className="wallet-app-close absolute right-6 rounded-full p-2 text-dim/80 transition-all duration-200 ease-out hover:bg-white/[0.06] hover:text-white active:scale-95"
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
                    onSwap={() => {
                      recoveryCancelledRef.current = true;
                      snapshotRecoveryControllerRef.current?.abort();
                      accountStateRef.current = { status: "idle" };
                      setAccountState({ status: "idle" });
                      setScreen("swap");
                    }}
                  />
                )}
                {screen === "swap" && (
                  <WalletSwap
                    errors={formErrors}
                    flags={flags}
                    form={form}
                    language={language}
                    quote={quote}
                    accountState={accountState}
                    p0Config={p0Config}
                    onChange={(nextForm) => {
                      setForm(nextForm);
                      setQuote({ status: "idle" });
                      accountStateRef.current = { status: "idle" };
                      setAccountState({ status: "idle" });
                      if (Object.keys(formErrors).length > 0) setFormErrors({});
                    }}
                    onSubmit={runCheck}
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
                    tokenMetadata={result.tokenMetadata}
                    onDiscard={discard}
                    onRetry={() => runCheck(true)}
                    onKeep={() => setScreen("swap")}
                    onOpenEvidence={() => setDrawerOpen(true)}
                    onSelectOption={applyOption}
                  />
                )}
              </div>
            </ScreenTransition>
          </div>
        </div>
      )}

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
