import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import {
  CAMELOT_V3_ROUTER_ADDRESS,
  CAMELOT_V3_WETH_ADDRESS,
  inspectCamelotV3Transaction,
} from "./camelot-v3-binding.js";

const sender = "0x1111111111111111111111111111111111111111";
const tokenOut = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";

const intent: NormalizedSwapIntent = {
  chainId: 421614,
  protocol: "camelot-v3",
  sender,
  recipient: sender,
  recipientSource: "explicit",
  tokenIn: { kind: "native" },
  tokenOut: { kind: "erc20", address: tokenOut },
  amountInAtomic: "1000000000000000000",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

function word(value: string): string {
  return value.slice(2).toLowerCase().padStart(64, "0");
}

function quantity(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function transaction(
  amountOutMinimum: bigint,
  tokenInWord = word(CAMELOT_V3_WETH_ADDRESS),
): { from: string; to: string; value: string; chainId: string; data: string } {
  const words = [
    tokenInWord,
    word(tokenOut),
    word(sender),
    quantity(1n),
    quantity(1000000000000000000n),
    quantity(amountOutMinimum),
    quantity(0n),
  ];
  return {
    from: sender,
    to: CAMELOT_V3_ROUTER_ADDRESS,
    value: "0xde0b6b3a7640000",
    chainId: "0x66eee",
    data: `0xbc651188${words.join("")}`,
  };
}

describe("Camelot transaction binding", () => {
  it("requires the canonical atomic quote when no explicit boundary exists", () => {
    const valid = inspectCamelotV3Transaction(
      intent,
      { amountOutAtomic: "1000" },
      transaction(990n),
    );
    expect(valid.ok).toBe(true);

    expect(inspectCamelotV3Transaction(intent, {}, transaction(990n)).ok).toBe(
      false,
    );
    expect(
      inspectCamelotV3Transaction(
        intent,
        { amountOutAtomic: "not-atomic" },
        transaction(990n),
      ).ok,
    ).toBe(false);
  });

  it("rejects a calldata minimum that differs from the canonical quote floor", () => {
    expect(
      inspectCamelotV3Transaction(
        intent,
        { amountOutAtomic: "1000" },
        transaction(991n),
      ).ok,
    ).toBe(false);
  });

  it("rejects ABI address words with non-zero high bytes", () => {
    const malformedAddressWord = `0x${"1".repeat(24)}${CAMELOT_V3_WETH_ADDRESS.slice(2)}`;
    expect(
      inspectCamelotV3Transaction(
        intent,
        { amountOutAtomic: "1000" },
        transaction(990n, malformedAddressWord),
      ).ok,
    ).toBe(false);
  });
});
