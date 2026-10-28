import {
  failedRunResultSchema,
  type NormalizedSwapIntent,
  runResultSchema,
} from "@parallax/contracts";
import { economicFailStopResult } from "@parallax/orchestrator/application/action-gate-fixtures";
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

const legacyArbitrumOneIntent = {
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
  economicBoundary: {
    availability: "unavailable",
    source: "unavailable",
  },
} as NormalizedSwapIntent;

function createCompletedLegacyArbitrumOneResult() {
  const intent: NormalizedSwapIntent = {
    ...legacyArbitrumOneIntent,
    economicBoundary: {
      availability: "available",
      minimumReceivedAtomic: "20000",
      source: "user_declared",
    },
  };
  if (intent.tokenOut.kind !== "erc20") {
    throw new Error("Expected an ERC-20 output for the legacy Run fixture");
  }
  const result = economicFailStopResult(
    {
      sender: intent.sender,
      mon: { kind: "native" },
      usdc: intent.tokenOut,
      simulatorPinnedBlock: "42",
      runtimeVersion: "legacy-runtime",
      runtimeRevision: "legacy-revision",
    },
    "legacy-one-completed-run",
    intent,
  );
  if (result.route.availability !== "available") {
    throw new Error("Expected an available legacy Run route");
  }
  result.route.protocol = "camelot-v3";
  return runResultSchema.parse({
    ...result,
    createdAt: "2026-10-17T19:17:33.990Z",
  });
}

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

  it("does not fabricate a result when recovering a started legacy Arbitrum One Run", async () => {
    const storedRecord = {
      runId: "legacy-one-started-run",
      createdAt: "2026-10-17T19:17:33.990Z",
      intent: legacyArbitrumOneIntent,
      status: "started" as const,
    };
    const get = vi.fn<RunStore["get"]>().mockResolvedValue(storedRecord);
    const service = createService({ store: fakeStore(get) });

    const response = await service.getRun(storedRecord.runId);

    expect(response).toEqual({ status: 200, body: storedRecord });
    if (response.status !== 200) {
      throw new Error("Started legacy Run was not returned");
    }
    expect(response.body).not.toHaveProperty("result");
    expect(response.body.intent).toEqual(legacyArbitrumOneIntent);
    expect(get).toHaveBeenCalledTimes(1);
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
    const arbitrumOneIntent = legacyArbitrumOneIntent;
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

  it("projects absent legacy Arbitrum One provenance on completed Runs without rewriting storage", async () => {
    const result = createCompletedLegacyArbitrumOneResult();
    if (result.status !== "completed") {
      throw new Error("Expected a completed legacy Run fixture");
    }
    const originalResult = structuredClone(result);
    const storedRecord = {
      runId: result.runId,
      createdAt: result.createdAt ?? "2026-10-17T19:17:33.990Z",
      intent: result.intent,
      status: "completed" as const,
      result,
    };
    const get = vi.fn<RunStore["get"]>().mockResolvedValue(storedRecord);
    const service = createService({ store: fakeStore(get) });

    const response = await service.getRun(result.runId);

    expect(response.status).toBe(200);
    if (response.status !== 200 || response.body.status !== "completed") {
      throw new Error("Completed legacy Run was not returned");
    }
    expect(response.body.result.arbitrumOneForkProvenance).toEqual({
      schemaVersion: 1,
      status: "UNKNOWN",
      reason: "NOT_RECORDED",
    });
    expect(storedRecord.result).toEqual(originalResult);
    expect(storedRecord.result.arbitrumOneForkProvenance).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
