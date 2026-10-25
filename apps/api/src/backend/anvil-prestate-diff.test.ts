import { describe, expect, it } from "vitest";
import {
  type AnvilStateRevisionContext,
  createArbitrumOneExecutionCall,
  fingerprintAnvilStateDump,
  qualifyArbitrumOneRecipientBalanceDelta,
} from "./anvil-prestate-diff.js";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import type { ArbitrumOneTransactionPayload } from "./arbitrum-one-transaction.js";

const tokenAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const recipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const poolSlot = `0x${"11".repeat(32)}`;
const recipientSlot = `0x${"22".repeat(32)}`;
const secondRecipientSlot = `0x${"33".repeat(32)}`;
const balanceBefore = 0n;
const poolBefore = 1_000_000_000n;
const poolAfter = poolBefore - 1_234_567n;
const received = 1_234_567n;
const context: AnvilStateRevisionContext = {
  forkInstanceId: "00000000-0000-4000-8000-000000000001",
  chainId: 31_337,
  blockNumber: "515881859",
  blockHash: `0x${"ab".repeat(32)}`,
};

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

const transaction: ArbitrumOneTransactionPayload = {
  from: recipient,
  to: tokenAddress,
  data: `0x${"12".repeat(4)}`,
  value: "0x1",
  chainId: "0xa4b1",
};

function traceForRecipientSlots(recipientSlots = [recipientSlot]) {
  const postStorage: Record<string, string> = {
    [poolSlot]: word(poolAfter),
  };
  for (const slot of recipientSlots) postStorage[slot] = word(received);
  return {
    pre: {
      [tokenAddress]: {
        balance: "0x0",
        code: "0x60006000",
        nonce: 0,
        storage: { [poolSlot]: word(poolBefore) },
      },
    },
    post: { [tokenAddress]: { storage: postStorage } },
  };
}

function createDiffRpc(
  options: {
    readonly mappedSlots?: readonly string[];
    readonly mismatchStorage?: boolean;
    readonly failStorageRead?: boolean;
    readonly failOverride?: boolean;
  } = {},
) {
  const calls: Array<{ method: string; params: readonly unknown[] }> = [];
  const rpc: ArbitrumRpcClient = {
    async request(method, params = []) {
      calls.push({ method, params });
      if (method === "eth_getStorageAt") {
        if (options.failStorageRead) throw new Error("storage unavailable");
        const slot = String(params[1]).toLowerCase();
        if (slot === poolSlot) {
          return word(options.mismatchStorage ? poolBefore + 1n : poolBefore);
        }
        return word(0n);
      }
      if (method === "eth_call") {
        if (options.failOverride) throw new Error("state override unsupported");
        const overrides = params[2] as Record<
          string,
          { stateDiff?: Record<string, string> }
        >;
        const override = Object.entries(overrides).find(
          ([address]) => address.toLowerCase() === tokenAddress,
        )?.[1];
        const [slot, value] =
          Object.entries(override?.stateDiff ?? {})[0] ?? [];
        const targetSlots = (options.mappedSlots ?? [recipientSlot]).map(
          (item) => item.toLowerCase(),
        );
        return word(
          slot !== undefined && targetSlots.includes(slot.toLowerCase())
            ? BigInt(value ?? "0x0")
            : balanceBefore,
        );
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    },
  };
  return { rpc, calls };
}

describe("Anvil prestate diff adapter", () => {
  it("omits only the already-verified Arbitrum chainId for local call RPCs", () => {
    expect(createArbitrumOneExecutionCall(transaction)).toEqual({
      from: transaction.from,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
    });
    expect(() =>
      createArbitrumOneExecutionCall({ ...transaction, chainId: "0x7a69" }),
    ).toThrow("Prepared transaction is not a valid Arbitrum One call");
    expect(() =>
      createArbitrumOneExecutionCall({
        ...transaction,
        gasPrice: "0x1",
      } as ArbitrumOneTransactionPayload),
    ).toThrow("Prepared transaction is not a valid Arbitrum One call");
  });

  it("fingerprints complete Anvil state bytes bound to fork and pinned block", () => {
    const first = fingerprintAnvilStateDump("0x01020304", context);
    const second = fingerprintAnvilStateDump("0x01020304", context);
    const differentState = fingerprintAnvilStateDump("0x01020305", context);
    const differentFork = fingerprintAnvilStateDump("0x01020304", {
      ...context,
      forkInstanceId: "00000000-0000-4000-8000-000000000002",
    });

    expect(first).toMatchObject({
      status: "AVAILABLE",
      method: "ANVIL_DUMP_STATE",
    });
    if (first.status !== "AVAILABLE") throw new Error("Expected fingerprint");
    expect(first.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second).toEqual(first);
    expect(differentState).not.toEqual(first);
    expect(differentFork).not.toEqual(first);
    expect(fingerprintAnvilStateDump("0x123", context)).toMatchObject({
      status: "UNKNOWN",
      reason: "NO_QUALIFIED_ANVIL_STATE_REVISION_TOKEN",
    });
  });

  it("qualifies one recipient balance slot through storage and state-override checks", async () => {
    const { rpc, calls } = createDiffRpc();
    const result = await qualifyArbitrumOneRecipientBalanceDelta({
      rpc,
      trace: traceForRecipientSlots(),
      tokenAddress,
      recipient,
      balanceBeforeAtomic: "0",
    });

    expect(result).toEqual({
      status: "AVAILABLE",
      amountReceivedAtomic: received.toString(),
      source: "VALIDATED_STATE_DIFF",
    });
    expect(
      calls.filter((call) => call.method === "eth_getStorageAt"),
    ).toHaveLength(2);
    expect(calls.filter((call) => call.method === "eth_call")).toHaveLength(3);
    expect(
      calls.every((call) =>
        ["eth_getStorageAt", "eth_call"].includes(call.method),
      ),
    ).toBe(true);
    const overrideCalls = calls.filter((call) => call.method === "eth_call");
    expect(overrideCalls[0]?.params[0]).toMatchObject({
      to: tokenAddress,
      data: `0x70a08231${recipient.slice(2).padStart(64, "0")}`,
    });
    expect(overrideCalls[0]?.params[1]).toBe("latest");
  });

  it.each([
    {
      name: "an arbitrary extra tracer field",
      trace: { ...traceForRecipientSlots(), returnValue: "0x" },
      options: {},
    },
    {
      name: "a mismatching direct storage read",
      trace: traceForRecipientSlots(),
      options: { mismatchStorage: true },
    },
    {
      name: "an unavailable direct storage read",
      trace: traceForRecipientSlots(),
      options: { failStorageRead: true },
    },
    {
      name: "unsupported state overrides",
      trace: traceForRecipientSlots(),
      options: { failOverride: true },
    },
    {
      name: "two slots that both resolve to this recipient balance",
      trace: traceForRecipientSlots([recipientSlot, secondRecipientSlot]),
      options: { mappedSlots: [recipientSlot, secondRecipientSlot] },
    },
    {
      name: "an absent prestate account",
      trace: { pre: {}, post: {} },
      options: {},
    },
  ])("fails closed for $name", async ({ trace, options }) => {
    const { rpc } = createDiffRpc(options);
    await expect(
      qualifyArbitrumOneRecipientBalanceDelta({
        rpc,
        trace,
        tokenAddress,
        recipient,
        balanceBeforeAtomic: "0",
      }),
    ).resolves.toEqual({
      status: "UNAVAILABLE",
      reason: "STATE_DIFF_NOT_QUALIFIED",
    });
  });
});
