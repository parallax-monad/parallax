import {
  type NormalizedSwapIntent,
  normalizedSwapIntentSchema,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import {
  CAMELOT_V3_ROUTER_ADDRESS,
  inspectCamelotV3Transaction,
} from "./camelot-v3-binding.js";

// Real addresses from the merged #103 real USDC -> WETH qualification capture
// fixtures/provider-registry/be-103/usdc-weth-camelot-2026-09-29T10-09-52-993Z.
const usdc = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const weth = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const qualifiedSender = "0x01bb7b44cc398aaa2b76ac6253f0f5634279db9d";

/** Exact prepared unsigned transaction recorded by the #103 qualification. */
const qualifiedTransaction = {
  from: qualifiedSender,
  to: CAMELOT_V3_ROUTER_ADDRESS,
  data:
    "0xbc651188" +
    "000000000000000000000000b893e3334d4bd6c5ba8277fd559e99ed683a9fc7" +
    "000000000000000000000000980b62da83eff3d4576c647993b0c1d7faf17c73" +
    "00000000000000000000000001bb7b44cc398aaa2b76ac6253f0f5634279db9d" +
    "000000000000000000000000000000000000000000000000000000006abb8f9b" +
    "00000000000000000000000000000000000000000000000000038d7ea4c68000" +
    "000000000000000000000000000000000000000000000000000038ac44e1e47b" +
    "0000000000000000000000000000000000000000000000000000000000000000",
  value: "0x0",
  chainId: "0x66eee",
} as const;

/** Pinned quote recorded by the same qualification. */
const qualifiedQuote = { amountOutAtomic: "62941960793078" };

function reverseIntent(
  overrides: { protocol?: string; chainId?: number } = {},
): NormalizedSwapIntent {
  return normalizedSwapIntentSchema.parse({
    chainId: overrides.chainId ?? 421614,
    protocol: overrides.protocol ?? "camelot-v3",
    sender: qualifiedSender,
    recipient: qualifiedSender,
    recipientSource: "defaulted_from_sender",
    tokenIn: { kind: "erc20", address: usdc },
    tokenOut: { kind: "erc20", address: weth },
    amountInAtomic: "1000000000000000",
    economicBoundary: { availability: "unavailable", source: "unavailable" },
  });
}

describe("Camelot V3 reverse ERC-20 binding fails closed", () => {
  const inspect = (
    overrides: Partial<typeof qualifiedTransaction>,
    intent = reverseIntent(),
    quote: unknown = qualifiedQuote,
  ) =>
    inspectCamelotV3Transaction(intent, quote, {
      ...qualifiedTransaction,
      ...overrides,
    });

  /** Rewrites one ABI word of the recorded calldata. */
  const withWord = (index: number, value: bigint) => {
    const hex = value.toString(16).padStart(64, "0");
    const start = 2 + 8 + index * 64;
    const data = qualifiedTransaction.data;
    return { data: `${data.slice(0, start)}${hex}${data.slice(start + 64)}` };
  };

  it("accepts USDC -> WETH when the explicit recipient differs from the sender", () => {
    const recipient = "0x2222222222222222222222222222222222222222";
    const splitIntent = normalizedSwapIntentSchema.parse({
      ...reverseIntent(),
      recipient,
      recipientSource: "explicit",
    });

    const result = inspect(withWord(2, BigInt(recipient)), splitIntent);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.binding).toMatchObject({
        sender: qualifiedSender,
        recipient,
        from: qualifiedSender,
        to: CAMELOT_V3_ROUTER_ADDRESS,
        value: "0x0",
        tokenIn: usdc.toLowerCase(),
        tokenOut: weth.toLowerCase(),
      });
    }
  });
});
