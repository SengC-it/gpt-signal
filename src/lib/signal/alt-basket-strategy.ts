import type { Candle, SignalEvaluation, TradingPlan } from "./types.ts";
import { REVIEW_ROUND_TRIP_COST_PCT } from "./review.ts";
import { calculateCostEdge } from "./cost-edge.ts";

export const ALT_BASKET_SHORT_SYMBOL = "ALT_SHORT_BASKET";

export type AltBasketShortConfig = {
  basketSymbols?: string[];
  btcSmaPeriod?: number;
  takeProfitPct?: number;
  stopLossPct?: number;
  maxFundingCostPct?: number;
};

export type AltBasketShortInput = {
  btcCandles4h: Candle[];
  basketCandles15m: Record<string, Candle[]>;
  fundingRates?: Record<string, number | null>;
  config?: AltBasketShortConfig;
};

const DEFAULT_BASKET = ["ETHUSDT", "SOLUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT"];
const DEFAULT_SMA_PERIOD = 50;
const DEFAULT_MAX_FUNDING_COST_PCT = 1.2;

export const ALT_BASKET_SHORT_CONFIG_V1: Required<AltBasketShortConfig> = {
  basketSymbols: [...DEFAULT_BASKET],
  btcSmaPeriod: DEFAULT_SMA_PERIOD,
  takeProfitPct: 6,
  stopLossPct: 5,
  maxFundingCostPct: DEFAULT_MAX_FUNDING_COST_PCT
};

export const ALT_BASKET_SHORT_CONFIG_V2: Required<AltBasketShortConfig> = {
  ...ALT_BASKET_SHORT_CONFIG_V1,
  takeProfitPct: 4
};

export const ALT_BASKET_SHORT_OPPORTUNITY_ID_V1 = "alt_basket_short:btc_4h_sma50:tp6_sl5";
export const ALT_BASKET_SHORT_OPPORTUNITY_ID_V2 = "alt_basket_short:btc_4h_sma50:tp4_sl5";
export const ALT_BASKET_SHORT_OPPORTUNITY_ID = ALT_BASKET_SHORT_OPPORTUNITY_ID_V1;

export function evaluateAltBasketShortStrategy(input: AltBasketShortInput): SignalEvaluation | null {
  const config = resolveConfig(input.config);
  const btcCandles = closed(input.btcCandles4h);
  if (btcCandles.length < config.btcSmaPeriod) return null;

  const latestBtc = btcCandles.at(-1)!;
  const btcSma = average(btcCandles.slice(-config.btcSmaPeriod).map((item) => item.close));
  if (latestBtc.close >= btcSma) return null;

  const basket = config.basketSymbols
    .map((symbol) => {
      const latest = closed(input.basketCandles15m[symbol] ?? []).at(-1);
      return latest ? { symbol, price: latest.close, fundingRate: input.fundingRates?.[symbol] ?? null } : null;
    })
    .filter((item): item is { symbol: string; price: number; fundingRate: number | null } => item !== null);

  if (basket.length < Math.max(3, Math.ceil(config.basketSymbols.length * 0.7))) return null;

  const expectedFundingCostPct = estimateFundingCostPct(basket.map((item) => item.fundingRate));
  if (expectedFundingCostPct > config.maxFundingCostPct) return null;

  const plan = buildIndexedPlan(config.takeProfitPct, config.stopLossPct, "SHORT");
  const costEdge = calculateCostEdge("SHORT", plan);
  const btcWeaknessPct = ((btcSma - latestBtc.close) / btcSma) * 100;
  const score = Math.min(95, Math.round(78 + btcWeaknessPct * 5 + Math.max(0, config.maxFundingCostPct - expectedFundingCostPct) * 2));
  const level = score >= 88 ? "S" : "A";
  const weights = basket.map((item) => `${item.symbol}:${round(100 / basket.length, 2)}%`).join(",");
  const prices = basket.map((item) => `${item.symbol}:${round(item.price, 6)}`).join(",");

  return {
    symbol: ALT_BASKET_SHORT_SYMBOL,
    direction: "SHORT",
    signalType: "alt_basket_short",
    lifecycleStatus: "planned",
    level,
    score,
    plan,
    btcState: "btc_4h_below_sma50",
    marketRegime: "risk_off_alt_short",
    dataQualityScore: Math.round((basket.length / config.basketSymbols.length) * 100),
    relativeStrengthScore: -round(btcWeaknessPct, 2),
    reasons: [
      `BTC 4 小时收盘价 ${round(latestBtc.close, 2)} 低于 SMA${config.btcSmaPeriod} ${round(btcSma, 2)}`,
      `等权做空 ${basket.map((item) => item.symbol).join(", ")}`,
      `每个币分别设置止盈 ${config.takeProfitPct}%、止损 ${config.stopLossPct}%`,
      `预计持仓期间资金费率成本 ${round(expectedFundingCostPct, 2)}%`
    ],
    invalidationRules: [
      `每个币从实际成交价上涨 ${config.stopLossPct}% 时止损`,
      `每个币从实际成交价下跌 ${config.takeProfitPct}% 时止盈`,
      `BTC 4 小时收盘重新站上 SMA${config.btcSmaPeriod} 时，平掉所有剩余仓位`
    ],
    noChaseRule: {
      strategy: "btc_weak_alt_basket_short",
      basketSymbols: basket.map((item) => item.symbol).join(","),
      weights,
      entryPrices: prices,
      btc4hClose: round(latestBtc.close, 2),
      btcSma50: round(btcSma, 2),
      takeProfitPct: config.takeProfitPct,
      stopLossPct: config.stopLossPct,
      maxFundingCostPct: config.maxFundingCostPct,
      expectedFundingCostPct: round(expectedFundingCostPct, 2),
      ...costEdge
    },
    costEdge
  };
}

export function expandAltBasketSignal(signal: SignalEvaluation): SignalEvaluation[] {
  if (signal.signalType !== "alt_basket_short") return [signal];

  const entryPrices = parseSymbolValues(signal.noChaseRule.entryPrices);
  const symbols = String(signal.noChaseRule.basketSymbols ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const takeProfitPct = numberField(signal.noChaseRule.takeProfitPct, 6);
  const stopLossPct = numberField(signal.noChaseRule.stopLossPct, 5);
  const weightPct = symbols.length > 0 ? round(100 / symbols.length, 2) : 0;
  const basketGroup = `${signal.marketRegime}:${String(signal.noChaseRule.btc4hClose ?? "unknown")}`;

  return symbols.flatMap((symbol) => {
    const entryPrice = entryPrices.get(symbol);
    if (!entryPrice) return [];

    const plan = buildPricePlan(entryPrice, takeProfitPct, stopLossPct);
    const costEdge = calculateCostEdge("SHORT", plan);
    return [{
      ...signal,
      symbol,
      plan,
      costEdge,
      reasons: [
        ...signal.reasons,
        `${symbol} 是本次等权篮子的其中一份，参考入场价 ${formatPrice(entryPrice)}`
      ],
      noChaseRule: {
        ...signal.noChaseRule,
        basketGroup,
        basketComponent: symbol,
        referenceEntryPrice: entryPrice,
        weightPct,
        ...costEdge
      }
    }];
  });
}

function resolveConfig(config: AltBasketShortConfig = {}) {
  return {
    ...ALT_BASKET_SHORT_CONFIG_V1,
    ...config,
    basketSymbols: config.basketSymbols ?? ALT_BASKET_SHORT_CONFIG_V1.basketSymbols
  };
}

function buildIndexedPlan(takeProfitPct: number, stopLossPct: number, direction: "LONG" | "SHORT"): TradingPlan {
  const entry = 100;
  const sign = direction === "LONG" ? 1 : -1;
  const stopLoss = entry * (1 - sign * stopLossPct / 100);
  const tp1 = entry * (1 + sign * takeProfitPct / 100);
  const grossR = takeProfitPct / stopLossPct;
  const costR = stopLossPct > 0 ? REVIEW_ROUND_TRIP_COST_PCT / (stopLossPct / 100) : 0;
  return {
    entryMode: "confirmation_wait",
    entryLow: entry,
    entryHigh: entry,
    stopLoss: round(stopLoss, 4),
    tp1: round(tp1, 4),
    tp2: round(tp1, 4),
    tp3: round(tp1, 4),
    theoreticalRr: round(grossR, 4),
    weightedRr: round(grossR, 4),
    costAdjustedRr: round(grossR - costR, 4),
    slDistancePct: stopLossPct,
    slAtrRatio: 0,
    noChasePrice: round(stopLoss, 4)
  };
}

function buildPricePlan(entryPrice: number, takeProfitPct: number, stopLossPct: number): TradingPlan {
  const tp = priceRound(entryPrice * (1 - takeProfitPct / 100));
  const stopLoss = priceRound(entryPrice * (1 + stopLossPct / 100));
  const grossR = takeProfitPct / stopLossPct;
  const costR = stopLossPct > 0 ? REVIEW_ROUND_TRIP_COST_PCT / (stopLossPct / 100) : 0;
  const entry = priceRound(entryPrice);

  return {
    entryMode: "confirmation_wait",
    entryLow: entry,
    entryHigh: entry,
    stopLoss,
    tp1: tp,
    tp2: tp,
    tp3: tp,
    theoreticalRr: round(grossR, 4),
    weightedRr: round(grossR, 4),
    costAdjustedRr: round(grossR - costR, 4),
    slDistancePct: stopLossPct,
    slAtrRatio: 0,
    noChasePrice: stopLoss
  };
}

function parseSymbolValues(value: unknown) {
  const entries = String(value ?? "")
    .split(",")
    .map((item) => item.split(":"))
    .map(([symbol, raw]) => [symbol?.trim().toUpperCase(), Number(raw)] as const)
    .filter(([symbol, numeric]) => Boolean(symbol) && Number.isFinite(numeric) && numeric > 0);
  return new Map(entries);
}

function numberField(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function priceRound(value: number) {
  if (value >= 1000) return round(value, 2);
  if (value >= 100) return round(value, 3);
  if (value >= 1) return round(value, 4);
  return round(value, 6);
}

function formatPrice(value: number) {
  return String(priceRound(value));
}

function estimateFundingCostPct(fundingRates: Array<number | null>) {
  const validRates = fundingRates.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  if (validRates.length === 0) return 0;
  const avgFunding = average(validRates);
  const expectedFundingIntervals = 9;
  return Math.max(0, -avgFunding * expectedFundingIntervals * 100);
}

function closed(candles: Candle[]) {
  return candles.filter((item) => item.isClosed);
}

function average(values: number[]) {
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
