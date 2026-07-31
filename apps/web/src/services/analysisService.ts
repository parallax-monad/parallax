import { finalAssessment } from "@/lib/finalAssessment";
import { fixtureQuote, fixtureSimulation } from "@/lib/sources/fixtures";
import { buildIntent, runPreliminary } from "@/lib/stage1Preliminary";
import type {
  AnalysisSession,
  FinalAssessment,
  RiskPolicy,
  TradeAction,
  WalletContextInput,
} from "@/lib/types";

export interface PreliminaryInput {
  walletAddress: string;
  protocolId: string;
  action: TradeAction;
  amountIn: string;
  policy: RiskPolicy;
  parentRunId?: string | null;
  walletContext?: WalletContextInput;
}

const sessions = new Map<string, AnalysisSession>();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export const analysisService = {
  async requestPreliminary(input: PreliminaryInput): Promise<AnalysisSession> {
    const intent = buildIntent(input);
    const preliminary = await runPreliminary(intent, input.policy);
    const createdAt = new Date().toISOString();
    const session: AnalysisSession = {
      id: id("session"),
      runId: id("run"),
      createdAt,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      parentRunId: input.parentRunId ?? null,
      preliminary,
    };
    sessions.set(session.id, session);
    return session;
  },

  async requestSimulation(session: AnalysisSession): Promise<FinalAssessment> {
    const active = sessions.get(session.id) ?? session;
    if (Date.parse(active.expiresAt) < Date.now()) {
      sessions.delete(active.id);
      throw new Error("分析會話已過期，請重新建立風險收據。");
    }
    const simulation = fixtureSimulation(
      active.preliminary.intent,
      active.preliminary.quote,
    );
    const analysis = finalAssessment(
      active.preliminary,
      simulation,
      active.runId,
      active.parentRunId,
    );
    sessions.delete(active.id);
    return analysis;
  },
};

export { fixtureQuote };
