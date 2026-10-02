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
  fetchP0Config,
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

const tokenMetadata = {
  tokenIn: {
    chainId: 143,
    asset: { kind: "native" },
    symbol: "MON",
    decimals: 18,
    decimalsSource: "chain_config",
  },
  tokenOut: {
    chainId: 143,
    asset: {
      kind: "erc20",
      address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    },
    symbol: "USDC",
    decimals: 6,
    decimalsSource: "onchain_verified",
    verifiedAtBlock: "92820000",
  },
};

const completed = {
  runId: "run-live-1",
  createdAt: "2026-08-15T08:00:00.000Z",
  replayMode: false,
  intent,
  tokenMetadata,
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
      recipient: "0x1111111111111111111111111111111111111111",
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
    expect(result.tokenMetadata).toEqual(tokenMetadata);
    expect(result.intent.amountIn).toBe("0.01");
  });

  test("maps a malformed successful Check response to INVALID_RESPONSE", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: "completed" }));

    const result = await checkSwap(input, { fetch: request });

    expect(result.systemStatus).toBe("INTEGRATION_ERROR");
    expect(result.apiFailure).toMatchObject({
      code: "INVALID_RESPONSE",
      httpStatus: 200,
      retryable: false,
    });
  });

  test("maps an invalid JSON Check response to INVALID_JSON_RESPONSE", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not-json", {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.systemStatus).toBe("INTEGRATION_ERROR");
    expect(result.apiFailure).toMatchObject({
      code: "INVALID_JSON_RESPONSE",
      httpStatus: 502,
      retryable: true,
    });
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

  test("resolves known Arbitrum assets when Run token metadata is absent", async () => {
    const arbitrumRun = {
      ...completed,
      intent: {
        ...intent,
        chainId: 421614,
        protocol: "camelot-v3",
        tokenIn: {
          kind: "erc20",
          address: "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7",
        },
        tokenOut: {
          kind: "erc20",
          address: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73",
        },
      },
      tokenMetadata: undefined,
      route: {
        path: [
          {
            kind: "erc20",
            address: "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7",
          },
          {
            kind: "erc20",
            address: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73",
          },
        ],
      },
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(arbitrumRun));

    const result = await checkSwap(input, { fetch: request });

    expect(result.intent.tokenIn).toBe("USDC");
    expect(result.intent.tokenOut).toBe("WETH");
    expect(result.quote.route.en).toBe("USDC → WETH");
  });

  test("keeps atomic output unavailable without trusted token metadata", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        tokenMetadata: undefined,
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

    expect(result.quote.expectedOutput).toBe("unavailable");
    expect(result.simulatedOutput).toBe("unavailable");
    expect(result.intent.amountIn).toBe("unavailable");
    expect(result.intent.tokenIn).toBe("MON");
    expect(result.tokenMetadata).toBeUndefined();
  });

  test("sends the selected quote as an expectation baseline", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(completed));
    const quote = {
      source: "quote" as const,
      estimatedAmountOut: "0.000230",
      minimumAmountOut: "0.000228",
      blockNumber: "91383505",
      fetchedAt: "2026-08-08T12:00:00.000Z",
      runtimeVersion: "arbitrum-camelot-v3",
      runtimeRevision: "native-rpc",
    };

    await checkSwap(
      {
        ...input,
        protocol: "camelot-v3",
        tokenIn: "ETH",
        tokenOut: "USDC",
        expectationBaseline: {
          chainId: 421614,
          protocol: "camelot-v3",
          tokenIn: { kind: "native" },
          tokenOut: {
            kind: "erc20",
            address: "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7",
          },
          amountIn: "0.01",
          quote,
        },
      },
      { fetch: request },
    );

    const sent = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(sent.expectationBaseline.quote).toEqual(quote);
  });

  test("maps baseline observedAt for initial and recovered Runs", async () => {
    const observedAt = "2026-08-15T08:05:00.000Z";
    const response = {
      ...completed,
      p0: {
        expectationBaseline: {
          status: "AVAILABLE",
          chainId: 143,
          protocol: "kuru",
          tokenIn: "native",
          tokenOut: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
          amountInAtomic: "10000000000000000",
          amountOutAtomic: "123456",
          quoteId: "quote-1",
          blockNumber: "92820000",
          observedAt,
          provenance: "quote/native-rpc",
        },
        evidenceState: "INCOMPLETE",
      },
    };

    const checkRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(response));
    const initial = await checkSwap(input, { fetch: checkRequest });

    const recoveryRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ status: "completed", result: response }),
      );
    const recovered = await loadRun("run-live-1", { fetch: recoveryRequest });

    expect(initial.expectationBaseline?.observedAt).toBe(observedAt);
    expect(recovered.kind).toBe("terminal");
    if (recovered.kind === "terminal") {
      expect(recovered.result.expectationBaseline?.observedAt).toBe(observedAt);
    }
  });

  test("preserves empty scope groups and explicit unavailable scope", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        providerEvidence: {
          provider: { providerId: "native-rpc", status: "UNKNOWN" },
          checkedScope: [],
          unknownScope: [],
          unavailableScope: ["Trace RPC"],
        },
      }),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.providerEvidence?.checkedScope).toEqual([]);
    expect(result.providerEvidence?.unknownScope).toEqual([]);
    expect(result.providerEvidence?.unavailableScope).toEqual(["Trace RPC"]);
  });

  test("preserves child Run identity and diff", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        runId: "run-child-1",
        parentRunId: "run-live-1",
        diff: {
          previousRunId: "run-live-1",
          previousVerdict: "UNKNOWN",
          changedFields: [
            {
              field: "amountInAtomic",
              before: "10000000000000000",
              after: "11000000000000000",
            },
          ],
        },
      }),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.parentRunId).toBe("run-live-1");
    expect(result.diff?.[0]).toMatchObject({ field: { en: "amountIn" } });
  });

  test("preserves Provider status and execution status as separate fields", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        providerEvidence: {
          provider: {
            providerId: "arbitrum-camelot-v3",
            status: "UNKNOWN",
            integrationStatus: "OK",
            errors: {
              value: null,
              source: "unknown",
              reproducibility: "REPRODUCIBLE",
            },
          },
          execution: {
            status: "SUCCESS",
          },
          provenance: {
            mode: "LIVE",
            source: "quote",
            fetchedAt: "2026-08-15T08:00:00.000Z",
            simulationBlock: "92820000",
          },
        },
        p0: {
          evidenceState: "INCOMPLETE",
        },
      }),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.providerEvidence?.status).toBe("UNKNOWN");
    expect(result.executionEvidence?.status).toBe("SUCCESS");
    expect(result.evidenceState).toBe("INCOMPLETE");
    expect(result.verdict).toBe("UNKNOWN");
  });

  test("keeps provider execution distinct from provider and Risk status", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        providerEvidence: {
          provider: {
            providerId: "native-rpc",
            status: "UNKNOWN",
          },
          execution: { status: "SUCCESS" },
          provenance: {
            fetchedAt: "2026-01-01T00:00:00.000Z",
            blockNumber: "12345",
          },
        },
        p0: {
          evidenceState: "INCOMPLETE",
          remediation: { status: "NOT_RUN" },
        },
      }),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.providerEvidence?.status).toBe("UNKNOWN");
    expect(result.executionEvidence?.status).toBe("SUCCESS");
    expect(result.evidenceState).toBe("INCOMPLETE");
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.providerEvidence?.observedAt).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  test("does not infer capabilities from legacy Trace payloads", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        providerEvidence: {
          provider: { providerId: "native-rpc", status: "UNKNOWN" },
          execution: { status: "UNKNOWN" },
          providerData: {
            traceRpc: {
              capabilities: {
                callTracer: {
                  status: "observed",
                  executionStatus: "reverted",
                },
              },
            },
          },
        },
        p0: { evidenceState: "INCOMPLETE" },
      }),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.providerEvidence?.capabilities).toBeUndefined();
    expect(result.providerEvidence?.status).toBe("UNKNOWN");
    expect(result.executionEvidence?.status).toBe("UNKNOWN");
    expect(result.evidenceState).toBe("INCOMPLETE");
    expect(result.verdict).toBe("UNKNOWN");
  });

  test("consumes normalized capability states and evidence presentation", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        evidencePresentation: {
          version: 1,
          items: [
            {
              evidenceKey: "quote-1",
              status: "checked",
              sourceCategory: "quote",
              observedAt: "2026-08-15T08:01:00.000Z",
              mode: "RECORDED_REPLAY",
            },
          ],
          capabilities: [
            {
              key: "callTracer",
              summary: "Supplementary call trace",
              stage: "SIMULATE",
              sourceCategory: "trace_rpc",
              status: "not_checked",
              reason: "outside_baseline",
              mode: "RECORDED_REPLAY",
              blockContext: {
                blockNumber: "92820000",
                status: "requested",
              },
            },
            {
              key: "prestateTracerDiff",
              summary: "Supplementary state diff",
              stage: "SIMULATE",
              sourceCategory: "trace_rpc",
              status: "unavailable",
              reason: "method_unsupported",
            },
          ],
        },
        providerEvidence: {
          provider: { providerId: "native-rpc", status: "UNKNOWN" },
          providerData: {
            traceRpc: {
              capabilities: {
                callTracer: { status: "checked" },
              },
            },
          },
        },
      }),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.evidence[0]).toMatchObject({
      source: "quote",
      observedAt: "2026-08-15T08:01:00.000Z",
      mode: "RECORDED_REPLAY",
      origin: "replay",
      status: "checked",
    });
    expect(result.providerEvidence?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "callTracer",
          status: "not_checked",
          reason: "outside_baseline",
          blockContext: {
            blockNumber: "92820000",
            status: "requested",
          },
        }),
        expect.objectContaining({
          id: "prestateTracerDiff",
          status: "unavailable",
          reason: "method_unsupported",
        }),
      ]),
    );
  });
  test("keeps missing evidence mode separate from Run replay mode", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        replayMode: true,
        evidence: [
          {
            key: "legacy-unknown",
            stage: "QUOTE",
            summary: "Legacy evidence",
          },
        ],
      }),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.replayMode).toBe(true);
    expect(result.evidence[0]).toMatchObject({
      origin: "unknown",
      mode: undefined,
    });
  });

  test("keeps explicit evidence mode independent from Run replay mode", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...completed,
        replayMode: true,
        evidence: [
          {
            key: "live-evidence",
            stage: "QUOTE",
            summary: "Live evidence",
          },
        ],
        evidencePresentation: {
          version: 1,
          items: [
            {
              evidenceKey: "live-evidence",
              status: "checked",
              sourceCategory: "quote",
              mode: "LIVE",
            },
          ],
          capabilities: [],
        },
      }),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.evidence[0]).toMatchObject({
      origin: "live",
      mode: "LIVE",
    });
  });
  test("does not send a client expectation baseline when quote is unavailable", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(completed));

    await checkSwap(
      {
        ...input,
        protocol: "camelot-v3",
        tokenIn: "ETH",
        tokenOut: "USDC",
      },
      { fetch: request },
    );

    const sent = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(sent.expectationBaseline).toBeUndefined();
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

  test("shows an actionable native-balance message for an interrupted check", async () => {
    const run = {
      ...completed,
      runId: "failed-balance-1",
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "The check could not be completed",
      error: {
        code: "INSUFFICIENT_NATIVE_BALANCE",
        stage: "action",
        message:
          "The sender does not have enough native currency to cover the transaction amount and gas",
        retryable: false,
      },
      scope: [
        {
          key: "P0-CHECK-ACTION-001",
          label: "Transaction preparation",
          status: "unknown",
          reason: "REQUIRED_CHECK_INTERRUPTED",
        },
      ],
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "INSUFFICIENT_NATIVE_BALANCE",
            message:
              "The sender does not have enough native currency to cover the transaction amount and gas",
          },
          run,
        },
        502,
      ),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.apiFailure).toMatchObject({
      code: "INSUFFICIENT_NATIVE_BALANCE",
      stage: "action",
      retryable: false,
    });
    expect(result.summary.en).toContain("does not have enough native currency");
    expect(result.summary.zh).toContain("原生币余额不足");
  });

  test("shows a typed gas-preflight execution revert on the initial check", async () => {
    const run = {
      ...completed,
      runId: "failed-revert-1",
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "The check could not be completed",
      error: {
        code: "EXECUTION_REVERT",
        stage: "action",
        message:
          "The transaction reverted during gas preflight; the check was not completed.",
        retryable: false,
      },
      scope: [
        {
          key: "P0-CHECK-ACTION-001",
          label: "Transaction preparation",
          status: "unknown",
          reason: "REQUIRED_CHECK_INTERRUPTED",
        },
      ],
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "EXECUTION_REVERT",
            message:
              "The transaction reverted during gas preflight; the check was not completed.",
          },
          run,
        },
        502,
      ),
    );

    const result = await checkSwap(input, { fetch: request });

    expect(result.apiFailure).toMatchObject({
      code: "EXECUTION_REVERT",
      stage: "action",
      retryable: false,
    });
    expect(result.summary.en).toContain("reverted during gas preflight");
    expect(result.summary.zh).toContain("Gas 预检");
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
        source: "quote",
        estimatedAmountOut: "0.000223",
        minimumAmountOut: "0.000221",
        blockNumber: "91383505",
        fetchedAt: "2026-08-08T12:00:00.000Z",
        runtimeVersion: "0.1.0",
        runtimeRevision: "a".repeat(40),
      },
      requestIdentity: {
        protocol: "kuru",
        tokenIn: "MON",
        tokenOut: "USDC",
        amountIn: "0.01",
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

  test("preserves quote tokenMetadata without rescaling human-unit amounts", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...available,
        tokenMetadata,
      }),
    );

    const state = await fetchQuote(quoteInput, { fetch: request });

    expect(state).toMatchObject({
      status: "available",
      quote: { estimatedAmountOut: "0.000223" },
      tokenMetadata,
    });
  });
});

describe("fetchP0Config", () => {
  const p0Metadata = {
    tokenIn: {
      chainId: 421614,
      asset: { kind: "native" as const },
      symbol: "ETH",
      decimals: 18,
      decimalsSource: "chain_config",
    },
    tokenOut: {
      chainId: 421614,
      asset: {
        kind: "erc20" as const,
        address: "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7",
      },
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified",
      verifiedAtBlock: "42",
    },
  };

  test("maps AVAILABLE as configured route identity, not a live success", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: "AVAILABLE",
        chainId: 421614,
        protocol: "camelot-v3",
        tokenMetadata: p0Metadata,
      }),
    );

    await expect(fetchP0Config({ fetch: request })).resolves.toEqual({
      status: "AVAILABLE",
      chainId: 421614,
      protocol: "camelot-v3",
      tokenMetadata: p0Metadata,
    });
    expect(request.mock.calls[0]?.[0]).toBe("/api/p0-config");
  });

  test("keeps UNAVAILABLE as configuration discovery", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: "UNAVAILABLE",
        reason: "TOKEN_METADATA_UNAVAILABLE",
      }),
    );

    await expect(fetchP0Config({ fetch: request })).resolves.toEqual({
      status: "UNAVAILABLE",
      reason: "TOKEN_METADATA_UNAVAILABLE",
    });
  });
});

describe("loadReplay", () => {
  const recorded = {
    tokenMetadata,
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

  test("preserves a failed Run's API error code across recovery", async () => {
    const failedRun = {
      ...completed,
      runId: "failed-run",
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "The check timed out.",
      error: {
        code: "TIMEOUT",
        stage: "quote",
        message: "Agent Flow timed out",
        retryable: true,
      },
    };
    const initialRequest = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "AGENT_FLOW_ERROR",
            message: "Agent Flow could not complete the check",
          },
          run: failedRun,
        },
        502,
      ),
    );

    const initial = await checkSwap(input, { fetch: initialRequest });
    const recoveryRequest = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        runId: failedRun.runId,
        createdAt: failedRun.createdAt,
        intent,
        status: "failed",
        failure: "AGENT_FLOW_ERROR",
        result: failedRun,
      }),
    );

    const recovery = await loadRun(failedRun.runId, {
      fetch: recoveryRequest,
    });

    expect(initial.apiFailure).toMatchObject({
      code: "AGENT_FLOW_ERROR",
      stage: "quote",
      retryable: true,
    });
    expect(recovery).toMatchObject({
      kind: "terminal",
      result: {
        runId: failedRun.runId,
        apiFailure: {
          code: "AGENT_FLOW_ERROR",
          stage: "quote",
          retryable: true,
        },
      },
    });
  });

  test("preserves a specific native-balance error across failed Run recovery", async () => {
    const failedRun = {
      ...completed,
      runId: "failed-balance-recovery",
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "The check could not be completed",
      error: {
        code: "INSUFFICIENT_NATIVE_BALANCE",
        stage: "action",
        message:
          "The sender does not have enough native currency to cover the transaction amount and gas",
        retryable: false,
      },
      scope: [
        {
          key: "P0-CHECK-ACTION-001",
          label: "Transaction preparation",
          status: "unknown",
          reason: "REQUIRED_CHECK_INTERRUPTED",
        },
        {
          key: "P0-CHECK-SIMULATION-001",
          label: "Moss simulation",
          status: "unknown",
          reason: "REQUIRED_CHECK_INTERRUPTED",
        },
        {
          key: "P0-CHECK-SIMULATION-COVERAGE-001",
          label: "Simulation coverage",
          status: "unknown",
          reason: "REQUIRED_CHECK_INTERRUPTED",
        },
      ],
    };
    const recoveryRequest = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        runId: failedRun.runId,
        createdAt: failedRun.createdAt,
        intent,
        status: "failed",
        failure: "AGENT_FLOW_ERROR",
        result: failedRun,
      }),
    );

    const recovery = await loadRun(failedRun.runId, {
      fetch: recoveryRequest,
    });

    expect(recovery).toMatchObject({
      kind: "terminal",
      result: {
        apiFailure: {
          code: "INSUFFICIENT_NATIVE_BALANCE",
          stage: "action",
          retryable: false,
        },
        summary: {
          en: expect.stringContaining("does not have enough native currency"),
        },
      },
    });
  });

  test("preserves a specific execution-revert error across failed Run recovery", async () => {
    const failedRun = {
      ...completed,
      runId: "failed-revert-recovery",
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "The check could not be completed",
      error: {
        code: "EXECUTION_REVERT",
        stage: "action",
        message:
          "The transaction reverted during gas preflight; the check was not completed.",
        retryable: false,
      },
      scope: [
        {
          key: "P0-CHECK-ACTION-001",
          label: "Transaction preparation",
          status: "unknown",
          reason: "REQUIRED_CHECK_INTERRUPTED",
        },
      ],
    };
    const recoveryRequest = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        runId: failedRun.runId,
        createdAt: failedRun.createdAt,
        intent,
        status: "failed",
        failure: "AGENT_FLOW_ERROR",
        result: failedRun,
      }),
    );

    const recovery = await loadRun(failedRun.runId, {
      fetch: recoveryRequest,
    });

    expect(recovery).toMatchObject({
      kind: "terminal",
      result: {
        apiFailure: {
          code: "EXECUTION_REVERT",
          stage: "action",
          retryable: false,
        },
        summary: {
          en: expect.stringContaining("reverted during gas preflight"),
          zh: expect.stringContaining("Gas 预检"),
        },
      },
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
