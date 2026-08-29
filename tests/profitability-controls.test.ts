import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { compareSignalConcentration } from "@/lib/signal/concentration-control";
import { calculateCostEdge, passesCostGate } from "@/lib/signal/cost-edge";
import { buildEdgeEvidence, evaluateEdgeEvidence } from "@/lib/signal/edge-evidence";
import { ALT_BASKET_DELIVERY_MODE, MAIN_STRATEGY_DELIVERY_MODE } from "@/lib/signal/profitability-config";
import { evaluatePromotionGate } from "@/lib/signal/promotion-gate";
import { applyReviewCandles } from "@/lib/signal/review";
import { evaluateSchedulerHealth } from "@/lib/signal/scheduler-health";
import { buildBenchmarkSnapshotRows, summarizeBenchmarkSnapshots, summarizeProfitability } from "@/lib/signal/profitability-analytics";
import { mainOpportunityId, shouldCreateRuntimeSignal } from "@/lib/signal/runtime-parity";
import { MAIN_STRATEGY_V2 } from "@/lib/signal/strategy-config";
import { canSendNotifications } from "@/lib/signal/delivery";
import type { Candle, SignalEvaluation, TradingPlan } from "@/lib/signal/types";

const plan: TradingPlan = {
  entryMode: "pullback_limit", entryLow: 100, entryHigh: 101, stopLoss: 95,
  tp1: 106, tp2: 112, tp3: 118, theoreticalRr: 3, weightedRr: 1,
  costAdjustedRr: 0.95, slDistancePct: 5, slAtrRatio: 1, noChasePrice: 107
};

describe("ALT Basket loss containment", () => {
  test("is Shadow Only and therefore cannot trigger a production email", () => {
    expect(ALT_BASKET_DELIVERY_MODE).toBe("shadow");
    expect(canSendNotifications(ALT_BASKET_DELIVERY_MODE)).toBe(false);
  });

  test("adds a database backstop against notifications for shadow signals", () => {
    const migration = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/202608290001_loss_containment_edge_gate.sql"),
      "utf8"
    );
    expect(migration).toContain("reject_shadow_signal_notification");
    expect(migration).toContain("signal.delivery_mode = 'shadow'");
    expect(migration).toContain("before insert or update on public.gpt_notifications");
  });

  test("archives legacy basket parents without fabricating settlement", () => {
    const migration = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260815054901_backfill_alt_basket_components.sql"),
      "utf8"
    );
    expect(migration).toContain("superseded_at = coalesce");
    expect(migration).toContain("delivery_mode = 'shadow'");
    expect(migration).not.toContain("set completed_at = coalesce");
  });
});

describe("Main V2 loss containment", () => {
  test("Main V2 Shadow cannot send production notification", () => {
    expect(MAIN_STRATEGY_DELIVERY_MODE).toBe("shadow");
    expect(canSendNotifications(MAIN_STRATEGY_DELIVERY_MODE)).toBe(false);
  });
});

describe("Signal Edge Evidence", () => {
  test.each([
    [{ settledTrades: 29, profitFactor: 10, expectancyR: 2 }, "UNPROVEN"],
    [{ settledTrades: 30, profitFactor: 1.2, expectancyR: 0.01 }, "PASS"],
    [{ settledTrades: 30, profitFactor: 0.79, expectancyR: 0 }, "FAIL"],
    [{ settledTrades: 30, profitFactor: 1, expectancyR: -0.05 }, "WATCH"]
  ] as const)("classifies %o as %s", (input, expected) => {
    expect(evaluateEdgeEvidence(input)).toBe(expected);
  });

  test("never mixes results from different strategy versions", () => {
    const dimensions = { signalType: "trend_pullback", symbol: "SOLUSDT", direction: "LONG" as const, marketRegime: "bull_trend" };
    const trades = [
      ...Array.from({ length: 30 }, () => ({ ...dimensions, strategyVersion: "v1", settled: true, netR: -1 })),
      ...Array.from({ length: 5 }, () => ({ ...dimensions, strategyVersion: "v2", settled: true, netR: 1 }))
    ];
    const evidence = buildEdgeEvidence(trades);
    expect(evidence).toHaveLength(2);
    expect(evidence.find((item) => item.strategyVersion === "v1")?.status).toBe("FAIL");
    expect(evidence.find((item) => item.strategyVersion === "v2")?.status).toBe("UNPROVEN");
  });
});

describe("cost edge", () => {
  test("uses the review fee/slippage baseline and supports candidate thresholds", () => {
    const edge = calculateCostEdge("LONG", plan);
    expect(edge.grossTp1ReturnPct).toBeCloseTo(4.950495, 6);
    expect(edge.estimatedRoundTripCostPct).toBe(0.3);
    expect(edge.estimatedNetTp1ReturnPct).toBeCloseTo(4.650495, 6);
    expect(edge.costCoverageRatio).toBeCloseTo(16.50165, 5);
    expect(passesCostGate(edge, null)).toBe(true);
    expect(passesCostGate(edge, 1)).toBe(true);
    expect(passesCostGate(edge, 20)).toBe(false);
  });
});

describe("open review MTM", () => {
  test("marks an open signal to the latest closed candle after costs", () => {
    const result = applyReviewCandles({
      direction: "LONG",
      plan,
      candles: [candle(103, 100, 102, 1)]
    });
    expect(result.finalStatus).toBe("open");
    expect(result.currentReviewPrice).toBe(102);
    expect(result.unrealizedGrossPnlPct).toBeCloseTo(0.990099, 6);
    expect(result.unrealizedNetPnlPct).toBeCloseTo(0.690099, 6);
    expect(result.currentR).toBeGreaterThan(0);
    expect(result.mfe).toBeGreaterThan(0);
    expect(result.mae).toBeGreaterThan(0);
  });

  test("adds open MTM to the hypothetical benchmark without treating it as realized", () => {
    const summary = summarizeProfitability([
      {
        strategyVersion: "v2", signalType: "trend_pullback", symbol: "SOLUSDT", direction: "LONG",
        marketRegime: "bull_trend", status: "hit_tp1", signalSentAt: "2026-01-01T00:00:00Z",
        netR: 1, netPnlPct: 10, unrealizedNetPnlPct: null, currentR: null
      },
      {
        strategyVersion: "v2", signalType: "trend_pullback", symbol: "ETHUSDT", direction: "LONG",
        marketRegime: "bull_trend", status: "open", signalSentAt: "2026-01-02T00:00:00Z",
        netR: null, netPnlPct: null, unrealizedNetPnlPct: -5, currentR: -0.5
      }
    ]);
    expect(summary.settled).toBe(1);
    expect(summary.open).toBe(1);
    expect(summary.realizedBenchmarkEquity).toBeCloseTo(110);
    expect(summary.currentMtmAdjustedEquity).toBeCloseTo(104.5);
    expect(summary).not.toHaveProperty("mtmMaxDrawdownPct");
  });

  test("computes MTM drawdown from time-series snapshots with concurrent open reviews", () => {
    const first = buildBenchmarkSnapshotRows([
      snapshotReview("SOLUSDT", 10),
      snapshotReview("ETHUSDT", -5)
    ], "2026-01-01T00:15:00Z")[0];
    const second = { ...first, snapshotAt: "2026-01-01T00:30:00Z", benchmarkEquity: first.benchmarkEquity * 0.8 };
    const summary = summarizeBenchmarkSnapshots([first, second]);

    expect(first.openReviews).toBe(2);
    expect(first.unrealizedMtmComponent).not.toBe(0);
    expect(summary.mtmMaxDrawdownPct).toBeCloseTo(20);
  });
});

describe("Backtest runtime parity primitives", () => {
  test("uses the same opportunity identity and lifecycle dedupe as runtime", () => {
    const candidate = signal("SOLUSDT", 90);
    expect(mainOpportunityId(candidate, "v2")).toBe("SOLUSDT:LONG:trend_pullback:bull_trend:v2:15m");
    expect(shouldCreateRuntimeSignal({ level: "A", lifecycleStatus: "planned" }, candidate)).toBe(false);
    expect(shouldCreateRuntimeSignal({ level: "A", lifecycleStatus: "entered" }, candidate)).toBe(true);
  });
});

describe("candidate-only controls", () => {
  test("keeps concentration as shadow comparison and ranks the best candidates", () => {
    const candidates = [80, 95, 90, 70].map((score, index) => ({
      signal: signal(`ALT${index}USDT`, score), evidenceStatus: index === 0 ? "PASS" as const : "UNPROVEN" as const
    }));
    const comparison = compareSignalConcentration(candidates);
    expect(comparison.mode).toBe("shadow_comparison_only");
    expect(comparison.productionChanged).toBe(false);
    expect(comparison.selected).toHaveLength(3);
    expect(comparison.suppressed).toHaveLength(1);
    expect(comparison.selected[0].signal.symbol).toBe("ALT0USDT");
  });

  test("requires the unified promotion gate and reports insufficient samples", () => {
    expect(evaluatePromotionGate({
      candidate: { settledTrades: 29, netPnlPct: 10, expectancyR: 1, profitFactor: 2, maxDrawdownR: 1 },
      noLookAheadBias: true,
      noDataLeakage: true
    }).status).toBe("INSUFFICIENT_SAMPLE");
  });
});

describe("scheduler health", () => {
  test("does not treat an old candle as healthy just because sync succeeded", () => {
    const now = Date.UTC(2026, 7, 29, 12);
    const result = evaluateSchedulerHealth({
      now,
      lastSuccessfulSync: now - 5 * 60_000,
      lastCandleTimestamp: now - 70 * 60_000
    });
    expect(result.status).toBe("Stale");
  });

  test("surfaces consecutive sync errors even while the last candle is recent", () => {
    const now = Date.UTC(2026, 7, 29, 12);
    expect(evaluateSchedulerHealth({
      now,
      lastSuccessfulSync: now - 10 * 60_000,
      lastCandleTimestamp: now - 10 * 60_000,
      consecutiveSyncErrors: 1
    }).status).toBe("Delayed");
  });
});

describe("production safety baselines", () => {
  test("keeps the Main V2 production parameters unchanged", () => {
    expect(MAIN_STRATEGY_V2).toEqual({
      version: "v2", targetR: 0.35, minScore: 86, minRewardRisk: 0.35,
      regimeMode: "any", requireWeakness: false, trendMode: "any",
      structureLookback: 20, stopBufferAtr: 0.3, relativeStrengthThreshold: 0,
      longRelativeStrengthThreshold: 0, shortRelativeStrengthThreshold: 0,
      relativeStrengthMode: "trend", setupMode: "pullback"
    });
  });

  test("contains no private Binance trading or auto-order endpoint", () => {
    const source = readSourceTree(path.resolve(process.cwd(), "src"));
    expect(source).not.toMatch(/\/fapi\/v\d+\/(order|positionRisk|leverage|marginType)/i);
    expect(source).not.toMatch(/X-MBX-APIKEY|BINANCE_API_KEY|BINANCE_SECRET/i);
  });
});

function candle(high: number, low: number, close: number, index: number): Candle {
  return {
    symbol: "TESTUSDT", interval: "15m", openTime: index * 900_000,
    closeTime: index * 900_000 + 899_999, open: close, high, low, close,
    volume: 1, quoteVolume: 1, trades: 1, takerBuyVolume: 1, takerBuyQuoteVolume: 1, isClosed: true
  };
}

function signal(symbol: string, score: number): SignalEvaluation {
  return {
    symbol, direction: "LONG", signalType: "trend_pullback", lifecycleStatus: "planned", level: "A", score,
    plan, btcState: "bull", marketRegime: "bull_trend", dataQualityScore: 100, relativeStrengthScore: 1,
    reasons: [], invalidationRules: [], noChaseRule: { costCoverageRatio: score / 10 }, strategyVersion: "v2", deliveryMode: "shadow"
  };
}

function snapshotReview(symbol: string, unrealizedNetPnlPct: number) {
  return {
    deliveryMode: "shadow" as const,
    status: "open" as const,
    signalSentAt: "2026-01-01T00:00:00Z",
    netPnlPct: null,
    unrealizedNetPnlPct,
    lastCheckedAt: "2026-01-01T00:14:59Z",
    symbol
  };
}

function readSourceTree(directory: string): string {
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? readSourceTree(target) : /\.(ts|tsx)$/.test(entry.name) ? fs.readFileSync(target, "utf8") : "";
  }).join("\n");
}
