import type { ServerType } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import {
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

describe("configured backend launcher", () => {
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
