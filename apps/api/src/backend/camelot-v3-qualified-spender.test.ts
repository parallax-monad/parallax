import {
  type NormalizedSwapIntent,
  normalizedSwapIntentSchema,
  type TrustedTokenRegistry,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { createTrustedTokenRegistry } from "../trusted-token-registry.js";
import { ArbitrumAccountStateReader } from "./arbitrum-account-state-reader.js";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import {
  CAMELOT_V3_ROUTER_ADDRESS,
  inspectCamelotV3Transaction,
} from "./camelot-v3-binding.js";
import {
  CAMELOT_V3_ALLOWANCE_SPENDER_QUALIFICATION_REF,
  createCamelotV3QualifiedAllowanceSpenderResolver,
} from "./camelot-v3-qualified-spender.js";

// Real addresses from the merged #103 real USDC -> WETH qualification capture
// fixtures/provider-registry/be-103/usdc-weth-camelot-2026-09-29T10-09-52-993Z.
const usdc = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const weth = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const qualifiedSender = "0x01bb7b44cc398aaa2b76ac6253f0f5634279db9d";
const blockHash = `0x${"a".repeat(64)}`;

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

const tokenRegistry: TrustedTokenRegistry = createTrustedTokenRegistry({
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

function createRpcClient(options: {
  readonly allowanceAtomic?: string;
}): ArbitrumRpcClient {
  return {
    async request(method, params = []) {
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
          return `0x${BigInt(options.allowanceAtomic ?? "0")
            .toString(16)
            .padStart(64, "0")}`;
        }
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    },
  };
}

const resolver = createCamelotV3QualifiedAllowanceSpenderResolver();

describe("Camelot V3 qualified allowance spender", () => {
  it("qualifies the same router address the prepared-transaction binding enforces", () => {
    const spender = resolver({ intent: reverseIntent() });
    expect(spender).toEqual({
      address: CAMELOT_V3_ROUTER_ADDRESS,
      qualificationRef: CAMELOT_V3_ALLOWANCE_SPENDER_QUALIFICATION_REF,
    });

    // The #103 prepared transaction binds against that same constant, so the
    // approved spender and the transaction target cannot diverge.
    const binding = inspectCamelotV3Transaction(
      reverseIntent(),
      qualifiedQuote,
      qualifiedTransaction,
    );
    expect(binding.ok).toBe(true);
    if (binding.ok) {
      expect(binding.binding.router).toBe(spender?.address);
      expect(binding.binding.value).toBe("0x0");
      expect(binding.binding.recipient).toBe(qualifiedSender);
      expect(binding.binding.amountInAtomic).toBe("1000000000000000");
    }
  });

  it("fails closed for an unqualified protocol, chain, or native input", () => {
    expect(resolver({ intent: reverseIntent({ protocol: "kuru" }) })).toBe(
      undefined,
    );
    expect(resolver({ intent: reverseIntent({ chainId: 143 }) })).toBe(
      undefined,
    );
    const nativeIntent = normalizedSwapIntentSchema.parse({
      ...reverseIntent(),
      tokenIn: { kind: "native" },
    });
    expect(resolver({ intent: nativeIntent })).toBe(undefined);
  });

  it("qualifies only the exact #103 USDC -> WETH pair", () => {
    const otherChain = 421614;
    const withPair = (
      tokenIn: { kind: "erc20"; address: string },
      tokenOut: { kind: "erc20"; address: string },
    ) =>
      normalizedSwapIntentSchema.parse({
        ...reverseIntent({ chainId: otherChain }),
        tokenIn,
        tokenOut,
      });
    const arbitrary = "0x0000000000000000000000000000000000000abc";

    // Swapping the qualified legs must not inherit the USDC -> WETH evidence.
    expect(
      resolver({
        intent: withPair(
          { kind: "erc20", address: weth },
          { kind: "erc20", address: usdc },
        ),
      }),
    ).toBe(undefined);
    // An arbitrary ERC-20 input must not inherit it either.
    expect(
      resolver({
        intent: withPair(
          { kind: "erc20", address: arbitrary },
          { kind: "erc20", address: weth },
        ),
      }),
    ).toBe(undefined);
    // Nor may an arbitrary output.
    expect(
      resolver({
        intent: withPair(
          { kind: "erc20", address: usdc },
          { kind: "erc20", address: arbitrary },
        ),
      }),
    ).toBe(undefined);
    // The qualified pair itself still qualifies.
    expect(
      resolver({
        intent: withPair(
          { kind: "erc20", address: usdc },
          { kind: "erc20", address: weth },
        ),
      }),
    ).toMatchObject({
      address: CAMELOT_V3_ROUTER_ADDRESS,
      qualificationRef: CAMELOT_V3_ALLOWANCE_SPENDER_QUALIFICATION_REF,
    });
  });

  it("leaves an unqualified pair's allowance SPENDER_NOT_QUALIFIED through the real reader", async () => {
    const reader = new ArbitrumAccountStateReader({
      client: createRpcClient({ allowanceAtomic: "1000000000000000" }),
      tokenRegistry,
      resolveQualifiedSpender: resolver,
    });

    const observation = await reader.readAccountState({
      intent: normalizedSwapIntentSchema.parse({
        ...reverseIntent(),
        tokenIn: { kind: "erc20", address: weth },
        tokenOut: { kind: "erc20", address: usdc },
      }),
    });

    expect(observation.allowance).toMatchObject({
      status: "UNAVAILABLE",
      reason: "SPENDER_NOT_QUALIFIED",
      spender: { status: "UNAVAILABLE", reason: "SPENDER_NOT_QUALIFIED" },
    });
  });

  it("reads a real ERC-20 allowance for the reverse path instead of SPENDER_NOT_QUALIFIED", async () => {
    const reader = new ArbitrumAccountStateReader({
      client: createRpcClient({ allowanceAtomic: "1000000000000000" }),
      tokenRegistry,
      resolveQualifiedSpender: resolver,
    });

    const observation = await reader.readAccountState({
      intent: reverseIntent(),
    });

    expect(observation.allowance).toMatchObject({
      status: "SUFFICIENT",
      owner: qualifiedSender,
      tokenAddress: usdc.toLowerCase(),
      spender: {
        status: "QUALIFIED",
        address: CAMELOT_V3_ROUTER_ADDRESS.toLowerCase(),
        qualificationRef: CAMELOT_V3_ALLOWANCE_SPENDER_QUALIFICATION_REF,
      },
      requiredAmountAtomic: "1000000000000000",
      allowanceAtomic: "1000000000000000",
      blockNumber: "100",
    });
  });

  it("reports an insufficient allowance truthfully instead of assuming approval", async () => {
    const reader = new ArbitrumAccountStateReader({
      client: createRpcClient({ allowanceAtomic: "999999999999999" }),
      tokenRegistry,
      resolveQualifiedSpender: resolver,
    });

    const observation = await reader.readAccountState({
      intent: reverseIntent(),
    });

    expect(observation.allowance).toMatchObject({
      status: "INSUFFICIENT",
      allowanceAtomic: "999999999999999",
      requiredAmountAtomic: "1000000000000000",
    });
  });
});

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

  it("accepts the exact qualified USDC -> WETH transaction", () => {
    const result = inspect({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.binding.value).toBe("0x0");
      expect(result.binding.amountOutMinimumAtomic).toBe("62312541185147");
      expect(result.binding.tokenIn).toBe(usdc.toLowerCase());
      expect(result.binding.tokenOut).toBe(weth.toLowerCase());
    }
  });

  it.each([
    ["a non-zero native value on an ERC-20 input", { value: "0x1" }],
    [
      "a router that is not the qualified Camelot router",
      { to: "0x000000000000000000000000000000000000dEaD" },
    ],
    [
      "a sender that is not the Intent sender",
      { from: "0x000000000000000000000000000000000000dEaD" },
    ],
    ["a malformed calldata body", { data: "0xdeadbeef" }],
  ] as const)("rejects %s", (_name, overrides) => {
    const result = inspect(overrides as Partial<typeof qualifiedTransaction>);
    expect(result.ok).toBe(false);
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

  it("rejects a non-zero sqrtPriceLimitX96 word", () => {
    expect(inspect(withWord(6, 1n)).ok).toBe(false);
  });

  it("rejects a calldata with no execution deadline", () => {
    expect(inspect(withWord(3, 0n)).ok).toBe(false);
  });

  it("rejects an Intent whose token pair does not match the calldata", () => {
    const swapped = normalizedSwapIntentSchema.parse({
      ...reverseIntent(),
      tokenIn: { kind: "erc20", address: weth },
      tokenOut: { kind: "erc20", address: usdc },
    });
    expect(inspect({}, swapped).ok).toBe(false);
  });

  it("rejects an amountIn that drifted from the Intent", () => {
    const drifted = normalizedSwapIntentSchema.parse({
      ...reverseIntent(),
      amountInAtomic: "1000000000000001",
    });
    expect(inspect({}, drifted).ok).toBe(false);
  });

  it("rejects a recipient that drifted from the Intent", () => {
    const drifted = normalizedSwapIntentSchema.parse({
      ...reverseIntent(),
      recipient: "0x000000000000000000000000000000000000dEaD",
      recipientSource: "explicit",
    });
    expect(inspect({}, drifted).ok).toBe(false);
  });

  it("fails closed when the private atomic quote is unavailable and no boundary exists", () => {
    // Without the atomic quote the protocol-side 99% protection floor cannot be
    // verified, so the transaction must not be published as bound Evidence.
    expect(inspect({}, reverseIntent(), {}).ok).toBe(false);
  });

  it("binds an explicit economic boundary verbatim instead of the derived floor", () => {
    const bounded = normalizedSwapIntentSchema.parse({
      ...reverseIntent(),
      economicBoundary: {
        availability: "available",
        source: "user_declared",
        minimumReceivedAtomic: "62312541185147",
      },
    });
    const result = inspect({}, bounded, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.binding.amountOutMinimumAtomic).toBe("62312541185147");
    }
  });
});
