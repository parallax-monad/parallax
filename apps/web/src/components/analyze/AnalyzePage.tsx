import { useEffect, useRef, useState } from "react";
import { ActionsCard } from "@/components/analyze/ActionsCard";
import {
  CHECK_STAGE_COUNT,
  CheckingCard,
} from "@/components/analyze/CheckingCard";
import { DiffCard } from "@/components/analyze/DiffCard";
import { EvidenceDrawer } from "@/components/analyze/EvidenceDrawer";
import { FlowArrow } from "@/components/analyze/FlowArrow";
import { Reveal } from "@/components/analyze/Reveal";
import { SwapForm } from "@/components/analyze/SwapForm";
import { VerdictCard } from "@/components/analyze/VerdictCard";
import { flaggedFields } from "@/lib/analyze/fields";
import { type FormState, INITIAL_FORM, toInput } from "@/lib/analyze/form";
import { checkSwap } from "@/lib/analyze/service";
import type { CheckSwapResult } from "@/lib/analyze/types";
import { type Language, say } from "@/lib/i18n";

/** Milliseconds per simulated Moss stage, tuned for a three-minute demo. */
const STAGE_MS = 420;

export function AnalyzePage({ language }: { language: Language }) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [stage, setStage] = useState(-1);
  const [result, setResult] = useState<CheckSwapResult | undefined>(undefined);
  const [previous, setPrevious] = useState<CheckSwapResult | undefined>(
    undefined,
  );
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
    setPrevious(parent);
    setResult(undefined);
    setDrawerOpen(false);
    setStage(0);

    // Stages advance one at a time; the result cards only mount after the last.
    for (let index = 1; index <= CHECK_STAGE_COUNT; index++) {
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
          setStage(-1);
        },
        STAGE_MS * (CHECK_STAGE_COUNT + 1),
      ),
    );
  };

  const checking = stage >= 0;
  // Derived from the current result only, so the flags clear the moment a new
  // run starts rather than pointing at conditions the user already changed.
  const flags = result ? flaggedFields(result) : [];

  return (
    <main className="shell">
      <header className="mb-7">
        <span className="eyebrow">
          {say(language, { en: "Pre-sign check", zh: "签名前检查" })}
        </span>
        <h1 className="m-0 text-[clamp(28px,3.6vw,46px)] font-extrabold uppercase leading-[0.95] tracking-[-0.06em]">
          {say(language, {
            en: "Know what to do before you sign.",
            zh: "签名前先知道该怎么做。",
          })}
        </h1>
        <p className="mt-3 max-w-[620px] text-[16px] leading-[1.7] text-dim">
          {say(language, {
            en: "Enter a swap intent, run the check, then change one condition and compare the result.",
            zh: "输入交易意图，执行检查，然后修改一个条件并对比结果。",
          })}
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <SwapForm
          flags={flags}
          form={form}
          language={language}
          pending={checking}
          onChange={setForm}
          onSubmit={runCheck}
        />

        {checking && (
          <Reveal>
            <CheckingCard language={language} stage={stage} />
          </Reveal>
        )}

        {result && (
          <>
            <Reveal>
              <VerdictCard
                language={language}
                result={result}
                onOpenEvidence={() => setDrawerOpen(true)}
              />
            </Reveal>
            <FlowArrow language={language} />
            <Reveal delay={220}>
              <ActionsCard language={language} result={result} />
            </Reveal>
            {result.diff && previous && (
              <>
                <FlowArrow language={language} />
                <Reveal delay={440}>
                  <DiffCard
                    diff={result.diff}
                    language={language}
                    previousRunId={previous.runId}
                    runId={result.runId}
                  />
                </Reveal>
              </>
            )}
          </>
        )}
      </div>

      {result && drawerOpen && (
        <EvidenceDrawer
          language={language}
          result={result}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </main>
  );
}
