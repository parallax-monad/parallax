import type { NormalizedSwapIntent } from "@parallax/contracts";
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
    await store.start("refresh-run", intent);

    const response = await createService({ store }).getRun(" refresh-run ");

    expect(response).toEqual({
      status: 200,
      body: {
        runId: "refresh-run",
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
});
