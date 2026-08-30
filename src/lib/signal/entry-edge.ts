import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Candle, Direction } from "./types.ts";

export const GPT_PROFIT_003_DISCOVERY_CUTOFF = "2026-08-02T03:15:00.000Z";
export const GPT_PROFIT_003_FINAL_UNSEEN_START = "2026-08-02T03:30:00.000Z";
export const GPT_PROFIT_003_FINAL_UNSEEN_END = "2026-08-29T23:45:00.000Z";
export const ENTRY_EDGE_FEE_RATE = 0.001;
export const ENTRY_EDGE_SLIPPAGE_RATE = 0.0005;
export const ENTRY_EDGE_HORIZON_BARS = 96;
export const ENTRY_EDGE_PURGE_BARS = 16;

export const ENTRY_EDGE_SETUP_DEFINITIONS = {
  trend_pullback_continuation: {
    label: "A. Trend Pullback Continuation",
    requirements: ["higher-timeframe trend", "pullback depth", "structure position", "recovery confirmation"]
  },
  breakout_retest: {
    label: "B. Breakout + Retest",
    requirements: ["structure breakout", "breakout distance / ATR", "retest", "hold or rejection confirmation"]
  },
  volatility_compression_expansion: {
    label: "C. Volatility Compression → Expansion",
    requirements: ["ATR/range compression", "volume compression", "range/volume expansion", "trend direction alignment"]
  },
  relative_strength_continuation: {
    label: "D. Relative Strength Continuation",
    requirements: ["asset vs BTC relative strength", "multi-horizon relative strength", "BTC direction/regime alignment"]
  }
} as const;

export type EntrySetupFamily = keyof typeof ENTRY_EDGE_SETUP_DEFINITIONS;

export const ENTRY_EDGE_FEATURE_NAMES = [
  "trend_return_15m",
  "trend_return_1h",
  "trend_return_4h",
  "trend_return_12h",
  "trend_slope_short",
  "trend_slope_medium",
  "trend_alignment_long",
  "structure_distance_rolling_high",
  "structure_distance_rolling_low",
  "breakout_distance_atr",
  "pullback_depth_atr",
  "retracement_ratio",
  "structure_age",
  "atr_pct",
  "atr_percentile",
  "recent_range_atr",
  "compression_ratio",
  "expansion_ratio",
  "body_range_ratio",
  "upper_wick_ratio",
  "lower_wick_ratio",
  "close_location_value",
  "volume_ratio",
  "quote_volume_ratio",
  "volume_percentile",
  "volume_expansion",
  "relative_strength_1h",
  "relative_strength_4h",
  "relative_strength_12h",
  "btc_trend_1h",
  "btc_trend_4h",
  "btc_volatility_state",
  "breadth_bullish_pct",
  "breadth_bearish_pct",
  "cross_sectional_dispersion",
  "sl_distance_pct",
  "estimated_round_trip_cost_pct",
  "cost_coverage_ratio"
] as const;

export type EntryEdgeFeatureName = typeof ENTRY_EDGE_FEATURE_NAMES[number];
export type EntryFeaturePanel = Record<EntryEdgeFeatureName, number>;

export type EntryLabel = {
  targetR: 1 | 1.25;
  status: "hit_tp" | "hit_sl" | "open";
  entryTime: number;
  exitTime: number | null;
  grossR: number | null;
  netR: number | null;
  grossPnlPct: number | null;
  netPnlPct: number | null;
  mfe: number;
  mae: number;
  barsToOutcome: number | null;
};

export type EntryEvent = {
  eventId: string;
  symbol: string;
  setupFamily: EntrySetupFamily;
  direction: Direction;
  decisionIndex: number;
  eventTime: number;
  entryPrice: number;
  stopLoss: number;
  risk: number;
  marketRegime: "bull" | "bear" | "sideways" | "unknown";
  features: EntryFeaturePanel;
  labelOneR: EntryLabel;
  labelOne25R: EntryLabel;
};

export type CalibrationBucket = {
  bucket: number;
  lower: number | null;
  upper: number | null;
  sample: number;
  settled: number;
  wins: number;
  winProbability: number;
  profitFactor: number;
  expectancyR: number;
  netR: number;
  averageWinR: number;
  averageLossR: number;
  liftVsBaseline: number;
  confidenceInterval: [number, number];
  symbolBreadth: number;
  positiveMonths: number;
};

export type EntryOutcomeSummary = {
  trades: number;
  settled: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number;
  netR: number;
  profitFactor: number;
  expectancyR: number;
  averageWinR: number;
  averageLossR: number;
  payoff: number;
  maxDrawdownR: number;
  positiveMonths: number;
  symbolBreadth: number;
  largestSymbolContributionPct: number;
  largestSingleTradeContributionPct: number;
};

export type EntryEdgeScoreSpec = {
  features: Array<{
    name: EntryEdgeFeatureName;
    weight: number;
    orientation: 1 | -1;
    center: number;
    scale: number;
  }>;
  formula: string;
};

export type EntryEdgeGate = {
  passed: boolean;
  status: "PASS" | "FAIL";
  reasons: string[];
  checks: Record<string, boolean>;
};

const MILLISECONDS_PER_BAR = 15 * 60 * 1000;
const HOUR_BARS = { one: 4, four: 16, twelve: 48 } as const;

export function calculateEntryFeaturePanel(input: {
  symbolCandles: Candle[];
  btcCandles: Candle[];
  direction: Direction;
  breadthBullishPct?: number;
  breadthBearishPct?: number;
  crossSectionalDispersion?: number;
}): EntryFeaturePanel | null {
  const symbol = closedCandles(input.symbolCandles);
  const btc = closedCandles(input.btcCandles);
  if (symbol.length < 80 || btc.length < 80) return null;
  const latest = symbol.at(-1)!;
  const sign = input.direction === "LONG" ? 1 : -1;
  const recentWindow = symbol.slice(-80);
  const ranges = recentWindow.map((_, index) => trueRange(recentWindow, index));
  const atr = average(ranges.slice(-14));
  const previousAtr: number[] = [];
  for (let cursor = Math.max(14, ranges.length - 64); cursor < ranges.length - 1; cursor += 1) {
    previousAtr.push(average(ranges.slice(cursor - 13, cursor + 1)));
  }
  const latestRange = ranges.at(-1) ?? 0;
  const close = latest.close;
  const safeClose = close > 0 ? close : 1;
  const rollingHigh = Math.max(...symbol.slice(-41, -1).map((candle) => candle.high));
  const rollingLow = Math.min(...symbol.slice(-41, -1).map((candle) => candle.low));
  const structureRange = Math.max(rollingHigh - rollingLow, Number.EPSILON);
  const priorHigh = Math.max(...symbol.slice(-21, -1).map((candle) => candle.high));
  const priorLow = Math.min(...symbol.slice(-21, -1).map((candle) => candle.low));
  const pullbackDepth = input.direction === "LONG"
    ? Math.max(0, rollingHigh - close) / Math.max(atr, Number.EPSILON)
    : Math.max(0, close - rollingLow) / Math.max(atr, Number.EPSILON);
  const retracement = input.direction === "LONG"
    ? (rollingHigh - close) / structureRange
    : (close - rollingLow) / structureRange;
  const volumeAverage = average(symbol.slice(-21, -1).map((candle) => candle.volume));
  const quoteVolumeAverage = average(symbol.slice(-21, -1).map((candle) => candle.quoteVolume));
  const volumeWindow = symbol.slice(-65, -1).map((candle) => candle.volume).filter((value) => value > 0);
  const atrPct = atr / safeClose * 100;
  const btcRecentWindow = btc.slice(-80);
  const btcAtr = average(btcRecentWindow.slice(-14).map((_, index) => trueRange(btcRecentWindow.slice(-14), index)));
  const btcAtrPct = btcAtr / Math.max(btc.at(-1)!.close, Number.EPSILON) * 100;
  const currentBody = Math.abs(latest.close - latest.open);
  const currentRange = Math.max(latest.high - latest.low, Number.EPSILON);
  const previousRangeAverage = average(ranges.slice(-9, -1));
  const compressionReference = average(ranges.slice(-33, -9));

  const feature = (name: EntryEdgeFeatureName, value: number) => [name, finite(value)] as const;
  return Object.fromEntries([
    feature("trend_return_15m", signedReturn(symbol, 1, sign)),
    feature("trend_return_1h", signedReturn(symbol, HOUR_BARS.one, sign)),
    feature("trend_return_4h", signedReturn(symbol, HOUR_BARS.four, sign)),
    feature("trend_return_12h", signedReturn(symbol, HOUR_BARS.twelve, sign)),
    feature("trend_slope_short", signedSlope(symbol, 8, sign)),
    feature("trend_slope_medium", signedSlope(symbol, 24, sign)),
    feature("trend_alignment_long", signedReturn(symbol, 64, sign) >= 0 ? 1 : 0),
    feature("structure_distance_rolling_high", input.direction === "LONG"
      ? (close - rollingHigh) / safeClose * 100
      : (rollingLow - close) / safeClose * 100),
    feature("structure_distance_rolling_low", input.direction === "LONG"
      ? (close - rollingLow) / safeClose * 100
      : (rollingHigh - close) / safeClose * 100),
    feature("breakout_distance_atr", input.direction === "LONG"
      ? (close - priorHigh) / Math.max(atr, Number.EPSILON)
      : (priorLow - close) / Math.max(atr, Number.EPSILON)),
    feature("pullback_depth_atr", pullbackDepth),
    feature("retracement_ratio", clamp(retracement, -2, 2)),
    feature("structure_age", structureAge(symbol, input.direction)),
    feature("atr_pct", atrPct),
    feature("atr_percentile", percentileRank(previousAtr, atr)),
    feature("recent_range_atr", average(ranges.slice(-8)) / Math.max(atr, Number.EPSILON)),
    feature("compression_ratio", average(ranges.slice(-8)) / Math.max(compressionReference, Number.EPSILON)),
    feature("expansion_ratio", latestRange / Math.max(previousRangeAverage, Number.EPSILON)),
    feature("body_range_ratio", currentBody / currentRange * sign),
    feature("upper_wick_ratio", Math.max(0, latest.high - Math.max(latest.open, latest.close)) / currentRange),
    feature("lower_wick_ratio", Math.max(0, Math.min(latest.open, latest.close) - latest.low) / currentRange),
    feature("close_location_value", ((latest.close - latest.low) / currentRange * 2 - 1) * sign),
    feature("volume_ratio", latest.volume / Math.max(volumeAverage, Number.EPSILON)),
    feature("quote_volume_ratio", latest.quoteVolume / Math.max(quoteVolumeAverage, Number.EPSILON)),
    feature("volume_percentile", percentileRank(volumeWindow, latest.volume)),
    feature("volume_expansion", latest.volume / Math.max(average(symbol.slice(-9, -1).map((candle) => candle.volume)), Number.EPSILON)),
    feature("relative_strength_1h", relativeStrength(symbol, btc, HOUR_BARS.one) * sign),
    feature("relative_strength_4h", relativeStrength(symbol, btc, HOUR_BARS.four) * sign),
    feature("relative_strength_12h", relativeStrength(symbol, btc, HOUR_BARS.twelve) * sign),
    feature("btc_trend_1h", signedReturn(btc, HOUR_BARS.one, sign)),
    feature("btc_trend_4h", signedReturn(btc, HOUR_BARS.four, sign)),
    feature("btc_volatility_state", btcAtrPct),
    feature("breadth_bullish_pct", finite(input.breadthBullishPct ?? 50)),
    feature("breadth_bearish_pct", finite(input.breadthBearishPct ?? 50)),
    feature("cross_sectional_dispersion", finite(input.crossSectionalDispersion ?? 0)),
    feature("sl_distance_pct", atrPct),
    feature("estimated_round_trip_cost_pct", (ENTRY_EDGE_FEE_RATE + ENTRY_EDGE_SLIPPAGE_RATE) * 2 * 100),
    feature("cost_coverage_ratio", (atrPct) / ((ENTRY_EDGE_FEE_RATE + ENTRY_EDGE_SLIPPAGE_RATE) * 2 * 100))
  ]) as EntryFeaturePanel;
};

export function detectEntrySetups(input: {
  symbolCandles: Candle[];
  btcCandles: Candle[];
  breadthBullishPct?: number;
  breadthBearishPct?: number;
  crossSectionalDispersion?: number;
}): Array<{ family: EntrySetupFamily; direction: Direction; features: EntryFeaturePanel }> {
  const symbol = closedCandles(input.symbolCandles);
  const btc = closedCandles(input.btcCandles);
  if (symbol.length < 80 || btc.length < 80) return [];
  const rawFourHour = percentageReturn(symbol, HOUR_BARS.four);
  const rawRelative = relativeStrength(symbol, btc, HOUR_BARS.four);
  const directions: Direction[] = rawFourHour === 0 && rawRelative === 0
    ? []
    : [rawRelative >= 0 ? "LONG" : "SHORT"];
  const results: Array<{ family: EntrySetupFamily; direction: Direction; features: EntryFeaturePanel }> = [];
  for (const direction of directions) {
    const features = calculateEntryFeaturePanel({ ...input, direction });
    if (!features) continue;
    const current = symbol.at(-1)!;
    const previous = symbol.at(-2)!;
    const sign = direction === "LONG" ? 1 : -1;
    const recovery = ((current.close - previous.close) / Math.max(previous.close, Number.EPSILON)) * sign;
    const trend = features.trend_return_4h > 0 && features.trend_return_12h > 0;
    const structurePosition = direction === "LONG"
      ? features.structure_distance_rolling_low > 0
      : features.structure_distance_rolling_low > 0;
    const pullback = features.pullback_depth_atr >= 0.15 && features.pullback_depth_atr <= 3.5;
    if (trend && pullback && recovery > -0.002 && structurePosition && features.close_location_value > -0.25) {
      results.push({ family: "trend_pullback_continuation", direction, features });
    }

    const breakout = features.breakout_distance_atr >= -0.35 && features.breakout_distance_atr <= 2.5;
    const retest = features.retracement_ratio >= 0.05 && features.retracement_ratio <= 0.7;
    if (breakout && retest && recovery > -0.001 && features.close_location_value > -0.4) {
      results.push({ family: "breakout_retest", direction, features });
    }

    if (features.compression_ratio <= 0.9 && features.expansion_ratio >= 1.05 && features.volume_expansion >= 1.02 && features.trend_alignment_long > 0) {
      results.push({ family: "volatility_compression_expansion", direction, features });
    }

    if (Math.abs(features.relative_strength_1h) >= 0.05 && Math.abs(features.relative_strength_4h) >= 0.1
      && Math.abs(features.relative_strength_12h) >= 0.15 && features.btc_trend_4h > -1.5) {
      results.push({ family: "relative_strength_continuation", direction, features });
    }
  }
  return results;
}

export function buildEntryEvent(input: {
  symbol: string;
  setupFamily: EntrySetupFamily;
  direction: Direction;
  decisionIndex: number;
  candles: Candle[];
  features: EntryFeaturePanel;
  marketRegime: EntryEvent["marketRegime"];
  horizonBars?: number;
}): EntryEvent | null {
  const candles = closedCandles(input.candles);
  const current = candles[input.decisionIndex];
  if (!current || !Number.isFinite(current.close) || current.close <= 0) return null;
  const atr = Math.max(atrAt(candles, input.decisionIndex, 14), current.close * 0.0005);
  const risk = atr;
  const stopLoss = input.direction === "LONG" ? current.close - risk : current.close + risk;
  const base = {
    eventId: `${input.symbol}:${input.setupFamily}:${current.openTime}:${input.direction}`,
    symbol: input.symbol,
    setupFamily: input.setupFamily,
    direction: input.direction,
    decisionIndex: input.decisionIndex,
    eventTime: current.closeTime,
    entryPrice: current.close,
    stopLoss,
    risk,
    marketRegime: input.marketRegime,
    features: input.features
  };
  const future = candles.slice(input.decisionIndex + 1, input.decisionIndex + 1 + (input.horizonBars ?? ENTRY_EDGE_HORIZON_BARS));
  return {
    ...base,
    labelOneR: simulateEntryLabel({ ...base, targetR: 1, futureCandles: future }),
    labelOne25R: simulateEntryLabel({ ...base, targetR: 1.25, futureCandles: future })
  };
}

export function simulateEntryLabel(input: {
  direction: Direction;
  entryPrice: number;
  stopLoss: number;
  risk: number;
  eventTime: number;
  targetR: 1 | 1.25;
  futureCandles: Array<Pick<Candle, "openTime" | "closeTime" | "high" | "low" | "close" | "isClosed">>;
}): EntryLabel {
  const feeAndSlippage = (ENTRY_EDGE_FEE_RATE + ENTRY_EDGE_SLIPPAGE_RATE) * 2;
  const costR = input.entryPrice > 0 && input.risk > 0
    ? feeAndSlippage / (input.risk / input.entryPrice)
    : Number.POSITIVE_INFINITY;
  let mfe = 0;
  let mae = 0;
  let bars = 0;
  const target = input.direction === "LONG"
    ? input.entryPrice + input.risk * input.targetR
    : input.entryPrice - input.risk * input.targetR;
  for (const candle of [...input.futureCandles].sort((a, b) => a.closeTime - b.closeTime)) {
    if (!candle.isClosed || candle.closeTime <= input.eventTime) continue;
    bars += 1;
    const favorable = input.direction === "LONG" ? candle.high - input.entryPrice : input.entryPrice - candle.low;
    const adverse = input.direction === "LONG" ? input.entryPrice - candle.low : candle.high - input.entryPrice;
    mfe = Math.max(mfe, favorable / Math.max(input.risk, Number.EPSILON));
    mae = Math.max(mae, adverse / Math.max(input.risk, Number.EPSILON));
    const hitStop = input.direction === "LONG" ? candle.low <= input.stopLoss : candle.high >= input.stopLoss;
    const hitTarget = input.direction === "LONG" ? candle.high >= target : candle.low <= target;
    // Conservative fixed benchmark: if both barriers occur inside one candle,
    // stop is always taken first and no intrabar ordering is inferred.
    if (hitStop) {
      const grossR = -1;
      return labelResult(input, "hit_sl", candle.closeTime, grossR, costR, mfe, mae, bars);
    }
    if (hitTarget) {
      const grossR = input.targetR;
      return labelResult(input, "hit_tp", candle.closeTime, grossR, costR, mfe, mae, bars);
    }
  }
  return {
    targetR: input.targetR,
    status: "open",
    entryTime: input.eventTime,
    exitTime: null,
    grossR: null,
    netR: null,
    grossPnlPct: null,
    netPnlPct: null,
    mfe,
    mae,
    barsToOutcome: null
  };
}

export function summarizeEntryEvents(events: EntryEvent[], labelKey: "labelOneR" | "labelOne25R" = "labelOneR"): EntryOutcomeSummary {
  const labels = events.map((event) => event[labelKey]);
  const settled = labels.filter((label) => label.netR !== null);
  const returns = settled.map((label) => label.netR ?? 0);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const grossProfit = sum(wins);
  const grossLoss = Math.abs(sum(losses));
  const byMonth = new Map<string, number>();
  const bySymbol = new Map<string, number>();
  for (const event of events) {
    const label = event[labelKey];
    if (label.netR === null) continue;
    const month = new Date(event.eventTime).toISOString().slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + label.netR);
    bySymbol.set(event.symbol, (bySymbol.get(event.symbol) ?? 0) + label.netR);
  }
  const positiveTotal = Math.max(grossProfit, Number.EPSILON);
  return {
    trades: events.length,
    settled: settled.length,
    open: labels.length - settled.length,
    wins: wins.length,
    losses: losses.length,
    winRate: settled.length ? wins.length / settled.length * 100 : 0,
    netR: sum(returns),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
    expectancyR: settled.length ? sum(returns) / settled.length : 0,
    averageWinR: wins.length ? sum(wins) / wins.length : 0,
    averageLossR: losses.length ? Math.abs(sum(losses) / losses.length) : 0,
    payoff: losses.length ? (wins.length ? sum(wins) / wins.length : 0) / Math.abs(sum(losses) / losses.length) : wins.length ? sum(wins) / wins.length : 0,
    maxDrawdownR: maximumDrawdown(returns),
    positiveMonths: [...byMonth.values()].filter((value) => value > 0).length,
    symbolBreadth: new Set(events.filter((event) => event[labelKey].netR !== null).map((event) => event.symbol)).size,
    largestSymbolContributionPct: Math.max(0, ...bySymbol.values()) / positiveTotal * 100,
    largestSingleTradeContributionPct: (returns.length ? Math.max(0, returns.reduce((maximum, value) => Math.max(maximum, value), 0)) : 0) / positiveTotal * 100
  };
}

export function quantileEdges(values: number[], bins = 5): number[] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length || bins < 2) return [];
  const edges: number[] = [];
  for (let index = 1; index < bins; index += 1) {
    edges.push(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * index / bins))]);
  }
  return [...new Set(edges)];
}

export function bucketIndex(value: number, edges: number[]): number {
  let index = 0;
  while (index < edges.length && value >= edges[index]) index += 1;
  return index;
}

export function calibrateFeature(input: {
  events: EntryEvent[];
  fitEvents?: EntryEvent[];
  feature: EntryEdgeFeatureName;
  labelKey?: "labelOneR" | "labelOne25R";
  bins?: number;
}): { feature: EntryEdgeFeatureName; edges: number[]; buckets: CalibrationBucket[]; baselineExpectancyR: number; monotonicViolations: number } {
  const labelKey = input.labelKey ?? "labelOneR";
  const fitEvents = input.fitEvents ?? input.events;
  const edges = quantileEdges(fitEvents.map((event) => event.features[input.feature]), input.bins ?? 5);
  const baseline = summarizeEntryEvents(input.events, labelKey);
  const buckets: CalibrationBucket[] = [];
  const bucketCount = edges.length + 1;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const members = input.events.filter((event) => bucketIndex(event.features[input.feature], edges) === bucket);
    const labels = members.map((event) => event[labelKey]).filter((label) => label.netR !== null);
    const returns = labels.map((label) => label.netR ?? 0);
    const wins = returns.filter((value) => value > 0);
    const losses = returns.filter((value) => value < 0);
    const grossProfit = sum(wins);
    const grossLoss = Math.abs(sum(losses));
    buckets.push({
      bucket,
      lower: bucket === 0 ? null : edges[bucket - 1] ?? null,
      upper: bucket === edges.length ? null : edges[bucket] ?? null,
      sample: members.length,
      settled: labels.length,
      wins: wins.length,
      winProbability: labels.length ? wins.length / labels.length : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
      expectancyR: labels.length ? sum(returns) / labels.length : 0,
      netR: sum(returns),
      averageWinR: wins.length ? sum(wins) / wins.length : 0,
      averageLossR: losses.length ? Math.abs(sum(losses) / losses.length) : 0,
      liftVsBaseline: labels.length ? sum(returns) / labels.length - baseline.expectancyR : 0,
      confidenceInterval: bootstrapMeanInterval(returns),
      symbolBreadth: new Set(members.filter((event) => event[labelKey].netR !== null).map((event) => event.symbol)).size,
      positiveMonths: positiveMonths(members, labelKey)
    });
  }
  return {
    feature: input.feature,
    edges,
    buckets,
    baselineExpectancyR: baseline.expectancyR,
    monotonicViolations: countMonotonicViolations(buckets.map((bucket) => bucket.expectancyR))
  };
}

export function classifyFeatureStatus(input: {
  sample: number;
  symbolBreadth: number;
  positiveFoldCount: number;
  foldCount: number;
  monotonicViolations: number;
  directionalLift: number;
}): "ROBUST" | "WEAK" | "UNSTABLE" | "NO_EDGE" {
  const foldRatio = input.foldCount ? input.positiveFoldCount / input.foldCount : 0;
  if (input.sample >= 150 && input.symbolBreadth >= 3 && foldRatio >= 2 / 3 && input.monotonicViolations <= 2 && input.directionalLift >= 0.01) return "ROBUST";
  if (input.foldCount > 0 && input.positiveFoldCount > 0 && input.positiveFoldCount < input.foldCount - 1) return "UNSTABLE";
  if (input.sample >= 50 && input.directionalLift > 0) return "WEAK";
  return "NO_EDGE";
}

export function fitEntryEdgeScoreSpec(events: EntryEvent[], featureNames: EntryEdgeFeatureName[]): EntryEdgeScoreSpec {
  const features = featureNames.map((name) => {
    const values = events.map((event) => event.features[name]).filter(Number.isFinite);
    const paired = events
      .map((event) => ({ x: event.features[name], y: event.labelOneR.netR }))
      .filter((item): item is { x: number; y: number } => Number.isFinite(item.x) && item.y !== null);
    const correlation = pearson(paired.map((item) => item.x), paired.map((item) => item.y));
    const scale = standardDeviation(values) || 1;
    return {
      name,
      weight: Math.max(0.05, Math.min(1, Math.abs(correlation))),
      orientation: (correlation >= 0 ? 1 : -1) as 1 | -1,
      center: average(values),
      scale
    };
  });
  const total = sum(features.map((feature) => feature.weight)) || 1;
  return {
    features: features.map((feature) => ({ ...feature, weight: feature.weight / total })),
    formula: "50 + 25 * tanh(sum(weight * orientation * (feature - train_mean) / train_sd))"
  };
}

export function calculateEntryEdgeScore(event: EntryEvent, spec: EntryEdgeScoreSpec): number {
  const raw = spec.features.reduce((total, feature) => total + feature.weight * feature.orientation
    * (event.features[feature.name] - feature.center) / Math.max(feature.scale, Number.EPSILON), 0);
  return clamp(50 + 25 * Math.tanh(raw), 0, 100);
}

export function calculateSpearman(values: number[], outcomes: number[]): number {
  const pairs = values.map((value, index) => ({ value, outcome: outcomes[index] }))
    .filter((pair) => Number.isFinite(pair.value) && Number.isFinite(pair.outcome));
  if (pairs.length < 3) return 0;
  const ranks = (items: number[]) => items.map((item, index) => ({ item, index }))
    .sort((a, b) => a.item - b.item)
    .reduce((result, item, index, sorted) => {
      let end = index;
      while (end + 1 < sorted.length && sorted[end + 1].item === item.item) end += 1;
      const rank = (index + end + 2) / 2;
      for (let cursor = index; cursor <= end; cursor += 1) result[sorted[cursor].index] = rank;
      return result;
    }, Array<number>(items.length).fill(0));
  return pearson(ranks(pairs.map((pair) => pair.value)), ranks(pairs.map((pair) => pair.outcome)));
}

export function countMonotonicViolations(values: number[]): number {
  let violations = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (Number.isFinite(values[index - 1]) && Number.isFinite(values[index]) && values[index] + 1e-9 < values[index - 1]) violations += 1;
  }
  return violations;
}

export function evaluateEntryEdgeGate(input: {
  summary: EntryOutcomeSummary;
  positiveFoldCount: number;
  foldCount: number;
  positiveMonthRatio: number;
  scoreCalibrated: boolean;
  noLeakage: boolean;
  noLookahead: boolean;
  baseline: EntryOutcomeSummary;
}): EntryEdgeGate {
  const checks = {
    minimumSettledTrades: input.summary.settled >= 300,
    netRPositive: input.summary.netR > 0,
    profitFactor: input.summary.profitFactor >= 1.25,
    expectancy: input.summary.expectancyR >= 0.08,
    payoff: input.summary.payoff >= 0.8,
    positiveFolds: input.foldCount > 0 && input.positiveFoldCount / input.foldCount >= 2 / 3,
    positiveMonths: input.positiveMonthRatio >= 0.6,
    symbolBreadth: input.summary.symbolBreadth >= 3,
    symbolConcentration: input.summary.largestSymbolContributionPct <= 50,
    singleTradeConcentration: input.summary.largestSingleTradeContributionPct <= 10,
    entryScoreCalibrated: input.scoreCalibrated,
    noLeakage: input.noLeakage,
    noLookahead: input.noLookahead,
    meaningfulImprovement: input.summary.expectancyR >= input.baseline.expectancyR + 0.03
  };
  const reasons = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { passed: reasons.length === 0, status: reasons.length === 0 ? "PASS" : "FAIL", reasons, checks };
}

export function ensureEntryEdgeCandidateFreeze(input: {
  freezePath: string;
  hashPath: string;
  definition: Record<string, unknown>;
}): { freeze: Record<string, unknown>; sha256: string; created: boolean } {
  fs.mkdirSync(path.dirname(input.freezePath), { recursive: true });
  const canonicalDefinition = freezeProjection(input.definition);
  if (fs.existsSync(input.freezePath)) {
    const existing = JSON.parse(fs.readFileSync(input.freezePath, "utf8")) as Record<string, unknown>;
    if (stableJson(freezeProjection(existing)) !== stableJson(canonicalDefinition)) {
      throw new Error("GPT-PROFIT-003 candidate freeze mismatch; refusing to overwrite existing freeze");
    }
    const sha256 = hashFile(input.freezePath);
    if (fs.existsSync(input.hashPath)) {
      const sidecar = fs.readFileSync(input.hashPath, "utf8").trim().split(/\s+/)[0]?.toLowerCase();
      if (sidecar && sidecar !== sha256) throw new Error("GPT-PROFIT-003 candidate freeze SHA256 mismatch; refusing to continue");
    } else {
      fs.writeFileSync(input.hashPath, `${sha256}  ${path.basename(input.freezePath)}\n`);
    }
    return { freeze: existing, sha256, created: false };
  }
  const freeze = canonicalDefinition;
  fs.writeFileSync(input.freezePath, `${stableJson(freeze)}\n`);
  const sha256 = hashFile(input.freezePath);
  fs.writeFileSync(input.hashPath, `${sha256}  ${path.basename(input.freezePath)}\n`);
  return { freeze, sha256, created: true };
}

export function assertFinalUnseenCanExecute(input: {
  freezeExists: boolean;
  freezeHashValid: boolean;
  internalGatePassed: boolean;
  selectedCandidateId: string | null;
  frozenCandidateIds: string[];
  markerPath: string;
}) {
  if (fs.existsSync(input.markerPath)) throw new Error("Final Unseen execution marker exists; refusing a second execution");
  if (!input.freezeExists || !input.freezeHashValid) throw new Error("Final Unseen requires a valid candidate freeze");
  if (!input.internalGatePassed) throw new Error("Final Unseen requires Internal OOS Gate PASS");
  if (!input.selectedCandidateId || !input.frozenCandidateIds.includes(input.selectedCandidateId)) {
    throw new Error("Final Unseen candidate is not from the frozen candidate set");
  }
}

export function readHoldoutExecutionCount(markerPath: string): number {
  if (!fs.existsSync(markerPath)) return 0;
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as { executionCount?: number };
  return Number(marker.executionCount ?? 0);
}

export function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function simulateLabelResult(input: {
  targetR: 1 | 1.25;
  direction: Direction;
  entryPrice: number;
  risk: number;
  eventTime: number;
  status: "hit_tp" | "hit_sl";
  exitTime: number;
  grossR: number;
  costR: number;
  mfe: number;
  mae: number;
  bars: number;
}): EntryLabel {
  const grossPnlPct = input.entryPrice > 0
    ? input.grossR * input.risk / input.entryPrice * 100
    : 0;
  const feeAndSlippagePct = (ENTRY_EDGE_FEE_RATE + ENTRY_EDGE_SLIPPAGE_RATE) * 2 * 100;
  return {
    targetR: input.targetR,
    status: input.status,
    entryTime: input.eventTime,
    exitTime: input.exitTime,
    grossR: round(input.grossR),
    netR: round(input.grossR - input.costR),
    grossPnlPct: round(grossPnlPct),
    netPnlPct: round(grossPnlPct - feeAndSlippagePct),
    mfe: round(input.mfe),
    mae: round(input.mae),
    barsToOutcome: input.bars
  };
}

function labelResult(input: {
  direction: Direction;
  entryPrice: number;
  risk: number;
  eventTime: number;
  targetR: 1 | 1.25;
}, status: "hit_tp" | "hit_sl", exitTime: number, grossR: number, costR: number, mfe: number, mae: number, bars: number): EntryLabel {
  return simulateLabelResult({ ...input, status, exitTime, grossR, costR, mfe, mae, bars });
}

function closedCandles(candles: Candle[]): Candle[] {
  return candles.filter((candle) => candle.isClosed && Number.isFinite(candle.closeTime)).sort((a, b) => a.closeTime - b.closeTime);
}

function atrAt(candles: Candle[], index: number, period: number): number {
  const values: number[] = [];
  for (let cursor = Math.max(0, index - period + 1); cursor <= index; cursor += 1) values.push(trueRange(candles, cursor));
  return average(values);
}

function trueRange(candles: Candle[], index: number): number {
  const candle = candles[index];
  if (!candle) return 0;
  const previousClose = candles[index - 1]?.close ?? candle.open;
  return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
}

function signedReturn(candles: Candle[], bars: number, sign: number): number {
  return percentageReturn(candles, bars) * sign;
}

function percentageReturn(candles: Candle[], bars: number): number {
  const end = candles.at(-1)?.close ?? 0;
  const start = candles.at(-(bars + 1))?.close ?? 0;
  return start > 0 ? (end / start - 1) * 100 : 0;
}

function signedSlope(candles: Candle[], bars: number, sign: number): number {
  const values = candles.slice(-(bars + 1)).map((candle) => candle.close);
  if (values.length < 3) return 0;
  const xMean = (values.length - 1) / 2;
  const yMean = average(values);
  const numerator = values.reduce((sumValue, value, index) => sumValue + (index - xMean) * (value - yMean), 0);
  const denominator = values.reduce((sumValue, _, index) => sumValue + (index - xMean) ** 2, 0);
  return denominator ? numerator / denominator / Math.max(yMean, Number.EPSILON) * 100 * sign : 0;
}

function relativeStrength(symbol: Candle[], btc: Candle[], bars: number): number {
  const symbolReturn = percentageReturn(symbol, bars);
  const btcReturn = percentageReturn(btc, bars);
  return symbolReturn - btcReturn;
}

function structureAge(candles: Candle[], direction: Direction): number {
  const window = candles.slice(-41, -1);
  if (!window.length) return 0;
  const extreme = direction === "LONG"
    ? Math.max(...window.map((candle) => candle.high))
    : Math.min(...window.map((candle) => candle.low));
  for (let index = window.length - 1; index >= 0; index -= 1) {
    if (direction === "LONG" ? window[index].high === extreme : window[index].low === extreme) return window.length - 1 - index;
  }
  return window.length;
}

function percentileRank(values: number[], value: number): number {
  if (!values.length) return 50;
  return values.filter((item) => item <= value).length / values.length * 100;
}

function bootstrapMeanInterval(values: number[]): [number, number] {
  if (!values.length) return [0, 0];
  const samples = Math.min(160, Math.max(40, values.length));
  const means: number[] = [];
  let seed = 0x9e3779b9;
  for (let sample = 0; sample < samples; sample += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      total += values[seed % values.length];
    }
    means.push(total / values.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(means.length * 0.025)] ?? 0, means[Math.floor(means.length * 0.975)] ?? 0];
}

function positiveMonths(events: EntryEvent[], labelKey: "labelOneR" | "labelOne25R"): number {
  const months = new Map<string, number>();
  for (const event of events) {
    const netR = event[labelKey].netR;
    if (netR === null) continue;
    const month = new Date(event.eventTime).toISOString().slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + netR);
  }
  return [...months.values()].filter((value) => value > 0).length;
}

function maximumDrawdown(values: number[]): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return round(drawdown);
}

function pearson(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = average(left);
  const rightMean = average(right);
  const numerator = left.reduce((total, value, index) => total + (value - leftMean) * (right[index] - rightMean), 0);
  const leftVariance = left.reduce((total, value) => total + (value - leftMean) ** 2, 0);
  const rightVariance = right.reduce((total, value) => total + (value - rightMean) ** 2, 0);
  return leftVariance > 0 && rightVariance > 0 ? numerator / Math.sqrt(leftVariance * rightVariance) : 0;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length);
}

function freezeProjection(value: Record<string, unknown>): Record<string, unknown> {
  const allowed = ["freezeVersion", "discoveryCutoff", "holdoutDefinition", "setupDefinitions", "selectedFeatures", "scoreFormula", "scoreParameters", "thresholds", "executionAssumptions", "validationProtocol", "candidates"];
  return Object.fromEntries(allowed.filter((key) => key in value).map((key) => [key, value[key]]));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

// Keep the timing constant exported for tests and for the research report.
export const ENTRY_EDGE_BAR_MS = MILLISECONDS_PER_BAR;
