import type { AddressInfo } from "node:net";
import type { ServerType } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import { startBackendServer } from "./bootstrap/backend.js";

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

describe("real Node backend listener", () => {
  it("serves composed Replay and Check routes over HTTP", async () => {
    let server: ServerType | undefined;
    const address = await new Promise<AddressInfo>((resolve, reject) => {
      server = startBackendServer({
        environment,
        tokenRegistry,
        hostname: "127.0.0.1",
        port: 0,
        onListening: resolve,
      });
      server.once("error", reject);
    });

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const replay = await fetch(`${baseUrl}/api/replay/mon-to-usdc`);
      expect(replay.status).toBe(200);
      expect(replay.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );

      const check = await fetch(`${baseUrl}/api/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkRequest()),
      });
      expect(check.status).toBe(502);
      await expect(check.json()).resolves.toMatchObject({
        error: { code: "AGENT_FLOW_ERROR" },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 10_000);
});
