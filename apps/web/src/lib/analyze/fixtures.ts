import type { Copy } from "@/lib/i18n";
import type { EvidenceItem, EvidenceOrigin, Protocol } from "./types";

/**
 * Provenance of everything this module produces. The values below are computed
 * from local rate and balance tables rather than read from a recorded fixture,
 * so they are `mock`. Marking them `replay` would claim recorded provenance the
 * data does not have. Loading real fixtures is what earns `replay`.
 */
const DEMO_ORIGIN: EvidenceOrigin = "mock";

export const TOKENS = ["MON", "WMON", "USDC", "USDT", "WETH", "SHMON"] as const;

export type TokenSymbol = (typeof TOKENS)[number];

/**
 * What the P0 recorded fixture set can actually answer for. The form is driven
 * by these lists so it never offers an input we have no evidence for. Add
 * entries here once new fixtures land and the inputs become selectable again.
 */
export type ProtocolOption = { value: Protocol; label: string };

export const SUPPORTED_PROTOCOLS: readonly ProtocolOption[] = [
  { value: "kuru", label: "Kuru" },
];

export const SUPPORTED_TOKENS_IN: readonly string[] = ["MON"];

export const SUPPORTED_TOKENS_OUT: readonly string[] = ["USDC"];

export type ExecutionStatus = "SUCCESS" | "NO_ROUTE" | "REVERTED" | "UNKNOWN";

/**
 * Normalized execution evidence. Rules read only this shape, never Moss raw
 * types, so the decision layer stays independent of the integration (PRD 14).
 */
export type NormalizedEvidence = {
  executionStatus: ExecutionStatus;
  route: Copy;
  expectedOutput: number;
  blockNumber: string;
  warnings: Copy[];
  /** Technical field names the run could not resolve; drives UNKNOWN (PRD 10.3). */
  missingFields: string[];
  origin: EvidenceOrigin;
  items: EvidenceItem[];
};

const RATES: Record<string, number> = {
  "MON>USDC": 0.42,
  "MON>USDT": 0.41,
  "WMON>USDC": 0.42,
  "MON>WMON": 1,
  "WMON>MON": 1,
};

/** Pairs Kuru can quote in the recorded fixture set. */
const KURU_PAIRS = new Set([
  "MON>USDC",
  "MON>USDT",
  "MON>WMON",
  "WMON>MON",
  "WMON>USDC",
]);

/** PancakeSwap stayed UNAVAILABLE for P0 (PRD 15.3), so routes are thin. */
const PANCAKE_PAIRS = new Set(["MON>USDC", "WMON>USDC"]);

/** Recorded sender balance, so oversized amounts fail for a traceable reason. */
const SENDER_BALANCE: Record<string, number> = {
  MON: 1800,
  WMON: 1200,
  USDC: 500,
  USDT: 500,
  WETH: 2,
  SHMON: 0,
};

const STAGE_LABELS = {
  discover: { en: "Protocol discovery", zh: "协议发现" },
  load: { en: "Route load", zh: "路径加载" },
  action: { en: "Unsigned action built", zh: "构建未签名交易" },
  simulate: { en: "Simulation status", zh: "模拟执行状态" },
  balance: { en: "Sender balance", zh: "发送方余额" },
  quote: { en: "Quoted output", zh: "报价输出" },
} satisfies Record<string, Copy>;

function stageItems(
  protocol: string,
  routeValue: string,
  status: ExecutionStatus,
  blockNumber: string,
): EvidenceItem[] {
  const origin = DEMO_ORIGIN;
  return [
    {
      id: "discover",
      stage: "discover",
      label: STAGE_LABELS.discover,
      value: `${protocol} capabilities loaded`,
      origin,
      blockNumber,
    },
    {
      id: "load",
      stage: "load",
      label: STAGE_LABELS.load,
      // Raw route identifier, kept language-neutral like other evidence values.
      value: routeValue,
      origin,
      blockNumber,
    },
    {
      id: "action",
      stage: "action",
      label: STAGE_LABELS.action,
      value: status === "NO_ROUTE" ? "not reached" : "swap calldata prepared",
      origin,
      blockNumber,
    },
    {
      id: "simulate",
      stage: "simulate",
      label: STAGE_LABELS.simulate,
      value: status,
      origin,
      blockNumber,
    },
  ];
}

export type EvidenceRequest = {
  protocol: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippage: number;
};

/**
 * Produces normalized demo evidence from deterministic local tables. Every item
 * is marked `mock`: this module does not load a recorded fixture and therefore
 * cannot claim replay provenance.
 */
export function runEvidence(request: EvidenceRequest): NormalizedEvidence {
  const { protocol, tokenIn, tokenOut, amountIn, slippage } = request;
  const pair = `${tokenIn}>${tokenOut}`;
  const blockNumber = "unavailable";
  const pairs = protocol === "kuru" ? KURU_PAIRS : PANCAKE_PAIRS;
  const venue = protocol === "kuru" ? "Kuru" : "PancakeSwap V3";
  const route: Copy = {
    en: `${tokenIn} → ${tokenOut} via ${venue}`,
    zh: `${tokenIn} → ${tokenOut}，经由 ${venue}`,
  };

  if (tokenIn === tokenOut || !pairs.has(pair) || RATES[pair] === undefined) {
    const reason: Copy =
      tokenIn === tokenOut
        ? { en: "identical token pair", zh: "输入与输出是同一种代币" }
        : {
            en: `no ${venue} pool for ${tokenIn}/${tokenOut}`,
            zh: `${venue} 上没有 ${tokenIn}/${tokenOut} 资金池`,
          };
    return {
      executionStatus: "NO_ROUTE",
      route: reason,
      expectedOutput: 0,
      blockNumber,
      warnings: [],
      missingFields: [],
      origin: DEMO_ORIGIN,
      items: stageItems(
        protocol,
        `no_route ${tokenIn}/${tokenOut} on ${venue}`,
        "NO_ROUTE",
        blockNumber,
      ),
    };
  }

  const balance = SENDER_BALANCE[tokenIn] ?? 0;
  if (amountIn > balance) {
    const items = stageItems(protocol, route.en, "REVERTED", blockNumber);
    items.push({
      id: "balance",
      stage: "rpc",
      label: STAGE_LABELS.balance,
      value: `${balance} ${tokenIn} available, ${amountIn} requested`,
      origin: DEMO_ORIGIN,
      blockNumber,
    });
    return {
      executionStatus: "REVERTED",
      route,
      expectedOutput: 0,
      blockNumber,
      warnings: [
        {
          en: "transfer would exceed sender balance",
          zh: "转账金额会超出发送方余额",
        },
      ],
      missingFields: [],
      origin: DEMO_ORIGIN,
      items,
    };
  }

  // Slippage is applied to the quoted rate so the boundary rule compares
  // against a real number rather than an idealised one.
  const expectedOutput = amountIn * RATES[pair] * (1 - slippage / 100);
  const items = stageItems(protocol, route.en, "SUCCESS", blockNumber);
  items.push({
    id: "quote",
    stage: "load",
    label: STAGE_LABELS.quote,
    value: `${expectedOutput.toFixed(4)} ${tokenOut}`,
    origin: DEMO_ORIGIN,
    blockNumber,
  });

  return {
    executionStatus: "SUCCESS",
    route,
    expectedOutput,
    blockNumber,
    warnings:
      protocol === "pancake"
        ? [{ en: "thin liquidity on this pool", zh: "该资金池流动性偏低" }]
        : [],
    missingFields: protocol === "pancake" ? ["priceImpact"] : [],
    origin: DEMO_ORIGIN,
    items,
  };
}
