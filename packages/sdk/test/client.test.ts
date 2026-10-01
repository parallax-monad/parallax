import { readFileSync } from "node:fs";
import type {
  CheckSwapRequest,
  QuoteRequest,
  RunResult,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import {
  type AccountStateRequest,
  type AccountStateSnapshot,
  ParallaxApiError,
  ParallaxClient,
  type ParallaxFetch,
} from "../src/index.js";

const sender = "0x1111111111111111111111111111111111111111";
const usdc = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const quoteRequest: QuoteRequest = {
  chainId: 143,
  protocol: "kuru",
  sender,
  tokenIn: { kind: "native" },
  tokenOut: { kind: "erc20", address: usdc },
  amountIn: "0.01",
};
const checkRequest: CheckSwapRequest = {
  ...quoteRequest,
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};
const recordedRun = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/replay-data/mon-to-usdc.json", import.meta.url),
    "utf8",
  ),
) as RunResult;

type RecordedRequest = { url: string; init?: RequestInit };

function makeClient(body: unknown, status = 200) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: ParallaxFetch = async (input, init) => {
    requests.push({ url: input.toString(), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  return {
    client: new ParallaxClient({
      baseUrl: "https://api.example.test/",
      fetch: fetchImpl,
      headers: { "x-client-test": "sdk" },
    }),
    requests,
  };
}

function postedBody(request: RecordedRequest): unknown {
  return JSON.parse(String(request.init?.body)) as unknown;
}

function firstRequest(requests: RecordedRequest[]): RecordedRequest {
  const request = requests.at(0);
  if (!request) throw new Error("Expected a request to be recorded");
  return request;
}

function unavailableAccountStateSnapshot(): AccountStateSnapshot {
  return {
    context: {
      chainId: 143,
      protocol: "kuru",
      sender,
      recipient: sender,
      tokenIn: { kind: "native" },
      tokenOut: { kind: "erc20", address: usdc },
      amountInAtomic: "10000000000000000",
    },
    block: {
      status: "UNAVAILABLE",
      chainId: 143,
      observedAt: "2026-09-29T20:00:00.000Z",
      reason: "RPC_UNAVAILABLE",
    },
    balances: {
      inputToken: {
        account: sender,
        asset: { kind: "native" },
        metadata: {
          symbol: "MON",
          decimals: 18,
          decimalsSource: "chain_config",
        },
        explorerUrls: {},
        status: "UNAVAILABLE",
        reason: "RPC_UNAVAILABLE",
      },
      outputToken: {
        account: sender,
        asset: { kind: "erc20", address: usdc },
        metadata: {
          symbol: "USDC",
          decimals: 6,
          decimalsSource: "onchain_verified",
          verifiedAtBlock: "100",
        },
        explorerUrls: {},
        status: "UNAVAILABLE",
        reason: "RPC_UNAVAILABLE",
      },
      native: {
        account: sender,
        asset: { kind: "native" },
        metadata: {
          symbol: "MON",
          decimals: 18,
          decimalsSource: "chain_config",
        },
        explorerUrls: {},
        status: "UNAVAILABLE",
        reason: "RPC_UNAVAILABLE",
      },
    },
    allowance: {
      status: "NOT_APPLICABLE",
      owner: sender,
      spender: { status: "NOT_APPLICABLE" },
      reason: "NATIVE_INPUT",
    },
    snapshotId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "UNAVAILABLE",
  };
}

describe("ParallaxClient", () => {
  it("posts a canonical Quote request and parses the public response", async () => {
    const result = {
      status: "available",
      quote: {
        estimatedAmountOut: "1.25",
        source: "quote",
        blockNumber: "123",
        runtimeVersion: "runtime-v1",
        runtimeRevision: "revision-1",
      },
    } as const;
    const { client, requests } = makeClient(result);

    await expect(client.quote(quoteRequest)).resolves.toEqual(result);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.example.test/api/quote");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(new Headers(requests[0]?.init?.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(new Headers(requests[0]?.init?.headers).get("x-client-test")).toBe(
      "sdk",
    );
    expect(postedBody(firstRequest(requests))).toEqual(quoteRequest);
  });

  it("validates and posts Check using the canonical request and Run schemas", async () => {
    const { client, requests } = makeClient(recordedRun);

    await expect(client.check(checkRequest)).resolves.toEqual(recordedRun);
    expect(requests[0]?.url).toBe("https://api.example.test/api/check");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(postedBody(firstRequest(requests))).toEqual(checkRequest);
  });

  it("gets a persisted Run envelope without reinterpreting the result", async () => {
    const envelope = {
      runId: recordedRun.runId,
      createdAt: recordedRun.createdAt ?? "2026-09-29T20:00:00.000Z",
      intent: recordedRun.intent,
      status: "completed",
      result: recordedRun,
    };
    const { client, requests } = makeClient(envelope);

    await expect(client.getRun(recordedRun.runId)).resolves.toEqual(envelope);
    expect(requests[0]?.url).toBe(
      `https://api.example.test/api/runs/${encodeURIComponent(recordedRun.runId)}`,
    );
    expect(requests[0]?.init?.method).toBe("GET");
  });

  it("rechecks through the same Check endpoint and lets the Backend enforce eligibility", async () => {
    const { client, requests } = makeClient(recordedRun);

    await expect(
      client.recheck("baseline-run", { ...checkRequest, amountIn: "0.02" }),
    ).resolves.toEqual(recordedRun);
    expect(requests[0]?.url).toBe("https://api.example.test/api/check");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(postedBody(firstRequest(requests))).toEqual({
      ...checkRequest,
      amountIn: "0.02",
      parentRunId: "baseline-run",
    });
  });

  it("posts Account State and validates the shared snapshot Contract", async () => {
    const snapshot = unavailableAccountStateSnapshot();
    const request: AccountStateRequest = { ...quoteRequest, recipient: sender };
    const { client, requests } = makeClient(snapshot);

    const result = await client.getAccountState(request);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.balances.outputToken.status).toBe("UNAVAILABLE");
    expect(result).toEqual(snapshot);
    expect(requests[0]?.url).toBe("https://api.example.test/api/account-state");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(postedBody(firstRequest(requests))).toEqual(request);
  });

  it("rejects malformed Account State snapshots returned by the API", async () => {
    const request: AccountStateRequest = { ...quoteRequest, recipient: sender };
    const { client } = makeClient({});

    await expect(client.getAccountState(request)).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("gets and validates a persisted Account State snapshot", async () => {
    const snapshot = unavailableAccountStateSnapshot();
    const { client, requests } = makeClient(snapshot);

    await expect(
      client.getAccountStateSnapshot(snapshot.snapshotId),
    ).resolves.toEqual(snapshot);
    expect(requests[0]?.url).toBe(
      `https://api.example.test/api/account-state/${snapshot.snapshotId}`,
    );
    expect(requests[0]?.init?.method).toBe("GET");
  });

  it("rejects malformed persisted Account State snapshots", async () => {
    const { client } = makeClient({});

    await expect(
      client.getAccountStateSnapshot("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("rejects invalid Account State snapshot IDs before sending", async () => {
    let fetchCalled = false;
    const client = new ParallaxClient({
      baseUrl: "https://api.example.test",
      fetch: async () => {
        fetchCalled = true;
        return new Response("{}");
      },
    });

    await expect(
      client.getAccountStateSnapshot("not-a-uuid"),
    ).rejects.toThrow();
    expect(fetchCalled).toBe(false);
  });

  it("preserves HTTP status, body, and Backend error code", async () => {
    const errorBody = {
      error: { code: "RUN_NOT_FOUND", message: "No Run exists" },
    };
    const { client } = makeClient(errorBody, 404);

    await expect(client.getRun("missing-run")).rejects.toMatchObject({
      name: "ParallaxApiError",
      status: 404,
      body: errorBody,
      code: "RUN_NOT_FOUND",
    });
  });

  it("fails closed when a successful API response is not valid JSON", async () => {
    const fetchImpl: ParallaxFetch = async () =>
      new Response("not-json", { status: 200 });
    const client = new ParallaxClient({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
    });

    await expect(client.quote(quoteRequest)).rejects.toBeInstanceOf(
      ParallaxApiError,
    );
  });

  it("uses canonical request validation before sending", async () => {
    let fetchCalled = false;
    const fetchImpl: ParallaxFetch = async () => {
      fetchCalled = true;
      return new Response("{}");
    };
    const client = new ParallaxClient({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
    });

    await expect(
      client.quote({ ...quoteRequest, amountIn: "0" }),
    ).rejects.toThrow();
    expect(fetchCalled).toBe(false);
  });

  it("requires an absolute HTTP(S) API base URL without embedded credentials", () => {
    expect(() => new ParallaxClient({ baseUrl: "relative/path" })).toThrow(
      TypeError,
    );
    expect(
      () =>
        new ParallaxClient({
          baseUrl: "https://user:password@api.example.test",
        }),
    ).toThrow(/embedded credentials/);
  });
});
