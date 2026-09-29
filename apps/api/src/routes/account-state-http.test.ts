import { describe, expect, it } from "vitest";
import { AccountStateApplicationService } from "../account-state-application.js";
import { ArbitrumAccountStateReader } from "../backend/arbitrum-account-state-reader.js";
import type { ArbitrumRpcClient } from "../backend/arbitrum-chain-adapter.js";
import { CAMELOT_V3_ROUTER_ADDRESS } from "../backend/camelot-v3-binding.js";
import { createCamelotV3QualifiedAllowanceSpenderResolver } from "../backend/camelot-v3-qualified-spender.js";
import { InMemoryRunStore } from "../store.js";
import { createTrustedTokenRegistry } from "../trusted-token-registry.js";
import { createAccountStateApp } from "./account-state.js";

// Real addresses recorded by the merged #103 USDC -> WETH qualification.
const usdc = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const weth = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const sender = "0x01bb7b44cc398aaa2b76ac6253f0f5634279db9d";
const blockHash = `0x${"a".repeat(64)}`;

const tokenRegistry = createTrustedTokenRegistry({
  chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
  tokens: [
    {
      chainId: 421614,
      address: usdc,
      symbol: "USDC",
      decimals: 18,
      decimalsSource: "onchain_verified",
      verifiedAtBlock: "100",
    },
    {
      chainId: 421614,
      address: weth,
      symbol: "WETH",
      decimals: 18,
      decimalsSource: "onchain_verified",
      verifiedAtBlock: "100",
    },
  ],
});

function createRpcClient(): ArbitrumRpcClient & { reads: number } {
  const client = {
    reads: 0,
    async request(method: string, params: readonly unknown[] = []) {
      client.reads += 1;
      if (method === "eth_chainId") return "0x66eee";
      if (method === "eth_getBlockByNumber") {
        return { number: "0x64", hash: blockHash };
      }
      if (method === "eth_getBalance") return "0x0";
      if (method === "eth_call") {
        const transaction = params[0] as { data: string };
        if (transaction.data.startsWith("0x70a08231")) {
          return `0x${BigInt("0").toString(16).padStart(64, "0")}`;
        }
        if (transaction.data.startsWith("0xdd62ed3e")) {
          return `0x${BigInt("1000000000000000")
            .toString(16)
            .padStart(64, "0")}`;
        }
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    },
  };
  return client as unknown as ArbitrumRpcClient & { reads: number };
}

function createTestApp() {
  const rpcClient = createRpcClient();
  const store = new InMemoryRunStore();
  const service = new AccountStateApplicationService({
    tokenRegistry,
    reader: new ArbitrumAccountStateReader({
      client: rpcClient,
      tokenRegistry,
      resolveQualifiedSpender:
        createCamelotV3QualifiedAllowanceSpenderResolver(),
    }),
    store,
  });
  return { app: createAccountStateApp(service), rpcClient };
}

const reverseRequest = {
  chainId: 421614,
  protocol: "camelot-v3",
  sender,
  tokenIn: { kind: "erc20", address: usdc },
  tokenOut: { kind: "erc20", address: weth },
  amountIn: "0.001",
};

function post(app: ReturnType<typeof createTestApp>["app"], body: unknown) {
  return app.fetch(
    new Request("https://api.example.test/api/account-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("account-state HTTP boundary for the reverse ERC-20 path", () => {
  it("persists and recovers block-bound balance and qualified allowance state without re-reading RPC", async () => {
    const { app, rpcClient } = createTestApp();

    const response = await post(app, reverseRequest);
    expect(response.status).toBe(200);
    const snapshot = await response.json();

    expect(snapshot).toMatchObject({
      status: "AVAILABLE",
      block: {
        status: "VERIFIED",
        chainId: 421614,
        blockNumber: "100",
        blockHash,
      },
      allowance: {
        status: "SUFFICIENT",
        owner: sender,
        tokenAddress: usdc.toLowerCase(),
        requiredAmountAtomic: "1000000000000000",
        allowanceAtomic: "1000000000000000",
        spender: {
          status: "QUALIFIED",
          address: CAMELOT_V3_ROUTER_ADDRESS.toLowerCase(),
        },
      },
    });
    expect(snapshot.allowance.spender.qualificationRef).toEqual(
      expect.any(String),
    );
    // Trusted decimals come from the registry, not a frontend assumption: this
    // Sepolia test USDC has 18 decimals.
    expect(snapshot.balances.inputToken).toMatchObject({
      status: "AVAILABLE",
      metadata: { symbol: "USDC", decimals: 18 },
    });

    const readsAfterQuery = rpcClient.reads;
    expect(readsAfterQuery).toBeGreaterThan(0);

    const recovered = await app.fetch(
      new Request(
        `https://api.example.test/api/account-state/${encodeURIComponent(snapshot.snapshotId)}`,
      ),
    );
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual(snapshot);
    // Historical recovery is a store read only; it never re-queries the chain.
    expect(rpcClient.reads).toBe(readsAfterQuery);
  });

  it("fails closed for an unknown snapshot and an unsupported chain", async () => {
    const { app } = createTestApp();
    const missing = await app.fetch(
      new Request(
        "https://api.example.test/api/account-state/00000000-0000-4000-8000-000000000000",
      ),
    );
    expect(missing.status).toBe(404);

    const unsupported = await post(app, { ...reverseRequest, chainId: 143 });
    expect(unsupported.status).toBe(400);
  });

  it("does not expose provider payloads or RPC endpoints on the account-state boundary", async () => {
    const { app } = createTestApp();
    const response = await post(app, reverseRequest);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain("providerData");
    expect(serialized).not.toContain("returnData");
    // Public block-explorer links are intended; RPC endpoints and credentials
    // are not.
    expect(serialized).not.toMatch(
      /sepolia-rollup\.arbitrum\.io|alchemy|infura|quicknode|api[_-]?key|rpcUrl/i,
    );
  });
});
