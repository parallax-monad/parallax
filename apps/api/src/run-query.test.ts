import {
  failedRunResultSchema,
  type NormalizedSwapIntent,
} from "@parallax/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  RunQueryApplicationService,
  type RunQueryApplicationServiceDependencies,
} from "./run-query.js";
import { InMemoryRunStore, type RunStore } from "./store.js";

const intent = {
  chainId: 143,
  protocol: "kuru",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: {
    kind: "erc20",
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  amountInAtomic: "1",
  economicBoundary: {
    availability: "unavailable",
    source: "unavailable",
  },
} as NormalizedSwapIntent;

function createService(
  dependencies: Partial<RunQueryApplicationServiceDependencies> = {},
) {
  return new RunQueryApplicationService({
    store: dependencies.store ?? new InMemoryRunStore(),
  });
}

function fakeStore(get: RunStore["get"]): RunStore {
  return {
    start: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    get,
  };
}

describe("RunQueryApplicationService", () => {
  it("returns a stored started Run without fabricating a receipt", async () => {
    const store = new InMemoryRunStore();
    const createdAt = "2026-08-15T08:00:00.000Z";
    await store.start("refresh-run", intent, undefined, createdAt);

    const response = await createService({ store }).getRun(" refresh-run ");

    expect(response).toEqual({
      status: 200,
      body: {
        runId: "refresh-run",
        createdAt,
        intent,
        status: "started",
      },
    });
  });

  it("returns the same not-found response for invalid and unknown IDs", async () => {
    const get = vi.fn<RunQueryApplicationServiceDependencies["store"]["get"]>();
    const service = createService({ store: fakeStore(get) });

    await expect(service.getRun(" ")).resolves.toEqual({
      status: 404,
      body: {
        error: {
          code: "RUN_NOT_FOUND",
          message: "The requested run does not exist",
        },
      },
    });
    await expect(service.getRun("missing-run")).resolves.toEqual({
      status: 404,
      body: {
        error: {
          code: "RUN_NOT_FOUND",
          message: "The requested run does not exist",
        },
      },
    });
    expect(get).toHaveBeenCalledWith("missing-run");
  });

  it("maps Store read failures without exposing database details", async () => {
    const service = createService({
      store: fakeStore(vi.fn().mockRejectedValue(new Error("password=secret"))),
    });

    await expect(service.getRun("run-with-error")).resolves.toEqual({
      status: 500,
      body: {
        error: {
          code: "RUN_STORE_ERROR",
          message: "The requested run could not be loaded",
        },
      },
    });
  });

  it("projects absent legacy Arbitrum One provenance as UNKNOWN without rewriting storage", async () => {
    const arbitrumOneIntent = {
      chainId: 42161,
      protocol: "camelot-v3",
      sender: "0x1111111111111111111111111111111111111111",
      recipient: "0x1111111111111111111111111111111111111111",
      recipientSource: "defaulted_from_sender",
      tokenIn: { kind: "native" },
      tokenOut: {
        kind: "erc20",
        address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      },
      amountInAtomic: "1",
      economicBoundary: { availability: "unavailable", source: "unavailable" },
    } as NormalizedSwapIntent;
    const result = failedRunResultSchema.parse({
      runId: "legacy-one-run",
      createdAt: "2026-10-17T19:17:33.990Z",
      replayMode: false,
      intent: arbitrumOneIntent,
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "The check could not be completed",
      error: {
        code: "INTERNAL_ERROR",
        stage: "unknown",
        message: "Agent Flow failed internally",
        retryable: false,
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
    });
    const storedRecord = {
      runId: result.runId,
      createdAt: result.createdAt ?? "2026-10-17T19:17:33.990Z",
      intent: arbitrumOneIntent,
      status: "failed" as const,
      failure: "AGENT_FLOW_ERROR" as const,
      result,
    };
    const get = vi.fn<RunStore["get"]>().mockResolvedValue(storedRecord);
    const service = createService({ store: fakeStore(get) });

    const response = await service.getRun("legacy-one-run");

    expect(response.status).toBe(200);
    if (response.status !== 200 || response.body.status !== "failed") {
      throw new Error("Legacy Run was not returned");
    }
    expect(response.body.result.arbitrumOneForkProvenance).toEqual({
      schemaVersion: 1,
      status: "UNKNOWN",
      reason: "NOT_RECORDED",
    });
    expect(storedRecord.result.arbitrumOneForkProvenance).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
