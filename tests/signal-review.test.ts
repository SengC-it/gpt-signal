import { describe, expect, test } from "vitest";
import { applyReviewCandles, createInitialReviewState } from "@/lib/signal/review";
import type { Candle, TradingPlan } from "@/lib/signal/types";

const longPlan: TradingPlan = {
  entryMode: "pullback_limit",
  entryLow: 100,
  entryHigh: 101,
  stopLoss: 95,
  tp1: 106,
  tp2: 112,
  tp3: 118,
  theoreticalRr: 1,
  weightedRr: 1,
  costAdjustedRr: 1,
  slDistancePct: 5,
  slAtrRatio: 1,
  noChasePrice: 107
};

function candle(high: number, low: number, index: number): Candle {
  return {
    symbol: "TESTUSDT",
    interval: "15m",
    openTime: index * 900_000,
    closeTime: index * 900_000 + 899_999,
    open: (high + low) / 2,
    high,
    low,
    close: (high + low) / 2,
    volume: 1,
    quoteVolume: 1,
    trades: 1,
    takerBuyVolume: 1,
    takerBuyQuoteVolume: 1,
    isClosed: true
  };
}

describe("signal review execution", () => {
  test("exits the full position at TP1 and uses the email entry reference", () => {
    const result = applyReviewCandles({
      direction: "LONG",
      plan: longPlan,
      feeRate: 0,
      slippageRate: 0,
      candles: [candle(119, 100, 1)]
    });

    expect(result.finalStatus).toBe("hit_tp1");
    expect(result.entryPrice).toBe(101);
    expect(result.grossR).toBeCloseTo(5 / 6, 6);
    expect(result.grossPnlPct).toBeCloseTo((5 / 101) * 100, 6);
  });

  test("keeps the legacy furthest-target policy available for audit rows", () => {
    const result = applyReviewCandles({
      direction: "LONG",
      plan: longPlan,
      executionPolicy: { exitMode: "legacy_furthest_tp" },
      feeRate: 0,
      slippageRate: 0,
      candles: [candle(119, 100, 1)]
    });

    expect(result.finalStatus).toBe("hit_tp3");
    expect(result.exitPrice).toBe(118);
  });

  test("uses SL first when TP1 and SL are touched in the same candle", () => {
    const result = applyReviewCandles({
      direction: "LONG",
      plan: longPlan,
      feeRate: 0,
      slippageRate: 0,
      candles: [candle(108, 94, 1)]
    });

    expect(result.finalStatus).toBe("hit_sl");
    expect(result.exitPrice).toBe(95);
  });

  test("does not change a full-TP1 result when later candles reach TP2 and TP3", () => {
    const first = applyReviewCandles({
      direction: "LONG",
      plan: longPlan,
      feeRate: 0,
      slippageRate: 0,
      candles: [candle(107, 100, 1)]
    });
    const second = applyReviewCandles({
      direction: "LONG",
      plan: longPlan,
      state: first,
      feeRate: 0,
      slippageRate: 0,
      candles: [candle(120, 106, 2)]
    });

    expect(second.finalStatus).toBe("hit_tp1");
    expect(second.exitPrice).toBe(106);
  });

  test("keeps an unclosed position open across incremental checks", () => {
    const first = applyReviewCandles({
      direction: "LONG",
      plan: longPlan,
      feeRate: 0,
      slippageRate: 0,
      candles: [candle(103, 100, 1)]
    });
    expect(first.finalStatus).toBe("open");

    const second = applyReviewCandles({
      direction: "LONG",
      plan: longPlan,
      feeRate: 0,
      slippageRate: 0,
      state: first,
      candles: [candle(104, 101, 1), candle(105, 102, 2)]
    });
    expect(second.finalStatus).toBe("open");
    expect(second.lastCheckedAt).toBe(candle(105, 102, 2).closeTime);
  });

  test("supports short signals using the same email levels", () => {
    const shortPlan: TradingPlan = {
      ...longPlan,
      entryLow: 99,
      entryHigh: 100,
      stopLoss: 105,
      tp1: 94,
      tp2: 88,
      tp3: 82
    };
    const result = applyReviewCandles({
      direction: "SHORT",
      plan: shortPlan,
      state: createInitialReviewState(),
      feeRate: 0.001,
      slippageRate: 0.0005,
      candles: [candle(100, 81, 1)]
    });

    expect(result.finalStatus).toBe("hit_tp1");
    expect(result.entryPrice).toBe(99);
    expect(result.exitPrice).toBe(94);
    expect(result.netR).toBeLessThan(result.grossR ?? 0);
    expect(result.netPnlPct).toBeLessThan(result.grossPnlPct ?? 0);
  });
});
