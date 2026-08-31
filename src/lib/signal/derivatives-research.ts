import type { Direction } from "./types.ts";
import {
  DERIVATIVES_FAMILY_FRESHNESS_TOLERANCE_MS
} from "../binance/derivatives.ts";

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
  available_at?: string | number;
  availableAt?: string | number;
  family_timing?: Record<string, Record<string, unknown>>;
  familyTiming?: Record<string, Record<string, unknown>>;
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

export type DerivativesMonotonicBucket = {
  bucket: number;
  count: number;
  grossExpectancyR: number | null;
  netExpectancyR: number | null;
};

export const DERIVATIVES_MONOTONIC_BUCKET_COUNT = 10;

export type DerivativesFamilySummary = {
  family: "price_only" | DerivativeFamily | "combined_permitted";
  status: "EVALUATED" | "INSUFFICIENT_DERIVATIVES_HISTORY" | "NO_DATA" | "NOT_PERMITTED";
  eventCount: number;
  settled: number;
  grossExpectancyR: number | null;
  netExpectancyR: number | null;
  profitFactor: number | null;
  payoff: number | null;
  conditionedEventCount: number;
  conditionedSettled: number;
  conditionedGrossExpectancyR: number | null;
  conditionedNetExpectancyR: number | null;
  conditionedProfitFactor: number | null;
  conditionedPayoff: number | null;
  conditionedScoreThreshold: number | null;
  conditionedSymbolBreadth: number;
  conditionedMonthBreadth: number;
  conditionedPositiveMonths: number;
  conditionedPositiveFolds: number;
  conditionedFolds: number;
  conditionedFoldConsistency: string;
  conditionedNetRBySymbol: Record<string, number>;
  conditionedLargestSymbolAbsoluteContributionShare: number | null;
  conditionedLargestSymbolPositiveContributionShare: number | null;
  spearman: number | null;
  monotonicBucketCount: number;
  monotonicValidBucketCount: number;
  monotonicViolations: number | null;
  monotonicBuckets: DerivativesMonotonicBucket[];
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
  coverageDays: number | null;
  missingExcludedCount: number;
  staleExcludedCount: number;
  netRBySymbol: Record<string, number>;
  largestSymbolAbsoluteContributionShare: number | null;
  largestSymbolPositiveContributionShare: number | null;
  comparableBaseline: {
    eventCount: number;
    settled: number;
    grossExpectancyR: number | null;
    netExpectancyR: number | null;
    profitFactor: number | null;
  };
};

export type DerivativesGate = {
  status: "PASS" | "FAIL" | "INSUFFICIENT_DERIVATIVES_HISTORY" | "READY_FOR_NESTED_DERIVATIVES_RESEARCH";
  passed: boolean;
  reasons: string[];
  checks: Record<string, boolean>;
  evidenceStatus: "PRELIMINARY_INCREMENTAL_EVIDENCE" | "NO_PRELIMINARY_INCREMENTAL_EVIDENCE" | "INSUFFICIENT_DERIVATIVES_HISTORY";
  validationRequired: "PURGED_NESTED_OOS";
};

/** Point-in-time join: an observation is visible only after its source-specific availability boundary. */
export function selectDerivativeMetricAsOf(
  rows: DerivativesResearchMetric[],
  symbol: string,
  asOf: number
): DerivativesResearchMetric | null {
  return rows
    .filter((row) => row.symbol === symbol && availabilityTimeOf(row) <= asOf)
    .sort((left, right) => availabilityTimeOf(left) - availabilityTimeOf(right))
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

export function availabilityTimeOf(row: DerivativesResearchMetric): number {
  const value = row.availableAt ?? row.available_at;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return metricTimeOf(row);
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
      const raw = metric[key];
      if (raw === null || raw === undefined || raw === "") continue;
      const value = Number(raw);
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
  status: DerivativesFamilySummary["status"] = "EVALUATED",
  diagnostics: {
    coverageDays?: number | null;
    missingExcludedCount?: number;
    staleExcludedCount?: number;
  } = {}
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
  const netRBySymbol: Record<string, number> = {};
  for (const row of settled) netRBySymbol[row.event.symbol] = round((netRBySymbol[row.event.symbol] ?? 0) + row.event.netR!);
  const absoluteContributionTotal = Object.values(netRBySymbol).reduce((sum, value) => sum + Math.abs(value), 0);
  const positiveContributionTotal = Object.values(netRBySymbol).reduce((sum, value) => sum + Math.max(value, 0), 0);
  const largestSymbolAbsoluteContributionShare = absoluteContributionTotal > 0
    ? round(Math.max(...Object.values(netRBySymbol).map((value) => Math.abs(value))) / absoluteContributionTotal)
    : null;
  const largestSymbolPositiveContributionShare = positiveContributionTotal > 0
    ? round(Math.max(...Object.values(netRBySymbol).map((value) => Math.max(value, 0))) / positiveContributionTotal)
    : null;
  const sorted = [...usable].filter((row) => Number.isFinite(row.score)).sort((left, right) => left.score! - right.score!);
  const topCut = sorted.length ? sorted[Math.floor(sorted.length * 0.7)]!.score! : null;
  const conditionedRows = topCut === null ? [] : sorted.filter((row) => row.score! >= topCut);
  const conditionedSettledRows = conditionedRows.filter((row) => row.event.netR !== null && Number.isFinite(row.event.netR));
  const conditionedGross = conditionedSettledRows.map((row) => row.event.grossR).filter(isFiniteNumber);
  const conditionedNet = conditionedSettledRows.map((row) => row.event.netR).filter(isFiniteNumber);
  const conditionedGrossMean = mean(conditionedGross);
  const conditionedNetMean = mean(conditionedNet);
  const conditionedProfitFactor = calculateProfitFactor(conditionedNet);
  const conditionalLiftR = conditionedNetMean !== null && netMean !== null ? round(conditionedNetMean - netMean) : null;
  const conditionedMonths = new Set(conditionedSettledRows.map((row) => new Date(row.event.eventTime).toISOString().slice(0, 7)));
  const conditionedMonthReturns = new Map<string, number>();
  for (const row of conditionedSettledRows) {
    const month = new Date(row.event.eventTime).toISOString().slice(0, 7);
    conditionedMonthReturns.set(month, (conditionedMonthReturns.get(month) ?? 0) + row.event.netR!);
  }
  const conditionedFoldValues = new Map<number, number[]>();
  for (const row of conditionedSettledRows) {
    const values = conditionedFoldValues.get(row.event.fold) ?? [];
    values.push(row.event.netR!);
    conditionedFoldValues.set(row.event.fold, values);
  }
  const conditionedPositiveFolds = [...conditionedFoldValues.values()].filter((values) => (mean(values) ?? 0) > 0).length;
  const conditionedFolds = conditionedFoldValues.size;
  const conditionedNetRBySymbol: Record<string, number> = {};
  for (const row of conditionedSettledRows) {
    conditionedNetRBySymbol[row.event.symbol] = round((conditionedNetRBySymbol[row.event.symbol] ?? 0) + row.event.netR!);
  }
  const conditionedAbsoluteContributionTotal = Object.values(conditionedNetRBySymbol).reduce((sum, value) => sum + Math.abs(value), 0);
  const conditionedPositiveContributionTotal = Object.values(conditionedNetRBySymbol).reduce((sum, value) => sum + Math.max(value, 0), 0);
  const conditionedLargestSymbolAbsoluteContributionShare = conditionedAbsoluteContributionTotal > 0
    ? round(Math.max(...Object.values(conditionedNetRBySymbol).map((value) => Math.abs(value))) / conditionedAbsoluteContributionTotal)
    : null;
  const conditionedLargestSymbolPositiveContributionShare = conditionedPositiveContributionTotal > 0
    ? round(Math.max(...Object.values(conditionedNetRBySymbol).map((value) => Math.max(value, 0))) / conditionedPositiveContributionTotal)
    : null;
  const monotonic = buildMonotonicDeciles(sorted);
  const summary: DerivativesFamilySummary = {
    family,
    status,
    eventCount,
    settled: settled.length,
    grossExpectancyR: grossMean,
    netExpectancyR: netMean,
    profitFactor,
    payoff: calculatePayoff(netSettled),
    conditionedEventCount: conditionedRows.length,
    conditionedSettled: conditionedSettledRows.length,
    conditionedGrossExpectancyR: conditionedGrossMean,
    conditionedNetExpectancyR: conditionedNetMean,
    conditionedProfitFactor,
    conditionedPayoff: calculatePayoff(conditionedNet),
    conditionedScoreThreshold: topCut,
    conditionedSymbolBreadth: new Set(conditionedSettledRows.map((row) => row.event.symbol)).size,
    conditionedMonthBreadth: conditionedMonths.size,
    conditionedPositiveMonths: [...conditionedMonthReturns.values()].filter((value) => value > 0).length,
    conditionedPositiveFolds,
    conditionedFolds,
    conditionedFoldConsistency: conditionedFolds ? `${conditionedPositiveFolds}/${conditionedFolds}` : "0/0",
    conditionedNetRBySymbol,
    conditionedLargestSymbolAbsoluteContributionShare,
    conditionedLargestSymbolPositiveContributionShare,
    spearman: scoreValues.length >= 2 ? spearman(scoreValues, outcomeValues) : null,
    monotonicBucketCount: monotonic.bucketCount,
    monotonicValidBucketCount: monotonic.validBucketCount,
    monotonicViolations: monotonic.violations,
    monotonicBuckets: monotonic.buckets,
    conditionalLiftR,
    deltaGrossExpectancyR: comparableBaseline
      ? difference(conditionedGrossMean, comparableBaseline.grossExpectancyR) : null,
    deltaNetExpectancyR: comparableBaseline
      ? difference(conditionedNetMean, comparableBaseline.netExpectancyR) : null,
    deltaProfitFactor: comparableBaseline
      ? difference(conditionedProfitFactor, comparableBaseline.profitFactor) : null,
    symbolBreadth,
    monthBreadth: familyMonths.size,
    positiveMonths: [...monthReturns.values()].filter((value) => value > 0).length,
    positiveFolds,
    folds,
    foldConsistency: folds ? `${positiveFolds}/${folds}` : "0/0",
    coverageDays: diagnostics.coverageDays ?? null,
    missingExcludedCount: diagnostics.missingExcludedCount ?? 0,
    staleExcludedCount: diagnostics.staleExcludedCount ?? 0,
    netRBySymbol,
    largestSymbolAbsoluteContributionShare,
    largestSymbolPositiveContributionShare,
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
  historyDays?: number;
  familyCoverageDays?: Partial<Record<DerivativeFamily, number>>;
}): { baseline: DerivativesFamilySummary; families: DerivativesFamilySummary[]; combined: DerivativesFamilySummary } {
  const baselineRows = input.events.map((event) => ({ event, score: null }));
  const baseline = summarizeDerivativeFamily("price_only", baselineRows);
  const metricsBySymbol = new Map<string, DerivativesResearchMetric[]>();
  for (const metric of input.metrics) {
    const list = metricsBySymbol.get(metric.symbol ?? "") ?? [];
    list.push(metric);
    metricsBySymbol.set(metric.symbol ?? "", list);
  }
  for (const list of metricsBySymbol.values()) list.sort((left, right) => availabilityTimeOf(left) - availabilityTimeOf(right));
  const families = DERIVATIVE_FAMILIES.map((family) => {
    let missingExcludedCount = 0;
    let staleExcludedCount = 0;
    const rows = input.events.flatMap((event) => {
      const candidates = (metricsBySymbol.get(event.symbol) ?? []).filter((metric) => hasFamilyValue(metric, family));
      const metric = selectSortedMetricAsOf(candidates, event.eventTime, family);
      if (!metric) {
        missingExcludedCount += 1;
        return [];
      }
      if (!isFreshFamilyMetric(metric, family, event.eventTime)) {
        staleExcludedCount += 1;
        return [];
      }
      const score = derivativeFamilyScore(family, metric, event.direction);
      if (score === null) {
        missingExcludedCount += 1;
        return [];
      }
      return [{ event, score }];
    });
    const comparable = summarizeDerivativeFamily("price_only", rows.map((row) => ({ event: row.event, score: null })));
    const coverageDays = input.familyCoverageDays?.[family] ?? input.historyDays ?? null;
    const status = coverageDays !== null && coverageDays < 90
      ? "INSUFFICIENT_DERIVATIVES_HISTORY"
      : rows.length ? "EVALUATED" : "NO_DATA";
    return summarizeDerivativeFamily(
      family,
      rows,
      comparable,
      status,
      { coverageDays, missingExcludedCount, staleExcludedCount }
    );
  });
  const permittedFamilies = families.filter((summary) => summary.status === "EVALUATED"
    && ((summary.deltaGrossExpectancyR ?? -Infinity) > 0 || (summary.spearman ?? -Infinity) > 0)
    && (summary.deltaNetExpectancyR ?? -Infinity) > 0
    && (summary.deltaProfitFactor ?? -Infinity) > 0
    && summary.conditionedPositiveFolds >= 2
    && summary.conditionedFolds >= 3
    && summary.conditionedSettled >= 300
    && summary.conditionedSymbolBreadth >= 3);
  const combinedRows = permittedFamilies.length ? input.events.flatMap((event) => {
    const metricsByFamily = permittedFamilies.map((summary) => {
      const family = summary.family as DerivativeFamily;
      const candidates = (metricsBySymbol.get(event.symbol) ?? []).filter((metric) => hasFamilyValue(metric, family));
      const metric = selectSortedMetricAsOf(candidates, event.eventTime, family);
      return metric && isFreshFamilyMetric(metric, family, event.eventTime)
        ? derivativeFamilyScore(family, metric, event.direction)
        : null;
    });
    const scores = metricsByFamily;
    if (scores.some((score) => score === null)) return [];
    return [{ event, score: mean(scores as number[]) }];
  }) : [];
  const combinedBaseline = summarizeDerivativeFamily("price_only", combinedRows.map((row) => ({ event: row.event, score: null })));
  const combinedCoverageDays = permittedFamilies.length
    ? derivativesIntersectionCoverageDays(permittedFamilies.map((summary) => summary.coverageDays))
    : null;
  const combined = summarizeDerivativeFamily(
    "combined_permitted",
    combinedRows,
    combinedBaseline,
    combinedCoverageDays !== null && combinedCoverageDays < 90
      ? "INSUFFICIENT_DERIVATIVES_HISTORY"
      : permittedFamilies.length ? "EVALUATED" : "NOT_PERMITTED",
    { coverageDays: combinedCoverageDays }
  );
  return { baseline, families, combined };
}

/** Return the time intersection available to the selected families only. */
export function derivativesIntersectionCoverageDays(coverageDays: Array<number | null | undefined>): number | null {
  const valid = coverageDays.filter((days): days is number => days !== null && days !== undefined && Number.isFinite(days) && days >= 0);
  return valid.length ? Math.min(...valid) : null;
}

function selectSortedMetricAsOf(rows: DerivativesResearchMetric[], asOf: number, family?: DerivativeFamily): DerivativesResearchMetric | null {
  const availability = (row: DerivativesResearchMetric) => family ? familyAvailabilityTimeOf(row, family) : availabilityTimeOf(row);
  let low = 0;
  let high = rows.length - 1;
  let best = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (availability(rows[middle]!) <= asOf) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best >= 0 ? rows[best]! : null;
}

function familyAvailabilityTimeOf(row: DerivativesResearchMetric, family: DerivativeFamily) {
  const timing = row.familyTiming?.[family] ?? row.family_timing?.[family];
  const raw = timing?.availableAt ?? timing?.available_at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return availabilityTimeOf(row);
}

function hasFamilyValue(metric: DerivativesResearchMetric, family: DerivativeFamily) {
  const keys: Record<DerivativeFamily, string[]> = {
    open_interest: ["open_interest", "open_interest_value", "oi_change_5m", "oi_percentile", "oiChange5m", "oiPercentile"],
    funding: ["funding_rate", "funding_z_score", "last_settled_funding", "fundingRate", "fundingZScore"],
    basis: ["basis_bps", "basis_rate", "basis_percentile", "basisBps", "basisPercentile"],
    taker_flow: ["taker_imbalance", "taker_buy_ratio", "takerImbalance", "takerBuyRatio"],
    positioning: ["global_long_short_change", "top_account_long_short_change", "top_position_long_short_change", "global_long_short_ratio", "globalLongShortRatio"]
  };
  return keys[family].some((key) => {
    const raw = metric[key];
    return raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw));
  });
}

function isFreshFamilyMetric(metric: DerivativesResearchMetric, family: DerivativeFamily, decisionTime: number) {
  const timing = metric.familyTiming?.[family] ?? metric.family_timing?.[family];
  const rawAvailable = timing?.availableAt ?? timing?.available_at ?? metric.availableAt ?? metric.available_at;
  const availableAt = typeof rawAvailable === "number" ? rawAvailable : typeof rawAvailable === "string" ? Date.parse(rawAvailable) : metricTimeOf(metric);
  if (!Number.isFinite(availableAt) || availableAt > decisionTime) return false;
  return decisionTime - availableAt <= DERIVATIVES_FAMILY_FRESHNESS_TOLERANCE_MS[family];
}

export function evaluateDerivativesGate(input: {
  historyDays: number;
  summary: DerivativesFamilySummary;
  validation?: "PRELIMINARY_ONLY" | "PURGED_NESTED_OOS";
}): DerivativesGate {
  if (input.historyDays < 90) {
    return {
      status: "INSUFFICIENT_DERIVATIVES_HISTORY",
      passed: false,
      reasons: [`only ${input.historyDays.toFixed(2)} days of point-in-time derivatives history; >=90 days required`],
      checks: { historyAtLeast90d: false, nestedValidationCompleted: false },
      evidenceStatus: "INSUFFICIENT_DERIVATIVES_HISTORY",
      validationRequired: "PURGED_NESTED_OOS"
    };
  }
  const summary = input.summary;
  const validation = input.validation ?? "PRELIMINARY_ONLY";
  const checks = {
    historyAtLeast90d: true,
    settledAtLeast300: summary.conditionedSettled >= 300,
    netExpectancyPositive: (summary.conditionedNetExpectancyR ?? -Infinity) > 0,
    profitFactorAtLeast125: (summary.conditionedProfitFactor ?? 0) >= 1.25,
    expectancyAtLeast008: (summary.conditionedNetExpectancyR ?? -Infinity) >= 0.08,
    payoffAtLeast080: (summary.conditionedPayoff ?? 0) >= 0.8,
    positiveFoldsAtLeast2of3: summary.conditionedPositiveFolds >= 2,
    symbolBreadthAtLeast3: summary.conditionedSymbolBreadth >= 3,
    positiveMonthShareAtLeast60: summary.conditionedMonthBreadth > 0 && summary.conditionedPositiveMonths / summary.conditionedMonthBreadth >= 0.6,
    largestSymbolAbsoluteContributionAtMost50: summary.conditionedLargestSymbolAbsoluteContributionShare !== null
      && summary.conditionedLargestSymbolAbsoluteContributionShare <= 0.5,
    largestSymbolPositiveContributionAtMost50: summary.conditionedLargestSymbolPositiveContributionShare !== null
      && summary.conditionedLargestSymbolPositiveContributionShare <= 0.5,
    noSingleSymbolDomination: summary.conditionedLargestSymbolAbsoluteContributionShare !== null
      && summary.conditionedLargestSymbolAbsoluteContributionShare <= 0.5,
    materiallyBetterThanPriceOnly: (summary.deltaNetExpectancyR ?? -Infinity) > 0,
    noLeakage: true,
    nestedValidationCompleted: validation === "PURGED_NESTED_OOS"
  };
  const preliminaryEvidence = (summary.conditionedNetExpectancyR ?? -Infinity) > 0
    && (summary.deltaNetExpectancyR ?? -Infinity) > 0
    && (summary.deltaProfitFactor ?? -Infinity) > 0
    && ((summary.deltaGrossExpectancyR ?? -Infinity) > 0 || (summary.spearman ?? -Infinity) > 0);
  const evidenceStatus = preliminaryEvidence ? "PRELIMINARY_INCREMENTAL_EVIDENCE" : "NO_PRELIMINARY_INCREMENTAL_EVIDENCE";
  if (validation !== "PURGED_NESTED_OOS") {
    return {
      status: preliminaryEvidence ? "READY_FOR_NESTED_DERIVATIVES_RESEARCH" : "FAIL",
      passed: false,
      reasons: preliminaryEvidence
        ? ["preliminary conditional evidence requires purged nested OOS before a robust Gate decision"]
        : ["no preliminary incremental evidence", "robust Gate requires purged nested OOS"],
      checks,
      evidenceStatus,
      validationRequired: "PURGED_NESTED_OOS"
    };
  }
  const reasons = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { status: reasons.length ? "FAIL" : "PASS", passed: reasons.length === 0, reasons, checks, evidenceStatus, validationRequired: "PURGED_NESTED_OOS" };
}

function emptyComparableBaseline() { return { eventCount: 0, settled: 0, grossExpectancyR: null, netExpectancyR: null, profitFactor: null, payoff: null }; }
function difference(value: number | null, baseline: number | null): number | null {
  if (value === null || baseline === null || Number.isNaN(value) || Number.isNaN(baseline)) return null;
  if (value === baseline) return 0;
  const delta = value - baseline;
  return Number.isFinite(delta) ? round(delta) : delta;
}
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
function buildMonotonicDeciles(rows: Array<{ event: DerivativesResearchEvent; score: number | null }>): {
  bucketCount: number;
  validBucketCount: number;
  violations: number | null;
  buckets: DerivativesMonotonicBucket[];
} {
  const buckets = Array.from({ length: DERIVATIVES_MONOTONIC_BUCKET_COUNT }, (_, bucket) => ({
    bucket,
    rows: [] as Array<{ event: DerivativesResearchEvent; score: number | null }>
  }));
  rows.forEach((row, index) => {
    const bucket = Math.min(
      DERIVATIVES_MONOTONIC_BUCKET_COUNT - 1,
      Math.floor(index * DERIVATIVES_MONOTONIC_BUCKET_COUNT / Math.max(rows.length, 1))
    );
    buckets[bucket]!.rows.push(row);
  });
  const summaries = buckets.map(({ bucket, rows: bucketRows }) => ({
    bucket,
    count: bucketRows.length,
    grossExpectancyR: mean(bucketRows.map((row) => row.event.grossR).filter(isFiniteNumber)),
    netExpectancyR: mean(bucketRows.map((row) => row.event.netR).filter(isFiniteNumber))
  }));
  const valid = summaries.filter((summary) => summary.grossExpectancyR !== null);
  let violations = 0;
  for (let index = 1; index < valid.length; index += 1) {
    if (valid[index]!.grossExpectancyR! < valid[index - 1]!.grossExpectancyR!) violations += 1;
  }
  return {
    bucketCount: DERIVATIVES_MONOTONIC_BUCKET_COUNT,
    validBucketCount: valid.length,
    violations: valid.length >= 2 ? violations : null,
    buckets: summaries
  };
}
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
