import { describe, expect, test } from "vitest";
import { runBacktest, simulateSignalOutcome } from "@/lib/signal/backtest";
import type { Candle, TradingPlan } from "@/lib/signal/types";

const plan: TradingPlan = {
  entryMode: "pullback_limit",
  entryLow: 100,
  entryHigh: 101,
  stopLoss: 95,
  tp1: 106,
  tp2: 112,
  tp3: 118,
  theoreticalRr: 3,
  weightedRr: 1.8,
  costAdjustedRr: 1.68,
  slDistancePct: 5,
  slAtrRatio: 1.2,
  noChasePrice: 107
};

function candle(high: number, low: number, close: number, index: number): Candle {
  return {
    symbol: "SOLUSDT",
    interval: "15m",
    openTime: index * 900_000,
    closeTime: index * 900_000 + 899_999,
    open: close,
    high,
    low,
    close,
    volume: 100,
    quoteVolume: 10_000,
    trades: 100,
    takerBuyVolume: 50,
    takerBuyQuoteVolume: 5000,
    isClosed: true
  };
}

describe("backtest", () => {
  test("uses conservative SL first when TP and SL are touched in same candle", () => {
    const result = simulateSignalOutcome({
      direction: "LONG",
      plan,
      futureCandles: [candle(108, 94, 100, 1)],
      feeRate: 0,
      slippageRate: 0
    });

    expect(result.finalStatus).toBe("hit_sl");
    expect(result.finalR).toBe(-1);
  });

  test("calculates R from the email price levels and deducts fee and slippage", () => {
    const result = simulateSignalOutcome({
      direction: "LONG",
      plan,
      futureCandles: [candle(107, 100, 106, 1)],
      feeRate: 0.001,
      slippageRate: 0.001
    });

    expect(result.finalStatus).toBe("hit_tp1");
    expect(result.finalR).toBeCloseTo(0.766, 3);
  });

  test("settles at TP1 even when a later candle reaches TP2 and TP3", () => {
    const result = simulateSignalOutcome({
      direction: "LONG",
      plan,
      futureCandles: [candle(107, 100, 106, 1), candle(120, 106, 118, 2)],
      feeRate: 0,
      slippageRate: 0
    });

    expect(result.finalStatus).toBe("hit_tp1");
    expect(result.grossR).toBeCloseTo(5 / 6, 6);
  });

  test("adds fee and slippage to losing R based on stop distance", () => {
    const result = simulateSignalOutcome({
      direction: "LONG",
      plan,
      futureCandles: [candle(101, 94, 95, 1)],
      feeRate: 0.001,
      slippageRate: 0.001
    });

    expect(result.finalStatus).toBe("hit_sl");
    expect(result.finalR).toBeCloseTo(-1.067333, 5);
  });

  test("keeps an entered signal open when neither TP nor SL is touched", () => {
    const result = simulateSignalOutcome({
      direction: "LONG",
      plan,
      futureCandles: [candle(102, 100, 101, 1)],
      feeRate: 0.001,
      slippageRate: 0.001
    });

    expect(result.finalStatus).toBe("open");
    expect(result.entryHit).toBe(true);
    expect(result.netR).toBeNull();
    expect(result.finalR).toBe(0);
  });

  test("keeps a signal waiting when the entry zone is never touched", () => {
    const result = simulateSignalOutcome({
      direction: "LONG",
      plan,
      futureCandles: [candle(99, 90, 95, 1)],
      feeRate: 0,
      slippageRate: 0
    });

    expect(result.finalStatus).toBe("waiting_entry");
    expect(result.entryHit).toBe(false);
    expect(result.netR).toBeNull();
  });

  test("summarizes core backtest metrics", () => {
    const summary = runBacktest([
      {
        direction: "LONG",
        plan,
        futureCandles: [candle(107, 100, 106, 1)]
      },
      {
        direction: "LONG",
        plan,
        futureCandles: [candle(102, 94, 96, 2)]
      }
    ]);

    expect(summary.totalTrades).toBe(2);
    expect(summary.settledTrades).toBe(2);
    expect(summary.winRate).toBe(50);
    expect(summary.maxLosingStreak).toBe(1);
  });
});

