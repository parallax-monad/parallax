import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerType } from "@hono/node-server";
import type { KuruLiveRunner } from "@parallax/orchestrator/agent-flow";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { BackendCompositionRuntime } from "../backend/composition.js";
import { createTraceRpcEvidenceSource } from "../backend/trace-rpc-evidence-source.js";
import { bootstrapBackendRuntime } from "../runtime-config.js";
import { InMemoryRunStore } from "../store.js";
import {
  bootstrapBackendApp,
  createBackendApp,
  startBackendServer,
} from "./backend.js";

const sender = "0x1111111111111111111111111111111111111111";
const usdcAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const tokenRegistry = {
  chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
  tokens: [
    {
      chainId: 143,
      address: usdcAddress,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "90000000",
    },
  ],
};
const environment = {
  MONAD_RPC_URL: "https://rpc.example.test",
  MOSS_RUNTIME_VERSION: "confirmed-portable-baseline",
  MOSS_RUNTIME_REVISION: "moss-commit-123",
};
const reverseSender = "0x01bb7b44cc398aaa2b76ac6253f0f5634279db9d";
const reverseUsdc = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const reverseWeth = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const unqualifiedErc20 = "0x0000000000000000000000000000000000000abc";
const qualifiedCamelotRouter = "0x171B925C51565F5D2a7d8C494ba3188D304EFD93";
const qualifiedSpenderRef =
  "be-103:usdc-weth-camelot-2026-09-29T10-09-52-993Z#evaluation.callTrace.actualSpender";
const reverseTokenRegistry = {
  chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
  tokens: [
    {
      chainId: 421614,
      address: reverseUsdc,
      symbol: "USDC",
      decimals: 18,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "100",
    },
    {
      chainId: 421614,
      address: reverseWeth,
      symbol: "WETH",
      decimals: 18,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "100",
    },
  ],
};

function createAccountStateRpcFetch(allowanceAtomic = "1000000000000000") {
  const calls: Array<{
    method: string;
    params: readonly unknown[];
  }> = [];
  const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: readonly unknown[];
    };
    calls.push({ method: request.method, params: request.params });

    let result: unknown;
    if (request.method === "eth_chainId") {
      result = "0x66eee";
    } else if (request.method === "eth_getBlockByNumber") {
      result = { number: "0x64", hash: `0x${"ab".repeat(32)}` };
    } else if (request.method === "eth_getBalance") {
      result = "0xde0b6b3a7640000";
    } else if (request.method === "eth_call") {
      const transaction = request.params[0] as { data: string };
      const amount = transaction.data.startsWith("0xdd62ed3e")
        ? allowanceAtomic
        : transaction.data.startsWith("0x70a08231")
          ? "2000000000000000"
          : undefined;
      if (amount === undefined) throw new Error("Unexpected eth_call selector");
      result = `0x${BigInt(amount).toString(16).padStart(64, "0")}`;
    } else {
      throw new Error(`Unexpected RPC method: ${request.method}`);
    }

    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return { calls, fetchImplementation };
}

function checkRequest() {
  return {
    chainId: 143,
    protocol: "kuru",
    sender,
    tokenIn: { kind: "native" },
    tokenOut: { kind: "erc20", address: usdcAddress },
    amountIn: "1.5",
    economicBoundary: {
      availability: "unavailable",
      source: "unavailable",
    },
  };
}

describe("backend Node runtime", () => {
  it("exposes the #103-qualified spender through production account-state and immutable history", async () => {
    const rpc = createAccountStateRpcFetch();
    vi.stubGlobal("fetch", rpc.fetchImplementation);
    const app = bootstrapBackendApp({
      environment: {
        ...environment,
        ARBITRUM_RPC_URL: "https://arbitrum.example.test",
      },
      tokenRegistry: reverseTokenRegistry,
    });

    try {
      const response = await app.fetch(
        new Request("https://api.example.test/api/account-state", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chainId: 421614,
            protocol: "camelot-v3",
            sender: reverseSender,
            tokenIn: { kind: "erc20", address: reverseUsdc },
            tokenOut: { kind: "erc20", address: reverseWeth },
            amountIn: "0.001",
          }),
        }),
      );
      const snapshot = (await response.json()) as {
        snapshotId: string;
        allowance: unknown;
      };

      expect(response.status).toBe(200);
      expect(snapshot.allowance).toMatchObject({
        status: "SUFFICIENT",
        spender: {
          status: "QUALIFIED",
          address: qualifiedCamelotRouter.toLowerCase(),
          qualificationRef: qualifiedSpenderRef,
        },
        requiredAmountAtomic: "1000000000000000",
        allowanceAtomic: "1000000000000000",
        blockNumber: "100",
      });
      const allowanceCall = rpc.calls.find(
        ({ method, params }) =>
          method === "eth_call" &&
          (params[0] as { data: string }).data.startsWith("0xdd62ed3e"),
      );
      expect(allowanceCall?.params[0]).toEqual({
        to: reverseUsdc.toLowerCase(),
        data: `0xdd62ed3e${reverseSender.slice(2).toLowerCase().padStart(64, "0")}${qualifiedCamelotRouter.slice(2).toLowerCase().padStart(64, "0")}`,
      });

      const requestCountAfterObservation = rpc.calls.length;
      const historicalResponse = await app.fetch(
        new Request(
          `https://api.example.test/api/account-state/${snapshot.snapshotId}`,
        ),
      );
      expect(historicalResponse.status).toBe(200);
      await expect(historicalResponse.json()).resolves.toEqual(snapshot);
      expect(rpc.calls).toHaveLength(requestCountAfterObservation);
    } finally {
      await app.close();
      vi.unstubAllGlobals();
    }
  });

  it("keeps an unqualified ERC-20 pair unavailable without querying allowance", async () => {
    const rpc = createAccountStateRpcFetch();
    vi.stubGlobal("fetch", rpc.fetchImplementation);
    const app = bootstrapBackendApp({
      environment: {
        ...environment,
        ARBITRUM_RPC_URL: "https://arbitrum.example.test",
      },
      tokenRegistry: {
        ...reverseTokenRegistry,
        tokens: [
          ...reverseTokenRegistry.tokens,
          {
            chainId: 421614,
            address: unqualifiedErc20,
            symbol: "OTHER",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: "100",
          },
        ],
      },
    });

    try {
      const response = await app.fetch(
        new Request("https://api.example.test/api/account-state", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chainId: 421614,
            protocol: "camelot-v3",
            sender: reverseSender,
            tokenIn: { kind: "erc20", address: unqualifiedErc20 },
            tokenOut: { kind: "erc20", address: reverseWeth },
            amountIn: "0.001",
          }),
        }),
      );
      const snapshot = (await response.json()) as {
        allowance: unknown;
      };

      expect(response.status).toBe(200);
      expect(snapshot.allowance).toMatchObject({
        status: "UNAVAILABLE",
        reason: "SPENDER_NOT_QUALIFIED",
        spender: { status: "UNAVAILABLE", reason: "SPENDER_NOT_QUALIFIED" },
      });
      expect(
        rpc.calls.some(
          ({ method, params }) =>
            method === "eth_call" &&
            (params[0] as { data: string }).data.startsWith("0xdd62ed3e"),
        ),
      ).toBe(false);
    } finally {
      await app.close();
      vi.unstubAllGlobals();
    }
  });

  it("rejects a Trace source that would be silently ignored by a supplied composition", () => {
    const source = createTraceRpcEvidenceSource({
      client: { request: async () => undefined },
      mode: "MOCK",
    });

    expect(() =>
      bootstrapBackendApp({
        environment,
        tokenRegistry,
        composition: {
          runStore: new InMemoryRunStore(),
        } as unknown as BackendCompositionRuntime,
        traceRpcEvidenceSource: source,
      }),
    ).toThrow(
      "traceRpcEvidenceSource must be configured on the supplied composition",
    );
  });

  it("rejects a Trace source when no Arbitrum route can consume it", () => {
    const source = createTraceRpcEvidenceSource({
      client: { request: async () => undefined },
      mode: "MOCK",
    });

    expect(() =>
      bootstrapBackendApp({
        environment,
        tokenRegistry,
        traceRpcEvidenceSource: source,
      }),
    ).toThrow(
      "traceRpcEvidenceSource requires an Arbitrum RPC URL or supplied composition",
    );
  });

  it("serves a lightweight health response without invoking business services", async () => {
    let agentFlowCalled = false;
    let quoteFlowCalled = false;
    const app = createBackendApp({
      runtime: bootstrapBackendRuntime({ environment, tokenRegistry }),
      agentFlow: {
        async check() {
          agentFlowCalled = true;
          throw new Error("health must not invoke Agent Flow");
        },
      },
      quoteFlow: {
        async quote() {
          quoteFlowCalled = true;
          throw new Error("health must not invoke quote flow");
        },
      },
    });

    const response = await app.fetch(
      new Request("https://api.example.test/health"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(agentFlowCalled).toBe(false);
    expect(quoteFlowCalled).toBe(false);
  });

  it("reports readiness from the configured dependency probe", async () => {
    const readinessCheck = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    const app = createBackendApp({
      runtime: bootstrapBackendRuntime({ environment, tokenRegistry }),
      readinessCheck,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/readyz"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(readinessCheck).toHaveBeenCalledTimes(1);
  });

  it("fails readiness closed without exposing dependency errors", async () => {
    const app = createBackendApp({
      runtime: bootstrapBackendRuntime({ environment, tokenRegistry }),
      readinessCheck: async () => {
        throw new Error("database password must not be returned");
      },
    });

    const response = await app.fetch(
      new Request("https://api.example.test/readyz"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "not_ready" });
  });

  it("fails closed when production runtime configuration is incomplete", () => {
    expect(() =>
      bootstrapBackendApp({ environment: {}, tokenRegistry }),
    ).toThrow();
  });

  it("does not silently fall back to memory when PostgreSQL is selected", () => {
    expect(() =>
      bootstrapBackendApp({
        environment: { ...environment, RUN_STORE_BACKEND: "postgres" },
        tokenRegistry,
      }),
    ).toThrow("DATABASE_URL is required when RUN_STORE_BACKEND=postgres");
  });

  it("exposes configured PostgreSQL disposal through the app lifecycle", async () => {
    const poolEnd = vi
      .spyOn(Pool.prototype, "end")
      .mockResolvedValue(undefined);

    try {
      const app = bootstrapBackendApp({
        environment: {
          ...environment,
          RUN_STORE_BACKEND: "postgres",
          DATABASE_URL: "postgres://user:pass@localhost:5432/parallax",
        },
        tokenRegistry,
      });

      await app.close();
      expect(poolEnd).toHaveBeenCalledTimes(1);
    } finally {
      poolEnd.mockRestore();
    }
  });

  it("does not close an injected store without an explicit disposer", async () => {
    const store = new InMemoryRunStore();
    const storeClose = vi.spyOn(store, "close");
    const app = createBackendApp({
      runtime: bootstrapBackendRuntime({ environment, tokenRegistry }),
      store,
    });

    await app.close();

    expect(storeClose).not.toHaveBeenCalled();
  });

  it("uses an explicit disposer for an injected store", async () => {
    const disposer = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const app = createBackendApp({
      runtime: bootstrapBackendRuntime({ environment, tokenRegistry }),
      store: new InMemoryRunStore(),
      disposeStore: disposer,
    });

    await app.close();
    await app.close();

    expect(disposer).toHaveBeenCalledTimes(1);
  });

  it("composes Check and explicit Replay routes without a live fixture fallback", async () => {
    const app = bootstrapBackendApp({ environment, tokenRegistry });

    const replayResponse = await app.fetch(
      new Request("https://api.example.test/api/replay/mon-to-usdc"),
    );
    expect(replayResponse.status).toBe(200);

    const checkResponse = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkRequest()),
      }),
    );
    expect(checkResponse.status).toBe(502);
    await expect(checkResponse.json()).resolves.toMatchObject({
      error: {
        code: "UNSUPPORTED",
        message: "Live Agent Flow is not available in this runtime",
      },
    });
  });

  it("serves a stored Run for page refresh", async () => {
    const store = new InMemoryRunStore();
    await store.start("refresh-run", {
      chainId: 143,
      protocol: "kuru",
      sender,
      recipient: sender,
      recipientSource: "defaulted_from_sender",
      tokenIn: { kind: "native" },
      tokenOut: { kind: "erc20", address: usdcAddress },
      amountInAtomic: "1",
      economicBoundary: {
        availability: "unavailable",
        source: "unavailable",
      },
    });

    const app = createBackendApp({
      runtime: bootstrapBackendRuntime({ environment, tokenRegistry }),
      store,
    });
    const response = await app.fetch(
      new Request("https://api.example.test/api/runs/refresh-run"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      runId: "refresh-run",
      status: "started",
    });
  });

  it("composes the Quote route independently from the full Check flow", async () => {
    const app = createBackendApp({
      runtime: bootstrapBackendRuntime({ environment, tokenRegistry }),
      quoteFlow: {
        async quote() {
          return {
            status: "available",
            quote: {
              estimatedAmountOut: "0.000223",
              source: "quote",
              blockNumber: "91383505",
              runtimeVersion: "0.1.0",
              runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
            },
          };
        },
      },
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 143,
          protocol: "kuru",
          sender,
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: usdcAddress },
          amountIn: "0.01",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "available",
      quote: { estimatedAmountOut: "0.000223" },
    });
  });

  it("selects the configured live flow and invokes its injected runner", async () => {
    const calls: Parameters<KuruLiveRunner>[0][] = [];
    const runtime = bootstrapBackendRuntime({
      environment: {
        ...environment,
        MOSS_RUNTIME_PATH: "/tmp/moss-runtime",
      },
      tokenRegistry,
    });
    const app = createBackendApp({
      runtime,
      liveRunner: async (input) => {
        calls.push(input);
        throw new Error("runner invoked");
      },
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkRequest()),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AGENT_FLOW_ERROR" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      rpcUrl: environment.MONAD_RPC_URL,
      runtimePath: "/tmp/moss-runtime",
      runtimeVersion: environment.MOSS_RUNTIME_VERSION,
      runtimeRevision: environment.MOSS_RUNTIME_REVISION,
    });
  });

  it("rejects an invalid Moss runtime during backend bootstrap", () => {
    const invalidRuntimePath = mkdtempSync(
      join(tmpdir(), "parallax-invalid-moss-bootstrap-"),
    );

    expect(() =>
      bootstrapBackendApp({
        environment: {
          ...environment,
          MOSS_RUNTIME_PATH: invalidRuntimePath,
        },
        tokenRegistry,
      }),
    ).toThrow(/does not contain a Moss checkout/);
  });

  it("returns a stable JSON error when the configured Replay Fixture is unavailable", async () => {
    const app = bootstrapBackendApp({
      environment,
      tokenRegistry,
      replayRepository: {
        async load() {
          throw new Error("fixture missing");
        },
      },
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/replay/mon-to-usdc"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "REPLAY_STORE_ERROR",
        message: "The recorded replay could not be loaded",
      },
    });
  });

  it("starts through the Node adapter with validated listener settings", () => {
    const fakeServer = { close: () => undefined } as unknown as ServerType;
    let received: { hostname?: string; port?: number } | undefined;
    const server = startBackendServer({
      environment,
      tokenRegistry,
      hostname: "0.0.0.0",
      port: 9000,
      onListening: () => undefined,
      serverFactory(options, listener) {
        received = {
          hostname: options.hostname,
          port: options.port,
        };
        listener?.({ address: "0.0.0.0", family: "IPv4", port: 9000 });
        return fakeServer;
      },
    });

    expect(server).toBe(fakeServer);
    expect(received).toEqual({ hostname: "0.0.0.0", port: 9000 });
  });

  it("closes the configured PostgreSQL pool when the server shuts down", () => {
    const poolEnd = vi
      .spyOn(Pool.prototype, "end")
      .mockResolvedValue(undefined);
    const fakeServer = new EventEmitter();
    Object.assign(fakeServer, {
      close: () => {
        fakeServer.emit("close");
        return fakeServer;
      },
    });

    try {
      const server = startBackendServer({
        environment: {
          ...environment,
          RUN_STORE_BACKEND: "postgres",
          DATABASE_URL: "postgres://user:pass@localhost:5432/parallax",
        },
        tokenRegistry,
        hostname: "0.0.0.0",
        port: 9000,
        serverFactory: () => fakeServer as unknown as ServerType,
      });

      server.close();
      expect(poolEnd).toHaveBeenCalledTimes(1);
    } finally {
      poolEnd.mockRestore();
    }
  });

  it("rejects an invalid listener port before opening a socket", () => {
    expect(() =>
      startBackendServer({
        environment: { ...environment, PORT: "not-a-port" },
        tokenRegistry,
      }),
    ).toThrow();
  });

  it("rejects an invalid Moss runtime before opening a socket", () => {
    let serverFactoryCalls = 0;
    const invalidRuntimePath = mkdtempSync(
      join(tmpdir(), "parallax-invalid-moss-runtime-"),
    );

    expect(() =>
      startBackendServer({
        environment: {
          ...environment,
          MOSS_RUNTIME_PATH: invalidRuntimePath,
        },
        tokenRegistry,
        hostname: "127.0.0.1",
        port: 9000,
        serverFactory: () => {
          serverFactoryCalls += 1;
          return { close: () => undefined } as never;
        },
      }),
    ).toThrow(/does not contain a Moss checkout/);
    expect(serverFactoryCalls).toBe(0);
  });

  it.each(["", "   "])(
    "rejects a blank listener port before coercing %j to zero",
    (port) => {
      expect(() =>
        startBackendServer({
          environment: { ...environment, PORT: port },
          tokenRegistry,
          serverFactory: () => ({ close: () => undefined }) as never,
        }),
      ).toThrow(/PORT is required/);
    },
  );

  it("requires explicit listener settings when no overrides are provided", () => {
    expect(() =>
      startBackendServer({
        environment,
        tokenRegistry,
        serverFactory: () => ({ close: () => undefined }) as never,
      }),
    ).toThrow(/HOST is required/);
  });
});
