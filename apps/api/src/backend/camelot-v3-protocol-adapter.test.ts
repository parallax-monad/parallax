import { CAMELOT_V3_PROTOCOL_ID } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import {
  CamelotV3ProtocolAdapter,
  createCamelotV3ProtocolAdapter,
} from "./camelot-v3-protocol-adapter.js";
import { isProtocolAdapterError } from "./protocol-adapter.js";

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
});
