import { pathToFileURL } from "node:url";
import type { ServerType } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import { bootstrapBackendApp } from "./bootstrap/backend.js";
import {
  isMainModule,
  logBackendListening,
  type StartConfiguredBackendServerOptions,
  startConfiguredBackendServer,
} from "./server.js";

const environment = {
  MONAD_RPC_URL: "https://rpc.example.test",
  MOSS_RUNTIME_VERSION: "confirmed-portable-baseline",
  MOSS_RUNTIME_REVISION: "moss-commit-123",
  PARALLAX_TOKEN_REGISTRY_JSON: JSON.stringify({
    chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
    tokens: [],
  }),
  HOST: "127.0.0.1",
  PORT: "8787",
};
const tokenRegistry = {
  chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
  tokens: [],
};

describe("configured backend launcher", () => {
  it("matches Windows entrypoint paths despite drive or case differences", () => {
    const modulePath = "/Users/johnma/projects/parallax/apps/api/src/server.ts";

    expect(
      isMainModule(
        modulePath.toUpperCase(),
        pathToFileURL(modulePath).href,
        "win32",
      ),
    ).toBe(true);
  });

  it("logs the actual bound listener address", () => {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      output.push(String(message));
    };

    try {
      logBackendListening({
        address: "127.0.0.1",
        family: "IPv4",
        port: 8787,
      });
    } finally {
      console.log = originalLog;
    }

    expect(output).toEqual(["Parallax API listening on http://127.0.0.1:8787"]);
  });

  it("handles browser preflight requests for the configured origin", async () => {
    const app = bootstrapBackendApp({
      environment: {
        ...environment,
        CORS_ORIGIN: "http://localhost:5173",
      },
      tokenRegistry,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Content-Type",
    );
  });

  it("injects the environment token registry into the Node server bootstrap", () => {
    const fakeServer = { close: () => undefined } as unknown as ServerType;
    let received: { hostname?: string; port?: number } | undefined;
    const options: StartConfiguredBackendServerOptions = {
      environment,
      serverFactory(serverOptions) {
        received = {
          hostname: serverOptions.hostname,
          port: serverOptions.port,
        };
        return fakeServer;
      },
    };

    expect(startConfiguredBackendServer(options)).toBe(fakeServer);
    expect(received).toEqual({ hostname: "127.0.0.1", port: 8787 });
  });

  it("fails before opening the server when token metadata is absent", () => {
    const serverFactory: NonNullable<
      StartConfiguredBackendServerOptions["serverFactory"]
    > = () => ({ close: () => undefined }) as never;

    expect(() =>
      startConfiguredBackendServer({
        environment: { ...environment, PARALLAX_TOKEN_REGISTRY_JSON: "" },
        serverFactory,
      }),
    ).toThrow(/PARALLAX_TOKEN_REGISTRY_JSON/);
  });
});
