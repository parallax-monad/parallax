import { describe, expect, test, vi } from "vitest";
import { DEMO_ADDRESS, DEMO_RECIPIENT } from "@/components/wallet/walletData";
import {
  changedLogicalFields,
  INITIAL_FORM,
  planSubmission,
  validateForm,
} from "./form";
import { checkSwap } from "./service";
import type { CheckSwapInput } from "./types";

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
    expect(result.quote.route.en).toBe("MON → USDC");
    expect(result.rawResponse).toEqual(completed);
  });

  test("fails a live authoritative verdict closed when pinned-block provenance is missing", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        verdict: "PROCEED",
        simulatorPinnedBlock: undefined,
      }),
    );
    const result = await checkSwap(input, { fetch: request });

    expect(result.verdict).toBe("UNKNOWN");
    expect(result.summary.en).toContain("simulatorPinnedBlock");
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

describe("form validation and backend-supported reruns", () => {
  test("validates the initial live request", () => {
    expect(validateForm(INITIAL_FORM).valid).toBe(true);
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
