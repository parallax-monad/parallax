/**
 * Backend P0 acceptance matrix at the Check Application boundary.
 *
 * Delivery entry: `pnpm test:acceptance`
 * Spec: docs/integration/backend-p0-acceptance.md
 *
 * Live Moss SUCCESS is intentionally out of scope here.
 */
import type {
  CheckSwapRequest,
  EvidenceItem,
  EvidenceRef,
  NormalizedSwapIntent,
  RunResult,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { CheckApplicationService } from "./application.js";
import { normalizeCheckSwapRequest } from "./normalization.js";
import { type AgentFlowPort, UnsupportedAgentFlowError } from "./ports.js";
import type { BackendRuntime } from "./runtime-config.js";
import { InMemoryRunStore, type RunStore } from "./store.js";
import {
  economicFailStopResult,
  economicPassChildResult,
} from "@parallax/orchestrator/application/action-gate-fixtures";
import { createTrustedTokenRegistry } from "./trusted-token-registry.js";

const sender = "0x1111111111111111111111111111111111111111";
const usdcAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const mon = { kind: "native" as const };
const usdc = { kind: "erc20" as const, address: usdcAddress };
const simulatorPinnedBlock = "92820000";

const tokenRegistryConfig = {
  chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
  tokens: [
    {
      chainId: 143,
      address: usdcAddress,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "90000000",
    },
  ],
};

const runtime: BackendRuntime = {
  config: {
    tokenRegistry: tokenRegistryConfig,
    moss: {
      rpcUrl: "https://rpc.example.test",
      runtimeVersion: "moss-0.1.0",
      runtimeRevision: "revision-1",
    },
  },
  tokenRegistry: createTrustedTokenRegistry(tokenRegistryConfig),
};

const actionGateAssets = {
  sender,
  mon,
  usdc,
  simulatorPinnedBlock,
  runtimeVersion: runtime.config.moss.runtimeVersion,
  runtimeRevision: runtime.config.moss.runtimeRevision,
};

type CompletedRunResult = Extract<RunResult, { status: "completed" }>;

function publicRequest(
  overrides: Partial<CheckSwapRequest> = {},
): CheckSwapRequest {
  return {
    chainId: 143,
    protocol: "kuru",
    sender,
    tokenIn: mon,
    tokenOut: usdc,
    amountIn: "1.5",
    economicBoundary: {
      availability: "unavailable",
      source: "unavailable",
    },
    ...overrides,
  };
}

function evidenceRef(evidence: EvidenceItem): EvidenceRef {
  return {
    key: evidence.key,
    source: evidence.source,
    stage: evidence.stage,
    blockNumber: evidence.blockNumber,
    simulatorPinnedBlock: evidence.simulatorPinnedBlock,
    runtimeVersion: evidence.runtimeVersion,
    runtimeRevision: evidence.runtimeRevision,
    fixtureId: evidence.fixtureId,
    reproducibility: evidence.reproducibility,
    isReplay: evidence.isReplay,
    isMock: evidence.isMock,
  };
}

function completedRunResult(
  runId: string,
  intent: NormalizedSwapIntent,
  overrides: Pick<
    CompletedRunResult,
    "ruleResults" | "evidence" | "scope" | "route" | "verdict" | "summary"
  >,
): CompletedRunResult {
  const { verdict, summary, ...rest } = overrides;
  return {
    runId,
    replayMode: false,
    intent,
    simulatorPinnedBlock,
    status: "completed",
    systemStatus: "OK",
    verdict,
    summary,
    recommendedActions: [],
    irrelevantActions: [],
    ...rest,
  };
}

function completedUnknownResult(
  runId: string,
  intent: NormalizedSwapIntent,
): CompletedRunResult {
  const routeEvidence = {
    kind: "generic" as const,
    key: "route-quote",
    status: "confirmed" as const,
    summary: "Moss returned a route for the checked Intent",
    source: "quote" as const,
    stage: "QUOTE" as const,
    blockNumber: "12345",
    simulatorPinnedBlock,
    runtimeVersion: runtime.config.moss.runtimeVersion,
    runtimeRevision: runtime.config.moss.runtimeRevision,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
    routeInputRole: "ROUTE_QUOTE" as const,
  };

  return completedRunResult(runId, intent, {
    verdict: "UNKNOWN",
    summary: "Live check could not establish a trustworthy result",
    ruleResults: [
      {
        ruleId: "P0-ECONOMIC-001",
        status: "NOT_APPLICABLE",
        applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
        evidenceRefs: [],
        actionEvaluations: [],
      },
    ],
    evidence: [routeEvidence],
    scope: [
      {
        key: "P0-ECONOMIC-001",
        label: "Economic result",
        status: "not_checked",
        reason: "PRECONDITION_ABSENT",
      },
      {
        key: "OUTSIDE_P0_SCOPE",
        label: "Complete protocol security",
        status: "not_checked",
        reason: "OUTSIDE_P0_SCOPE",
      },
    ],
    route: {
      availability: "available",
      protocol: "kuru",
      path: [mon, usdc],
      source: "quote",
      blockNumber: "12345",
      evidenceRef: evidenceRef(routeEvidence),
    },
  });
}

function completedProceedResult(
  runId: string,
  intent: NormalizedSwapIntent,
): CompletedRunResult {
  const evidence = {
    kind: "generic" as const,
    key: "evidence-completeness",
    status: "confirmed" as const,
    summary: "P0 Evidence completeness is verified",
    source: "derived" as const,
    stage: "SIMULATE" as const,
    blockNumber: "12345",
    simulatorPinnedBlock,
    runtimeVersion: runtime.config.moss.runtimeVersion,
    runtimeRevision: runtime.config.moss.runtimeRevision,
    coreRole: "EVIDENCE_COMPLETENESS" as const,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
  };

  return completedRunResult(runId, intent, {
    verdict: "PROCEED",
    summary: "P0 Evidence completeness is verified",
    ruleResults: [
      {
        ruleId: "P0-EVIDENCE-001",
        status: "PASS",
        evidenceRefs: [evidenceRef(evidence)],
        actionEvaluations: [],
      },
      {
        ruleId: "P0-ECONOMIC-001",
        status: "NOT_APPLICABLE",
        applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
        evidenceRefs: [],
        actionEvaluations: [],
      },
    ],
    evidence: [evidence],
    scope: [
      {
        key: "P0-EVIDENCE-001",
        label: "Evidence result",
        status: "checked",
      },
      {
        key: "P0-ECONOMIC-001",
        label: "Economic result",
        status: "not_checked",
        reason: "PRECONDITION_ABSENT",
      },
      {
        key: "OUTSIDE_P0_SCOPE",
        label: "Complete protocol security",
        status: "not_checked",
        reason: "OUTSIDE_P0_SCOPE",
      },
    ],
    route: {
      availability: "unavailable",
      reason: "No route in test fixture",
    },
  });
}

function stageEvidenceResult(
  runId: string,
  intent: NormalizedSwapIntent,
): CompletedRunResult {
  const quote = {
    kind: "generic" as const,
    key: "stage-quote",
    status: "confirmed" as const,
    summary: "Quote stage Evidence",
    source: "quote" as const,
    stage: "QUOTE" as const,
    blockNumber: "100",
    simulatorPinnedBlock,
    runtimeVersion: runtime.config.moss.runtimeVersion,
    runtimeRevision: runtime.config.moss.runtimeRevision,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
    routeInputRole: "ROUTE_QUOTE" as const,
  };
  const action = {
    kind: "generic" as const,
    key: "stage-action",
    status: "confirmed" as const,
    summary: "Action stage Evidence",
    source: "moss" as const,
    stage: "ACTION" as const,
    blockNumber: "100",
    simulatorPinnedBlock,
    runtimeVersion: runtime.config.moss.runtimeVersion,
    runtimeRevision: runtime.config.moss.runtimeRevision,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
  };
  const simulate = {
    kind: "generic" as const,
    key: "stage-simulate",
    status: "confirmed" as const,
    summary: "Simulate stage Evidence",
    source: "derived" as const,
    stage: "SIMULATE" as const,
    blockNumber: "100",
    simulatorPinnedBlock,
    runtimeVersion: runtime.config.moss.runtimeVersion,
    runtimeRevision: runtime.config.moss.runtimeRevision,
    coreRole: "EVIDENCE_COMPLETENESS" as const,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
  };

  return completedRunResult(runId, intent, {
    verdict: "UNKNOWN",
    summary: "Stage Evidence preserved for acceptance",
    ruleResults: [
      {
        ruleId: "P0-EVIDENCE-001",
        status: "PASS",
        evidenceRefs: [evidenceRef(simulate)],
        actionEvaluations: [],
      },
      {
        ruleId: "P0-ECONOMIC-001",
        status: "NOT_APPLICABLE",
        applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
        evidenceRefs: [],
        actionEvaluations: [],
      },
    ],
    evidence: [quote, action, simulate],
    scope: [
      {
        key: "P0-EVIDENCE-001",
        label: "Evidence result",
        status: "checked",
      },
      {
        key: "P0-ECONOMIC-001",
        label: "Economic result",
        status: "not_checked",
        reason: "PRECONDITION_ABSENT",
      },
      {
        key: "OUTSIDE_P0_SCOPE",
        label: "Complete protocol security",
        status: "not_checked",
        reason: "OUTSIDE_P0_SCOPE",
      },
    ],
    route: {
      availability: "available",
      protocol: "kuru",
      path: [mon, usdc],
      source: "quote",
      blockNumber: "100",
      evidenceRef: evidenceRef(quote),
    },
  });
}

function integrationErrorResult(
  runId: string,
  intent: NormalizedSwapIntent,
): RunResult {
  return {
    runId,
    replayMode: false,
    intent,
    status: "integration_error",
    systemStatus: "INTEGRATION_ERROR",
    verdict: "UNKNOWN",
    summary: "Moss is unavailable",
    error: {
      code: "MOSS_UNAVAILABLE",
      stage: "unknown",
      message: "Moss runtime is not connected",
      retryable: true,
    },
    ruleResults: [],
    recommendedActions: [],
    irrelevantActions: [],
    evidence: [],
    scope: [
      {
        key: "P0-CHECK-SIMULATION-001",
        label: "Moss simulation",
        status: "unknown",
        reason: "REQUIRED_CHECK_INTERRUPTED",
      },
    ],
  };
}

function createService(
  agentFlow: AgentFlowPort,
  store: RunStore = new InMemoryRunStore(),
  createRunId: () => string = () => "run-1",
) {
  return new CheckApplicationService({
    runtime,
    agentFlow,
    store,
    createRunId,
  });
}

describe("Backend P0 acceptance matrix", () => {
  it("A1 PROCEED: stores a completed Proceed Run", async () => {
    const store = new InMemoryRunStore();
    const service = createService(
      {
        async check(input) {
          return completedProceedResult(input.runId, input.intent);
        },
      },
      store,
    );

    const response = await service.check(publicRequest());

    expect(response).toMatchObject({
      status: 200,
      body: {
        status: "completed",
        systemStatus: "OK",
        verdict: "PROCEED",
        replayMode: false,
        simulatorPinnedBlock,
      },
    });
    expect(store.get("run-1")).toMatchObject({
      status: "completed",
      result: response.status === 200 ? response.body : undefined,
    });
  });

  it("A2 STOP: closes an unattested ADJUST without public Actions", async () => {
    const service = createService({
      async check(input) {
        return {
          ...completedUnknownResult(input.runId, input.intent),
          verdict: "ADJUST" as const,
          summary: "Adjustment candidate",
          recommendedActions: [],
        };
      },
    });

    const response = await service.check(publicRequest());

    expect(response).toMatchObject({
      status: 200,
      body: {
        verdict: "STOP",
        recommendedActions: [],
        summary:
          "No verified child Run and Action Gate attestation is available",
      },
    });
  });

  it("A3 UNKNOWN: preserves a completed Unknown verdict", async () => {
    const response = await createService({
      async check(input) {
        return completedUnknownResult(input.runId, input.intent);
      },
    }).check(publicRequest());

    expect(response).toMatchObject({
      status: 200,
      body: {
        status: "completed",
        verdict: "UNKNOWN",
        replayMode: false,
      },
    });
  });

  it("A4 Integration Error: stores an isolated integration_error Run", async () => {
    const store = new InMemoryRunStore();
    const response = await createService(
      {
        async check(input) {
          return integrationErrorResult(input.runId, input.intent);
        },
      },
      store,
    ).check(publicRequest());

    expect(response).toMatchObject({
      status: 200,
      body: {
        status: "integration_error",
        systemStatus: "INTEGRATION_ERROR",
        verdict: "UNKNOWN",
        error: {
          code: "MOSS_UNAVAILABLE",
          retryable: true,
        },
      },
    });
    expect(store.get("run-1")).toMatchObject({ status: "completed" });
  });

  // API boundary only: Evidence stage labels round-trip. Does not run Moss stages.
  it("A5 Stage evidence: preserves Quote, Action, and Simulate Evidence", async () => {
    const response = await createService({
      async check(input) {
        return stageEvidenceResult(input.runId, input.intent);
      },
    }).check(publicRequest());

    expect(response.status).toBe(200);
    if (response.status !== 200) {
      throw new Error("expected completed acceptance response");
    }
    expect(response.body.evidence.map((item) => item.stage)).toEqual([
      "QUOTE",
      "ACTION",
      "SIMULATE",
    ]);
    expect(
      response.body.evidence.every((item) => item.isReplay === false),
    ).toBe(true);
  });

  it.each([
    {
      id: "A6",
      name: "Timeout",
      cause: {
        code: "TIMEOUT",
        stage: "SIMULATE",
        integrationStatus: "TIMEOUT",
      },
      expected: {
        code: "TIMEOUT",
        stage: "simulation",
        retryable: true,
      },
    },
    {
      id: "A7",
      name: "RPC unavailable",
      cause: {
        code: "UNAVAILABLE",
        stage: "QUOTE",
        integrationStatus: "UNAVAILABLE",
        source: "rpc",
      },
      expected: {
        code: "RPC_UNAVAILABLE",
        stage: "quote",
        retryable: true,
      },
    },
    {
      id: "A8",
      name: "Moss unavailable",
      cause: {
        code: "UNAVAILABLE",
        stage: "LOAD",
        integrationStatus: "UNAVAILABLE",
        source: "moss",
      },
      expected: {
        code: "MOSS_UNAVAILABLE",
        stage: "unknown",
        retryable: true,
      },
    },
  ])(
    "$id $name: maps structured Agent Flow failure without protocol-risk STOP",
    async (testCase) => {
      const store = new InMemoryRunStore();
      const response = await createService(
        {
          async check() {
            throw testCase.cause;
          },
        },
        store,
      ).check(publicRequest());

      expect(response).toMatchObject({
        status: 502,
        body: {
          run: {
            status: "integration_error",
            verdict: "UNKNOWN",
            error: testCase.expected,
          },
        },
      });
      expect(store.get("run-1")).toMatchObject({ status: "failed" });
    },
  );

  it("A9 Unsupported: returns non-retryable UNSUPPORTED when live flow is unwired", async () => {
    const store = new InMemoryRunStore();
    const response = await createService(
      {
        async check() {
          throw new UnsupportedAgentFlowError();
        },
      },
      store,
    ).check(publicRequest());

    expect(response).toMatchObject({
      status: 502,
      body: {
        error: { code: "UNSUPPORTED" },
        run: {
          verdict: "UNKNOWN",
          error: { code: "UNSUPPORTED", retryable: false },
        },
      },
    });
    expect(store.get("run-1")).toMatchObject({ failure: "UNSUPPORTED" });
  });

  // Replay rejection on the live path is A11, not this row.
  it("A10 Provenance: requires and preserves simulator pinned-block", async () => {
    const preserved = await createService({
      async check(input) {
        return completedUnknownResult(input.runId, input.intent);
      },
    }).check(publicRequest());

    expect(preserved).toMatchObject({
      status: 200,
      body: { simulatorPinnedBlock },
    });
    if (preserved.status === 200) {
      expect(
        preserved.body.evidence.every(
          (item) => item.simulatorPinnedBlock === simulatorPinnedBlock,
        ),
      ).toBe(true);
    }

    const rejected = await createService({
      async check(input) {
        const result = completedUnknownResult(input.runId, input.intent);
        const { simulatorPinnedBlock: _removed, ...withoutBlock } = result;
        return withoutBlock;
      },
    }).check(publicRequest());

    expect(rejected).toMatchObject({
      status: 502,
      body: { error: { code: "INVALID_AGENT_FLOW_RESPONSE" } },
    });
  });

  it("A11 Replay/Live separation: rejects replay on the live check path and as Re-run baseline", async () => {
    const liveRejectsReplay = await createService({
      async check(input) {
        return {
          ...completedUnknownResult(input.runId, input.intent),
          replayMode: true,
        };
      },
    }).check(publicRequest());

    expect(liveRejectsReplay).toMatchObject({
      status: 502,
      body: { error: { code: "INVALID_AGENT_FLOW_RESPONSE" } },
    });

    const store = new InMemoryRunStore();
    const normalized = normalizeCheckSwapRequest(
      publicRequest(),
      runtime.tokenRegistry,
    );
    if (!normalized.success) {
      throw new Error("expected normalized Intent for replay baseline");
    }
    await store.start("run-1", normalized.intent);
    await store.complete({
      ...completedUnknownResult("run-1", normalized.intent),
      replayMode: true,
      evidence: completedUnknownResult("run-1", normalized.intent).evidence.map(
        (item) => ({
          ...item,
          isReplay: true,
          fixtureId: "mon-to-usdc",
        }),
      ),
    });

    const response = await createService(
      {
        async check() {
          throw new Error("must not run");
        },
      },
      store,
      () => "run-2",
    ).check(publicRequest({ parentRunId: "run-1", amountIn: "2" }));

    expect(response).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "INVALID_RERUN",
          reason: "PARENT_IS_REPLAY",
        },
      },
    });
  });

  it("A12 Re-run: rejects more than one changed Intent condition", async () => {
    const store = new InMemoryRunStore();
    await createService(
      {
        async check(input) {
          return completedUnknownResult(input.runId, input.intent);
        },
      },
      store,
    ).check(publicRequest());

    const response = await createService(
      {
        async check() {
          throw new Error("must not run");
        },
      },
      store,
      () => "run-2",
    ).check(
      publicRequest({
        parentRunId: "run-1",
        amountIn: "2",
        protocol: "pancake",
      }),
    );

    expect(response).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "INVALID_RERUN",
          reason: "NOT_EXACTLY_ONE_CHANGE",
          message: "A Re-run must change exactly one supported Intent field",
        },
      },
    });
    expect(store.get("run-2")).toBeUndefined();
  });

  it("A13 Child Run failure: keeps parentRunId and Diff when Agent Flow fails", async () => {
    const store = new InMemoryRunStore();
    await createService(
      {
        async check(input) {
          return completedUnknownResult(input.runId, input.intent);
        },
      },
      store,
    ).check(publicRequest());

    const response = await createService(
      {
        async check() {
          throw {
            code: "TIMEOUT",
            stage: "SIMULATE",
            integrationStatus: "TIMEOUT",
          };
        },
      },
      store,
      () => "run-2",
    ).check(publicRequest({ parentRunId: "run-1", amountIn: "2" }));

    expect(response).toMatchObject({
      status: 502,
      body: {
        run: {
          runId: "run-2",
          parentRunId: "run-1",
          status: "integration_error",
          verdict: "UNKNOWN",
          diff: {
            previousRunId: "run-1",
            changedFields: [
              {
                field: "amountInAtomic",
                before: "1500000000000000000",
                after: "2000000000000000000",
              },
            ],
          },
          error: { code: "TIMEOUT", retryable: true },
        },
      },
    });
    expect(store.get("run-2")).toMatchObject({
      status: "failed",
      parentRunId: "run-1",
      result: {
        parentRunId: "run-1",
        diff: {
          previousRunId: "run-1",
        },
      },
    });
  });

  it("A14 ADJUST: publishes verified amountIn Action Gate Actions", async () => {
    const store = new InMemoryRunStore();
    let nextId = 1;
    const response = await createService(
      {
        async check(input) {
          if (input.runId === "run-1") {
            return economicFailStopResult(
              actionGateAssets,
              input.runId,
              input.intent,
            );
          }
          return economicPassChildResult(
            actionGateAssets,
            input.runId,
            input.intent,
          );
        },
      },
      store,
      () => `run-${nextId++}`,
    ).check(
      publicRequest({
        economicBoundary: {
          availability: "available",
          minimumReceived: "0.02",
          source: "user_declared",
        },
      }),
    );

    expect(response).toMatchObject({
      status: 200,
      body: {
        runId: "run-1",
        status: "completed",
        verdict: "ADJUST",
        recommendedActions: [
          {
            action: { kind: "TRANSACTION_ADJUSTMENT", field: "amountIn" },
            recommendable: true,
            actionReasonCode: "OUTPUT_IMPROVEMENT_VERIFIED",
            proposedChange: {
              field: "amountIn",
              before: "1500000000000000000",
              after: "1000000000000000000",
            },
          },
        ],
      },
    });
    expect(
      response.status === 200 &&
        response.body.status === "completed" &&
        response.body.evidence.some(
          (item) =>
            item.kind === "action_verification" &&
            item.verificationRunId === "run-2",
        ),
    ).toBe(true);
    expect(store.get("run-2")).toMatchObject({
      status: "completed",
      parentRunId: "run-1",
    });
  });
});
