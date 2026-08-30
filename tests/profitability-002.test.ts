import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Candle, TradingPlan } from "@/lib/signal/types";
import {
  PROFITABILITY_002_DISCOVERY_CUTOFF,
  applyResearchLifecycleCandles,
  buildProfitability002Candidates,
  classifyResearchRegime,
  createInitialResearchLifecycleState,
  evaluateProfitability002InternalGate,
  isDiscoveryCandle,
  isHoldoutCandle,
  isSettledResearchStatus,
  researchStatusToLifecycle,
  selectCandidateDirection,
  simulateResearchOutcome,
  summarizeResearchTrades
} from "@/lib/signal/profitability-002";
import { classifyRuntimeStrategy, PRODUCTION_SIGNAL_STRATEGIES } from "@/lib/signal/profitability-config";
import { canSendRuntimeNotification } from "@/lib/signal/delivery";
import { shouldCreateRuntimeSignal } from "@/lib/signal/runtime-parity";

const plan: TradingPlan = {
  entryMode: "pullback_limit",
  entryLow: 99,
  entryHigh: 101,
  stopLoss: 95,
  tp1: 106,
  tp2: 111,
  tp3: 116,
  theoreticalRr: 3,
  weightedRr: 1,
  costAdjustedRr: 0.9,
  slDistancePct: 5.94,
  slAtrRatio: 1,
  noChasePrice: 107
};

function candle(high: number, low: number, close: number, index: number): Candle {
  return {
    symbol: "TESTUSDT",
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
    takerBuyQuoteVolume: 5_000,
    isClosed: true
  };
}

function researchTrade(netR: number, signalTime = 1) {
  return {
    candidateId: "test",
    symbol: "TESTUSDT",
    direction: "LONG" as const,
    signalTime,
    entryTime: signalTime + 1,
    exitTime: signalTime + 2,
    finalStatus: netR > 0 ? "hit_tp1" as const : "hit_sl" as const,
    entryHit: true,
    netR,
    grossR: netR,
    netPnlPct: netR,
    grossPnlPct: netR,
    mfe: netR > 0 ? 1 : 0,
    mae: netR < 0 ? 1 : 0,
    durationCandles: 2,
    score: 86,
    relativeStrengthScore: 1,
    btcRegime: "bull" as const,
    marketRegime: "bull_trend",
    trendAlignment: "aligned" as const,
    volatilityBand: "0.75-1.24 ATR",
    costCoverageBand: "1.5-1.99x",
    slAtrRatioBand: "0.75-1.24 ATR",
    entryStructure: "pullback_limit",
    opportunityKey: "test",
    repeatedOpportunity: "first" as const
  };
}

describe("GPT-PROFIT-002 research controls", () => {
  test("keeps the exact cutoff in discovery and puts only later candles in holdout", () => {
    const cutoff = Date.parse(PROFITABILITY_002_DISCOVERY_CUTOFF);
    expect(isDiscoveryCandle(cutoff)).toBe(true);
    expect(isHoldoutCandle(cutoff)).toBe(false);
    expect(isDiscoveryCandle(cutoff + 900_000)).toBe(false);
    expect(isHoldoutCandle(cutoff + 900_000)).toBe(true);
  });

  test("freezes a bounded, unique candidate set with every requested family", () => {
    const candidates = buildProfitability002Candidates();
    expect(candidates.length).toBeLessThanOrEqual(16);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(candidates.length);
    expect(new Set(candidates.map((candidate) => candidate.family))).toEqual(new Set([
      "A_balanced_payoff_trend_pullback",
      "B_structure_breakout",
      "C_relative_strength_trend",
      "D_early_invalidation",
      "E_time_stop"
    ]));
    expect(candidates.some((candidate) => candidate.config.setupMode === "breakout")).toBe(true);
    expect(candidates.some((candidate) => candidate.exitMode === "early_invalidation")).toBe(true);
    expect(candidates.some((candidate) => candidate.exitMode === "time_stop" && candidate.timeStopCandles === 96)).toBe(true);
  });

  test("classifies bull, bear, and weak sideways regimes", () => {
    const bull = Array.from({ length: 49 }, () => ({ close: 100, isClosed: true }));
    bull.push({ close: 101, isClosed: true });
    const bear = Array.from({ length: 49 }, () => ({ close: 100, isClosed: true }));
    bear.push({ close: 99, isClosed: true });
    const sideways = Array.from({ length: 50 }, () => ({ close: 100, isClosed: true }));
    expect(classifyResearchRegime(bull)).toBe("bull");
    expect(classifyResearchRegime(bear)).toBe("bear");
    expect(classifyResearchRegime(sideways)).toBe("sideways");
  });

  test("uses relative strength for the C-family direction without looking ahead", () => {
    const symbolCandles = Array.from({ length: 16 }, (_, index) => candle(100 + index, 99 + index, 100 + index, index));
    const btcCandles = Array.from({ length: 16 }, (_, index) => candle(100, 99, 100, index));
    expect(selectCandidateDirection({ mode: "relative", symbolCandles, btcCandles })).toBe("LONG");
  });

  test("preserves conservative same-candle stop priority and records MFE/MAE", () => {
    const result = simulateResearchOutcome({
      direction: "LONG",
      plan,
      candles: [candle(108, 94, 100, 1)],
      feeRate: 0,
      slippageRate: 0
    });
    expect(result.finalStatus).toBe("hit_sl");
    expect(result.mfe).toBeGreaterThanOrEqual(1);
    expect(result.mae).toBeGreaterThanOrEqual(1);
    expect(isSettledResearchStatus(result.finalStatus)).toBe(true);
  });

  test("supports hypothetical early invalidation and bounded time stops", () => {
    const invalidated = simulateResearchOutcome({
      direction: "LONG",
      plan,
      candles: [candle(102, 100, 101, 1), candle(103, 100, 100, 2)],
      feeRate: 0,
      slippageRate: 0,
      exitMode: "early_invalidation",
      shouldInvalidate: () => true
    });
    expect(invalidated.finalStatus).toBe("invalidated_exit");

    const timed = simulateResearchOutcome({
      direction: "LONG",
      plan,
      candles: [candle(102, 100, 101, 1), candle(103, 100, 101, 2)],
      feeRate: 0,
      slippageRate: 0,
      exitMode: "time_stop",
      timeStopCandles: 2
    });
    expect(timed.finalStatus).toBe("time_stop_exit");
  });

  test("settles early invalidation in the research lifecycle and permits the next opportunity", () => {
    const entered = applyResearchLifecycleCandles({
      direction: "LONG",
      plan,
      candles: [candle(102, 100, 101, 1)],
      state: createInitialResearchLifecycleState(),
      feeRate: 0,
      slippageRate: 0,
      exitMode: "early_invalidation",
      shouldInvalidate: () => false
    });
    expect(entered.finalStatus).toBe("open");
    expect(researchStatusToLifecycle(entered.finalStatus)).toBe("entered");
    expect(shouldCreateRuntimeSignal(
      { level: "A", lifecycleStatus: researchStatusToLifecycle(entered.finalStatus) },
      { level: "A", lifecycleStatus: researchStatusToLifecycle(entered.finalStatus) }
    )).toBe(false);

    const invalidated = applyResearchLifecycleCandles({
      direction: "LONG",
      plan,
      candles: [candle(103, 100, 100, 2)],
      state: entered,
      feeRate: 0,
      slippageRate: 0,
      exitMode: "early_invalidation",
      shouldInvalidate: () => true
    });
    expect(invalidated.finalStatus).toBe("invalidated_exit");
    expect(isSettledResearchStatus(invalidated.finalStatus)).toBe(true);
    expect(shouldCreateRuntimeSignal(
      { level: "A", lifecycleStatus: researchStatusToLifecycle(invalidated.finalStatus) },
      { level: "A", lifecycleStatus: "planned" }
    )).toBe(true);
  });

  test("settles a time stop in the research lifecycle and permits the next opportunity", () => {
    const entered = applyResearchLifecycleCandles({
      direction: "LONG",
      plan,
      candles: [candle(102, 100, 101, 3)],
      state: createInitialResearchLifecycleState(),
      feeRate: 0,
      slippageRate: 0,
      exitMode: "time_stop",
      timeStopCandles: 2
    });
    const timed = applyResearchLifecycleCandles({
      direction: "LONG",
      plan,
      candles: [candle(103, 100, 101, 4)],
      state: entered,
      feeRate: 0,
      slippageRate: 0,
      exitMode: "time_stop",
      timeStopCandles: 2
    });
    expect(timed.finalStatus).toBe("time_stop_exit");
    expect(isSettledResearchStatus(timed.finalStatus)).toBe(true);
    expect(shouldCreateRuntimeSignal(
      { level: "A", lifecycleStatus: researchStatusToLifecycle(timed.finalStatus) },
      { level: "A", lifecycleStatus: "planned" }
    )).toBe(true);
  });

  test("keeps hard SL/TP lifecycle behavior unchanged", () => {
    const candles = [candle(102, 100, 101, 5), candle(108, 100, 106, 6)];
    const full = simulateResearchOutcome({ direction: "LONG", plan, candles, feeRate: 0, slippageRate: 0 });
    const first = applyResearchLifecycleCandles({
      direction: "LONG",
      plan,
      candles: [candles[0]],
      state: createInitialResearchLifecycleState(),
      feeRate: 0,
      slippageRate: 0,
      exitMode: "hard_sl_tp"
    });
    const incremental = applyResearchLifecycleCandles({
      direction: "LONG",
      plan,
      candles: [candles[1]],
      state: first,
      feeRate: 0,
      slippageRate: 0,
      exitMode: "hard_sl_tp"
    });
    expect(full.finalStatus).toBe("hit_tp1");
    expect(incremental.finalStatus).toBe("hit_tp1");
    expect(incremental.netR).toBe(full.netR);
    expect(incremental.exitTime).toBe(full.exitTime);
  });

  test("applies round-trip costs and exposes payoff/breakeven metrics", () => {
    const summary = summarizeResearchTrades([researchTrade(1), researchTrade(-1, 2)]);
    expect(summary.settledTrades).toBe(2);
    expect(summary.payoffRatio).toBe(1);
    expect(summary.breakevenWinRate).toBe(50);
    expect(summary.maxDrawdownR).toBe(1);
    const costResult = simulateResearchOutcome({
      direction: "LONG",
      plan,
      candles: [candle(108, 100, 106, 1)]
    });
    expect(costResult.netR).toBeLessThan(costResult.grossR ?? 0);
  });

  test("does not lower the internal gate when no candidate meets every check", () => {
    const summary = summarizeResearchTrades(Array.from({ length: 10 }, (_, index) => researchTrade(-1, index)));
    const gate = evaluateProfitability002InternalGate({ summary, positiveFoldCount: 0, foldCount: 3, noLeakage: true });
    expect(gate.passed).toBe(false);
    expect(gate.reasons).toContain("minimumSettledTrades");
    expect(gate.reasons).toContain("profitFactor");
  });

  test("labels legacy production delivery rows separately from the empty current runtime allowlist", () => {
    expect(PRODUCTION_SIGNAL_STRATEGIES).toHaveLength(0);
    expect(classifyRuntimeStrategy({ deliveryMode: "production", strategyVersion: null, signalType: "trend_pullback" })).toBe("historical_delivery");
    expect(classifyRuntimeStrategy({ deliveryMode: "shadow", strategyVersion: "v2", signalType: "trend_pullback" })).toBe("shadow_candidate");
    expect(canSendRuntimeNotification({ deliveryMode: "production", strategyVersion: null })).toBe(false);
    expect(canSendRuntimeNotification({ deliveryMode: "production", strategyVersion: "v2" })).toBe(false);
  });

  test("keeps research and runtime inside the analysis-only boundary", () => {
    const route = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/jobs/sync-market/route.ts"), "utf8");
    const fetcher = fs.readFileSync(path.resolve(process.cwd(), "scripts/fetch-profit-002-data.mjs"), "utf8");
    expect(route).not.toMatch(/fapi\/v[12]\/(order|positionRisk|account)/i);
    expect(fetcher).toContain("/fapi/v1/klines");
    expect(fetcher).not.toMatch(/\/fapi\/v[12]\/(order|positionRisk|account)/i);
  });
});
