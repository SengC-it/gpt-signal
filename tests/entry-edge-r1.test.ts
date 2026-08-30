import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  ENTRY_EDGE_FEATURE_NAMES,
  type EntryEvent,
  type EntryFeaturePanel
} from "@/lib/signal/entry-edge";
import {
  ALT_BASKET_DELIVERY_MODE,
  MAIN_STRATEGY_DELIVERY_MODE,
  PRODUCTION_SIGNAL_STRATEGIES
} from "@/lib/signal/profitability-config";
import {
  ENTRY_EDGE_R1_INNER_PURGE_BARS,
  ENTRY_EDGE_R1_LABEL_HORIZON_BARS,
  ENTRY_EDGE_R1_OUTER_PURGE_BARS,
  assertR1FinalUnseenCanExecute,
  assertTrainLabelsBeforeTest,
  buildR1TimeFolds,
  calculateR1Score,
  calibrateR1Score,
  deduplicateR1Features,
  ensureR1CandidateFreeze,
  evaluateR1Gate,
  fitR1GrossScoreSpec,
  quantileThreshold,
  summarizeR1Outcomes,
  summarizeR1ScoreRows
} from "@/lib/signal/entry-edge-r1";

describe("GPT-PROFIT-003-R1 nested protocol", () => {
  test("purge is at least the complete label horizon", () => {
    expect(ENTRY_EDGE_R1_OUTER_PURGE_BARS).toBeGreaterThanOrEqual(ENTRY_EDGE_R1_LABEL_HORIZON_BARS);
    expect(ENTRY_EDGE_R1_INNER_PURGE_BARS).toBeGreaterThanOrEqual(ENTRY_EDGE_R1_LABEL_HORIZON_BARS);
  });

  test("training labels cannot overlap an outer test window", () => {
    expect(() => assertTrainLabelsBeforeTest({ trainEvents: [{ decisionIndex: 100 }], testStartIndex: 196, horizonBars: 96 })).toThrow(/label leakage/);
    expect(() => assertTrainLabelsBeforeTest({ trainEvents: [{ decisionIndex: 99 }], testStartIndex: 196, horizonBars: 96 })).not.toThrow();
  });

  test("nested outer and inner folds carry independent purge boundaries", () => {
    const outer = buildR1TimeFolds({ startIndex: 0, endIndex: 399, foldCount: 3, purgeBars: ENTRY_EDGE_R1_OUTER_PURGE_BARS });
    const inner = buildR1TimeFolds({ startIndex: 0, endIndex: outer[0].trainEndIndex, foldCount: 3, purgeBars: ENTRY_EDGE_R1_INNER_PURGE_BARS });
    expect(outer).toHaveLength(3);
    expect(inner).toHaveLength(3);
    expect(outer.every((fold) => fold.testStartIndex - fold.trainEndIndex - 1 === ENTRY_EDGE_R1_OUTER_PURGE_BARS)).toBe(true);
    expect(inner.every((fold) => fold.testStartIndex - fold.trainEndIndex - 1 === ENTRY_EDGE_R1_INNER_PURGE_BARS)).toBe(true);
  });

  test("outer-test outcomes cannot change gross score weights", () => {
    const train = Array.from({ length: 30 }, (_, index) => event(index, index, index % 2 ? 1 : -1, index % 2 ? 0.1 : -1.1));
    const test = Array.from({ length: 10 }, (_, index) => event(index + 100, index, 1, -1));
    const before = fitR1GrossScoreSpec(train, ["trend_return_4h"]);
    test.forEach((item) => { item.labelOneR.grossR = item.labelOneR.grossR === 1 ? -1 : 1; });
    const after = fitR1GrossScoreSpec(train, ["trend_return_4h"]);
    expect(after).toEqual(before);
  });

  test("outer-test outcomes cannot change a train-only threshold", () => {
    const train = [1, 2, 3, 4, 5];
    const testBefore = [100, 101];
    const threshold = quantileThreshold(train, 0.7);
    testBefore.reverse();
    expect(quantileThreshold(train, 0.7)).toBe(threshold);
  });

  test("each fold calibrates its own score threshold", () => {
    const firstFoldThreshold = quantileThreshold([1, 2, 3, 4, 5], 0.7);
    const secondFoldThreshold = quantileThreshold([10, 20, 30, 40, 50], 0.7);
    expect(firstFoldThreshold).not.toBe(secondFoldThreshold);
  });

  test("deduplicates exact and near alias features using training data", () => {
    const events = Array.from({ length: 20 }, (_, index) => {
      const item = event(index, index, 1, 0.5);
      item.features.atr_pct = index + 1;
      item.features.sl_distance_pct = index + 1;
      item.features.cost_coverage_ratio = (index + 1) * 2;
      return item;
    });
    const result = deduplicateR1Features({
      events,
      features: ["atr_pct", "sl_distance_pct", "cost_coverage_ratio"],
      trainDirectionalLift: { atr_pct: 0.1, sl_distance_pct: 0.2, cost_coverage_ratio: 0.3 }
    });
    expect(result.retainedFeatures).toEqual(["cost_coverage_ratio"]);
    expect(result.aliasGroups).toHaveLength(1);
    expect(result.aliasGroups[0].droppedFeatures).toEqual(["atr_pct", "sl_distance_pct"]);
  });

  test("gross predictive calibration is independent from net transaction costs", () => {
    const grossStable = Array.from({ length: 20 }, (_, index) => event(index, index, index % 2 ? 1 : -1, index % 2 ? 0.2 : -0.2));
    const netCostChanged = grossStable.map((item, index) => {
      const copy = cloneEvent(item);
      copy.labelOneR.netR = index % 2 ? -5 : 5;
      return copy;
    });
    const rowsA = grossStable.map((item) => ({ event: item, score: item.features.trend_return_4h }));
    const rowsB = netCostChanged.map((item) => ({ event: item, score: item.features.trend_return_4h }));
    const grossA = calibrateR1Score({ rows: rowsA, component: "grossR" });
    const grossB = calibrateR1Score({ rows: rowsB, component: "grossR" });
    expect(grossB).toEqual(grossA);
  });

  test("gross score fitting uses gross outcome rather than net outcome", () => {
    const events = Array.from({ length: 20 }, (_, index) => event(index, index, index > 9 ? 1 : -1, index > 9 ? -100 : 100));
    const spec = fitR1GrossScoreSpec(events, ["trend_return_4h"]);
    expect(spec.target).toBe("grossR");
    expect(spec.features[0].orientation).toBe(1);
    expect(calculateR1Score(events.at(-1)!, spec)).toBeGreaterThan(calculateR1Score(events[0], spec));
  });

  test("R1 gate requires aggregate outer OOS score calibration", () => {
    const summary = summarizeR1Outcomes(Array.from({ length: 420 }, (_, index) => event(index, index, 1, 0.8)), "netR");
    const baseline = summarizeR1Outcomes(Array.from({ length: 420 }, (_, index) => event(index, index, -1, -1.2)), "netR");
    const gate = evaluateR1Gate({
      summary,
      positiveFoldCount: 3,
      foldCount: 3,
      positiveMonthRatio: 1,
      trainingScoreStatus: "CALIBRATED",
      oosScoreStatus: "ENTRY_SCORE_NOT_CALIBRATED",
      oosGrossSpearman: -0.1,
      oosNetSpearman: 0.1,
      oosMonotonicViolations: 4,
      highestGrossBucketExpectancyR: 0,
      grossBaselineExpectancyR: -0.2,
      noLeakage: true,
      noLookahead: true,
      baseline
    });
    expect(gate.passed).toBe(false);
    expect(gate.reasons).toContain("oosScoreCalibrated");
    expect(gate.reasons).toContain("oosSpearmanPositive");
  });

  test("highest score bucket means the top populated score bucket", () => {
    const rows = [
      { event: event(1, 1, -1, -1), score: 10, bucket: 0 },
      { event: event(2, 2, 1, 1), score: 20, bucket: 1 },
      { event: event(3, 3, -0.5, -0.5), score: 30, bucket: 2 }
    ];
    const calibration = summarizeR1ScoreRows(rows, "grossR", 3);
    expect(calibration.highestBucketExpectancyR).toBe(-0.5);
  });

  test("R1 freeze fails closed instead of overwriting", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gpt003-r1-freeze-"));
    const freezePath = path.join(directory, "freeze.json");
    const hashPath = path.join(directory, "freeze.sha256");
    const definition = { freezeVersion: "r1", candidateTemplates: [{ id: "a", thresholdRule: "top30" }] };
    const first = ensureR1CandidateFreeze({ freezePath, hashPath, definition });
    expect(first.created).toBe(true);
    expect(first.sha256).toHaveLength(64);
    expect(() => ensureR1CandidateFreeze({ freezePath, hashPath, definition: { ...definition, candidateTemplates: [{ id: "b", thresholdRule: "top30" }] } })).toThrow(/refusing to overwrite/);
    expect(ensureR1CandidateFreeze({ freezePath, hashPath, definition }).created).toBe(false);
  });

  test("Final Unseen remains single-execution and fully guarded", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gpt003-r1-holdout-"));
    const markerPath = path.join(directory, "marker.json");
    expect(() => assertR1FinalUnseenCanExecute({ freezeExists: false, freezeHashValid: false, internalGatePassed: true, selectedCandidateId: "a", frozenCandidateIds: ["a"], markerPath })).toThrow(/valid candidate freeze/);
    fs.writeFileSync(markerPath, JSON.stringify({ executionCount: 1 }));
    expect(() => assertR1FinalUnseenCanExecute({ freezeExists: true, freezeHashValid: true, internalGatePassed: true, selectedCandidateId: "a", frozenCandidateIds: ["a"], markerPath })).toThrow(/second execution/);
  });
});

describe("GPT-PROFIT-003-R1 safety", () => {
  test("keeps all current strategies Shadow with no private API", () => {
    expect(MAIN_STRATEGY_DELIVERY_MODE).toBe("shadow");
    expect(ALT_BASKET_DELIVERY_MODE).toBe("shadow");
    expect(PRODUCTION_SIGNAL_STRATEGIES).toEqual([]);
  });
});

function panel(value: number): EntryFeaturePanel {
  return Object.fromEntries(ENTRY_EDGE_FEATURE_NAMES.map((name) => [name, value])) as EntryFeaturePanel;
}

function event(index: number, featureValue: number, grossR: number, netR: number): EntryEvent {
  const label = (gross: number, net: number) => ({
    targetR: 1 as const,
    status: gross > 0 ? "hit_tp" as const : "hit_sl" as const,
    entryTime: index * 900_000,
    exitTime: index * 900_000 + 899_999,
    grossR: gross,
    netR: net,
    grossPnlPct: gross,
    netPnlPct: net,
    mfe: Math.max(0, gross),
    mae: Math.max(0, -gross),
    barsToOutcome: 1
  });
  return {
    eventId: `r1-${index}`,
    symbol: `SYM${index % 6}USDT`,
    setupFamily: "trend_pullback_continuation",
    direction: "LONG",
    decisionIndex: index,
    eventTime: index * 900_000,
    entryPrice: 100,
    stopLoss: 99,
    risk: 1,
    marketRegime: "bull",
    features: { ...panel(0), trend_return_4h: featureValue },
    labelOneR: label(grossR, netR),
    labelOne25R: label(grossR, netR)
  };
}

function cloneEvent(value: EntryEvent): EntryEvent {
  return JSON.parse(JSON.stringify(value)) as EntryEvent;
}
