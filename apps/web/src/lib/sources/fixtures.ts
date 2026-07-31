import type {
  QuoteSnapshot,
  SimulationResult,
  Sourced,
  TradeIntent,
} from "../types";

const now = () => new Date().toISOString();

interface Fixture {
  liquidity: number;
  fee: number;
  route: string[];
  gas: number;
  limit: number;
  delta: number;
  warnings?: SimulationResult["warnings"];
}

const FIXTURES: Record<string, Fixture> = {
  kuru: {
    liquidity: 25_000_000,
    fee: 4,
    route: ["MON", "Kuru Router", "USDC"],
    gas: 148_000,
    limit: 220_000,
    delta: -5,
  },
  pancakeswap: {
    liquidity: 12_000_000,
    fee: 8,
    route: ["MON", "PancakeSwap V3 Pool", "USDC"],
    gas: 172_000,
    limit: 240_000,
    delta: -18,
    warnings: [
      {
        code: "price_impact_notice",
        severity: "low",
        message: "此路徑的價格影響高於同意圖下的最佳候選路徑。",
      },
    ],
  },
};

function source<T>(value: T): Sourced<T> {
  return { value, source: "fixture", fetchedAt: now(), detail: "樣例演示數據" };
}

function fixture(id: string) {
  return FIXTURES[id] ?? FIXTURES.kuru;
}

export function fixtureQuote(intent: TradeIntent): QuoteSnapshot {
  const f = fixture(intent.protocolId);
  const amount = Number(intent.amountIn);
  const ratio = amount / f.liquidity;
  const impact = f.fee + ratio * 10_000 * (1 + ratio * 4);
  const price = 1 - impact / 10_000;

  return {
    amountOut: source((amount * price).toFixed(6)),
    executionPrice: source(price),
    midPrice: source(1),
    priceImpactBps: source(Number(impact.toFixed(1))),
    expectedSlippageBps: source(Number((impact * 0.35).toFixed(1))),
    poolLiquidityUsd: source(f.liquidity),
    notionalUsd: source(amount),
    route: source(f.route),
  };
}

export function fixtureSimulation(
  intent: TradeIntent,
  quote: QuoteSnapshot,
): SimulationResult {
  const f = fixture(intent.protocolId);
  const actual = Number(quote.amountOut.value) * (1 + f.delta / 10_000);
  const gasPriceWei = "52000000000";
  const gasCostNative = ((f.gas * 52) / 1e9).toFixed(6);

  return {
    success: true,
    gasUsed: String(f.gas),
    gasLimit: String(f.limit),
    gasPriceWei,
    gasCostNative,
    gasCostUsd: Number((Number(gasCostNative) * 2.4).toFixed(4)),
    warnings: f.warnings ?? [],
    receipt: {
      status: "success",
      blockNumber: "12873001",
      logsCount: f.route.length + 1,
      effectiveGasPriceWei: gasPriceWei,
      rawLogs: [],
    },
    assetDeltas: [
      {
        token: intent.tokenIn.address,
        symbol: intent.tokenIn.symbol,
        amount: intent.amountIn,
        direction: "out",
      },
      ...(intent.tokenOut
        ? [
            {
              token: intent.tokenOut.address,
              symbol: intent.tokenOut.symbol,
              amount: actual.toFixed(6),
              direction: "in" as const,
            },
          ]
        : []),
    ],
    simulatedAt: now(),
    simulatorVersion: "fixture-0.2",
  };
}
