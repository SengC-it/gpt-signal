import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  ENTRY_EDGE_FEATURE_NAMES,
  ENTRY_EDGE_FEE_RATE,
  ENTRY_EDGE_SLIPPAGE_RATE,
  GPT_PROFIT_003_DISCOVERY_CUTOFF,
  GPT_PROFIT_003_FINAL_UNSEEN_START,
  assertFinalUnseenCanExecute,
  calculateEntryEdgeScore,
  calculateEntryFeaturePanel,
  calibrateFeature,
  countMonotonicViolations,
  ensureEntryEdgeCandidateFreeze,
  evaluateEntryEdgeGate,
  fitEntryEdgeScoreSpec,
  simulateEntryLabel,
  summarizeEntryEvents,
  type EntryEvent,
  type EntryFeaturePanel,
  type EntryLabel
} from "@/lib/signal/entry-edge";
import { ALT_BASKET_DELIVERY_MODE, MAIN_STRATEGY_DELIVERY_MODE, PRODUCTION_SIGNAL_STRATEGIES } from "@/lib/signal/profitability-config";
import type { Candle } from "@/lib/signal/types";

describe("GPT-PROFIT-003 Entry Edge features", () => {
  test("uses only past closed candles", () => {
    const candles = Array.from({ length: 100 }, (_, index) => candle(index, 100 + index, 99 + index, 101 + index, true));
    const btc = candles.map((item) => ({ ...item, symbol: "BTCUSDT", close: item.close * 0.9 }));
    const before = calculateEntryFeaturePanel({ symbolCandles: candles, btcCandles: btc, direction: "LONG" });
    const withFuture = [...candles, candle(100, 10_000, 1, 20_000, false)];
    const withFutureBtc = [...btc, { ...candles.at(-1)!, symbol: "BTCUSDT", openTime: 100 * 900_000, closeTime: 100 * 900_000 + 899_999, close: 1, high: 20_000, low: 1, isClosed: false }];
    const after = calculateEntryFeaturePanel({ symbolCandles: withFuture, btcCandles: withFutureBtc, direction: "LONG" });
    expect(after).toEqual(before);
  });

  test("keeps the discovery/holdout boundary explicit", () => {
    expect(Date.parse(GPT_PROFIT_003_DISCOVERY_CUTOFF)).toBeLessThan(Date.parse(GPT_PROFIT_003_FINAL_UNSEEN_START));
    expect(Date.parse(GPT_PROFIT_003_FINAL_UNSEEN_START) - Date.parse(GPT_PROFIT_003_DISCOVERY_CUTOFF)).toBe(15 * 60 * 1000);
  });

  test("labels only candles after the decision event", () => {
    const label = simulateEntryLabel({
      direction: "LONG", entryPrice: 100, stopLoss: 99, risk: 1, eventTime: 10_000, targetR: 1,
      futureCandles: [candle(0, 101, 100, 102, true, -1_000_000), candle(1, 101, 100, 102, true, 20_000)]
    });
    expect(label.status).toBe("hit_tp");
    expect(label.entryTime).toBe(10_000);
    expect(label.exitTime).toBe(20_000 + 899_999);
  });

  test("uses STOP FIRST when both barriers are inside one candle", () => {
    const label = simulateEntryLabel({
      direction: "LONG", entryPrice: 100, stopLoss: 99, risk: 1, eventTime: 0, targetR: 1,
      futureCandles: [candle(1, 100, 98, 102, true)]
    });
    expect(label.status).toBe("hit_sl");
    expect(label.grossR).toBe(-1);
  });

  test("applies fee and slippage to the fixed benchmark label", () => {
    const label = simulateEntryLabel({
      direction: "LONG", entryPrice: 100, stopLoss: 99, risk: 1, eventTime: 0, targetR: 1,
      futureCandles: [candle(1, 100, 100, 101, true)]
    });
    const expectedCostR = (ENTRY_EDGE_FEE_RATE + ENTRY_EDGE_SLIPPAGE_RATE) * 2 / 0.01;
    expect(label.netR).toBeCloseTo(1 - expectedCostR, 6);
    expect(label.netPnlPct).toBeCloseTo((0.01 - (ENTRY_EDGE_FEE_RATE + ENTRY_EDGE_SLIPPAGE_RATE) * 2) * 100, 6);
  });
});

describe("GPT-PROFIT-003 calibration and guards", () => {
  test("calibrates train-only feature buckets and reports monotonic violations", () => {
    const train = Array.from({ length: 20 }, (_, index) => event(index, index / 20, index % 2 ? 0.5 : -0.5));
    const test = Array.from({ length: 20 }, (_, index) => event(index + 30, index / 20, index / 20 - 0.25));
    const result = calibrateFeature({ events: test, fitEvents: train, feature: "trend_return_4h", bins: 4 });
    expect(result.edges.length).toBeGreaterThan(0);
    expect(result.buckets.reduce((total, bucket) => total + bucket.sample, 0)).toBe(test.length);
    expect(result.buckets.every((bucket) => Array.isArray(bucket.confidenceInterval))).toBe(true);
    expect(countMonotonicViolations([0, 1, 2])).toBe(0);
    expect(countMonotonicViolations([0, 2, 1])).toBe(1);
  });

  test("entry_edge_score ranks a positively calibrated feature higher", () => {
    const train = Array.from({ length: 30 }, (_, index) => event(index, index, index / 10));
    const spec = fitEntryEdgeScoreSpec(train, ["trend_return_4h"]);
    const low = calculateEntryEdgeScore(event(100, 0, -1), spec);
    const high = calculateEntryEdgeScore(event(101, 30, 2), spec);
    expect(high).toBeGreaterThan(low);
  });

  test("candidate freeze fails closed instead of silently overwriting", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gpt003-freeze-"));
    const freezePath = path.join(directory, "freeze.json");
    const hashPath = path.join(directory, "freeze.sha256");
    const definition = { freezeVersion: "v1", discoveryCutoff: GPT_PROFIT_003_DISCOVERY_CUTOFF, candidates: [{ id: "a", threshold: 1 }] };
    const first = ensureEntryEdgeCandidateFreeze({ freezePath, hashPath, definition });
    expect(first.created).toBe(true);
    expect(first.sha256).toHaveLength(64);
    expect(() => ensureEntryEdgeCandidateFreeze({ freezePath, hashPath, definition: { ...definition, candidates: [{ id: "b", threshold: 1 }] } })).toThrow(/refusing to overwrite/);
  });

  test("Final Unseen guard requires all conditions and one marker", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gpt003-holdout-"));
    const markerPath = path.join(directory, "marker.json");
    expect(() => assertFinalUnseenCanExecute({ freezeExists: false, freezeHashValid: false, internalGatePassed: true, selectedCandidateId: "a", frozenCandidateIds: ["a"], markerPath })).toThrow(/valid candidate freeze/);
    fs.writeFileSync(markerPath, JSON.stringify({ executionCount: 1 }));
    expect(() => assertFinalUnseenCanExecute({ freezeExists: true, freezeHashValid: true, internalGatePassed: true, selectedCandidateId: "a", frozenCandidateIds: ["a"], markerPath })).toThrow(/second execution/);
  });

  test("internal gate keeps a negative expectancy candidate out", () => {
    const summary = summarizeEntryEvents(Array.from({ length: 320 }, (_, index) => event(index, index, -0.2)));
    const gate = evaluateEntryEdgeGate({
      summary, positiveFoldCount: 0, foldCount: 3, positiveMonthRatio: 0, scoreCalibrated: true,
      noLeakage: true, noLookahead: true, baseline: summary
    });
    expect(gate.passed).toBe(false);
    expect(gate.reasons).toContain("netRPositive");
  });
});

describe("GPT-PROFIT-003 safety", () => {
  test("remains shadow-only with no production strategy allowlist", () => {
    expect(MAIN_STRATEGY_DELIVERY_MODE).toBe("shadow");
    expect(ALT_BASKET_DELIVERY_MODE).toBe("shadow");
    expect(PRODUCTION_SIGNAL_STRATEGIES).toEqual([]);
  });
});

function candle(index: number, open: number, low: number, high: number, isClosed: boolean, closeTimeOffset = index * 900_000) : Candle {
  return {
    symbol: "TESTUSDT", interval: "15m", openTime: closeTimeOffset, closeTime: closeTimeOffset + 899_999,
    open, high, low, close: (low + high) / 2, volume: 100 + index, quoteVolume: 1_000 + index,
    trades: 1, takerBuyVolume: 1, takerBuyQuoteVolume: 1, isClosed
  };
}

function panel(value: number): EntryFeaturePanel {
  return Object.fromEntries(ENTRY_EDGE_FEATURE_NAMES.map((name) => [name, value])) as EntryFeaturePanel;
}

function label(netR: number | null): EntryLabel {
  return { targetR: 1, status: netR === null ? "open" : netR > 0 ? "hit_tp" : "hit_sl", entryTime: 0, exitTime: netR === null ? null : 1, grossR: netR, netR, grossPnlPct: netR, netPnlPct: netR, mfe: Math.max(0, netR ?? 0), mae: Math.max(0, -(netR ?? 0)), barsToOutcome: netR === null ? null : 1 };
}

function event(index: number, featureValue: number, netR: number): EntryEvent {
  return {
    eventId: `event-${index}`, symbol: `SYM${index % 6}USDT`, setupFamily: "trend_pullback_continuation", direction: "LONG",
    decisionIndex: index, eventTime: index * 900_000, entryPrice: 100, stopLoss: 99, risk: 1,
    marketRegime: "bull", features: { ...panel(0), trend_return_4h: featureValue }, labelOneR: label(netR), labelOne25R: label(netR)
  };
}
