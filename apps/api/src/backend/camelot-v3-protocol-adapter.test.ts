import { CAMELOT_V3_PROTOCOL_ID } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import {
  CAMELOT_SEPOLIA_QUOTER,
  CAMELOT_SEPOLIA_ROUTER,
  CAMELOT_SEPOLIA_USDC,
  CAMELOT_SEPOLIA_WETH,
  CamelotV3ProtocolAdapter,
  createCamelotV3ProtocolAdapter,
} from "./camelot-v3-protocol-adapter.js";
import {
  isProtocolAdapterError,
  type UnsignedTransaction,
} from "./protocol-adapter.js";

const intent = {
  chainId: 421614,
  protocol: CAMELOT_V3_PROTOCOL_ID,
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender" as const,
  tokenIn: { kind: "native" as const },
  tokenOut: {
    kind: "erc20" as const,
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  amountInAtomic: "1000",
  economicBoundary: {
    availability: "unavailable" as const,
    source: "unavailable" as const,
  },
};

function quoteResponse(amountOut: bigint): string {
  return `0x${amountOut.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
}

function calldataWord(data: unknown, index: number): string {
  if (typeof data !== "string") throw new Error("expected calldata");
  const start = 2 + 8 + index * 64;
  return data.slice(start, start + 64);
}

describe("CamelotV3ProtocolAdapter", () => {
  it("keeps Camelot quote and transaction construction behind replaceable seams", async () => {
    const quote = { status: "controlled", scenarioId: "quote-seam" };
    const transaction = { to: "0xrouter", data: "0xcalldata", value: "0x0" };
    const calls: string[] = [];
    const adapter = new CamelotV3ProtocolAdapter({
      quote: async (received) => {
        calls.push(`quote:${received.amountInAtomic}`);
        return quote;
      },
      buildTransaction: async (received) => {
        calls.push(`transaction:${received.protocol}`);
        return transaction;
      },
    });

    await expect(adapter.quote(intent)).resolves.toBe(quote);
    await expect(adapter.buildTransaction(intent)).resolves.toEqual({
      kind: "unsigned",
      payload: transaction,
    });
    expect(adapter.protocolId).toBe(CAMELOT_V3_PROTOCOL_ID);
    expect(calls).toEqual(["quote:1000", "transaction:camelot-v3"]);
  });

  it("passes through an explicitly unsigned transaction without signing it", async () => {
    const unsigned = {
      kind: "unsigned" as const,
      payload: { to: "0xrouter", data: "0xcalldata", value: "0x0" },
    };
    const adapter = createCamelotV3ProtocolAdapter({
      buildTransaction: async () => unsigned,
    });

    await expect(adapter.buildTransaction(intent)).resolves.toBe(unsigned);
  });

  it("wraps arbitrary seam failures with the operation-specific protocol error", async () => {
    const adapter = new CamelotV3ProtocolAdapter({
      quote: async () => {
        throw new Error("quote service unavailable");
      },
      buildTransaction: async () => {
        throw new Error("transaction builder failed");
      },
    });

    await expect(adapter.quote(intent)).rejects.toSatisfy((error: unknown) => {
      return (
        isProtocolAdapterError(error) &&
        error.code === "QUOTE_FAILED" &&
        error.protocol === CAMELOT_V3_PROTOCOL_ID &&
        !error.retryable
      );
    });
    await expect(adapter.buildTransaction(intent)).rejects.toSatisfy(
      (error: unknown) => {
        return (
          isProtocolAdapterError(error) &&
          error.code === "BUILD_TRANSACTION_FAILED" &&
          error.protocol === CAMELOT_V3_PROTOCOL_ID &&
          !error.retryable
        );
      },
    );
  });

  it("does not pretend to support real quote or pool acceptance without a seam", async () => {
    const adapter = createCamelotV3ProtocolAdapter();

    await expect(adapter.quote(intent)).rejects.toSatisfy((error: unknown) => {
      return (
        isProtocolAdapterError(error) &&
        error.code === "UNAVAILABLE" &&
        error.protocol === CAMELOT_V3_PROTOCOL_ID
      );
    });
    await expect(adapter.buildTransaction(intent)).rejects.toSatisfy(
      (error: unknown) =>
        isProtocolAdapterError(error) &&
        error.code === "UNAVAILABLE" &&
        error.protocol === CAMELOT_V3_PROTOCOL_ID,
    );
  });

  it("rejects an intent for a different chain or protocol before invoking a seam", async () => {
    const quote = async () => ({ status: "controlled" });
    const adapter = new CamelotV3ProtocolAdapter({ quote });

    await expect(
      adapter.quote({ ...intent, chainId: 143 }),
    ).rejects.toMatchObject({ code: "INVALID_INTENT" });
    await expect(
      adapter.quote({ ...intent, protocol: "kuru" }),
    ).rejects.toMatchObject({ code: "INVALID_INTENT" });
  });

  it("uses the injected Arbitrum RPC client for the canonical Camelot path", async () => {
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    const rpcClient: ArbitrumRpcClient = {
      async request(method, params = []) {
        calls.push({ method, params });
        return `0x${(2n * 10n ** 18n).toString(16).padStart(64, "0")}${"0".repeat(64)}`;
      },
    };
    const canonicalIntent = {
      ...intent,
      amountInAtomic: "1000000000000000",
      recipient: "0x2222222222222222222222222222222222222222",
      recipientSource: "explicit" as const,
      tokenOut: { kind: "erc20" as const, address: CAMELOT_SEPOLIA_USDC },
    };
    const adapter = new CamelotV3ProtocolAdapter({
      rpcClient,
      tokenOutDecimals: 18,
      runtimeVersion: "test-runtime",
      runtimeRevision: "test-revision",
    });

    const blockContext = { blockNumber: "42" };
    const quote = await adapter.quote(canonicalIntent, { blockContext });
    expect(quote).toEqual({
      estimatedAmountOut: "2",
      source: "quote",
      blockNumber: "42",
      runtimeVersion: "test-runtime",
      runtimeRevision: "test-revision",
    });
    const transaction = await adapter.buildTransaction(canonicalIntent, {
      blockContext,
      quote,
    });
    const payload = (
      transaction as UnsignedTransaction<Record<string, unknown>>
    ).payload;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      method: "eth_call",
      params: [
        {
          to: CAMELOT_SEPOLIA_QUOTER,
          data: expect.stringMatching(/^0x2d9ebd1d[0-9a-f]{256}$/),
        },
        "0x2a",
      ],
    });
    expect(payload).toMatchObject({
      from: canonicalIntent.sender,
      to: CAMELOT_SEPOLIA_ROUTER,
      value: "0x38d7ea4c68000",
      chainId: "0x66eee",
    });
    expect(calldataWord(payload.data, 2)).toBe(
      canonicalIntent.recipient.slice(2).toLowerCase().padStart(64, "0"),
    );
    expect(String(payload.data).slice(0, 2 + 8 + 64)).toBe(
      `0xbc651188${CAMELOT_SEPOLIA_WETH.slice(2).toLowerCase().padStart(64, "0")}`,
    );
    expect(calls).toHaveLength(1);
  });

  it("binds quote and transaction construction to the supplied pinned block", async () => {
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    const rpcClient: ArbitrumRpcClient = {
      async request(method, params = []) {
        calls.push({ method, params });
        const amountOut =
          params[1] === "0x2a" ? 2n * 10n ** 18n : 3n * 10n ** 18n;
        return quoteResponse(amountOut);
      },
    };
    const canonicalIntent = {
      ...intent,
      amountInAtomic: "1000000000000000",
      tokenOut: { kind: "erc20" as const, address: CAMELOT_SEPOLIA_USDC },
    };
    const adapter = new CamelotV3ProtocolAdapter({
      rpcClient,
      tokenOutDecimals: 18,
    });

    const block42 = { blockNumber: "42" };
    const block43 = { blockNumber: "43" };
    const quote42 = await adapter.quote(canonicalIntent, {
      blockContext: block42,
    });
    const transaction42 = await adapter.buildTransaction(canonicalIntent, {
      blockContext: block42,
      quote: quote42,
    });
    const quote43 = await adapter.quote(canonicalIntent, {
      blockContext: block43,
    });
    const transaction43 = await adapter.buildTransaction(canonicalIntent, {
      blockContext: block43,
      quote: quote43,
    });

    expect(quote42).toMatchObject({
      estimatedAmountOut: "2",
      blockNumber: "42",
    });
    expect(quote43).toMatchObject({
      estimatedAmountOut: "3",
      blockNumber: "43",
    });
    expect(calldataWord(transaction42.payload.data, 5)).toBe(
      ((2n * 10n ** 18n * 99n) / 100n).toString(16).padStart(64, "0"),
    );
    expect(calldataWord(transaction43.payload.data, 5)).toBe(
      ((3n * 10n ** 18n * 99n) / 100n).toString(16).padStart(64, "0"),
    );
    await expect(
      adapter.buildTransaction(canonicalIntent, {
        blockContext: block43,
        quote: quote42,
      }),
    ).rejects.toMatchObject({
      code: "BUILD_TRANSACTION_FAILED",
      cause: expect.objectContaining({
        message: "Camelot quote is not bound to the requested pinned block",
      }),
    });
    expect(calls).toHaveLength(2);
  });

  it("does not re-quote when building a live transaction without the execution quote", async () => {
    const adapter = new CamelotV3ProtocolAdapter({
      rpcClient: {
        request: async () => quoteResponse(2n * 10n ** 18n),
      },
      tokenOutDecimals: 18,
    });
    const canonicalIntent = {
      ...intent,
      amountInAtomic: "1000000000000000",
      tokenOut: { kind: "erc20" as const, address: CAMELOT_SEPOLIA_USDC },
    };

    await expect(
      adapter.buildTransaction(canonicalIntent),
    ).rejects.toMatchObject({
      code: "BUILD_TRANSACTION_FAILED",
      cause: expect.objectContaining({
        message:
          "Camelot transaction construction requires the quote produced for this execution",
      }),
    });
  });

  it("fails closed when the live quote response is not exactly two ABI words", async () => {
    const adapter = new CamelotV3ProtocolAdapter({
      rpcClient: {
        request: async () => "0x01",
      },
    });

    await expect(adapter.quote(intent)).rejects.toSatisfy((error: unknown) => {
      return (
        isProtocolAdapterError(error) &&
        error.code === "QUOTE_FAILED" &&
        error.protocol === CAMELOT_V3_PROTOCOL_ID
      );
    });
  });
});
