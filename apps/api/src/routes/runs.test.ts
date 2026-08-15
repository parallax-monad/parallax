import { describe, expect, it } from "vitest";
import type { CheckRunRecord } from "../store.js";
import { createRunQueryApp, type RunQueryService } from "./runs.js";

const startedRecord: CheckRunRecord = {
  runId: "refresh-run",
  createdAt: "2026-08-15T08:00:00.000Z",
  intent: {
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
  },
  status: "started",
};

function dispatch(pathname: string, service: RunQueryService, method = "GET") {
  return createRunQueryApp(service).fetch(
    new Request(`https://api.example.test${pathname}`, { method }),
  );
}

describe("GET /api/runs/:runId transport", () => {
  it("passes the route ID to the application service", async () => {
    let received: string | undefined;
    const service: RunQueryService = {
      async getRun(runId) {
        received = runId;
        return { status: 200, body: startedRecord };
      },
    };

    const response = await dispatch("/api/runs/refresh-run", service);

    expect(received).toBe("refresh-run");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(startedRecord);
  });

  it("only accepts GET on the exact Run path", async () => {
    const service: RunQueryService = {
      async getRun() {
        throw new Error("must not run");
      },
    };

    const wrongMethod = await dispatch(
      "/api/runs/refresh-run",
      service,
      "POST",
    );
    const wrongPath = await dispatch("/api/run/refresh-run", service);

    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET");
    expect(wrongPath.status).toBe(404);
  });

  it("isolates unexpected application failures", async () => {
    const service: RunQueryService = {
      async getRun(): Promise<never> {
        throw new Error("database password");
      },
    };

    const response = await dispatch("/api/runs/refresh-run", service);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The requested run could not be returned",
      },
    });
  });
});
