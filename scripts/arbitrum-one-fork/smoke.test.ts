import { describe, expect, it } from "vitest";
import { ARBITRUM_ONE_RUNTIME_PROFILE } from "../../apps/api/src/runtime-config.js";
import {
  ForkSmokeError,
  getForkHarnessConfig,
  type RpcClient,
  runForkQuoteSmoke,
} from "./smoke.js";

const config = getForkHarnessConfig();
const blockNumber = BigInt(config.source.blockNumber);
const blockTag = `0x${blockNumber.toString(16)}`;
const sender = "0x1111111111111111111111111111111111111111";
const instanceId = "00000000-0000-4000-8000-000000000001";
const quoterAmount = 2_414_272n;

class FakeRpc implements RpcClient {
  readonly calls: { method: string; params: readonly unknown[] }[] = [];
  readonly balances = new Map<string, string>();
  readonly snapshots = new Map<string, Map<string, string>>();
  chainId: string;
  blockHash: string;
  forkInstanceId: string;
  code = "0x6000";
  version = `anvil/v${config.anvil.version}`;
  quoteAmount = quoterAmount;
  failRevert = false;
  private nextSnapshot = 1;

  constructor(
    readonly kind: "source" | "local",
    options: {
      chainId?: string;
      blockHash?: string;
      code?: string;
      quoteAmount?: bigint;
      version?: string;
      failRevert?: boolean;
      forkInstanceId?: string;
    } = {},
  ) {
    this.chainId = options.chainId ?? (kind === "source" ? "0xa4b1" : "0x7a69");
    this.blockHash = options.blockHash ?? config.source.blockHash;
    this.code = options.code ?? "0x6000";
    this.quoteAmount = options.quoteAmount ?? quoterAmount;
    this.version = options.version ?? `anvil/v${config.anvil.version}`;
    this.failRevert = options.failRevert ?? false;
    this.forkInstanceId = options.forkInstanceId ?? instanceId;
  }

  async request(
    method: string,
    params: readonly unknown[] = [],
  ): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === "parallax_forkInstanceId") return this.forkInstanceId;
    if (method === "eth_chainId") return this.chainId;
    if (method === "eth_blockNumber") {
      return this.kind === "source"
        ? `0x${(blockNumber + 1n).toString(16)}`
        : blockTag;
    }
    if (method === "eth_getBlockByNumber") {
      return {
        number: blockTag,
        hash: this.blockHash,
        timestamp: "0x6b1f2b5f",
      };
    }
    if (method === "eth_getCode") return this.code;
    if (method === "eth_accounts") return [];
    if (method === "web3_clientVersion") return this.version;
    if (method === "eth_getBalance") {
      const address = String(params[0]).toLowerCase();
      if (this.kind === "local" && params[1] === blockTag)
        return toQuantity(0n);
      return toQuantity(BigInt(this.balances.get(address) ?? "0"));
    }
    if (method === "anvil_setBalance") {
      const address = String(params[0]).toLowerCase();
      this.balances.set(address, BigInt(String(params[1])).toString());
      return true;
    }
    if (method === "evm_snapshot") {
      const snapshotId = `0x${this.nextSnapshot.toString(16)}`;
      this.nextSnapshot += 1;
      this.snapshots.set(snapshotId, new Map(this.balances));
      return snapshotId;
    }
    if (method === "evm_revert") {
      if (this.failRevert) return false;
      const snapshotId = String(params[0]);
      const snapshot = this.snapshots.get(snapshotId);
      if (snapshot === undefined) return false;
      this.balances.clear();
      for (const [address, balance] of snapshot)
        this.balances.set(address, balance);
      this.snapshots.delete(snapshotId);
      return true;
    }
    if (method === "eth_call") return this.ethCall(params);
    throw new Error(`Unexpected fake RPC method: ${method}`);
  }

  private ethCall(params: readonly unknown[]): string {
    const call = params[0] as { to: string; data: string };
    const target = call.to.toLowerCase();
    const selector = call.data.slice(2, 10).toLowerCase();
    const profile = ARBITRUM_ONE_RUNTIME_PROFILE;
    if (selector === "70a08231") return word(0n);
    if (selector === "95d89b41") {
      return encodeString(
        target === profile.deployments.wrappedNativeAddress.toLowerCase()
          ? "WETH"
          : "USDC",
      );
    }
    if (selector === "313ce567") {
      return word(
        target === profile.deployments.wrappedNativeAddress.toLowerCase()
          ? 18n
          : 6n,
      );
    }
    if (selector === "0dfe1681") {
      return encodeAddress(profile.deployments.wrappedNativeAddress);
    }
    if (selector === "d21220a7") {
      return encodeAddress(profile.deployments.usdcAddress);
    }
    if (selector === "1a686502") return word(100n);
    if (selector === "2d9ebd1d")
      return `0x${word(this.quoteAmount).slice(2)}${word(500n).slice(2)}`;
    throw new Error(`Unexpected fake eth_call selector: ${selector}`);
  }
}

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function encodeAddress(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function encodeString(value: string): string {
  const bytes = Buffer.from(value, "utf8").toString("hex");
  const padded = bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
  return `0x${word(32n).slice(2)}${word(BigInt(value.length)).slice(2)}${padded}`;
}

function toQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function isUsdcBalanceCall(call: {
  readonly method: string;
  readonly params: readonly unknown[];
}): boolean {
  if (call.method !== "eth_call") return false;
  const request = call.params[0];
  return (
    typeof request === "object" &&
    request !== null &&
    "data" in request &&
    typeof request.data === "string" &&
    request.data.slice(0, 10).toLowerCase() === "0x70a08231"
  );
}

function readUsdcBlockTags(rpc: FakeRpc): unknown[] {
  return rpc.calls.filter(isUsdcBalanceCall).map((call) => call.params[1]);
}

function run(
  sourceRpc = new FakeRpc("source"),
  localRpc = new FakeRpc("local"),
) {
  return runForkQuoteSmoke({
    sourceRpc,
    localRpc,
    forkInstanceId: instanceId,
    senderAddress: sender,
    now: () => new Date("2026-10-18T06:00:00.000Z"),
  });
}

describe("Arbitrum One local fork quote harness", () => {
  it("compares the same pinned Camelot quote and restores the local sender state", async () => {
    const source = new FakeRpc("source");
    const local = new FakeRpc("local");

    const evidence = await run(source, local);

    expect(evidence).toMatchObject({
      evidenceStatus: "READ_ONLY_QUOTE_REPRODUCIBILITY_NOT_SIMULATION",
      source: {
        chainId: 42161,
        blockNumber: config.source.blockNumber,
        blockHash: config.source.blockHash,
      },
      localExecution: {
        chainId: 31337,
        baseBlockNumber: config.source.blockNumber,
        forkInstanceId: instanceId,
      },
      senderPreparation: {
        address: sender,
        unlockedSignerCount: 0,
        localNativeBalanceOverrideAtomic: config.senderNativeBalanceAtomic,
        upstreamUsdcBalanceAtomic: "0",
        localUsdcBalanceAfterOverrideAtomic: "0",
        resetRestoredUpstreamBalances: true,
      },
      quote: {
        amountInAtomic: "1000000000000000",
        upstreamAmountOutAtomic: quoterAmount.toString(),
        forkAmountOutAtomic: quoterAmount.toString(),
        resetRerunAmountOutAtomic: quoterAmount.toString(),
        exactAtomicOutputMatched: true,
      },
      reset: {
        snapshotRevertedBetweenQuotes: true,
        repeatQuoteMatched: true,
        snapshotRevertedAfterSmoke: true,
        localBlockNumberRestored: true,
      },
      rpcSafety: {
        upstreamWritesAllowed: false,
        signingOrBroadcastingPerformed: false,
        gasOrSimulationMethodsPerformed: false,
        localTransactionsMined: false,
      },
    });
    expect(local.balances.get(sender)).toBeUndefined();
    expect(
      source.calls.every((call) => !call.method.startsWith("eth_send")),
    ).toBe(true);
    expect(local.calls.some((call) => call.method === "anvil_setBalance")).toBe(
      true,
    );
    expect(
      local.calls.some((call) => call.method === "eth_sendRawTransaction"),
    ).toBe(false);
    expect(
      source.calls
        .filter((call) => call.method === "eth_getBalance")
        .map((call) => call.params[1]),
    ).toEqual([blockTag]);
    expect(
      local.calls
        .filter((call) => call.method === "eth_getBalance")
        .map((call) => call.params[1]),
    ).toEqual([blockTag, "latest", "latest", blockTag]);
    expect(readUsdcBlockTags(source)).toEqual([blockTag]);
    expect(readUsdcBlockTags(local)).toEqual([
      blockTag,
      "latest",
      "latest",
      blockTag,
    ]);
    for (const rpc of [source, local]) {
      for (const call of rpc.calls) {
        if (call.method === "eth_getBlockByNumber") {
          expect(call.params[0]).toBe(blockTag);
        } else if (call.method === "eth_getCode") {
          expect(call.params[1]).toBe(blockTag);
        } else if (call.method === "eth_call" && !isUsdcBalanceCall(call)) {
          expect(call.params[1]).toBe(blockTag);
        }
      }
    }
  });

  it("rejects a second fork with matching chain, block, and Anvil version", async () => {
    const source = new FakeRpc("source");
    const secondFork = new FakeRpc("local", {
      forkInstanceId: "00000000-0000-4000-8000-000000000002",
    });

    await expect(run(source, secondFork)).rejects.toMatchObject({
      code: "FORK_INSTANCE_IDENTITY_MISMATCH",
    });
    expect(secondFork.calls).toEqual([
      { method: "parallax_forkInstanceId", params: [] },
    ]);
    expect(source.calls).toEqual([]);
    expect(secondFork.balances.size).toBe(0);
  });

  it("fails closed on a source chain mismatch", async () => {
    await expect(
      run(new FakeRpc("source", { chainId: "0x66eee" })),
    ).rejects.toMatchObject({
      code: "SOURCE_CHAIN_ID_MISMATCH",
    });
  });

  it("rejects a source block hash mismatch", async () => {
    await expect(
      run(new FakeRpc("source", { blockHash: `0x${"ab".repeat(32)}` })),
    ).rejects.toMatchObject({
      code: "SOURCE_BLOCK_HASH_MISMATCH",
    });
  });

  it("rejects missing verified route code before quoting", async () => {
    await expect(
      run(new FakeRpc("source", { code: "0x" })),
    ).rejects.toMatchObject({
      code: "REQUIRED_CONTRACT_CODE_MISSING",
    });
  });

  it("rejects a local Anvil version different from the pinned image", async () => {
    await expect(
      run(
        new FakeRpc("source"),
        new FakeRpc("local", { version: "anvil/v0.0.0" }),
      ),
    ).rejects.toMatchObject({
      code: "ANVIL_VERSION_MISMATCH",
    });
  });

  it("rejects a non-matching atomic quote and still reverts the local snapshot", async () => {
    const local = new FakeRpc("local", { quoteAmount: quoterAmount + 1n });
    await expect(run(new FakeRpc("source"), local)).rejects.toMatchObject({
      code: "QUOTE_PARITY_MISMATCH",
    });
    expect(local.balances.get(sender)).toBeUndefined();
  });

  it("surfaces failed snapshot reset for destroy-and-recreate recovery", async () => {
    await expect(
      run(new FakeRpc("source"), new FakeRpc("local", { failRevert: true })),
    ).rejects.toBeInstanceOf(ForkSmokeError);
    await expect(
      run(new FakeRpc("source"), new FakeRpc("local", { failRevert: true })),
    ).rejects.toMatchObject({
      code: "RESET_FAILED",
    });
  });
});
