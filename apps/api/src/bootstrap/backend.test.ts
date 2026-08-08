import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerType } from "@hono/node-server";
import type { KuruLiveRunner } from "@parallax/orchestrator/agent-flow";
import { describe, expect, it } from "vitest";
import { bootstrapBackendRuntime } from "../runtime-config.js";
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
  it("fails closed when production runtime configuration is incomplete", () => {
    expect(() =>
      bootstrapBackendApp({ environment: {}, tokenRegistry }),
    ).toThrow();
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
