import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EntryEdgeFeatureName, EntryEvent } from "./entry-edge.ts";

/**
 * R1 keeps the v1 Entry Edge module untouched and adds the integrity rules
 * required for a genuinely nested evaluation.  The public API is deliberately
 * small so tests can prove that outer-test outcomes cannot influence training
 * artifacts.
 */
export const ENTRY_EDGE_R1_OUTER_PURGE_BARS = 96;
export const ENTRY_EDGE_R1_INNER_PURGE_BARS = 96;
export const ENTRY_EDGE_R1_THRESHOLD_QUANTILE = 0.7;
export const ENTRY_EDGE_R1_LABEL_HORIZON_BARS = 96;

export type R1OutcomeComponent = "grossR" | "netR";
export type R1LabelKey = "labelOneR" | "labelOne25R";

export type R1OutcomeSummary = {
  trades: number;
  settled: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number;
  totalR: number;
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

export type R1Fold = {
  fold: number;
  trainStartIndex: number;
  trainEndIndex: number;
  testStartIndex: number;
  testEndIndex: number;
  purgeBars: number;
};

export type R1ScoreSpec = {
  features: Array<{
    name: EntryEdgeFeatureName;
    weight: number;
    orientation: 1 | -1;
    center: number;
    scale: number;
  }>;
  formula: string;
  target: "grossR";
};

export type R1ScoreRows = Array<{ event: EntryEvent; score: number; bucket?: number }>;

export type R1Calibration = {
  deciles: Array<{
    decile: number;
    trades: number;
    settled: number;
    winRate: number;
    profitFactor: number;
    expectancyR: number;
    averageWinR: number;
    averageLossR: number;
    payoff: number;
  }>;
  trades: number;
  settled: number;
  baselineExpectancyR: number;
  highestBucketExpectancyR: number;
  spearman: number;
  monotonicViolations: number;
  status: "CALIBRATED" | "ENTRY_SCORE_NOT_CALIBRATED";
};

export type R1Gate = {
  passed: boolean;
  status: "PASS" | "FAIL";
  reasons: string[];
  checks: Record<string, boolean>;
};

export type R1AliasGroup = {
  features: EntryEdgeFeatureName[];
  retainedFeature: EntryEdgeFeatureName;
  droppedFeatures: EntryEdgeFeatureName[];
  correlations: Array<{ feature: EntryEdgeFeatureName; correlation: number; reason: string }>;
};

export function outcomeValue(event: EntryEvent, component: R1OutcomeComponent, labelKey: R1LabelKey = "labelOneR"): number | null {
  const value = event[labelKey][component];
  return value === null ? null : value;
}

export function summarizeR1Outcomes(events: EntryEvent[], component: R1OutcomeComponent = "netR", labelKey: R1LabelKey = "labelOneR"): R1OutcomeSummary {
  const returns = events.map((event) => outcomeValue(event, component, labelKey));
  const settled = returns.filter((value): value is number => value !== null && Number.isFinite(value));
  const wins = settled.filter((value) => value > 0);
  const losses = settled.filter((value) => value < 0);
  const grossProfit = sum(wins);
  const grossLoss = Math.abs(sum(losses));
  const byMonth = new Map<string, number>();
  const bySymbol = new Map<string, number>();
  events.forEach((event, index) => {
    const value = returns[index];
    if (value === null || !Number.isFinite(value)) return;
    const month = new Date(event.eventTime).toISOString().slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + value);
    bySymbol.set(event.symbol, (bySymbol.get(event.symbol) ?? 0) + value);
  });
  const positiveTotal = Math.max(grossProfit, Number.EPSILON);
  return {
    trades: events.length,
    settled: settled.length,
    open: events.length - settled.length,
    wins: wins.length,
    losses: losses.length,
    winRate: settled.length ? wins.length / settled.length * 100 : 0,
    totalR: sum(settled),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
    expectancyR: settled.length ? sum(settled) / settled.length : 0,
    averageWinR: wins.length ? sum(wins) / wins.length : 0,
    averageLossR: losses.length ? Math.abs(sum(losses) / losses.length) : 0,
    payoff: losses.length ? (wins.length ? sum(wins) / wins.length : 0) / Math.abs(sum(losses) / losses.length) : wins.length ? sum(wins) / wins.length : 0,
    maxDrawdownR: maximumDrawdown(settled),
    positiveMonths: [...byMonth.values()].filter((value) => value > 0).length,
    symbolBreadth: new Set(events.filter((event, index) => returns[index] !== null).map((event) => event.symbol)).size,
    largestSymbolContributionPct: Math.max(0, ...bySymbol.values()) / positiveTotal * 100,
    largestSingleTradeContributionPct: (settled.length ? settled.reduce((maximum, value) => Math.max(maximum, value), 0) : 0) / positiveTotal * 100
  };
}

export function buildR1TimeFolds(input: {
  startIndex: number;
  endIndex: number;
  foldCount?: number;
  purgeBars?: number;
}): R1Fold[] {
  const foldCount = input.foldCount ?? 3;
  const purgeBars = input.purgeBars ?? ENTRY_EDGE_R1_OUTER_PURGE_BARS;
  const total = input.endIndex - input.startIndex + 1;
  const span = Math.max(32, Math.floor(total / (foldCount + 1)));
  return Array.from({ length: foldCount }, (_, offset) => {
    const trainEndIndex = Math.min(input.endIndex - purgeBars - 1, input.startIndex + span * (offset + 1));
    const testStartIndex = trainEndIndex + purgeBars + 1;
    const testEndIndex = Math.min(input.endIndex, testStartIndex + span - 1);
    return {
      fold: offset + 1,
      trainStartIndex: input.startIndex,
      trainEndIndex,
      testStartIndex,
      testEndIndex,
      purgeBars
    };
  }).filter((fold) => fold.trainEndIndex >= fold.trainStartIndex && fold.testEndIndex >= fold.testStartIndex);
}

export function assertTrainLabelsBeforeTest(input: {
  trainEvents: Array<Pick<EntryEvent, "decisionIndex">>;
  testStartIndex: number;
  horizonBars?: number;
}): void {
  const horizonBars = input.horizonBars ?? ENTRY_EDGE_R1_LABEL_HORIZON_BARS;
  const overlapping = input.trainEvents.find((event) => event.decisionIndex + horizonBars >= input.testStartIndex);
  if (overlapping) {
    throw new Error(`R1 label leakage: training event at ${overlapping.decisionIndex} reaches outer test start ${input.testStartIndex}`);
  }
}

export function fitR1GrossScoreSpec(events: EntryEvent[], featureNames: EntryEdgeFeatureName[]): R1ScoreSpec {
  const features = featureNames.map((name) => {
    const values = events.map((event) => event.features[name]).filter(Number.isFinite);
    const paired = events
      .map((event) => ({ x: event.features[name], y: outcomeValue(event, "grossR") }))
      .filter((item): item is { x: number; y: number } => Number.isFinite(item.x) && item.y !== null && Number.isFinite(item.y));
    const correlation = pearson(paired.map((item) => item.x), paired.map((item) => item.y));
    return {
      name,
      weight: Math.max(0.05, Math.min(1, Math.abs(correlation))),
      orientation: (correlation >= 0 ? 1 : -1) as 1 | -1,
      center: average(values),
      scale: standardDeviation(values) || 1
    };
  });
  const total = sum(features.map((feature) => feature.weight)) || 1;
  return {
    features: features.map((feature) => ({ ...feature, weight: feature.weight / total })),
    formula: "50 + 25 * tanh(sum(weight * orientation * (feature - train_mean) / train_sd)); target=grossR",
    target: "grossR"
  };
}

export function calculateR1Score(event: EntryEvent, spec: R1ScoreSpec): number {
  const raw = spec.features.reduce((total, feature) => total + feature.weight * feature.orientation
    * (event.features[feature.name] - feature.center) / Math.max(feature.scale, Number.EPSILON), 0);
  return clamp(50 + 25 * Math.tanh(raw), 0, 100);
}

export function quantileThreshold(values: number[], fraction = ENTRY_EDGE_R1_THRESHOLD_QUANTILE): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return Number.POSITIVE_INFINITY;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? Number.POSITIVE_INFINITY;
}

export function calibrateR1Score(input: {
  rows: R1ScoreRows;
  fitRows?: R1ScoreRows;
  component: R1OutcomeComponent;
  bins?: number;
}): R1Calibration {
  const fitRows = input.fitRows ?? input.rows;
  const bins = input.bins ?? 10;
  const fitScores = fitRows.map((row) => row.score).filter(Number.isFinite);
  const edges = quantileEdges(fitScores, bins);
  const rows = input.rows.map((row) => ({ ...row, bucket: bucketIndex(row.score, edges) }));
  return summarizeR1ScoreRows(rows, input.component, edges.length + 1);
}

export function summarizeR1ScoreRows(rows: R1ScoreRows, component: R1OutcomeComponent, bucketCount = 10): R1Calibration {
  const grouped = Array.from({ length: bucketCount }, (_, bucket) => rows.filter((row) => row.bucket === bucket));
  const deciles = grouped.map((members, index) => {
    const summary = summarizeR1Outcomes(members.map((row) => row.event), component);
    return {
      decile: index + 1,
      trades: summary.trades,
      settled: summary.settled,
      winRate: summary.winRate,
      profitFactor: summary.profitFactor,
      expectancyR: summary.expectancyR,
      averageWinR: summary.averageWinR,
      averageLossR: summary.averageLossR,
      payoff: summary.payoff
    };
  });
  const values = rows.map((row) => row.score);
  const outcomes = rows.map((row) => outcomeValue(row.event, component));
  const baseline = summarizeR1Outcomes(rows.map((row) => row.event), component);
  const expectancy = deciles.map((bucket) => bucket.expectancyR);
  const spearman = calculateR1Spearman(values, outcomes);
  const monotonicViolations = countR1MonotonicViolations(expectancy);
  const highestBucket = [...deciles].reverse().find((bucket) => bucket.settled > 0);
  const highestBucketExpectancyR = highestBucket?.expectancyR ?? 0;
  const status = rows.length > 0 && spearman > 0 && monotonicViolations <= 3
    && highestBucketExpectancyR >= baseline.expectancyR + 0.03
    ? "CALIBRATED"
    : "ENTRY_SCORE_NOT_CALIBRATED";
  return {
    deciles,
    trades: rows.length,
    settled: rows.filter((row) => outcomeValue(row.event, component) !== null).length,
    baselineExpectancyR: baseline.expectancyR,
    highestBucketExpectancyR,
    spearman,
    monotonicViolations,
    status
  };
}

export function calculateR1Spearman(values: number[], outcomes: Array<number | null>): number {
  const pairs = values.map((value, index) => ({ value, outcome: outcomes[index] }))
    .filter((pair): pair is { value: number; outcome: number } => Number.isFinite(pair.value) && pair.outcome !== null && Number.isFinite(pair.outcome));
  if (pairs.length < 3) return 0;
  const rank = (items: number[]) => items.map((item, index) => ({ item, index }))
    .sort((left, right) => left.item - right.item)
    .reduce((result, item, index, sorted) => {
      let end = index;
      while (end + 1 < sorted.length && sorted[end + 1].item === item.item) end += 1;
      const value = (index + end + 2) / 2;
      for (let cursor = index; cursor <= end; cursor += 1) result[sorted[cursor].index] = value;
      return result;
    }, Array<number>(items.length).fill(0));
  return pearson(rank(pairs.map((pair) => pair.value)), rank(pairs.map((pair) => pair.outcome)));
}

export function countR1MonotonicViolations(values: number[]): number {
  let violations = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (Number.isFinite(values[index - 1]) && Number.isFinite(values[index]) && values[index] + 1e-9 < values[index - 1]) violations += 1;
  }
  return violations;
}

export function deduplicateR1Features(input: {
  events: EntryEvent[];
  features: EntryEdgeFeatureName[];
  trainDirectionalLift?: Partial<Record<EntryEdgeFeatureName, number>>;
  correlationThreshold?: number;
}): { retainedFeatures: EntryEdgeFeatureName[]; aliasGroups: R1AliasGroup[] } {
  const threshold = input.correlationThreshold ?? 0.98;
  const parent = new Map<EntryEdgeFeatureName, EntryEdgeFeatureName>(input.features.map((feature) => [feature, feature]));
  const find = (feature: EntryEdgeFeatureName): EntryEdgeFeatureName => {
    const root = parent.get(feature) ?? feature;
    if (root === feature) return root;
    const resolved = find(root);
    parent.set(feature, resolved);
    return resolved;
  };
  const union = (left: EntryEdgeFeatureName, right: EntryEdgeFeatureName) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  const correlations = new Map<string, number>();
  for (let left = 0; left < input.features.length; left += 1) {
    for (let right = left + 1; right < input.features.length; right += 1) {
      const leftFeature = input.features[left];
      const rightFeature = input.features[right];
      const correlation = pearson(
        input.events.map((event) => event.features[leftFeature]),
        input.events.map((event) => event.features[rightFeature])
      );
      correlations.set(`${leftFeature}:${rightFeature}`, correlation);
      if (Math.abs(correlation) >= threshold) union(leftFeature, rightFeature);
    }
  }
  const groups = new Map<EntryEdgeFeatureName, EntryEdgeFeatureName[]>();
  input.features.forEach((feature) => {
    const root = find(feature);
    groups.set(root, [...(groups.get(root) ?? []), feature]);
  });
  const aliasGroups: R1AliasGroup[] = [];
  const retainedFeatures: EntryEdgeFeatureName[] = [];
  for (const features of groups.values()) {
    const retainedFeature = [...features].sort((left, right) => {
      const lift = (input.trainDirectionalLift?.[right] ?? 0) - (input.trainDirectionalLift?.[left] ?? 0);
      return lift || input.features.indexOf(left) - input.features.indexOf(right);
    })[0];
    retainedFeatures.push(retainedFeature);
    const droppedFeatures = features.filter((feature) => feature !== retainedFeature);
    if (!droppedFeatures.length) continue;
    aliasGroups.push({
      features,
      retainedFeature,
      droppedFeatures,
      correlations: droppedFeatures.map((feature) => {
        const correlation = correlations.get(`${retainedFeature}:${feature}`)
          ?? correlations.get(`${feature}:${retainedFeature}`)
          ?? 1;
        return {
          feature,
          correlation,
          reason: Math.abs(correlation) === 1 ? "exact/linear alias in benchmark" : `|correlation| >= ${threshold}`
        };
      })
    });
  }
  return { retainedFeatures, aliasGroups };
}

export function evaluateR1Gate(input: {
  summary: R1OutcomeSummary;
  positiveFoldCount: number;
  foldCount: number;
  positiveMonthRatio: number;
  trainingScoreStatus: R1Calibration["status"];
  oosScoreStatus: R1Calibration["status"];
  oosGrossSpearman: number;
  oosNetSpearman: number;
  oosMonotonicViolations: number;
  highestGrossBucketExpectancyR: number;
  grossBaselineExpectancyR: number;
  noLeakage: boolean;
  noLookahead: boolean;
  baseline: R1OutcomeSummary;
}): R1Gate {
  const checks = {
    minimumSettledTrades: input.summary.settled >= 300,
    netRPositive: input.summary.totalR > 0,
    profitFactor: input.summary.profitFactor >= 1.25,
    expectancy: input.summary.expectancyR >= 0.08,
    payoff: input.summary.payoff >= 0.8,
    positiveFolds: input.foldCount > 0 && input.positiveFoldCount / input.foldCount >= 2 / 3,
    positiveMonths: input.positiveMonthRatio >= 0.6,
    symbolBreadth: input.summary.symbolBreadth >= 3,
    symbolConcentration: input.summary.largestSymbolContributionPct <= 50,
    singleTradeConcentration: input.summary.largestSingleTradeContributionPct <= 10,
    trainingScoreCalibrated: input.trainingScoreStatus === "CALIBRATED",
    oosScoreCalibrated: input.oosScoreStatus === "CALIBRATED",
    oosSpearmanPositive: input.oosGrossSpearman > 0,
    oosBucketDirectionConsistent: input.oosMonotonicViolations <= 3,
    highestGrossBucketImprovesBaseline: input.highestGrossBucketExpectancyR >= input.grossBaselineExpectancyR + 0.03,
    noLeakage: input.noLeakage,
    noLookahead: input.noLookahead,
    meaningfulImprovement: input.summary.expectancyR >= input.baseline.expectancyR + 0.03
  };
  const reasons = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { passed: reasons.length === 0, status: reasons.length === 0 ? "PASS" : "FAIL", reasons, checks };
}

export function ensureR1CandidateFreeze(input: {
  freezePath: string;
  hashPath: string;
  definition: Record<string, unknown>;
}): { freeze: Record<string, unknown>; sha256: string; created: boolean } {
  fs.mkdirSync(path.dirname(input.freezePath), { recursive: true });
  const canonical = stableJson(input.definition);
  if (fs.existsSync(input.freezePath)) {
    const existing = JSON.parse(fs.readFileSync(input.freezePath, "utf8")) as Record<string, unknown>;
    if (stableJson(existing) !== canonical) throw new Error("GPT-PROFIT-003-R1 candidate freeze mismatch; refusing to overwrite existing freeze");
    const sha256 = hashR1File(input.freezePath);
    if (fs.existsSync(input.hashPath)) {
      const sidecar = fs.readFileSync(input.hashPath, "utf8").trim().split(/\s+/)[0]?.toLowerCase();
      if (sidecar && sidecar !== sha256) throw new Error("GPT-PROFIT-003-R1 candidate freeze SHA256 mismatch; refusing to continue");
    } else {
      fs.writeFileSync(input.hashPath, `${sha256}  ${path.basename(input.freezePath)}\n`);
    }
    return { freeze: existing, sha256, created: false };
  }
  fs.writeFileSync(input.freezePath, `${JSON.stringify(input.definition, null, 2)}\n`);
  const sha256 = hashR1File(input.freezePath);
  fs.writeFileSync(input.hashPath, `${sha256}  ${path.basename(input.freezePath)}\n`);
  return { freeze: input.definition, sha256, created: true };
}

export function assertR1FinalUnseenCanExecute(input: {
  freezeExists: boolean;
  freezeHashValid: boolean;
  internalGatePassed: boolean;
  selectedCandidateId: string | null;
  frozenCandidateIds: string[];
  markerPath: string;
}): void {
  if (fs.existsSync(input.markerPath)) throw new Error("R1 Final Unseen execution marker exists; refusing a second execution");
  if (!input.freezeExists || !input.freezeHashValid) throw new Error("R1 Final Unseen requires a valid candidate freeze");
  if (!input.internalGatePassed) throw new Error("R1 Final Unseen requires Internal OOS Gate PASS");
  if (!input.selectedCandidateId || !input.frozenCandidateIds.includes(input.selectedCandidateId)) {
    throw new Error("R1 Final Unseen candidate is not from the frozen candidate set");
  }
}

export function hashR1File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function bucketIndex(value: number, edges: number[]): number {
  let index = 0;
  while (index < edges.length && value >= edges[index]) index += 1;
  return index;
}

function quantileEdges(values: number[], bins: number): number[] {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length || bins < 2) return [];
  return [...new Set(Array.from({ length: bins - 1 }, (_, index) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (index + 1) / bins))]))];
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }
function average(values: number[]): number { return values.length ? sum(values) / values.length : 0; }
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}
function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, value)); }
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
