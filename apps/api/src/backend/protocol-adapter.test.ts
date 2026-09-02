import { describe, expect, it } from "vitest";
import {
  isProtocolAdapterError,
  type ProtocolAdapter,
  ProtocolAdapterError,
  type UnsignedTransaction,
} from "./protocol-adapter.js";

type FakeIntent = {
  protocol: string;
  payload: string;
};

type FakeQuote = {
  amountOut: string;
};

type FakeTransaction = {
  to: string;
  data: string;
  value: string;
};

describe("ProtocolAdapter port", () => {
  it("injects a fake adapter and invokes quote and buildTransaction", async () => {
    const intent: FakeIntent = {
      protocol: "test-protocol",
      payload: "fake-intent",
    };
    const quoteCalls: FakeIntent[] = [];
    const buildCalls: FakeIntent[] = [];
    const transaction: UnsignedTransaction<FakeTransaction> = {
      kind: "unsigned",
      payload: {
        to: "0xrouter",
        data: "0xcalldata",
        value: "0",
      },
    };
    const adapter: ProtocolAdapter<FakeIntent, FakeQuote, FakeTransaction> = {
      async quote(receivedIntent) {
        quoteCalls.push(receivedIntent);
        return { amountOut: "42" };
      },
      async buildTransaction(receivedIntent) {
        buildCalls.push(receivedIntent);
        return transaction;
      },
    };

    await expect(adapter.quote(intent)).resolves.toEqual({ amountOut: "42" });
    await expect(adapter.buildTransaction(intent)).resolves.toEqual(
      transaction,
    );
    expect(quoteCalls).toEqual([intent]);
    expect(buildCalls).toEqual([intent]);
  });

  it("marks the transaction result as unsigned and keeps the payload opaque", async () => {
    const adapter: ProtocolAdapter<FakeIntent, FakeQuote, FakeTransaction> = {
      async quote() {
        return { amountOut: "42" };
      },
      async buildTransaction() {
        return {
          kind: "unsigned",
          payload: {
            to: "0xrouter",
            data: "0xcalldata",
            value: "0",
          },
        };
      },
    };

    const result = await adapter.buildTransaction({
      protocol: "test-protocol",
      payload: "fake-intent",
    });

    expect(result.kind).toBe("unsigned");
    expect(result).not.toHaveProperty("signature");
    expect(result).not.toHaveProperty("signed");
    expect(result.payload).toEqual({
      to: "0xrouter",
      data: "0xcalldata",
      value: "0",
    });
  });

  it("identifies a protocol error and preserves its error code", () => {
    const error = new ProtocolAdapterError({
      code: "QUOTE_FAILED",
      message: "The protocol quote failed",
      protocol: "test-protocol",
    });

    expect(isProtocolAdapterError(error)).toBe(true);
    expect(error.code).toBe("QUOTE_FAILED");
    expect(error.protocol).toBe("test-protocol");
  });

  it("handles an unsupported protocol explicitly", async () => {
    const error = new ProtocolAdapterError({
      code: "UNSUPPORTED_PROTOCOL",
      message: "The protocol is not supported",
      protocol: "unsupported-protocol",
    });
    const adapter: ProtocolAdapter<FakeIntent, FakeQuote, FakeTransaction> = {
      async quote() {
        throw error;
      },
      async buildTransaction() {
        throw error;
      },
    };

    await expect(
      adapter.quote({ protocol: "unsupported-protocol", payload: "fake" }),
    ).rejects.toSatisfy(
      (received: unknown) =>
        isProtocolAdapterError(received) &&
        received.code === "UNSUPPORTED_PROTOCOL" &&
        received.protocol === "unsupported-protocol",
    );
    await expect(
      adapter.buildTransaction({
        protocol: "unsupported-protocol",
        payload: "fake",
      }),
    ).rejects.toSatisfy(
      (received: unknown) =>
        isProtocolAdapterError(received) &&
        received.code === "UNSUPPORTED_PROTOCOL",
    );
  });
});
