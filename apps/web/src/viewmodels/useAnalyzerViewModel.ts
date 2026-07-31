import { useCallback, useEffect, useState } from "react";
import { POLICY_TEMPLATES } from "@/lib/policy";
import type {
  AnalysisRun,
  AnalysisSession,
  FinalAssessment,
  PolicyTemplate,
  ProtocolProfile,
  RiskDiff,
  RiskPolicy,
  TradeAction,
} from "@/lib/types";
import { analysisService } from "@/services/analysisService";
import { walletService, type WalletAccount } from "@/services/walletService";

export type Phase = "idle" | "discovering" | "simulating";

function makeDiff(previous: AnalysisRun, current: AnalysisRun): RiskDiff {
  const before = new Map(
    previous.receipts.map((receipt) => [receipt.preliminary.profile.id, receipt]),
  );
  const changes: string[] = [];
  const quoteChanges: string[] = [];
  const riskChanges: string[] = [];
  const ruleChanges: string[] = [];
  const warningChanges: string[] = [];
  const assetChanges: string[] = [];

  if (previous.intent.amountIn !== current.intent.amountIn) {
    changes.push(
      `金額：${previous.intent.amountIn} → ${current.intent.amountIn} ${current.intent.tokenIn.symbol}`,
    );
  }
  if (previous.policy.template !== current.policy.template) {
    changes.push(`風險政策：${previous.policy.template} → ${current.policy.template}`);
  }
  if (previous.policy.maxSlippageBps !== current.policy.maxSlippageBps) {
    changes.push(
      `最大滑點：${previous.policy.maxSlippageBps} → ${current.policy.maxSlippageBps} bps`,
    );
  }
  if (previous.policy.maxPriceImpactBps !== current.policy.maxPriceImpactBps) {
    changes.push(
      `最大價格影響：${previous.policy.maxPriceImpactBps} → ${current.policy.maxPriceImpactBps} bps`,
    );
  }

  for (const receipt of current.receipts) {
    const old = before.get(receipt.preliminary.profile.id);
    const name = receipt.preliminary.profile.name;
    if (!old) {
      changes.push(`${name}：新加入的候選路徑`);
      continue;
    }
    const oldQuote = old.preliminary.quote;
    const quote = receipt.preliminary.quote;
    if (oldQuote.amountOut.value !== quote.amountOut.value) {
      quoteChanges.push(
        `${name} 預期輸出：${oldQuote.amountOut.value} → ${quote.amountOut.value}`,
      );
    }
    if (oldQuote.priceImpactBps.value !== quote.priceImpactBps.value) {
      quoteChanges.push(
        `${name} 價格影響：${oldQuote.priceImpactBps.value} → ${quote.priceImpactBps.value} bps`,
      );
    }
    if (old.overallRisk !== receipt.overallRisk) {
      riskChanges.push(
        `${name} 整體風險：${old.overallRisk.toUpperCase()} → ${receipt.overallRisk.toUpperCase()}`,
      );
    }
    const oldRules = new Map(old.policyRules.map((rule) => [rule.id, rule]));
    receipt.policyRules.forEach((rule) => {
      const previousRule = oldRules.get(rule.id);
      if (previousRule && previousRule.status !== rule.status) {
        ruleChanges.push(
          `${name} · ${rule.label}：${previousRule.status.toUpperCase()} → ${rule.status.toUpperCase()}`,
        );
      }
    });
    if (old.simulation.warnings.length !== receipt.simulation.warnings.length) {
      warningChanges.push(
        `${name} 模擬告警：${old.simulation.warnings.length} → ${receipt.simulation.warnings.length} 條`,
      );
    }
    const describe = (list: typeof old.simulation.assetDeltas) =>
      list.map((a) => `${a.direction}:${a.symbol}:${a.amount}`).join(", ");
    const oldAssets = describe(old.simulation.assetDeltas);
    const assets = describe(receipt.simulation.assetDeltas);
    if (oldAssets !== assets) {
      assetChanges.push(`${name} 資產變動：${oldAssets || "無"} → ${assets || "無"}`);
    }
  }

  if (
    !changes.length &&
    !quoteChanges.length &&
    !riskChanges.length &&
    !ruleChanges.length &&
    !warningChanges.length &&
    !assetChanges.length
  ) {
    changes.push("輸入、政策、報價與模擬 fixture 數據均未變化。");
  }

  return {
    parentRunId: previous.runId,
    changes,
    quoteChanges,
    riskChanges,
    ruleChanges,
    warningChanges,
    assetChanges,
  };
}

export function useAnalyzerViewModel(profiles: ProtocolProfile[]) {
  const [wallet, setWallet] = useState<WalletAccount | null>(null);
  const [action, setActionState] = useState<TradeAction>("swap");
  const [amount, setAmount] = useState("100");
  const [policy, setPolicy] = useState<RiskPolicy>(POLICY_TEMPLATES.standard);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, AnalysisSession>>({});
  const [selectedProtocolIds, setSelectedProtocolIds] = useState<string[]>([]);
  const [finals, setFinals] = useState<Record<string, FinalAssessment>>({});
  const [history, setHistory] = useState<AnalysisRun[]>([]);
  const [diff, setDiff] = useState<RiskDiff | null>(null);
  const [parentRunId, setParentRunId] = useState<string | null>(null);

  useEffect(() => setWallet(walletService.getAccount()), []);

  const reset = useCallback(() => {
    setCandidates({});
    setSelectedProtocolIds([]);
    setFinals({});
    setError(null);
    setPhase("idle");
  }, []);

  const connectWallet = useCallback(async () => {
    try {
      setWallet(await walletService.connect());
    } catch (err) {
      setError(err instanceof Error ? err.message : "錢包連接失敗。");
    }
  }, []);

  const disconnectWallet = useCallback(async () => {
    await walletService.disconnect();
    setWallet(null);
    reset();
  }, [reset]);

  const canAnalyze =
    wallet !== null &&
    /^\d+(\.\d+)?$/.test(amount) &&
    Number(amount) > 0 &&
    phase === "idle";

  const discover = useCallback(async () => {
    if (!wallet) return;
    setPhase("discovering");
    setError(null);
    setCandidates({});
    setFinals({});
    setSelectedProtocolIds([]);
    try {
      const results = await Promise.all(
        profiles.map(async (profile) => {
          const operation = profile.operations.find((item) => item.action === action);
          if (!operation) return null;
          const walletContext = await walletService.getContext(operation.tokenIn, "");
          return [
            profile.id,
            await analysisService.requestPreliminary({
              walletAddress: wallet.address,
              protocolId: profile.id,
              action,
              amountIn: amount,
              policy,
              parentRunId,
              walletContext,
            }),
          ] as const;
        }),
      );
      setCandidates(
        Object.fromEntries(
          results.filter(
            (item): item is readonly [string, AnalysisSession] => item !== null,
          ),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "候選協議發現失敗。");
    } finally {
      setPhase("idle");
    }
  }, [action, amount, parentRunId, policy, profiles, wallet]);

  const toggleProtocol = useCallback(
    (id: string) =>
      setSelectedProtocolIds((current) =>
        current.includes(id)
          ? current.filter((item) => item !== id)
          : [...current, id],
      ),
    [],
  );

  const simulateSelected = useCallback(async () => {
    const selected = selectedProtocolIds
      .map((id) => [id, candidates[id]] as const)
      .filter((entry): entry is readonly [string, AnalysisSession] =>
        Boolean(entry[1]),
      );
    if (!selected.length) return;
    setPhase("simulating");
    setError(null);
    try {
      const completed = await Promise.all(
        selected.map(
          async ([id, session]) =>
            [id, await analysisService.requestSimulation(session)] as const,
        ),
      );
      const nextFinals = Object.fromEntries(completed);
      setFinals(nextFinals);
      const first = completed[0]?.[1];
      if (first) {
        const run: AnalysisRun = {
          runId: first.runId,
          parentRunId: first.parentRunId,
          createdAt: first.generatedAt,
          intent: first.preliminary.intent,
          policy: first.preliminary.policy,
          receipts: Object.values(nextFinals),
        };
        setHistory((current) => {
          const previous = current.at(-1);
          setDiff(previous ? makeDiff(previous, run) : null);
          return [...current, run];
        });
        setParentRunId(first.runId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "模擬失敗。");
    } finally {
      setPhase("idle");
    }
  }, [candidates, selectedProtocolIds]);

  const setTemplate = useCallback(
    (template: PolicyTemplate) =>
      setPolicy(
        template === "custom"
          ? (current) => ({ ...current, template })
          : POLICY_TEMPLATES[template],
      ),
    [],
  );

  return {
    wallet,
    connectWallet,
    disconnectWallet,
    profiles,
    action,
    setAction: (value: TradeAction) => {
      setActionState(value);
      reset();
    },
    amount,
    setAmount,
    policy,
    setPolicy,
    setTemplate,
    phase,
    error,
    candidates,
    selectedProtocolIds,
    finals,
    history,
    diff,
    parentRunId,
    canAnalyze,
    canSimulate: selectedProtocolIds.length > 0 && phase === "idle",
    discover,
    toggleProtocol,
    simulateSelected,
    reset,
  };
}
