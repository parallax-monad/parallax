import { readFileSync } from "node:fs";
import type {
  CheckSwapRequest,
  NormalizedSwapIntent,
  QuoteRequest,
  RunResult,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  ParallaxApiError,
  ParallaxClient,
  type ParallaxFetch,
  type RecheckRequest,
} from "./index.js";

const SENDER = "0x1111111111111111111111111111111111111111";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

const quoteRequest: QuoteRequest = {
  chainId: 143,
  protocol: "kuru",
  sender: SENDER,
  tokenIn: { kind: "native" },
  tokenOut: { kind: "erc20", address: USDC },
  amountIn: "0.01",
};

const checkRequest: CheckSwapRequest = {
  ...quoteRequest,
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

const availableQuote = {
  status: "available",
  quote: {
    estimatedAmountOut: "0.42",
    source: "quote",
    blockNumber: "12345",
    runtimeVersion: "kuru-live",
    runtimeRevision: "rev-1",
  },
};

/** A real recorded canonical RunResult already committed in `fixtures/`. */
const recordedRun = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/replay-data/mon-to-usdc.json", import.meta.url),
    "utf8",
  ),
) as RunResult;

const recordedIntent = recordedRun.intent as NormalizedSwapIntent;

const startedEnvelope = {
  runId: "run-started-1",
  createdAt: "2026-09-29T20:00:00.000Z",
  intent: recordedIntent,
  status: "started",
};

const completedEnvelope = {
  runId: recordedRun.runId,
  createdAt: "2026-09-29T20:00:00.000Z",
  intent: recordedIntent,
  status: "completed",
  result: recordedRun,
};

type RecordedCall = { url: string; init: RequestInit };

function recordingTransport(
  handler: (url: string, init: RequestInit, index: number) => Response,
): { transport: ParallaxFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: ParallaxFetch = async (input, init) => {
    const url = String(input);
    const requestInit = init ?? {};
    calls.push({ url, init: requestInit });
    return handler(url, requestInit, calls.length - 1);
  };
  return { transport, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(
  handler: (url: string, init: RequestInit, index: number) => Response,
  options: { baseUrl?: string; headers?: Record<string, string> } = {},
) {
  const { transport, calls } = recordingTransport(handler);
  const client = new ParallaxClient({
    baseUrl: options.baseUrl ?? "https://api.example.test",
    fetch: transport,
    headers: options.headers,
  });
  return { client, calls };
}

describe("ParallaxClient.quote", () => {
  it("posts the canonical exact-input request to /api/quote", async () => {
    const { client, calls } = clientWith(() => jsonResponse(availableQuote));

    await client.quote(quoteRequest);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/api/quote");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(quoteRequest);
  });

  it("parses the canonical available and unavailable Quote results", async () => {
    const available = clientWith(() => jsonResponse(availableQuote)).client;
    await expect(available.quote(quoteRequest)).resolves.toEqual(
      availableQuote,
    );

    const unavailableBody = {
      status: "unavailable",
      reason: "NO_ROUTE",
    };
    const unavailable = clientWith(() => jsonResponse(unavailableBody)).client;
    await expect(unavailable.quote(quoteRequest)).resolves.toEqual(
      unavailableBody,
    );
  });

  it("fails closed on an invalid request without calling the API", async () => {
    const { client, calls } = clientWith(() => jsonResponse(availableQuote));

    await expect(
      client.quote({ ...quoteRequest, amountIn: "0" }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(calls).toHaveLength(0);
  });

  it("fails closed when the Quote response is not canonical", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ status: "available", quote: { source: "quote" } }),
    );

    await expect(client.quote(quoteRequest)).rejects.toBeInstanceOf(ZodError);
  });
});

describe("ParallaxClient.check", () => {
  it("posts the canonical Check request to /api/check", async () => {
    const { client, calls } = clientWith(() => jsonResponse(recordedRun));

    await client.check(checkRequest);

    expect(calls[0]?.url).toBe("https://api.example.test/api/check");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(checkRequest);
  });

  it("parses the canonical RunResult", async () => {
    const { client } = clientWith(() => jsonResponse(recordedRun));

    await expect(client.check(checkRequest)).resolves.toEqual(recordedRun);
  });

  it("fails closed on a malformed Run response", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ status: "completed", systemStatus: "OK" }),
    );

    await expect(client.check(checkRequest)).rejects.toBeInstanceOf(ZodError);
  });
});

describe("ParallaxClient.getRun", () => {
  it("GETs the encoded /api/runs/:runId path", async () => {
    const { client, calls } = clientWith(() => jsonResponse(startedEnvelope));

    await client.getRun("run with/slash");

    expect(calls[0]?.url).toBe(
      "https://api.example.test/api/runs/run%20with%2Fslash",
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("parses a started Run envelope without fabricating a result", async () => {
    const { client } = clientWith(() => jsonResponse(startedEnvelope));

    await expect(client.getRun("run-started-1")).resolves.toEqual(
      startedEnvelope,
    );
  });

  it("parses a completed Run envelope with its canonical result", async () => {
    const { client } = clientWith(() => jsonResponse(completedEnvelope));

    const envelope = await client.getRun(recordedRun.runId);

    expect(envelope.status).toBe("completed");
    expect(envelope).toEqual(completedEnvelope);
  });

  it("fails closed on a malformed Run envelope and on an empty runId", async () => {
    const malformed = clientWith(() =>
      jsonResponse({
        runId: "run-1",
        createdAt: "2026-09-29T20:00:00.000Z",
        intent: recordedIntent,
        status: "completed",
        result: { status: "completed" },
      }),
    ).client;
    await expect(malformed.getRun("run-1")).rejects.toBeInstanceOf(ZodError);

    const { client, calls } = clientWith(() => jsonResponse(startedEnvelope));
    await expect(client.getRun("   ")).rejects.toBeInstanceOf(ZodError);
    expect(calls).toHaveLength(0);
  });
});

describe("ParallaxClient.recheck", () => {
  it("posts to /api/check with parentRunId and the caller's Intent change", async () => {
    const { client, calls } = clientWith(() => jsonResponse(recordedRun));
    const changed: RecheckRequest = { ...checkRequest, amountIn: "0.02" };

    await client.recheck("baseline-run-1", changed);

    expect(calls[0]?.url).toBe("https://api.example.test/api/check");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      ...changed,
      parentRunId: "baseline-run-1",
    });
  });

  it("does not model the Backend Re-run rules", async () => {
    const { client } = clientWith(() =>
      jsonResponse(
        {
          error: {
            code: "INVALID_RERUN",
            reason: "NOT_EXACTLY_ONE_CHANGE",
            message: "The Re-run must change exactly one Intent condition",
          },
        },
        400,
      ),
    );

    // Identical Intent: the SDK sends it and the Backend owns the rejection.
    await expect(
      client.recheck("baseline-run-1", checkRequest),
    ).rejects.toBeInstanceOf(ParallaxApiError);
  });
});

describe("ParallaxClient.getAccountState", () => {
  const accountStateRequest = { ...quoteRequest, recipient: SENDER };

  it("posts the typed request to /api/account-state", async () => {
    const snapshot = { snapshotId: "snap-1", status: "UNAVAILABLE" };
    const { client, calls } = clientWith(() => jsonResponse(snapshot));

    await client.getAccountState(accountStateRequest);

    expect(calls[0]?.url).toBe("https://api.example.test/api/account-state");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(
      accountStateRequest,
    );
  });

  it("keeps the response opaque instead of restating the API-local schema", async () => {
    const snapshot = { snapshotId: "snap-1", status: "AVAILABLE", extra: 1 };
    const { client } = clientWith(() => jsonResponse(snapshot));

    await expect(client.getAccountState(accountStateRequest)).resolves.toEqual(
      snapshot,
    );
    await expect(
      client.getAccountState<{ status: string }>(accountStateRequest),
    ).resolves.toEqual(snapshot);
  });
});

describe("ParallaxClient transport", () => {
  it("turns HTTP 4xx into a ParallaxApiError with status, body, and code", async () => {
    const body = {
      error: {
        code: "INVALID_REQUEST",
        message: "The check request does not match the public API contract",
      },
    };
    const { client } = clientWith(() => jsonResponse(body, 400));

    const failure = await client.check(checkRequest).catch((error) => error);

    expect(failure).toBeInstanceOf(ParallaxApiError);
    expect(failure.status).toBe(400);
    expect(failure.body).toEqual(body);
    expect(failure.code).toBe("INVALID_REQUEST");
  });

  it("turns HTTP 5xx into a ParallaxApiError", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ error: { code: "RUN_STORE_ERROR", message: "no" } }, 500),
    );

    const failure = await client.getRun("run-1").catch((error) => error);

    expect(failure).toBeInstanceOf(ParallaxApiError);
    expect(failure.status).toBe(500);
    expect(failure.code).toBe("RUN_STORE_ERROR");
  });

  it("fails closed when a successful response body is not JSON", async () => {
    const { client } = clientWith(
      () => new Response("<html>gateway</html>", { status: 200 }),
    );

    const failure = await client.quote(quoteRequest).catch((error) => error);

    expect(failure).toBeInstanceOf(ParallaxApiError);
    expect(failure.status).toBe(200);
    expect(failure.body).toBeUndefined();
  });

  it("merges default headers, normalizes the base URL, and never adds a body to GET", async () => {
    const { client, calls } = clientWith(() => jsonResponse(availableQuote), {
      baseUrl: "https://api.example.test/",
      headers: { "x-api-key": "k" },
    });

    await client.quote(quoteRequest);

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(calls[0]?.url).toBe("https://api.example.test/api/quote");
    expect(headers["x-api-key"]).toBe("k");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.accept).toBe("application/json");
  });
});
