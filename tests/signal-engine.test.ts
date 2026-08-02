import { describe, expect, test } from "vitest";
import { calculateAtr, calculateDataQualityScore, calculateRelativeStrength } from "@/lib/signal/indicators";
import { buildTradingPlan, evaluateSignalCandidate, shouldMarkNoChase } from "@/lib/signal/engine";
import type { Candle } from "@/lib/signal/types";

function candle(close: number, index: number): Candle {
  return {
    symbol: "SOLUSDT",
    interval: "15m",
    openTime: 1_700_000_000_000 + index * 900_000,
    closeTime: 1_700_000_899_999 + index * 900_000,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 100 + index,
    quoteVolume: (100 + index) * close,
    trades: 1000,
    takerBuyVolume: 60,
    takerBuyQuoteVolume: 60 * close,
    isClosed: true
  };
}

describe("signal indicators", () => {
  test("calculates ATR from true ranges", () => {
    const candles = [candle(100, 0), candle(103, 1), candle(107, 2), candle(110, 3)];

    expect(calculateAtr(candles, 3)).toBeCloseTo(5.33333, 5);
  });

  test("calculates relative strength versus BTC", () => {
    const symbolCandles = [candle(100, 0), candle(110, 1)];
    const btcCandles = [candle(100, 0), candle(104, 1)];

    expect(calculateRelativeStrength(symbolCandles, btcCandles)).toBeCloseTo(6, 5);
  });

  test("downgrades stale or open-candle data quality", () => {
    const now = 1_700_002_000_000;
    const candles = [candle(100, 0), { ...candle(101, 1), isClosed: false }];

    expect(calculateDataQualityScore(candles, now, 900_000)).toBeLessThan(90);
  });
});

describe("signal engine", () => {
  test("marks no-chase when price is more than one risk unit above long entry", () => {
    expect(
      shouldMarkNoChase({
        direction: "LONG",
        currentPrice: 115,
        entryLow: 100,
        entryHigh: 104,
        stopLoss: 94
      })
    ).toBe(true);
  });

  test("builds a long trading plan with full-TP1 reward risk", () => {
    const plan = buildTradingPlan({
      direction: "LONG",
      currentPrice: 100,
      atr: 2,
      structureLow: 96,
      structureHigh: 106
    });

    expect(plan.stopLoss).toBeCloseTo(95.4, 5);
    expect(plan.weightedRr).toBeCloseTo(1, 5);
    expect(plan.noChasePrice).toBeGreaterThan(plan.entryHigh);
  });

  test("requires score, data quality, RR, and no circuit breaker for A/S plan eligibility", () => {
    const candles = Array.from({ length: 40 }, (_, index) => candle(100 + index * 0.5, index));
    const result = evaluateSignalCandidate({
      symbol: "SOLUSDT",
      direction: "LONG",
      signalType: "trend_pullback",
      candles15m: candles,
      btcCandles15m: Array.from({ length: 40 }, (_, index) => candle(100 + index * 0.1, index)),
      now: candles.at(-1)!.closeTime + 1,
      fundingRate: null,
      oiChange15m: null,
      circuitBreakerActive: false
    });

    expect(result.level === "A" || result.level === "S").toBe(true);
    expect(result.plan).not.toBeNull();
  });

  test("V2 supports both long and short signals with the compact target plan", () => {
    const candles = Array.from({ length: 40 }, (_, index) => candle(100 + index * 0.5, index));
    const shortCandles = Array.from({ length: 40 }, (_, index) => candle(120 - index * 0.5, index));
    const btcCandles15m = Array.from({ length: 40 }, (_, index) => candle(100 + index * 0.1, index));
    const btcCandles4h = Array.from({ length: 50 }, (_, index) => ({
      ...candle(100 + index, index),
      interval: "4h"
    }));
    const input = {
      symbol: "SOLUSDT",
      signalType: "trend_pullback" as const,
      candles15m: candles,
      btcCandles15m,
      btcCandles4h,
      strategyVersion: "v2" as const,
      now: candles.at(-1)!.closeTime + 1,
      fundingRate: null,
      oiChange15m: null,
      circuitBreakerActive: false
    };

    const longResult = evaluateSignalCandidate({ ...input, direction: "LONG" });
    const shortResult = evaluateSignalCandidate({ ...input, candles15m: shortCandles, direction: "SHORT" });

    expect(longResult.strategyVersion).toBe("v2");
    expect(longResult.plan).not.toBeNull();
    expect(longResult.plan?.weightedRr).toBeCloseTo(0.35, 2);
    expect(longResult.plan?.tp1).toBeCloseTo(
      longResult.plan!.entryHigh + (longResult.plan!.entryHigh - longResult.plan!.stopLoss) * 0.35,
      4
    );
    expect(shortResult.plan).not.toBeNull();
    expect(shortResult.direction).toBe("SHORT");
  });
});
