import { describe, expect, test } from "vitest";
import {
  ALT_BASKET_SHORT_CONFIG_V2,
  evaluateAltBasketShortStrategy,
  expandAltBasketSignal
} from "@/lib/signal/alt-basket-strategy";
import type { Candle } from "@/lib/signal/types";

function candle(symbol: string, close: number, index: number, interval = "4h"): Candle {
  const step = interval === "4h" ? 14_400_000 : 900_000;
  return {
    symbol,
    interval,
    openTime: 1_700_000_000_000 + index * step,
    closeTime: 1_700_000_000_000 + (index + 1) * step - 1,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000,
    quoteVolume: 1000 * close,
    trades: 1000,
    takerBuyVolume: 500,
    takerBuyQuoteVolume: 500 * close,
    isClosed: true
  };
}

const basketSymbols = ["ETHUSDT", "SOLUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT"];

describe("BTC weak alt basket short strategy", () => {
  test("creates a strict short-basket email signal when BTC 4h closes below SMA50", () => {
    const btcCandles = Array.from({ length: 49 }, (_, index) => candle("BTCUSDT", 100, index));
    btcCandles.push(candle("BTCUSDT", 94, 49));
    const basketCandles15m = Object.fromEntries(
      basketSymbols.map((symbol, index) => [symbol, [candle(symbol, 10 + index, 1, "15m")]])
    );

    const signal = evaluateAltBasketShortStrategy({ btcCandles4h: btcCandles, basketCandles15m });

    expect(signal).not.toBeNull();
    expect(signal?.symbol).toBe("ALT_SHORT_BASKET");
    expect(signal?.direction).toBe("SHORT");
    expect(signal?.signalType).toBe("alt_basket_short");
    expect(signal?.plan?.tp1).toBe(94);
    expect(signal?.plan?.stopLoss).toBe(105);
    expect(signal?.noChaseRule.basketSymbols).toContain("ETHUSDT");
    expect(signal?.invalidationRules).toContain("BTC 4 小时收盘重新站上 SMA50 时，平掉所有剩余仓位");
  });

  test("expands one basket alert into one executable signal per trading pair", () => {
    const btcCandles = Array.from({ length: 49 }, (_, index) => candle("BTCUSDT", 100, index));
    btcCandles.push(candle("BTCUSDT", 94, 49));
    const basketCandles15m = Object.fromEntries(
      basketSymbols.map((symbol, index) => [symbol, [candle(symbol, 10 + index, 1, "15m")]])
    );
    const basket = evaluateAltBasketShortStrategy({ btcCandles4h: btcCandles, basketCandles15m });
    const signals = expandAltBasketSignal(basket!);

    expect(signals).toHaveLength(6);
    expect(signals.map((signal) => signal.symbol)).toEqual(basketSymbols);
    expect(signals[0].plan?.entryLow).toBe(10);
    expect(signals[0].plan?.tp1).toBe(9.4);
    expect(signals[0].plan?.stopLoss).toBe(10.5);
    expect(signals[0].noChaseRule.weightPct).toBe(16.67);
  });

  test("does not signal when BTC is not below SMA50", () => {
    const btcCandles = Array.from({ length: 50 }, (_, index) => candle("BTCUSDT", 100 + index * 0.1, index));
    const basketCandles15m = Object.fromEntries(
      basketSymbols.map((symbol, index) => [symbol, [candle(symbol, 10 + index, 1, "15m")]])
    );

    expect(evaluateAltBasketShortStrategy({ btcCandles4h: btcCandles, basketCandles15m })).toBeNull();
  });

  test("blocks the trade when expected funding cost is too high", () => {
    const btcCandles = Array.from({ length: 49 }, (_, index) => candle("BTCUSDT", 100, index));
    btcCandles.push(candle("BTCUSDT", 94, 49));
    const basketCandles15m = Object.fromEntries(
      basketSymbols.map((symbol, index) => [symbol, [candle(symbol, 10 + index, 1, "15m")]])
    );
    const fundingRates = Object.fromEntries(basketSymbols.map((symbol) => [symbol, -0.003]));

    expect(evaluateAltBasketShortStrategy({ btcCandles4h: btcCandles, basketCandles15m, fundingRates })).toBeNull();
  });

  test("supports the validated V2 TP4/SL5 configuration", () => {
    const btcCandles = Array.from({ length: 49 }, (_, index) => candle("BTCUSDT", 100, index));
    btcCandles.push(candle("BTCUSDT", 94, 49));
    const basketCandles15m = Object.fromEntries(
      basketSymbols.map((symbol, index) => [symbol, [candle(symbol, 10 + index, 1, "15m")]])
    );

    const signal = evaluateAltBasketShortStrategy({
      btcCandles4h: btcCandles,
      basketCandles15m,
      config: ALT_BASKET_SHORT_CONFIG_V2
    });

    expect(signal?.plan?.tp1).toBe(96);
    expect(signal?.plan?.stopLoss).toBe(105);
    expect(signal?.noChaseRule.takeProfitPct).toBe(4);
  });
});
