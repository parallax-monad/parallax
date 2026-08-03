import type { FailedRunResult } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { type CheckService, createCheckApp } from "./http.js";

function dispatch(request: Request, service: CheckService) {
  return createCheckApp(service).fetch(request);
}

function request(
  body: BodyInit = "{}",
  options: { method?: string; pathname?: string } = {},
) {
  return new Request(
    `https://api.example.test${options.pathname ?? "/api/check"}`,
    {
      method: options.method ?? "POST",
      body: options.method === "GET" ? undefined : body,
    },
  );
}

describe("POST /api/check transport", () => {
  it("maps malformed JSON to a JSON 400 without calling the service", async () => {
    let called = false;
    const service: CheckService = {
      async check() {
        called = true;
        throw new Error("must not run");
      },
    };
    const response = await dispatch(request("{"), service);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON",
      },
    });
    expect(called).toBe(false);
  });

  it("rejects request bodies larger than 1 MiB before calling the service", async () => {
    let called = false;
    const service: CheckService = {
      async check() {
        called = true;
        throw new Error("must not run");
      },
    };
    const response = await dispatch(
      request(JSON.stringify({ value: "x".repeat(1024 * 1024) })),
      service,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
    expect(called).toBe(false);
  });

  it("cancels a streamed request as soon as it exceeds 1 MiB", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamedRequest = new Request("https://api.example.test/api/check", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const service: CheckService = {
      async check() {
        throw new Error("must not run");
      },
    };

    const response = await dispatch(streamedRequest, service);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("only accepts POST on the exact /api/check path", async () => {
    const service: CheckService = {
      async check() {
        throw new Error("must not run");
      },
    };

    const wrongMethod = await dispatch(request("", { method: "GET" }), service);
    const wrongPath = await dispatch(
      request("{}", { pathname: "/api/replay/run-1" }),
      service,
    );

    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
    expect(wrongPath.status).toBe(404);
  });

  it("passes parsed JSON to the application service and preserves its status", async () => {
    let received: unknown;
    const service: CheckService = {
      async check(input: unknown) {
        received = input;
        return {
          status: 400 as const,
          body: {
            error: {
              code: "INVALID_REQUEST" as const,
              message: "invalid",
            },
          },
        };
      },
    };
    const response = await dispatch(
      request('{"amountIn":"1","parentRunId":"run-1"}'),
      service,
    );

    expect(received).toEqual({ amountIn: "1", parentRunId: "run-1" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("preserves an Integration Error Run envelope in an API error response", async () => {
    const run: FailedRunResult = {
      runId: "run-2",
      parentRunId: "run-1",
      replayMode: false,
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
        amountInAtomic: "2",
        economicBoundary: {
          availability: "unavailable",
          source: "unavailable",
        },
      },
      status: "integration_error",
      systemStatus: "INTEGRATION_ERROR",
      verdict: "UNKNOWN",
      summary: "The check could not be completed",
      error: {
        code: "MOSS_UNAVAILABLE",
        stage: "unknown",
        message: "Agent Flow could not complete the check",
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
      diff: {
        previousRunId: "run-1",
        previousVerdict: "ADJUST",
        changedFields: [
          {
            field: "amountInAtomic",
            before: "1",
            after: "2",
          },
        ],
      },
    };
    const response = await dispatch(request(), {
      async check() {
        return {
          status: 502 as const,
          body: {
            error: {
              code: "AGENT_FLOW_ERROR" as const,
              message: "Agent Flow could not complete the check",
            },
            run,
          },
        };
      },
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AGENT_FLOW_ERROR" },
      run: {
        runId: "run-2",
        parentRunId: "run-1",
        status: "integration_error",
        verdict: "UNKNOWN",
        diff: {
          previousRunId: "run-1",
          changedFields: [{ field: "amountInAtomic" }],
        },
      },
    });
  });

  it("isolates unexpected application failures", async () => {
    const service: CheckService = {
      async check() {
        throw new Error("internal details");
      },
    };
    const response = await dispatch(request(), service);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The check could not be completed",
      },
    });
  });
});
