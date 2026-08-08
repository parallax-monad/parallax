import { describe, expect, it } from "vitest";
import { normalizeRecordedKuruEvidence } from "../src/index.js";
import type { JsonValue } from "../src/types.js";

const SENDER = "0xcccccccccccccccccccccccccccccccccccccccc";
const ROUTER = "0xd651346d7c789536ebf06dc72ae3c8502cd695cc";
const MARKET = "0x122c0d8683cab344163fb73e28e741754257e3fa";
const MAKER = "0x2a68ba1833cdf93fa9da1eebd7f46242ad8e90c5";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const USDC_LOWER = USDC.toLowerCase();
const OTHER_TOKEN = "0x1111111111111111111111111111111111111111";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TRADE_TOPIC =
  "0xf16924fba1c18c108912fcacaac7450c98eb3f2d8c0a3cdf3df7066c08f21581";
const FLIP_TOPIC =
  "0xb74e966bc873b8c144fab39c9981210f50130885e89caf4556c0840cec741dcd";
const ROUTER_SWAP_TOPIC =
  "0xae71e8ae9695e4f3523d27453a24d99edc4738fea8130c1cb33eb9ef95f53354";

const AMOUNT_IN = "10000000000000000";
const AMOUNT_OUT = "223";

function addressTopic(address: string): string {
  return "0x" + address.slice(2).toLowerCase().padStart(64, "0");
}

function amountData(amount: string): string {
  return "0x" + BigInt(amount).toString(16).padStart(64, "0");
}

function nativeTransfer(from: string, to: string, value: string): JsonValue {
  return { kind: "nativeTransfer", from, to, value };
}

function erc20Transfer(
  token: string,
  from: string,
  to: string,
  amount: string,
): JsonValue {
  return {
    kind: "event",
    address: token,
    topics: [TRANSFER_TOPIC, addressTopic(from), addressTopic(to)],
    data: amountData(amount),
  };
}

function nonValueEvent(address: string, topic: string): JsonValue {
  return { kind: "event", address, topics: [topic], data: "0x" };
}

function canonicalChanges(): JsonValue[] {
  return [
    nativeTransfer(SENDER, ROUTER, AMOUNT_IN),
    nativeTransfer(ROUTER, MARKET, AMOUNT_IN),
    nonValueEvent(MARKET, FLIP_TOPIC),
    nonValueEvent(MARKET, TRADE_TOPIC),
    erc20Transfer(USDC_LOWER, MAKER, ROUTER, AMOUNT_OUT),
    nativeTransfer(MARKET, MAKER, AMOUNT_IN),
    nonValueEvent(ROUTER, ROUTER_SWAP_TOPIC),
    erc20Transfer(USDC_LOWER, ROUTER, SENDER, AMOUNT_OUT),
  ];
}

function outcome(overrides: Record<string, unknown> = {}): JsonValue {
  return {
    operation: "swap",
    protocol: "kuru",
    sender: SENDER,
    tokenIn: "native",
    tokenOut: USDC,
    amountIn: AMOUNT_IN,
    amountOut: AMOUNT_OUT,
    ...overrides,
  };
}

function assess(
  changes: JsonValue[],
  options: {
    outcomeOverrides?: Record<string, unknown>;
    quotePath?: string[];
    intentOverrides?: Record<string, string>;
  } = {},
) {
  const normalized = normalizeRecordedKuruEvidence({
    intent: {
      chainId: "143",
      sender: SENDER,
      tokenIn: "native",
      tokenOut: USDC,
      amountIn: "0.01",
      ...options.intentOverrides,
    },
    raw: {
      discover: null,
      load: null,
      quote: {
        data: {
          amountSide: "amountIn",
          amountIn: "0.01",
          estimatedAmountOut: "0.000223",
          minimumAmountOut: "0.000221",
          path: options.quotePath ?? ["native", USDC],
        },
      },
      action: null,
      simulation: {
        results: [
          {
            protocol: "kuru",
            method: "swap",
            transaction: {
              from: SENDER,
              to: ROUTER,
              data: "0x",
              value: "0x2386f26fc10000",
            },
            reverted: false,
            receipt: {
              kind: "receipt",
              outcome: outcome(options.outcomeOverrides),
              changes: [],
            },
            changes,
            warnings: [],
            gas: "528696",
          },
        ],
      },
    },
    blockNumber: "100",
    mossVersion: "0.1.0",
  });
  return normalized.assetChangeAssessment;
}

describe("assessAssetChanges (Kuru asset-change predicate)", () => {
  it("explains the canonical MON -> USDC value movement with Kuru non-value events present", () => {
    expect(assess(canonicalChanges())).toBe("EXPLAINED");
  });

  it("returns NOT_APPLICABLE for an empty change set", () => {
    expect(assess([])).toBe("NOT_APPLICABLE");
  });

  it("returns UNKNOWN when the final tokenOut transfer to the sender is missing", () => {
    expect(assess(canonicalChanges().slice(0, -1))).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when the sender paid the wrong tokenIn amount", () => {
    const changes = canonicalChanges();
    changes[0] = nativeTransfer(SENDER, ROUTER, "9000000000000000");
    changes[1] = nativeTransfer(ROUTER, MARKET, "9000000000000000");
    changes[5] = nativeTransfer(MARKET, MAKER, "9000000000000000");
    expect(assess(changes)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when the simulated amountOut disagrees with the movements", () => {
    expect(
      assess(canonicalChanges(), { outcomeOverrides: { amountOut: "222" } }),
    ).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for an unexpected third asset", () => {
    const changes = [
      ...canonicalChanges(),
      erc20Transfer(OTHER_TOKEN, MAKER, SENDER, "5"),
    ];
    expect(assess(changes)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for a non-conserving transfer set (market mints value)", () => {
    const changes = canonicalChanges();
    changes[1] = nativeTransfer(ROUTER, MARKET, "9000000000000000");
    expect(assess(changes)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for an unknown value-relevant change kind", () => {
    const changes = [
      ...canonicalChanges(),
      { kind: "burn", from: SENDER, amount: "1" },
    ];
    expect(assess(changes)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for malformed native transfer quantities", () => {
    const changes = canonicalChanges();
    changes[0] = {
      kind: "nativeTransfer",
      from: SENDER,
      to: ROUTER,
      value: "0x10",
    };
    expect(assess(changes)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when the swap outcome is missing entirely", () => {
    expect(
      assess(canonicalChanges(), {
        outcomeOverrides: { amountOut: undefined },
      }),
    ).toBe("UNKNOWN");
  });
});
