import type { Candle, SignalEvaluation, TradingPlan } from "@/lib/signal/types";

export const ALT_BASKET_SHORT_SYMBOL = "ALT_SHORT_BASKET";
export const ALT_BASKET_SHORT_OPPORTUNITY_ID = "alt_basket_short:btc_4h_sma50:tp6_sl5";

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
const DEFAULT_TAKE_PROFIT_PCT = 6;
const DEFAULT_STOP_LOSS_PCT = 5;
const DEFAULT_MAX_FUNDING_COST_PCT = 1.2;

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

  const plan = buildIndexedPlan(config.takeProfitPct, config.stopLossPct);
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
      `BTC 4h close ${round(latestBtc.close, 2)} is below SMA${config.btcSmaPeriod} ${round(btcSma, 2)}`,
      `Short equal-weight alt basket: ${basket.map((item) => item.symbol).join(", ")}`,
      `Strict email plan: TP ${config.takeProfitPct}%, SL ${config.stopLossPct}%`,
      `Estimated funding cost over expected hold: ${round(expectedFundingCostPct, 2)}%`
    ],
    invalidationRules: [
      `Basket stop loss: +${config.stopLossPct}% from entry after costs`,
      `Basket take profit: -${config.takeProfitPct}% from entry after costs`,
      `BTC 4h close recovers above SMA${config.btcSmaPeriod}`
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
      expectedFundingCostPct: round(expectedFundingCostPct, 2)
    }
  };
}

function resolveConfig(config: AltBasketShortConfig = {}) {
  return {
    basketSymbols: config.basketSymbols ?? DEFAULT_BASKET,
    btcSmaPeriod: config.btcSmaPeriod ?? DEFAULT_SMA_PERIOD,
    takeProfitPct: config.takeProfitPct ?? DEFAULT_TAKE_PROFIT_PCT,
    stopLossPct: config.stopLossPct ?? DEFAULT_STOP_LOSS_PCT,
    maxFundingCostPct: config.maxFundingCostPct ?? DEFAULT_MAX_FUNDING_COST_PCT
  };
}

function buildIndexedPlan(takeProfitPct: number, stopLossPct: number): TradingPlan {
  const entry = 100;
  const stopLoss = entry * (1 + stopLossPct / 100);
  const tp1 = entry * (1 - takeProfitPct / 100);
  return {
    entryMode: "confirmation_wait",
    entryLow: entry,
    entryHigh: entry,
    stopLoss: round(stopLoss, 4),
    tp1: round(tp1, 4),
    tp2: round(tp1, 4),
    tp3: round(tp1, 4),
    theoreticalRr: round(takeProfitPct / stopLossPct, 4),
    weightedRr: round(takeProfitPct / stopLossPct, 4),
    costAdjustedRr: round(takeProfitPct / stopLossPct - 0.036, 4),
    slDistancePct: stopLossPct,
    slAtrRatio: 0,
    noChasePrice: round(stopLoss, 4)
  };
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
