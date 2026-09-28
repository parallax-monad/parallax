import {
  type AssetReference,
  type NormalizedSwapIntent,
  normalizedSwapIntentSchema,
  type TrustedTokenRegistry,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import {
  accountStateObservationSchema,
  summarizeAccountState,
} from "../account-state-model.js";
import { createTrustedTokenRegistry } from "../trusted-token-registry.js";
import {
  ArbitrumAccountStateReader,
  type QualifiedAllowanceSpender,
} from "./arbitrum-account-state-reader.js";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";

const sender = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const usdc = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const weth = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const spender = "0x3333333333333333333333333333333333333333";
const blockHash = `0x${"a".repeat(64)}`;
const reorgHash = `0x${"b".repeat(64)}`;

const tokenRegistry: TrustedTokenRegistry = createTrustedTokenRegistry({
  chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
  tokens: [
    {
      chainId: 421614,
      address: usdc,
      symbol: "USDC",
      decimals: 6,
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

type RpcCall = {
  readonly method: string;
  readonly params: readonly unknown[];
};

type RpcClientOptions = {
  readonly chainId?: string;
  readonly failChainId?: boolean;
  readonly failChainIdOnSecondCall?: boolean;
  readonly initialBlockHash?: string;
  readonly recheckedBlockHash?: string;
  readonly nativeBalance?: string;
  readonly erc20Balances?: Readonly<Record<string, string>>;
  readonly failBalancesFor?: readonly string[];
  readonly nativeBalances?: Readonly<Record<string, string>>;
  readonly failAllowance?: boolean;
  readonly allowanceAtomic?: string;
};

function makeIntent(
  tokenIn: AssetReference = { kind: "native" },
  tokenOut: AssetReference = { kind: "erc20", address: usdc },
  input: { sender?: string; recipient?: string; amountInAtomic?: string } = {},
): NormalizedSwapIntent {
  return normalizedSwapIntentSchema.parse({
    chainId: 421614,
    protocol: "camelot-v3",
    sender: input.sender ?? sender,
    recipient: input.recipient ?? input.sender ?? sender,
    recipientSource:
      input.recipient === undefined ? "defaulted_from_sender" : "explicit",
    tokenIn,
    tokenOut,
    amountInAtomic: input.amountInAtomic ?? "1000000",
    economicBoundary: { availability: "unavailable", source: "unavailable" },
  });
}

function createRpcClient(options: RpcClientOptions = {}): ArbitrumRpcClient & {
  readonly calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  let chainIdCallCount = 0;
  return {
    calls,
    async request(method, params = []) {
      calls.push({ method, params });
      if (method === "eth_chainId") {
        chainIdCallCount += 1;
        if (
          options.failChainId ||
          (options.failChainIdOnSecondCall && chainIdCallCount === 2)
        ) {
          throw new Error("offline");
        }
        return options.chainId ?? "0x66eee";
      }
      if (method === "eth_getBlockByNumber") {
        const isLatest = params[0] === "latest";
        return {
          number: "0x64",
          hash: isLatest
            ? (options.initialBlockHash ?? blockHash)
            : (options.recheckedBlockHash ??
              options.initialBlockHash ??
              blockHash),
        };
      }
      if (method === "eth_getBalance") {
        const account = String(params[0]).toLowerCase();
        return toQuantity(
          options.nativeBalances?.[account] ?? options.nativeBalance ?? "0",
        );
      }
      if (method === "eth_call") {
        const transaction = params[0] as { to: string; data: string };
        if (transaction.data.startsWith("0x70a08231")) {
          if (
            options.failBalancesFor?.some(
              (address) =>
                address.toLowerCase() === transaction.to.toLowerCase(),
            )
          ) {
            throw new Error("balance read failed");
          }
          return toWord(
            options.erc20Balances?.[transaction.to.toLowerCase()] ?? "0",
          );
        }
        if (transaction.data.startsWith("0xdd62ed3e")) {
          if (options.failAllowance) throw new Error("allowance read failed");
          return toWord(options.allowanceAtomic ?? "0");
        }
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    },
  };
}

function toQuantity(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function toWord(value: string): string {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function qualifiedSpender(): QualifiedAllowanceSpender {
  return { address: spender, qualificationRef: "test-fixture-only" };
}

describe("ArbitrumAccountStateReader", () => {
  it("deduplicates the sender's native read and preserves zero and large atomic balances", async () => {
    const client = createRpcClient({
      nativeBalance: "9007199254740993",
      erc20Balances: { [usdc]: "0" },
    });
    const timestamps = [
      "2026-09-28T10:00:00.000Z",
      "2026-09-28T10:00:01.000Z",
      "2026-09-28T10:00:02.000Z",
      "2026-09-28T10:00:03.000Z",
    ];
    const reader = new ArbitrumAccountStateReader({
      client,
      tokenRegistry,
      now: () => timestamps.shift() ?? "2026-09-28T10:00:04.000Z",
    });

    const observation = await reader.readAccountState({
      intent: makeIntent(
        { kind: "native" },
        { kind: "erc20", address: usdc },
        { recipient, amountInAtomic: "1000000000000000000" },
      ),
    });

    expect(observation.balances.inputToken).toMatchObject({
      status: "AVAILABLE",
      account: sender,
      amountAtomic: "9007199254740993",
    });
    expect(observation.balances.native).toMatchObject({
      status: "AVAILABLE",
      account: sender,
      amountAtomic: "9007199254740993",
    });
    expect(observation.balances.outputToken).toMatchObject({
      status: "AVAILABLE",
      account: recipient,
      amountAtomic: "0",
    });
    expect(
      client.calls.filter((call) => call.method === "eth_getBalance"),
    ).toHaveLength(1);

    const outputBalanceCall = client.calls.find((call) => {
      if (call.method !== "eth_call") return false;
      const transaction = call.params[0] as { to: string; data: string };
      return transaction.to.toLowerCase() === usdc;
    });
    expect(outputBalanceCall).toBeDefined();
    if (outputBalanceCall === undefined)
      throw new Error("Expected output balance RPC call");
    expect(outputBalanceCall.params[1]).toBe("0x64");
    expect((outputBalanceCall.params[0] as { data: string }).data).toBe(
      `0x70a08231${recipient.slice(2).toLowerCase().padStart(64, "0")}`,
    );
    expect(
      client.calls
        .filter(
          (call) =>
            call.method === "eth_getBalance" || call.method === "eth_call",
        )
        .every((call) => call.params[1] === "0x64"),
    ).toBe(true);
    expect(observation.block).toMatchObject({
      status: "VERIFIED",
      blockNumber: "100",
      blockHash,
      observedAt: "2026-09-28T10:00:03.000Z",
    });
    expect(summarizeAccountState(observation)).toBe("AVAILABLE");
  });

  it("keeps an individual failed token read unavailable without filling it with zero", async () => {
    const client = createRpcClient({
      nativeBalance: "42",
      erc20Balances: { [weth]: "0" },
      failBalancesFor: [usdc],
    });
    const reader = new ArbitrumAccountStateReader({ client, tokenRegistry });

    const observation = await reader.readAccountState({
      intent: makeIntent(
        { kind: "erc20", address: usdc },
        { kind: "erc20", address: weth },
      ),
    });

    expect(observation.balances.inputToken).toMatchObject({
      status: "UNAVAILABLE",
      reason: "RPC_UNAVAILABLE",
    });
    expect(observation.balances.outputToken).toMatchObject({
      status: "AVAILABLE",
      amountAtomic: "0",
    });
    expect(observation.balances.native).toMatchObject({
      status: "AVAILABLE",
      amountAtomic: "42",
    });
    expect(observation.allowance).toMatchObject({
      status: "UNAVAILABLE",
      reason: "SPENDER_NOT_QUALIFIED",
      spender: { status: "UNAVAILABLE", reason: "SPENDER_NOT_QUALIFIED" },
    });
    expect(
      client.calls.some(
        (call) =>
          call.method === "eth_call" &&
          (call.params[0] as { data: string }).data.startsWith("0xdd62ed3e"),
      ),
    ).toBe(false);
    expect(summarizeAccountState(observation)).toBe("PARTIAL");
  });

  it("keeps same-asset reads separate when the sender and recipient differ", async () => {
    const client = createRpcClient({
      nativeBalances: { [sender]: "7", [recipient]: "13" },
    });
    const reader = new ArbitrumAccountStateReader({ client, tokenRegistry });

    const observation = await reader.readAccountState({
      intent: makeIntent(
        { kind: "erc20", address: usdc },
        { kind: "native" },
        { sender, recipient },
      ),
    });

    expect(observation.balances.outputToken).toMatchObject({
      status: "AVAILABLE",
      account: recipient,
      asset: { kind: "native" },
      amountAtomic: "13",
    });
    expect(observation.balances.native).toMatchObject({
      status: "AVAILABLE",
      account: sender,
      asset: { kind: "native" },
      amountAtomic: "7",
    });
    const nativeReadCalls = client.calls.filter(
      (call) => call.method === "eth_getBalance",
    );
    expect(nativeReadCalls).toHaveLength(2);
    expect(nativeReadCalls.map((call) => call.params[0]).sort()).toEqual(
      [sender, recipient].sort(),
    );
  });

  it("fails closed on total RPC failure instead of reporting zero balances", async () => {
    const client = createRpcClient({ failChainId: true });
    const reader = new ArbitrumAccountStateReader({ client, tokenRegistry });

    const observation = await reader.readAccountState({
      intent: makeIntent(
        { kind: "erc20", address: usdc },
        { kind: "erc20", address: weth },
      ),
    });

    expect(observation.block.status).toBe("UNAVAILABLE");
    expect(observation.block).toMatchObject({
      reason: "RPC_UNAVAILABLE",
    });
    expect(observation.balances.inputToken.status).toBe("UNAVAILABLE");
    expect(observation.balances.outputToken.status).toBe("UNAVAILABLE");
    expect(observation.balances.native.status).toBe("UNAVAILABLE");
    expect(observation.allowance).toMatchObject({
      status: "UNAVAILABLE",
      reason: "SPENDER_NOT_QUALIFIED",
      spender: { status: "UNAVAILABLE", reason: "SPENDER_NOT_QUALIFIED" },
    });
    expect(summarizeAccountState(observation)).toBe("UNAVAILABLE");
    expect(client.calls.map((call) => call.method)).toEqual(["eth_chainId"]);
  });

  it("preserves the unqualified spender reason when the RPC reports another chain", async () => {
    const client = createRpcClient({ chainId: "0x1" });
    const reader = new ArbitrumAccountStateReader({ client, tokenRegistry });

    const observation = await reader.readAccountState({
      intent: makeIntent(
        { kind: "erc20", address: usdc },
        { kind: "erc20", address: weth },
      ),
    });

    expect(observation.block).toMatchObject({
      status: "UNAVAILABLE",
      reason: "CHAIN_MISMATCH",
    });
    expect(observation.allowance).toMatchObject({
      status: "UNAVAILABLE",
      reason: "SPENDER_NOT_QUALIFIED",
      spender: { status: "UNAVAILABLE", reason: "SPENDER_NOT_QUALIFIED" },
    });
    expect(client.calls.map((call) => call.method)).toEqual(["eth_chainId"]);
  });

  it("preserves the unqualified spender reason when the final chain recheck fails", async () => {
    const client = createRpcClient({ failChainIdOnSecondCall: true });
    const reader = new ArbitrumAccountStateReader({ client, tokenRegistry });

    const observation = await reader.readAccountState({
      intent: makeIntent(
        { kind: "erc20", address: usdc },
        { kind: "erc20", address: weth },
      ),
    });

    expect(observation.block).toMatchObject({
      status: "UNAVAILABLE",
      reason: "BLOCK_RECHECK_FAILED",
    });
    expect(observation.allowance).toMatchObject({
      status: "UNAVAILABLE",
      reason: "SPENDER_NOT_QUALIFIED",
      spender: { status: "UNAVAILABLE", reason: "SPENDER_NOT_QUALIFIED" },
    });
    expect(
      client.calls.filter((call) => call.method === "eth_chainId"),
    ).toHaveLength(2);
  });

  it("binds allowance sufficiency to normalized amount, qualified spender, and pinned block", async () => {
    const client = createRpcClient({ allowanceAtomic: "1000000" });
    const reader = new ArbitrumAccountStateReader({
      client,
      tokenRegistry,
      resolveQualifiedSpender: qualifiedSpender,
    });

    const observation = await reader.readAccountState({
      intent: makeIntent(
        { kind: "erc20", address: usdc },
        { kind: "erc20", address: weth },
        { amountInAtomic: "1000000" },
      ),
    });

    expect(observation.allowance).toMatchObject({
      status: "SUFFICIENT",
      owner: sender,
      tokenAddress: usdc,
      spender: { status: "QUALIFIED", address: spender },
      requiredAmountAtomic: "1000000",
      allowanceAtomic: "1000000",
      blockNumber: "100",
    });
    const allowanceCall = client.calls.find((call) => {
      if (call.method !== "eth_call") return false;
      return (call.params[0] as { data: string }).data.startsWith("0xdd62ed3e");
    });
    expect(allowanceCall).toBeDefined();
    if (allowanceCall === undefined)
      throw new Error("Expected allowance RPC call");
    expect(allowanceCall.params[1]).toBe("0x64");
    expect((allowanceCall.params[0] as { data: string }).data).toBe(
      `0xdd62ed3e${sender.slice(2).toLowerCase().padStart(64, "0")}` +
        spender.slice(2).toLowerCase().padStart(64, "0"),
    );
  });

  it("does not mark an allowance sufficient when the amount exceeds the allowance", async () => {
    const reader = new ArbitrumAccountStateReader({
      client: createRpcClient({ allowanceAtomic: "999999" }),
      tokenRegistry,
      resolveQualifiedSpender: qualifiedSpender,
    });

    const observation = await reader.readAccountState({
      intent: makeIntent(
        { kind: "erc20", address: usdc },
        { kind: "erc20", address: weth },
        { amountInAtomic: "1000000" },
      ),
    });

    expect(observation.allowance).toMatchObject({
      status: "INSUFFICIENT",
      requiredAmountAtomic: "1000000",
      allowanceAtomic: "999999",
      blockNumber: "100",
    });
  });

  it("keeps a qualified allowance unavailable when its RPC read fails", async () => {
    const reader = new ArbitrumAccountStateReader({
      client: createRpcClient({ failAllowance: true }),
      tokenRegistry,
      resolveQualifiedSpender: qualifiedSpender,
    });

    const observation = await reader.readAccountState({
      intent: makeIntent(
        { kind: "erc20", address: usdc },
        { kind: "erc20", address: weth },
        { amountInAtomic: "1000000" },
      ),
    });

    expect(observation.allowance).toMatchObject({
      status: "UNAVAILABLE",
      reason: "RPC_UNAVAILABLE",
      spender: { status: "QUALIFIED", address: spender },
      requiredAmountAtomic: "1000000",
      blockNumber: "100",
    });
    expect(observation.allowance).not.toHaveProperty("allowanceAtomic");
    expect(summarizeAccountState(observation)).toBe("PARTIAL");
    expect(accountStateObservationSchema.safeParse(observation).success).toBe(
      true,
    );

    expect(
      accountStateObservationSchema.safeParse({
        ...observation,
        allowance: {
          ...observation.allowance,
          spender: {
            status: "UNAVAILABLE",
            reason: "SPENDER_NOT_QUALIFIED",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("invalidates every amount and allowance when the pinned block hash changes", async () => {
    const client = createRpcClient({
      initialBlockHash: blockHash,
      recheckedBlockHash: reorgHash,
      nativeBalance: "20",
      erc20Balances: { [usdc]: "10", [weth]: "30" },
      allowanceAtomic: "1000000",
    });
    const reader = new ArbitrumAccountStateReader({
      client,
      tokenRegistry,
      resolveQualifiedSpender: qualifiedSpender,
    });

    const observation = await reader.readAccountState({
      intent: makeIntent(
        { kind: "erc20", address: usdc },
        { kind: "erc20", address: weth },
      ),
    });

    expect(observation.block).toMatchObject({
      status: "STALE",
      blockNumber: "100",
      blockHash,
      recheckedBlockHash: reorgHash,
    });
    expect(observation.balances.inputToken).toMatchObject({
      status: "UNAVAILABLE",
      reason: "BLOCK_HASH_MISMATCH",
    });
    expect(observation.balances.outputToken.status).toBe("UNAVAILABLE");
    expect(observation.balances.native.status).toBe("UNAVAILABLE");
    expect(observation.allowance).toMatchObject({
      status: "UNAVAILABLE",
      reason: "BLOCK_HASH_MISMATCH",
      blockNumber: "100",
    });
    expect(summarizeAccountState(observation)).toBe("UNAVAILABLE");
    expect(
      accountStateObservationSchema.safeParse({
        ...observation,
        allowance: {
          status: "SUFFICIENT",
          owner: sender,
          tokenAddress: usdc,
          spender: {
            status: "QUALIFIED",
            address: spender,
            qualificationRef: "test-fixture-only",
          },
          requiredAmountAtomic: "1000000",
          allowanceAtomic: "1000000",
          blockNumber: "100",
        },
      }).success,
    ).toBe(false);
  });
});
