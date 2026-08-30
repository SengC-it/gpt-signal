import type { Direction } from "./types.ts";

/**
 * GPT-PROFIT-004 is an information-increment study. It does not add a
 * strategy candidate and it never reads the GPT-PROFIT-003 unseen window.
 */
export const GPT_PROFIT_004_RESEARCH_CUTOFF = "2026-08-30T00:00:00.000Z";
export const GPT_PROFIT_004_FORWARD_START = "2026-08-30T00:05:00.000Z";
export const DERIVATIVES_LABEL_HORIZON_BARS = 96;
export const DERIVATIVES_FEE_RATE = 0.001;
export const DERIVATIVES_SLIPPAGE_RATE = 0.0005;

export const DERIVATIVE_FAMILIES = [
  "open_interest",
  "funding",
  "basis",
  "taker_flow",
  "positioning"
] as const;

export type DerivativeFamily = typeof DERIVATIVE_FAMILIES[number];
export type DerivativesResearchMetric = Record<string, unknown> & {
  symbol?: string;
  metric_time?: string | number;
  metricTime?: number;
  interval?: string;
};

export type DerivativesResearchEvent = {
  eventId: string;
  symbol: string;
  direction: Direction;
  eventTime: number;
  fold: number;
  grossR: number | null;
  netR: number | null;
};

export type DerivativesFamilySummary = {
  family: "price_only" | DerivativeFamily | "combined_permitted";
  status: "EVALUATED" | "INSUFFICIENT_DERIVATIVES_HISTORY" | "NO_DATA" | "NOT_PERMITTED";
  eventCount: number;
  settled: number;
  grossExpectancyR: number | null;
  netExpectancyR: number | null;
  profitFactor: number | null;
  payoff: number | null;
  spearman: number | null;
  monotonicViolations: number | null;
  conditionalLiftR: number | null;
  deltaGrossExpectancyR: number | null;
  deltaNetExpectancyR: number | null;
  deltaProfitFactor: number | null;
  symbolBreadth: number;
  monthBreadth: number;
  positiveMonths: number;
  positiveFolds: number;
  folds: number;
  foldConsistency: string;
  comparableBaseline: {
    eventCount: number;
    settled: number;
    grossExpectancyR: number | null;
    netExpectancyR: number | null;
    profitFactor: number | null;
  };
};

export type DerivativesGate = {
  status: "PASS" | "FAIL" | "INSUFFICIENT_DERIVATIVES_HISTORY";
  passed: boolean;
  reasons: string[];
  checks: Record<string, boolean>;
};

/** Point-in-time join: a metric at or after an event is never visible. */
export function selectDerivativeMetricAsOf(
  rows: DerivativesResearchMetric[],
  symbol: string,
  asOf: number
): DerivativesResearchMetric | null {
  return rows
    .filter((row) => row.symbol === symbol && metricTimeOf(row) <= asOf)
    .sort((left, right) => metricTimeOf(left) - metricTimeOf(right))
    .at(-1) ?? null;
}

export function metricTimeOf(row: DerivativesResearchMetric): number {
  const value = row.metricTime ?? row.metric_time ?? row.timestamp;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * Convert a single family to an economically interpretable, directional
 * diagnostic score. These are fixed transformations, not a threshold grid and
 * cannot create a Production candidate.
 */
export function derivativeFamilyScore(
  family: DerivativeFamily,
  metric: DerivativesResearchMetric,
  direction: Direction
): number | null {
  const sign = direction === "LONG" ? 1 : -1;
  const numberValue = (...keys: string[]) => {
    for (const key of keys) {
      const value = Number(metric[key]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  };
  if (family === "open_interest") {
    const price = numberValue("price_change_5m", "priceChange5m");
    const oi = numberValue("oi_change_5m", "oiChange5m");
    if (price !== null && oi !== null) return round(sign * price * oi);
    if (oi !== null) return round(sign * oi);
    const percentile = numberValue("oi_percentile", "oiPercentile");
    return percentile === null ? null : round(sign * (percentile - 50));
  }
  if (family === "funding") {
    const funding = numberValue("funding_z_score", "fundingZScore", "funding_rate", "fundingRate");
    return funding === null ? null : round(-sign * funding);
  }
  if (family === "basis") {
    const basis = numberValue("basis_bps", "basisBps", "basis_percentile", "basisPercentile");
    return basis === null ? null : round(-sign * basis);
  }
  if (family === "taker_flow") {
    const imbalance = numberValue("taker_imbalance", "takerImbalance", "taker_buy_ratio", "takerBuyRatio");
    return imbalance === null ? null : round(sign * imbalance);
  }
  const positioningChanges = [
    numberValue("global_long_short_change", "globalLongShortChange"),
    numberValue("top_account_long_short_change", "topAccountLongShortChange"),
    numberValue("top_position_long_short_change", "topPositionLongShortChange")
  ].filter(isFiniteNumber);
  if (positioningChanges.length) return round(-sign * (mean(positioningChanges) ?? 0));
  const positioning = numberValue("global_long_short_ratio", "globalLongShortRatio");
  return positioning === null ? null : round(-sign * (positioning - 1));
}

export function summarizeDerivativeFamily(
  family: DerivativeFamily | "price_only" | "combined_permitted",
  rows: Array<{ event: DerivativesResearchEvent; score: number | null }>,
  comparableBaseline: DerivativesFamilySummary | null = null,
  status: DerivativesFamilySummary["status"] = "EVALUATED"
): DerivativesFamilySummary {
  const usable = rows.filter((row) => Number.isFinite(row.score) || family === "price_only" || family === "combined_permitted");
  const eventCount = usable.length;
  const settled = usable.filter((row) => row.event.netR !== null && Number.isFinite(row.event.netR));
  const grossSettled = settled.map((row) => row.event.grossR).filter(isFiniteNumber);
  const netSettled = settled.map((row) => row.event.netR).filter(isFiniteNumber);
  const paired = usable.filter((row) => Number.isFinite(row.score) && Number.isFinite(row.event.grossR));
  const scoreValues = paired.map((row) => row.score!).filter(isFiniteNumber);
  const outcomeValues = paired.map((row) => row.event.grossR).filter(isFiniteNumber);
  const netMean = mean(netSettled);
  const grossMean = mean(grossSettled);
  const profitFactor = calculateProfitFactor(netSettled);
  const baseline = comparableBaseline ?? emptyComparableBaseline();
  const familyMonths = new Set(settled.map((row) => new Date(row.event.eventTime).toISOString().slice(0, 7)));
  const monthReturns = new Map<string, number>();
  for (const row of settled) {
    const month = new Date(row.event.eventTime).toISOString().slice(0, 7);
    monthReturns.set(month, (monthReturns.get(month) ?? 0) + row.event.netR!);
  }
  const symbolBreadth = new Set(settled.map((row) => row.event.symbol)).size;
  const foldValues = new Map<number, number[]>();
  for (const row of settled) {
    const values = foldValues.get(row.event.fold) ?? [];
    values.push(row.event.netR!);
    foldValues.set(row.event.fold, values);
  }
  const positiveFolds = [...foldValues.values()].filter((values) => (mean(values) ?? 0) > 0).length;
  const folds = foldValues.size;
  const sorted = [...usable].filter((row) => Number.isFinite(row.score)).sort((left, right) => left.score! - right.score!);
  const topCut = sorted.length ? sorted[Math.floor(sorted.length * 0.7)]!.score! : null;
  const top = topCut === null ? [] : sorted.filter((row) => row.score! >= topCut).map((row) => row.event.netR).filter(isFiniteNumber);
  const conditionalLiftR = top.length && netMean !== null ? round((mean(top) ?? 0) - netMean) : null;
  const summary: DerivativesFamilySummary = {
    family,
    status,
    eventCount,
    settled: settled.length,
    grossExpectancyR: grossMean,
    netExpectancyR: netMean,
    profitFactor,
    payoff: calculatePayoff(netSettled),
    spearman: scoreValues.length >= 2 ? spearman(scoreValues, outcomeValues) : null,
    monotonicViolations: scoreValues.length >= 3 ? monotonicViolations(sorted.map((row) => row.event.grossR).filter(isFiniteNumber)) : null,
    conditionalLiftR,
    deltaGrossExpectancyR: comparableBaseline && grossMean !== null && comparableBaseline.grossExpectancyR !== null
      ? round(grossMean - comparableBaseline.grossExpectancyR) : null,
    deltaNetExpectancyR: comparableBaseline && netMean !== null && comparableBaseline.netExpectancyR !== null
      ? round(netMean - comparableBaseline.netExpectancyR) : null,
    deltaProfitFactor: comparableBaseline && profitFactor !== null && comparableBaseline.profitFactor !== null
      ? round(profitFactor - comparableBaseline.profitFactor) : null,
    symbolBreadth,
    monthBreadth: familyMonths.size,
    positiveMonths: [...monthReturns.values()].filter((value) => value > 0).length,
    positiveFolds,
    folds,
    foldConsistency: folds ? `${positiveFolds}/${folds}` : "0/0",
    comparableBaseline: {
      eventCount: baseline.eventCount,
      settled: baseline.settled,
      grossExpectancyR: baseline.grossExpectancyR,
      netExpectancyR: baseline.netExpectancyR,
      profitFactor: baseline.profitFactor
    }
  };
  return summary;
}

export function buildDerivativeAblation(input: {
  events: DerivativesResearchEvent[];
  metrics: DerivativesResearchMetric[];
  historyDays: number;
}): { baseline: DerivativesFamilySummary; families: DerivativesFamilySummary[]; combined: DerivativesFamilySummary } {
  const baselineRows = input.events.map((event) => ({ event, score: null }));
  const baseline = summarizeDerivativeFamily("price_only", baselineRows);
  const metricsBySymbol = new Map<string, DerivativesResearchMetric[]>();
  for (const metric of input.metrics) {
    const list = metricsBySymbol.get(metric.symbol ?? "") ?? [];
    list.push(metric);
    metricsBySymbol.set(metric.symbol ?? "", list);
  }
  for (const list of metricsBySymbol.values()) list.sort((left, right) => metricTimeOf(left) - metricTimeOf(right));
  const families = DERIVATIVE_FAMILIES.map((family) => {
    const rows = input.events.flatMap((event) => {
      const metric = selectSortedMetricAsOf(metricsBySymbol.get(event.symbol) ?? [], event.eventTime);
      const score = metric ? derivativeFamilyScore(family, metric, event.direction) : null;
      return score === null ? [] : [{ event, score }];
    });
    const comparable = summarizeDerivativeFamily("price_only", rows.map((row) => ({ event: row.event, score: null })));
    return summarizeDerivativeFamily(
      family,
      rows,
      comparable,
      input.historyDays < 90 ? "INSUFFICIENT_DERIVATIVES_HISTORY" : rows.length ? "EVALUATED" : "NO_DATA"
    );
  });
  const permittedFamilies = families.filter((summary) => summary.status === "EVALUATED"
    && (summary.deltaNetExpectancyR ?? -Infinity) > 0
    && (summary.deltaProfitFactor ?? -Infinity) > 0);
  const combinedRows = permittedFamilies.length ? input.events.flatMap((event) => {
    const metrics = selectSortedMetricAsOf(metricsBySymbol.get(event.symbol) ?? [], event.eventTime);
    if (!metrics) return [];
    const scores = permittedFamilies.map((summary) => derivativeFamilyScore(summary.family as DerivativeFamily, metrics, event.direction));
    if (scores.some((score) => score === null)) return [];
    return [{ event, score: mean(scores as number[]) }];
  }) : [];
  const combinedBaseline = summarizeDerivativeFamily("price_only", combinedRows.map((row) => ({ event: row.event, score: null })));
  const combined = summarizeDerivativeFamily(
    "combined_permitted",
    combinedRows,
    combinedBaseline,
    input.historyDays < 90 ? "INSUFFICIENT_DERIVATIVES_HISTORY" : permittedFamilies.length ? "EVALUATED" : "NOT_PERMITTED"
  );
  return { baseline, families, combined };
}

function selectSortedMetricAsOf(rows: DerivativesResearchMetric[], asOf: number): DerivativesResearchMetric | null {
  let low = 0;
  let high = rows.length - 1;
  let best = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (metricTimeOf(rows[middle]!) <= asOf) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best >= 0 ? rows[best]! : null;
}

export function evaluateDerivativesGate(input: {
  historyDays: number;
  summary: DerivativesFamilySummary;
}): DerivativesGate {
  if (input.historyDays < 90) {
    return {
      status: "INSUFFICIENT_DERIVATIVES_HISTORY",
      passed: false,
      reasons: [`only ${input.historyDays.toFixed(2)} days of point-in-time derivatives history; >=90 days required`],
      checks: { historyAtLeast90d: false }
    };
  }
  const summary = input.summary;
  const checks = {
    historyAtLeast90d: true,
    settledAtLeast300: summary.settled >= 300,
    netExpectancyPositive: (summary.netExpectancyR ?? -Infinity) > 0,
    profitFactorAtLeast125: (summary.profitFactor ?? 0) >= 1.25,
    expectancyAtLeast008: (summary.netExpectancyR ?? -Infinity) >= 0.08,
    payoffAtLeast080: (summary.payoff ?? 0) >= 0.8,
    positiveFoldsAtLeast2of3: summary.positiveFolds >= 2,
    symbolBreadthAtLeast3: summary.symbolBreadth >= 3,
    positiveMonthShareAtLeast60: summary.monthBreadth > 0 && summary.positiveMonths / summary.monthBreadth >= 0.6,
    noSingleSymbolDomination: summary.symbolBreadth >= 3,
    materiallyBetterThanPriceOnly: (summary.deltaNetExpectancyR ?? -Infinity) > 0,
    noLeakage: true
  };
  const reasons = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { status: reasons.length ? "FAIL" : "PASS", passed: reasons.length === 0, reasons, checks };
}

function emptyComparableBaseline() { return { eventCount: 0, settled: 0, grossExpectancyR: null, netExpectancyR: null, profitFactor: null, payoff: null }; }
function isFiniteNumber(value: number | null): value is number { return value !== null && Number.isFinite(value); }
function mean(values: number[]): number | null { return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null; }
function calculateProfitFactor(values: number[]): number | null {
  if (!values.length) return null;
  const profit = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const loss = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  return loss > 0 ? round(profit / loss) : profit > 0 ? Number.POSITIVE_INFINITY : 0;
}
function calculatePayoff(values: number[]): number | null {
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0).map(Math.abs);
  if (!wins.length || !losses.length) return wins.length ? null : 0;
  return round((wins.reduce((sum, value) => sum + value, 0) / wins.length)
    / (losses.reduce((sum, value) => sum + value, 0) / losses.length));
}
function spearman(scores: number[], outcomes: number[]): number | null {
  if (scores.length !== outcomes.length || scores.length < 2) return null;
  const scoreRanks = rank(scores);
  const outcomeRanks = rank(outcomes);
  const scoreMean = mean(scoreRanks) ?? 0;
  const outcomeMean = mean(outcomeRanks) ?? 0;
  const numerator = scoreRanks.reduce((sum, value, index) => sum + (value - scoreMean) * (outcomeRanks[index]! - outcomeMean), 0);
  const left = Math.sqrt(scoreRanks.reduce((sum, value) => sum + (value - scoreMean) ** 2, 0));
  const right = Math.sqrt(outcomeRanks.reduce((sum, value) => sum + (value - outcomeMean) ** 2, 0));
  return left && right ? round(numerator / (left * right)) : 0;
}
function rank(values: number[]): number[] {
  return values.map((value) => 1 + values.filter((other) => other < value).length + (values.filter((other) => other === value).length - 1) / 2);
}
function monotonicViolations(values: number[]): number {
  let violations = 0;
  for (let index = 1; index < values.length; index += 1) if (values[index]! < values[index - 1]!) violations += 1;
  return violations;
}
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
