import { describe, expect, test, vi } from "vitest";
import { DEMO_ADDRESS, DEMO_RECIPIENT } from "@/components/wallet/walletData";
import {
  changedLogicalFields,
  INITIAL_FORM,
  planSubmission,
  validateForm,
} from "./form";
import {
  checkSwap,
  fetchQuote,
  formFromRunResult,
  loadReplay,
  loadRun,
} from "./service";
import type { CheckSwapInput, QuoteSwapInput } from "./types";

const input: CheckSwapInput = {
  protocol: "kuru",
  tokenIn: "MON",
  tokenOut: "USDC",
  amountIn: "0.01",
  slippage: "0.5",
  minimumReceivedSource: "unavailable",
};

const intent = {
  chainId: 143,
  protocol: "kuru",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: {
    kind: "erc20",
    address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  },
  amountInAtomic: "10000000000000000",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

const completed = {
  runId: "run-live-1",
  createdAt: "2026-08-15T08:00:00.000Z",
  replayMode: false,
  intent,
  simulatorPinnedBlock: "92820000",
  status: "completed",
  systemStatus: "OK",
  verdict: "UNKNOWN",
  summary: "Backend completed the check.",
  ruleResults: [
    {
      ruleId: "P0-EVIDENCE-001",
      status: "UNKNOWN",
      reasonCode: "CRITICAL_EVIDENCE_MISSING",
    },
  ],
  recommendedActions: [],
  irrelevantActions: [],
  evidence: [
    {
      key: "quote-1",
      kind: "generic",
      status: "confirmed",
      summary: "Live quote evidence",
      source: "quote",
      stage: "QUOTE",
      blockNumber: "92820000",
      runtimeVersion: "moss@1",
      runtimeRevision: "abc123",
      reproducibility: "REPRODUCIBLE",
      isReplay: false,
      isMock: false,
    },
  ],
  scope: [
    {
      key: "P0-EVIDENCE-001",
      label: "Evidence completeness",
      status: "unknown",
      reason: "REQUIRED_EVIDENCE_UNAVAILABLE",
    },
  ],
  route: {
    availability: "available",
    path: [intent.tokenIn, intent.tokenOut],
    blockNumber: "92820000",
  },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("checkSwap API adapter", () => {
  test("shows the same read-only identity that the API request submits", () => {
    expect(DEMO_ADDRESS).toBe("0x1111...1111");
    expect(DEMO_RECIPIENT).toBe(DEMO_ADDRESS);
  });

  test("posts only the handoff request fields and maps a completed Run", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(completed));
    const result = await checkSwap(input, { fetch: request });

    expect(request).toHaveBeenCalledOnce();
    const [, init] = request.mock.calls[0];
    const sent = JSON.parse(String(init?.body));
    expect(sent).toEqual({
      chainId: 143,
      protocol: "kuru",
      sender: "0x1111111111111111111111111111111111111111",
      tokenIn: { kind: "native" },
      tokenOut: {
        kind: "erc20",
        address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
      },
      amountIn: "0.01",
      economicBoundary: { availability: "unavailable", source: "unavailable" },
    });
    expect(sent.slippage).toBeUndefined();
    expect(result.systemStatus).toBe("OK");
    expect(result.productRunMode).toBe("LIVE");
    expect(result.createdAt).toBe(completed.createdAt);
    expect(result.quote.route.en).toBe("MON → USDC");
    expect(result.rawResponse).toEqual(completed);
  });

  test("prefers the top-level Quote projection over the simulated output", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        quote: {
          estimatedAmountOut: "0.000230",
          minimumAmountOut: "0.000228",
          source: "quote",
          blockNumber: "91383505",
          runtimeVersion: "moss@1",
          runtimeRevision: "abc123",
        },
        evidence: [
          ...completed.evidence,
          {
            key: "sim-out-1",
            kind: "simulated_token_out",
            status: "confirmed",
            summary: "Simulated output",
            source: "simulation",
            stage: "SIMULATE",
            amountReceivedAtomic: "223",
            isReplay: false,
            isMock: false,
          },
        ],
      }),
    );

    const result = await checkSwap(input, { fetch: request });

    // QUOTE-stage observation and simulation output are separate claims.
    expect(result.quote.expectedOutput).toBe("0.000230");
    expect(result.quote.blockNumber).toBe("91383505");
    expect(result.simulatedOutput).toBe("0.000223");
  });

  test("falls back to the simulated output when no Quote is projected", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        evidence: [
          ...completed.evidence,
          {
            key: "sim-out-1",
            kind: "simulated_token_out",
            status: "confirmed",
            summary: "Simulated output",
            source: "simulation",
            stage: "SIMULATE",
            amountReceivedAtomic: "223",
            isReplay: false,
            isMock: false,
          },
        ],
      }),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.quote.expectedOutput).toBe("0.000223");
    expect(result.simulatedOutput).toBe("0.000223");
  });

  test("preserves a terminal NO_ROUTE STOP without pinned-block provenance", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        verdict: "STOP",
        summary: "No executable route exists for this token pair.",
        simulatorPinnedBlock: undefined,
        route: { availability: "unavailable", reason: "NO_ROUTE" },
      }),
    );
    const result = await checkSwap(input, { fetch: request });

    expect(result.verdict).toBe("STOP");
    expect(result.summary.en).toBe(
      "No executable route exists for this token pair.",
    );
  });

  test("maps a verified ADJUST Action into display units, not atomic values", async () => {
    const adjust = {
      ...completed,
      verdict: "ADJUST",
      summary: "A verified amount adjustment can satisfy the Economic Boundary",
      intent: {
        ...intent,
        amountInAtomic: "1500000000000000000",
        economicBoundary: {
          availability: "available",
          minimumReceivedAtomic: "20000",
          source: "user_declared",
        },
      },
      recommendedActions: [
        {
          id: "verified-amount-in-adjustment",
          action: { kind: "TRANSACTION_ADJUSTMENT", field: "amountIn" },
          relevance: "RELEVANT",
          recommendable: true,
          actionReasonCode: "OUTPUT_IMPROVEMENT_VERIFIED",
          proposedChange: {
            field: "amountIn",
            before: "1500000000000000000",
            after: "1000000000000000000",
          },
        },
      ],
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(adjust));
    const result = await checkSwap(input, { fetch: request });

    expect(result.verdict).toBe("ADJUST");
    const action = result.recommendedActions[0];
    expect(action).toMatchObject({
      field: "amountIn",
      category: "TRANSACTION_CONDITION",
      recommendable: true,
    });
    // 1.5 MON → 1 MON, converted with 18 decimals rather than shown raw.
    expect(action?.proposedChange).toEqual({
      before: "1.5",
      after: "1",
      unit: "MON",
    });
    expect(action?.reason.en).toContain("not an optimal amount");
    expect(action?.reason.en).not.toContain("OUTPUT_IMPROVEMENT_VERIFIED");
  });

  test("renders a child Run Diff as amountIn in display units", async () => {
    const child = {
      ...completed,
      runId: "run-live-2",
      parentRunId: "run-live-1",
      diff: {
        previousRunId: "run-live-1",
        previousVerdict: "UNKNOWN",
        changedFields: [
          {
            field: "amountInAtomic",
            before: "10000000000000000",
            after: "20000000000000000",
          },
        ],
      },
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(child));
    const result = await checkSwap(input, { fetch: request });

    expect(result.diff).toEqual([
      {
        field: { en: "amountIn", zh: "amountIn" },
        previous: { en: "0.01 MON", zh: "0.01 MON" },
        next: { en: "0.02 MON", zh: "0.02 MON" },
        direction: "changed",
      },
    ]);
  });

  test("leaves non-amount Diff fields untouched", async () => {
    const child = {
      ...completed,
      runId: "run-live-3",
      parentRunId: "run-live-1",
      diff: {
        previousRunId: "run-live-1",
        previousVerdict: "UNKNOWN",
        changedFields: [
          { field: "protocol", before: "kuru", after: "pancake" },
        ],
      },
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(child));
    const result = await checkSwap(input, { fetch: request });

    expect(result.diff?.[0]?.field.en).toBe("protocol");
    expect(result.diff?.[0]?.previous.en).toBe("kuru");
    expect(result.diff?.[0]?.next.en).toBe("pancake");
  });

  test("prefers a nested Run retryable=false over the HTTP 502 fallback", async () => {
    const run = {
      ...completed,
      runId: "failed-1",
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "RPC unavailable",
      error: {
        code: "RPC_UNAVAILABLE",
        stage: "quote",
        message: "Dependency unavailable",
        retryable: false,
      },
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "AGENT_FLOW_ERROR", message: "Flow failed" }, run },
          502,
        ),
      );
    const result = await checkSwap(input, { fetch: request });

    expect(result.systemStatus).toBe("INTEGRATION_ERROR");
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.apiFailure).toMatchObject({
      httpStatus: 502,
      code: "AGENT_FLOW_ERROR",
      stage: "quote",
      retryable: false,
    });
    expect(result.rawResponse).toMatchObject({
      error: { code: "AGENT_FLOW_ERROR" },
      run: { runId: "failed-1" },
    });
  });

  test("surfaces backend field issues from a normalization failure", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "NORMALIZATION_FAILED",
            message: "The check request could not be normalized",
            issues: {
              code: "TOO_MANY_DECIMAL_PLACES",
              field: "economicBoundary.minimumReceived",
              message: "Amount supports at most 6 decimal places",
            },
          },
        },
        400,
      ),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.apiFailure).toMatchObject({
      httpStatus: 400,
      code: "NORMALIZATION_FAILED",
      retryable: false,
      issues: [
        {
          code: "TOO_MANY_DECIMAL_PLACES",
          field: "economicBoundary.minimumReceived",
          message: "Amount supports at most 6 decimal places",
        },
      ],
    });
    expect(result.summary.en).toContain("economicBoundary.minimumReceived");
    expect(result.summary.en).toContain("at most 6 decimal places");
  });

  test("names the rejected field when the backend reports Zod path segments", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "INVALID_REQUEST",
            issues: [
              {
                code: "custom",
                message: "Expected an amount greater than zero",
                path: ["economicBoundary", "minimumReceived"],
              },
            ],
          },
        },
        400,
      ),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.apiFailure).toMatchObject({
      code: "INVALID_REQUEST",
      issues: [
        {
          field: "economicBoundary.minimumReceived",
          message: "Expected an amount greater than zero",
        },
      ],
    });
  });

  test("preserves INVALID_RERUN reason in the error-page model", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "INVALID_RERUN",
            reason: "PARENT_NOT_FOUND",
            message: "Parent is no longer in memory",
          },
        },
        400,
      ),
    );
    const result = await checkSwap(
      { ...input, parentRunId: "gone" },
      { fetch: request },
    );

    expect(result.apiFailure).toMatchObject({
      code: "INVALID_RERUN",
      reason: "PARENT_NOT_FOUND",
      retryable: false,
    });
    expect(result.rawResponse).toEqual(
      expect.objectContaining({ error: expect.any(Object) }),
    );
  });

  test("turns a fetch exception into a retryable NETWORK_ERROR page", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await checkSwap(input, { fetch: request });

    expect(result.systemStatus).toBe("INTEGRATION_ERROR");
    expect(result.apiFailure).toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
  });
});

describe("fetchQuote", () => {
  const quoteInput: QuoteSwapInput = {
    protocol: "kuru",
    tokenIn: "MON",
    tokenOut: "USDC",
    amountIn: "0.01",
  };

  const available = {
    status: "available",
    quote: {
      estimatedAmountOut: "0.000223",
      minimumAmountOut: "0.000221",
      source: "quote",
      blockNumber: "91383505",
      fetchedAt: "2026-08-08T12:00:00.000Z",
      runtimeVersion: "0.1.0",
      runtimeRevision: "a".repeat(40),
    },
  };

  test("posts only the exact-input quote contract fields", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(available));

    await fetchQuote(quoteInput, { fetch: request });

    expect(request.mock.calls[0]?.[0]).toBe("/api/quote");
    const sent = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(sent).toEqual({
      chainId: 143,
      protocol: "kuru",
      sender: "0x1111111111111111111111111111111111111111",
      tokenIn: { kind: "native" },
      tokenOut: {
        kind: "erc20",
        address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
      },
      amountIn: "0.01",
    });
    // Quote has no boundary, rerun, or slippage inputs in the handoff contract.
    expect(sent.economicBoundary).toBeUndefined();
    expect(sent.parentRunId).toBeUndefined();
    expect(sent.slippage).toBeUndefined();
  });

  test("keeps backend human-unit amounts verbatim", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(available));

    const state = await fetchQuote(quoteInput, { fetch: request });

    expect(state).toEqual({
      status: "available",
      quote: {
        estimatedAmountOut: "0.000223",
        minimumAmountOut: "0.000221",
        blockNumber: "91383505",
        fetchedAt: "2026-08-08T12:00:00.000Z",
        runtimeVersion: "0.1.0",
        runtimeRevision: "a".repeat(40),
      },
    });
  });

  test("treats a 200 unavailable payload as a product state, not an error", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ status: "unavailable", reason: "NO_ROUTE" }),
      );

    expect(await fetchQuote(quoteInput, { fetch: request })).toEqual({
      status: "unavailable",
      reason: "NO_ROUTE",
    });
  });

  test("rejects an available Quote that is missing stage provenance", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: "available",
        quote: { ...available.quote, blockNumber: undefined },
      }),
    );

    expect(await fetchQuote(quoteInput, { fetch: request })).toMatchObject({
      status: "error",
      apiFailure: { code: "INVALID_RESPONSE", retryable: false },
    });
  });

  test("maps a QUOTE_ERROR to a retryable transport failure", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "QUOTE_ERROR", message: "flow failed" } },
          502,
        ),
      );

    expect(await fetchQuote(quoteInput, { fetch: request })).toMatchObject({
      status: "error",
      apiFailure: { httpStatus: 502, code: "QUOTE_ERROR", retryable: true },
    });
  });

  test("does not offer retry when the live Quote flow is unwired", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "UNSUPPORTED", message: "not configured" } },
          502,
        ),
      );

    expect(await fetchQuote(quoteInput, { fetch: request })).toMatchObject({
      status: "error",
      apiFailure: { code: "UNSUPPORTED", retryable: false },
    });
  });
});

describe("loadReplay", () => {
  const recorded = {
    runId: "recorded-kuru-mon-to-usdc-91383505",
    replayMode: true,
    intent: {
      ...intent,
      sender: "0xcccccccccccccccccccccccccccccccccccccccc",
      recipient: "0xcccccccccccccccccccccccccccccccccccccccc",
      amountInAtomic: "10000000000000000",
    },
    status: "completed",
    systemStatus: "OK",
    verdict: "UNKNOWN",
    summary: "Recorded Kuru replay: MON to USDC.",
    ruleResults: [],
    recommendedActions: [],
    irrelevantActions: [],
    evidence: [
      {
        key: "mon-to-usdc:quote",
        kind: "generic",
        status: "confirmed",
        summary: "Recorded Quote Evidence",
        source: "quote",
        stage: "QUOTE",
        isReplay: true,
        isMock: false,
        fixtureId: "mon-to-usdc",
      },
    ],
    scope: [],
  };

  test("maps a recorded Run as RECORDED_REPLAY", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(recorded));
    const result = await loadReplay("mon-to-usdc", { fetch: request });

    expect(request.mock.calls[0]?.[0]).toBe("/api/replay/mon-to-usdc");
    expect(result.productRunMode).toBe("RECORDED_REPLAY");
    expect(result.replayMode).toBe(true);
    // Without an override the recorded atomic amount is what gets shown.
    expect(result.intent.amountIn).toBe("0.01");
  });

  test("keeps a replay transport failure as an error page", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "REPLAY_NOT_FOUND", message: "missing" } },
          404,
        ),
      );
    const result = await loadReplay("mon-to-usdc", {
      fetch: request,
    });

    expect(result.systemStatus).toBe("INTEGRATION_ERROR");
    expect(result.apiFailure).toMatchObject({
      code: "REPLAY_NOT_FOUND",
      retryable: false,
    });
  });
});

describe("loadRun", () => {
  test("maps a persisted terminal record and encodes the run ID", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        runId: "run live",
        createdAt: completed.createdAt,
        intent,
        status: "completed",
        result: { ...completed, runId: "run live", createdAt: undefined },
      }),
    );

    const recovery = await loadRun("run live", { fetch: request });

    expect(request.mock.calls[0]?.[0]).toBe("/api/runs/run%20live");
    expect(recovery.kind).toBe("terminal");
    if (recovery.kind === "terminal") {
      expect(recovery.result.runId).toBe("run live");
      expect(recovery.result.productRunMode).toBe("LIVE");
      expect(recovery.result.createdAt).toBe(completed.createdAt);
    }
  });

  test("keeps the Receipt creation time stable across recovery", async () => {
    const initialRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(completed));
    const initial = await checkSwap(input, { fetch: initialRequest });
    const recoveryRequest = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        runId: completed.runId,
        createdAt: completed.createdAt,
        intent,
        status: "completed",
        result: completed,
      }),
    );

    const recovery = await loadRun(completed.runId, {
      fetch: recoveryRequest,
    });

    expect(recovery).toMatchObject({
      kind: "terminal",
      result: { runId: initial.runId, createdAt: initial.createdAt },
    });
  });

  test("returns started state without fabricating a result", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ runId: "started-run", intent, status: "started" }),
      );

    await expect(loadRun("started-run", { fetch: request })).resolves.toEqual({
      kind: "started",
      runId: "started-run",
    });
  });

  test("maps a missing persisted Run to a non-retryable failure", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "RUN_NOT_FOUND", message: "missing" } },
          404,
        ),
      );

    await expect(loadRun("missing-run", { fetch: request })).resolves.toEqual({
      kind: "error",
      failure: {
        httpStatus: 404,
        code: "RUN_NOT_FOUND",
        retryable: false,
        message: "missing",
      },
    });
  });

  test("reconstructs the form needed to continue a recovered Run", async () => {
    const result = await mapRunForTest({ ...completed, runId: "run-live-1" });

    expect(formFromRunResult(result)).toMatchObject({
      protocol: "kuru",
      tokenIn: "MON",
      tokenOut: "USDC",
      amountIn: "0.01",
      minimumReceived: "",
    });
  });
});

function mapRunForTest(raw: unknown) {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    jsonResponse({
      runId: "run-live-1",
      intent,
      status: "completed",
      result: raw,
    }),
  );
  return loadRun("run-live-1", {
    fetch: request,
  }).then((recovery) => {
    if (recovery.kind !== "terminal") {
      throw new Error("test fixture did not produce a terminal Run");
    }
    return recovery.result;
  });
}

describe("form validation and backend-supported reruns", () => {
  test("validates the initial live request", () => {
    expect(validateForm(INITIAL_FORM).valid).toBe(true);
  });

  test("rejects decimal formats the public API contract does not accept", () => {
    for (const value of [".0003", "1e-3", "0,0003", " 0.0003 "]) {
      const validation = validateForm({
        ...INITIAL_FORM,
        minimumReceived: value,
      });
      expect(validation.valid).toBe(false);
      if (!validation.valid) {
        expect(validation.errors.minimumReceived?.en).toContain("0.0003");
      }
    }
  });

  test("accepts a plain-decimal Minimum Received", () => {
    expect(
      validateForm({ ...INITIAL_FORM, minimumReceived: "0.0003" }).valid,
    ).toBe(true);
  });

  test("rejects non-contract amountIn formats before calling the API", () => {
    const validation = validateForm({ ...INITIAL_FORM, amountIn: ".01" });
    expect(validation.valid).toBe(false);
    if (!validation.valid) {
      expect(validation.errors.amountIn?.en).toContain("0.01");
    }
  });

  test("counts amount and boundary as two backend intent changes", () => {
    expect(
      changedLogicalFields(INITIAL_FORM, {
        ...INITIAL_FORM,
        amountIn: "0.02",
        minimumReceived: "20",
      }),
    ).toEqual(["amountIn", "minimumReceived"]);
  });

  test("does not treat slippage as an API rerun condition", () => {
    expect(
      changedLogicalFields(INITIAL_FORM, { ...INITIAL_FORM, slippage: "1" }),
    ).toEqual([]);
    const plan = planSubmission(
      { ...INITIAL_FORM, slippage: "1" },
      INITIAL_FORM,
    );
    expect(plan.allowed).toBe(false);
  });

  test("allows exactly one supported rerun change", () => {
    expect(
      planSubmission({ ...INITIAL_FORM, amountIn: "0.02" }, INITIAL_FORM)
        .allowed,
    ).toBe(true);
  });
});
