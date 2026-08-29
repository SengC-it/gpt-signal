import { isSettledReviewStatus, type ReviewFinalStatus } from "./review.ts";
import type { Direction } from "./types.ts";

export type ProfitabilityReview = {
  strategyVersion: string | null;
  signalType: string;
  symbol: string;
  direction: Direction;
  marketRegime: string;
  status: ReviewFinalStatus;
  signalSentAt: string;
  netR: number | null;
  netPnlPct: number | null;
  unrealizedNetPnlPct: number | null;
  currentR: number | null;
};

export type ProfitabilitySummary = {
  totalReviews: number;
  settled: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number;
  netR: number;
  netPnlPct: number;
  profitFactor: number;
  expectancyR: number;
  averageWinR: number;
  averageLossR: number;
  payoffRatio: number;
  breakevenWinRate: number;
  realizedMaxDrawdownPct: number;
  mtmMaxDrawdownPct: number;
  realizedBenchmarkEquity: number;
  signalBenchmarkEquity: number;
};

export type BreakdownKey = "strategyVersion" | "signalType" | "symbol" | "direction" | "marketRegime" | "month";

export function summarizeProfitability(reviews: ProfitabilityReview[]): ProfitabilitySummary {
  const ordered = [...reviews].sort((a, b) => timestamp(a.signalSentAt) - timestamp(b.signalSentAt));
  const settled = ordered.filter((review) => isSettledReviewStatus(review.status));
  const open = ordered.filter((review) => review.status === "open");
  const wins = settled.filter((review) => (review.netR ?? 0) > 0);
  const losses = settled.filter((review) => (review.netR ?? 0) < 0);
  const grossProfit = sum(wins.map((review) => review.netR ?? 0));
  const grossLoss = Math.abs(sum(losses.map((review) => review.netR ?? 0)));
  const netR = sum(settled.map((review) => review.netR ?? 0));
  const averageWinR = average(wins.map((review) => review.netR ?? 0));
  const averageLossR = average(losses.map((review) => Math.abs(review.netR ?? 0)));
  const payoffRatio = averageLossR > 0 ? averageWinR / averageLossR : (averageWinR > 0 ? Number.POSITIVE_INFINITY : 0);
  const realizedReturns = ordered.map((review) => isSettledReviewStatus(review.status) ? review.netPnlPct ?? 0 : 0);
  const mtmReturns = ordered.map((review) => review.status === "open"
    ? review.unrealizedNetPnlPct ?? 0
    : isSettledReviewStatus(review.status) ? review.netPnlPct ?? 0 : 0);
  const realizedCurve = compoundCurve(realizedReturns);
  const mtmCurve = compoundCurve(mtmReturns);

  return {
    totalReviews: reviews.length,
    settled: settled.length,
    open: open.length,
    wins: wins.length,
    losses: losses.length,
    winRate: settled.length ? wins.length / settled.length * 100 : 0,
    netR,
    netPnlPct: sum(settled.map((review) => review.netPnlPct ?? 0)),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0),
    expectancyR: settled.length ? netR / settled.length : 0,
    averageWinR,
    averageLossR,
    payoffRatio,
    breakevenWinRate: Number.isFinite(payoffRatio) && payoffRatio > 0 ? 100 / (1 + payoffRatio) : 0,
    realizedMaxDrawdownPct: maximumDrawdown(realizedCurve),
    mtmMaxDrawdownPct: maximumDrawdown(mtmCurve),
    realizedBenchmarkEquity: realizedCurve.at(-1) ?? 100,
    signalBenchmarkEquity: mtmCurve.at(-1) ?? 100
  };
}

export function buildProfitabilityBreakdown(reviews: ProfitabilityReview[], key: BreakdownKey) {
  const groups = new Map<string, ProfitabilityReview[]>();
  for (const review of reviews) {
    const value = key === "month"
      ? month(review.signalSentAt)
      : key === "strategyVersion"
        ? review.strategyVersion ?? "legacy/unknown"
        : String(review[key]);
    const group = groups.get(value) ?? [];
    group.push(review);
    groups.set(value, group);
  }
  return [...groups.entries()]
    .map(([value, group]) => ({ value, ...summarizeProfitability(group) }))
    .sort((a, b) => b.settled - a.settled || a.value.localeCompare(b.value));
}

function compoundCurve(returnsPct: number[]) {
  const curve = [100];
  for (const returnPct of returnsPct) curve.push(curve.at(-1)! * (1 + returnPct / 100));
  return curve;
}

function maximumDrawdown(curve: number[]) {
  let peak = curve[0] ?? 100;
  let drawdown = 0;
  for (const equity of curve) {
    peak = Math.max(peak, equity);
    if (peak > 0) drawdown = Math.max(drawdown, (peak - equity) / peak * 100);
  }
  return drawdown;
}

function month(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 7) : "unknown";
}

function timestamp(value: string) {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : 0;
}

function average(values: number[]) {
  return values.length ? sum(values) / values.length : 0;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
